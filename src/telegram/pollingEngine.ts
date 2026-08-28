import { loadPersistedOffset, persistOffset, alreadyProcessed } from "./state.js";
import { handleIncomingMessage } from "./commandHandlers.js";
import { processCallbackQuery } from "./callbackHandlers.js";

let pollingActive = false;
let pollingTimeout: NodeJS.Timeout | null = null;
let lastUpdateId = 0;

export function isPollingActive(): boolean {
  return pollingActive;
}

export function getLastUpdateId(): number {
  return lastUpdateId;
}

export function startPolling(token: string = process.env.TELEGRAM_BOT_TOKEN || ""): void {
  if (!token) {
    console.log("[Telegram Polling] SKIPPED: No TELEGRAM_BOT_TOKEN configured.");
    return;
  }
  if (pollingActive) {
    console.log("[Telegram Polling] Polling is already active.");
    return;
  }

  pollingActive = true;
  lastUpdateId = loadPersistedOffset(token);
  console.log(`[Telegram Polling] Starting background long polling for Telegram updates... (offset persistido: ${lastUpdateId})`);

  (async () => {
    // 1. Limpieza de Webhook previo (Evita conflicto HTTP 409)
    try {
      const delRes = await fetch(`https://api.telegram.org/bot${token}/deleteWebhook?drop_pending_updates=true`, { signal: AbortSignal.timeout(10000) });
      const delData = await delRes.json();
      if (delData && delData.ok) {
        console.log("[Telegram Polling] Webhook previo eliminado exitosamente.");
      }
    } catch (err) {
      console.error("[Telegram Polling] Error limpiando webhook:", err);
    }

    // 2. Validación de Token con getMe
    try {
      const getMeRes = await fetch(`https://api.telegram.org/bot${token}/getMe`, { signal: AbortSignal.timeout(10000) });
      const getMeData = await getMeRes.json();
      if (getMeData && getMeData.ok && getMeData.result) {
        console.log(`[Telegram Bot] Conectado exitosamente como @${getMeData.result.username}`);
      } else {
        console.warn(`[Telegram Bot] Error de validación de Token: ${JSON.stringify(getMeData)}`);
      }
    } catch (err) {
      console.error("[Telegram Bot] Error comprobando token con getMe:", err);
    }

    // 3. Bucle Long Polling
    let conflictCount = 0;
    const poll = async () => {
      if (!pollingActive) return;

      let delayMs = 3000;

      try {
        const url = `https://api.telegram.org/bot${token}/getUpdates?offset=${lastUpdateId + 1}&timeout=5`;
        const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
        if (res.ok) {
          conflictCount = 0;
          const data = await res.json();
          if (data.ok && Array.isArray(data.result)) {
            for (const update of data.result) {
              lastUpdateId = Math.max(lastUpdateId, update.update_id);
              persistOffset(token, lastUpdateId);

              if (alreadyProcessed(update.update_id)) {
                console.warn(`[Telegram Polling] update_id ${update.update_id} ya fue procesado recientemente, se omite (posible duplicado).`);
                continue;
              }

              try {
                if (update.callback_query) {
                  await processCallbackQuery(update.callback_query, token);
                } else if (update.message) {
                  await handleIncomingMessage(update.message, token);
                }
              } catch (innerErr) {
                console.error("[Telegram Polling] Error processing individual update:", innerErr);
              }
            }
          }
        } else {
          const errText = await res.text();
          if (res.status === 404 || res.status === 401) {
            console.warn(`[Telegram Polling] Invalid or missing Telegram Bot Token (HTTP ${res.status}). Polling paused.`);
            pollingActive = false;
            return;
          }
          if (res.status === 409) {
            conflictCount++;
            delayMs = Math.min(30000, 5000 * Math.pow(2, Math.min(conflictCount - 1, 3)));
            try {
              await fetch(`https://api.telegram.org/bot${token}/deleteWebhook?drop_pending_updates=true`);
            } catch (_) {}
            if (conflictCount === 1 || conflictCount % 10 === 0) {
              console.log(`[Telegram Polling] Instance conflict detected (409). Backing off for ${delayMs / 1000}s...`);
            }
          } else {
            console.error(`[Telegram Polling HTTP ${res.status}]: ${errText}`);
          }
        }
      } catch (err: any) {
        if (err?.name !== "AbortError" && err?.name !== "TimeoutError") {
          console.error("[Telegram Polling Exception]:", err);
        }
      }

      if (pollingActive) {
        pollingTimeout = setTimeout(poll, delayMs);
      }
    };

    poll();
  })();
}

export function stopPolling(): void {
  pollingActive = false;
  if (pollingTimeout) {
    clearTimeout(pollingTimeout);
    pollingTimeout = null;
  }
  console.log("[Telegram Polling] Stopped.");
}
