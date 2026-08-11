import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { DayEvaluation, DayStatus, Task, TaskStatus, DailyLog } from "./types.js";
import { store } from "./db.js";
import { getLocalDateIso } from "./dateUtils.js";
import { triggerSilentReevaluation } from "./scheduler.js";

// Persistimos el offset de Telegram (lastUpdateId) en disco, dentro de DATA_DIR,
// para que sobreviva a reinicios del proceso/contenedor. Sin esto, cada restart
// hace que Telegram reenvíe hasta 24h de updates ya procesados, causando
// respuestas duplicadas o contradictorias (bug detectado en producción, ago 2026).
//
// El offset queda atado a una huella del token del bot (hash, no el token en claro)
// porque los update_id NO son comparables entre bots distintos: cada bot tiene su
// propia numeración en los servidores de Telegram. Si se cambia de token (ej. al
// rotar producción/desarrollo) y se reusa un offset viejo de otro bot, Math.max()
// puede quedar "pegado" en un valor imposible de alcanzar por el bot nuevo, y
// Telegram termina reenviando la misma cola pendiente en loop infinito (bug
// detectado en producción, ago 2026, al rotar de @workshop_os_bot a un bot nuevo).
const TELEGRAM_STATE_FILE = path.join(process.env.DATA_DIR || "./data", "telegram_offset.json");

function tokenFingerprint(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex").slice(0, 16);
}

// Ventana de deduplicación en memoria: red de seguridad adicional por si dos
// instancias llegaran a procesar el mismo update_id casi en simultáneo.
const RECENTLY_PROCESSED_MAX = 200;

export class TelegramBotService {
  private token: string;
  private chatId: string;
  private apiUrl: string;

  private static pollingActive: boolean = false;
  private static pollingTimeout: NodeJS.Timeout | null = null;
  private static lastUpdateId: number = 0;
  private static recentlyProcessedIds: number[] = [];

  private static loadPersistedOffset(token: string): number {
    try {
      const raw = fs.readFileSync(TELEGRAM_STATE_FILE, "utf-8");
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed.lastUpdateId === "number" && parsed.tokenFingerprint === tokenFingerprint(token)) {
        return parsed.lastUpdateId;
      }
      if (parsed && parsed.tokenFingerprint && parsed.tokenFingerprint !== tokenFingerprint(token)) {
        console.warn("[Telegram Polling] El token cambió respecto al offset persistido. Se descarta el offset viejo y se arranca desde 0 para evitar contaminación cruzada entre bots.");
      }
    } catch (_) {
      // No existe todavía o está corrupto: arrancamos desde 0 (comportamiento anterior).
    }
    return 0;
  }

  private static persistOffset(token: string, updateId: number): void {
    try {
      const dir = path.dirname(TELEGRAM_STATE_FILE);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(TELEGRAM_STATE_FILE, JSON.stringify({ lastUpdateId: updateId, tokenFingerprint: tokenFingerprint(token) }), "utf-8");
    } catch (err) {
      console.error("[Telegram Polling] No se pudo persistir el offset:", err);
    }
  }

  private static alreadyProcessed(updateId: number): boolean {
    if (TelegramBotService.recentlyProcessedIds.includes(updateId)) return true;
    TelegramBotService.recentlyProcessedIds.push(updateId);
    if (TelegramBotService.recentlyProcessedIds.length > RECENTLY_PROCESSED_MAX) {
      TelegramBotService.recentlyProcessedIds.shift();
    }
    return false;
  }

  constructor(
    token: string = process.env.TELEGRAM_BOT_TOKEN || "",
    chatId: string = ""
  ) {
    this.token = token;
    this.chatId = chatId ? String(chatId).trim() : "";
    this.apiUrl = `https://api.telegram.org/bot${token}`;
  }

  public static startPolling(token: string = process.env.TELEGRAM_BOT_TOKEN || ""): void {
    if (!token) {
      console.log("[Telegram Polling] SKIPPED: No TELEGRAM_BOT_TOKEN configured.");
      return;
    }
    if (TelegramBotService.pollingActive) {
      console.log("[Telegram Polling] Polling is already active.");
      return;
    }

    TelegramBotService.pollingActive = true;
    TelegramBotService.lastUpdateId = TelegramBotService.loadPersistedOffset(token);
    console.log(`[Telegram Polling] Starting background long polling for Telegram updates... (offset persistido: ${TelegramBotService.lastUpdateId})`);

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
        if (!TelegramBotService.pollingActive) return;

        let delayMs = 3000;

        try {
          const url = `https://api.telegram.org/bot${token}/getUpdates?offset=${TelegramBotService.lastUpdateId + 1}&timeout=5`;
          const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
          if (res.ok) {
            conflictCount = 0;
            const data = await res.json();
            if (data.ok && Array.isArray(data.result)) {
              for (const update of data.result) {
                TelegramBotService.lastUpdateId = Math.max(TelegramBotService.lastUpdateId, update.update_id);
                TelegramBotService.persistOffset(token, TelegramBotService.lastUpdateId);

                if (TelegramBotService.alreadyProcessed(update.update_id)) {
                  console.warn(`[Telegram Polling] update_id ${update.update_id} ya fue procesado recientemente, se omite (posible duplicado).`);
                  continue;
                }

                const botSvc = new TelegramBotService(token);
                try {
                  if (update.callback_query) {
                    await botSvc.processCallbackQuery(update.callback_query);
                  } else if (update.message) {
                    await botSvc.handleIncomingMessage(update.message);
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
              TelegramBotService.pollingActive = false;
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
          if (err?.name === "AbortError" || err?.name === "TimeoutError") {
            // Normal timeout for long polling request
          } else {
            console.error("[Telegram Polling Exception]:", err);
          }
        }

        if (TelegramBotService.pollingActive) {
          TelegramBotService.pollingTimeout = setTimeout(poll, delayMs);
        }
      };

      poll();
    })();
  }

  public static stopPolling(): void {
    TelegramBotService.pollingActive = false;
    if (TelegramBotService.pollingTimeout) {
      clearTimeout(TelegramBotService.pollingTimeout);
      TelegramBotService.pollingTimeout = null;
    }
    console.log("[Telegram Polling] Stopped.");
  }

  public async sendTelegramMessage(chatId: string | number, text: string, options: any = {}): Promise<boolean> {
    const targetChatId = chatId ? String(chatId).trim() : this.chatId;
    if (!this.token || !targetChatId) {
      console.log(`[Telegram] SKIPPED: Missing token or chatId for '${options.method || 'sendMessage'}'`);
      return false;
    }

    try {
      const payload = {
        chat_id: targetChatId,
        text,
        parse_mode: options.parse_mode || "Markdown",
        ...options
      };
      const response = await fetch(`${this.apiUrl}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(10000)
      });
      const data = await response.json();
      if (data && data.ok) {
        return true;
      } else {
        const errDetail = data?.description || JSON.stringify(data);
        if (targetChatId && (
          errDetail.includes('bot was blocked by the user') ||
          errDetail.includes('user is deactivated') ||
          errDetail.includes('chat not found')
        )) {
          console.warn(`[Telegram] Chat ID ${targetChatId} está deshabilitado/bloqueado (${errDetail}). Desvinculando automáticamente.`);
          try { store.unlinkTelegramByChatId(String(targetChatId).trim()); } catch (_) {}
        }
        console.error(`[Telegram API Error] sendMessage to chatId ${targetChatId} failed: ${errDetail}`);
        return false;
      }
    } catch (err) {
      console.error(`[Telegram HTTP Fetch Error] sendMessage to chatId ${targetChatId}:`, err);
      return false;
    }
  }

  public async sendRequest(method: string, payload: any): Promise<boolean> {
    const targetChatId = payload.chat_id || this.chatId;
    const methodsWithoutChatId = ["answerCallbackQuery", "getUpdates", "setWebhook", "deleteWebhook", "getMe"];

    if (!this.token) {
      console.log(`[Telegram] SKIPPED: No TELEGRAM_BOT_TOKEN provided for method '${method}'`);
      return false;
    }

    if (!methodsWithoutChatId.includes(method) && !targetChatId) {
      const textPreview = (payload.text || "").substring(0, 60).replace(/\n/g, " ");
      console.log(`[Telegram] SKIPPED: No valid chatId provided for method '${method}': ${textPreview}`);
      return false;
    }

    try {
      const response = await fetch(`${this.apiUrl}/${method}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(10000)
      });
      const data = await response.json();
      if (data && data.ok) {
        return true;
      } else {
        const errDetail = data?.description || JSON.stringify(data);
        if (targetChatId && (
          errDetail.includes('bot was blocked by the user') ||
          errDetail.includes('user is deactivated') ||
          errDetail.includes('chat not found')
        )) {
          console.warn(`[Telegram] Chat ID ${targetChatId} está deshabilitado/bloqueado (${errDetail}). Desvinculando automáticamente.`);
          try { store.unlinkTelegramByChatId(String(targetChatId).trim()); } catch (_) {}
        }
        // Fallback automático: si falla la interpretación de Markdown, reintentar sin parse_mode (texto plano)
        if (payload.parse_mode) {
          console.warn(`[Telegram API Error] Method '${method}' failed with parse_mode='${payload.parse_mode}': ${errDetail}. Reintentando en texto plano sin parse_mode...`);
          const plainPayload = { ...payload };
          delete plainPayload.parse_mode;
          return await this.sendRequest(method, plainPayload);
        }

        console.error(`[Telegram API Error] Method '${method}' failed: ${errDetail}`);
        return false;
      }
    } catch (err) {
      if (payload.parse_mode) {
        console.warn(`[Telegram HTTP Fetch Error] Method '${method}' falló: ${err}. Reintentando en texto plano sin parse_mode...`);
        const plainPayload = { ...payload };
        delete plainPayload.parse_mode;
        return await this.sendRequest(method, plainPayload);
      }
      console.error(`[Telegram HTTP Fetch Error] Method '${method}' failed:`, err);
      return false;
    }
  }

  async sendWorkStartNotification(evalResult: DayEvaluation): Promise<boolean> {
    const parts = evalResult.eval_date.split("-");
    const dateStr = parts.length === 3 ? `${parts[2]}/${parts[1]}/${parts[0]}` : evalResult.eval_date;

    if (evalResult.status !== DayStatus.DAY_VIABLE || !evalResult.window) {
      return false;
    }

    const w = evalResult.window;
    const startStr = w.start_time;
    const endStr = w.end_time;

    const [startH, startM] = startStr.split(":").map(Number);
    const [endH, endM] = endStr.split(":").map(Number);

    const setupEndH = (startH + 1) % 24;
    const setupEndStr = `${String(setupEndH).padStart(2, "0")}:${String(startM).padStart(2, "0")}`;

    const teardownStartH = (endH - 1 + 24) % 24;
    const teardownStartStr = `${String(teardownStartH).padStart(2, "0")}:${String(endM).padStart(2, "0")}`;

    let taskListStr = "  • Sin tareas asignadas";
    if (evalResult.scheduled_tasks && evalResult.scheduled_tasks.length > 0) {
      taskListStr = evalResult.scheduled_tasks
        .map(t => `  • *${t.title}* (${t.estimated_hours}h)`)
        .join("\n");
    }

    const message =
      `🚀 *¡INICIO DE JORNADA DE TRABAJO (${dateStr})!* 🚀\n\n` +
      `🔔 Tu primer bloque de trabajo agendado está por comenzar.\n\n` +
      `🕒 *Horario de Jornada:* ${startStr} - ${endStr} (${w.total_duration_hours.toFixed(1)}h total)\n\n` +
      `📋 *Desglose del Bloque Macro:*\n` +
      `  🔧 *01h Setup:* ${startStr} - ${setupEndStr}\n` +
      `  🪵 *${w.net_work_hours.toFixed(1)}h Trabajo Neto:* ${setupEndStr} - ${teardownStartStr}\n` +
      `  🧹 *01h Teardown:* ${teardownStartStr} - ${endStr}\n\n` +
      `🎯 *Actividades del Bloque:*\n${taskListStr}\n\n` +
      `⚠️ *Preparación:* Verifica tus herramientas y condiciones de seguridad antes de comenzar. ¡Éxito en la jornada!`;

    return this.sendRequest("sendMessage", {
      chat_id: this.chatId,
      text: message,
      parse_mode: "Markdown"
    });
  }

  async sendMorningEvaluation(evalResult: DayEvaluation): Promise<boolean> {
    const parts = evalResult.eval_date.split("-");
    const dateStr = parts.length === 3 ? `${parts[2]}/${parts[1]}/${parts[0]}` : evalResult.eval_date;

    let message = "";

    if (evalResult.status === DayStatus.DAY_VIABLE && evalResult.window) {
      const w = evalResult.window;
      const startStr = w.start_time;
      const endStr = w.end_time;

      const [startH, startM] = startStr.split(":").map(Number);
      const [endH, endM] = endStr.split(":").map(Number);

      const setupEndH = (startH + 1) % 24;
      const setupEndStr = `${String(setupEndH).padStart(2, "0")}:${String(startM).padStart(2, "0")}`;

      const teardownStartH = (endH - 1 + 24) % 24;
      const teardownStartStr = `${String(teardownStartH).padStart(2, "0")}:${String(endM).padStart(2, "0")}`;

      let taskListStr = "  • Sin tareas asignadas";
      if (evalResult.scheduled_tasks && evalResult.scheduled_tasks.length > 0) {
        taskListStr = evalResult.scheduled_tasks
          .map(t => `  • *${t.title}* (${t.estimated_hours}h)`)
          .join("\n");
      }

      message =
        `☀️ *PLAN DE TALLER DE HOY (${dateStr})* ☀️\n\n` +
        `✅ *Día Viable (DAY_VIABLE)*\n` +
        `🕒 *Jornada:* ${startStr} - ${endStr} (${w.total_duration_hours.toFixed(1)}h total)\n\n` +
        `📋 *Desglose del Bloque Macro:*\n` +
        `  🔧 *01h Setup:* ${startStr} - ${setupEndStr}\n` +
        `  🪵 *${w.net_work_hours.toFixed(1)}h Trabajo Neto:* ${setupEndStr} - ${teardownStartStr}\n` +
        `  🧹 *01h Teardown:* ${teardownStartStr} - ${endStr}\n\n` +
        `🎯 *Tareas Agendadas:*\n${taskListStr}\n\n` +
        `⏰ *Jornada de taller activa para hoy.*`;
    } else {
      message =
        `🌧️ *REPORTE CLIMÁTICO DE HOY (${dateStr})* 🌧️\n\n` +
        `🛑 *Día Suspendido (DAY_BLOCKED)*\n\n` +
        `📝 *Causa Climática:*\n${evalResult.reason}\n\n` +
        `🛋️ *Acción:* La jornada de taller permanecerá en suspenso. ¡Aprovecha para planificación o descanso!`;
    }

    return this.sendRequest("sendMessage", {
      chat_id: this.chatId,
      text: message,
      parse_mode: "Markdown"
    });
  }

  async sendWeatherAlertBurst(dailyLogId: number, alertText: string): Promise<boolean> {
    const cleanAlertText = (alertText || "").replace(/<!--[\s\S]*?-->/g, "").trim();
    const msg1 = "🚨 ⚠️ *¡ALERTA DE EMERGENCIA EN TALLER!*";
    const msg2 = cleanAlertText.startsWith("🌧️") || cleanAlertText.startsWith("💨") || cleanAlertText.startsWith("🚨")
      ? cleanAlertText
      : `🌧️ *CAMBIO CLIMÁTICO IMPREVISTO:* ${cleanAlertText}`;
    const msg3 = "🛠️ *ACCIÓN REQUERIDA:* Cubre la madera expuesta, suspende aplicados de encolado/barniz y resguarda el taller.";

    const inlineKeyboard = [
      [
        { text: "🔕 Silenciar Alarma / Enterado", callback_data: `ack_alarm:${dailyLogId}` }
      ]
    ];

    const res1 = await this.sendRequest("sendMessage", {
      chat_id: this.chatId,
      text: msg1,
      parse_mode: "Markdown"
    });

    const res2 = await this.sendRequest("sendMessage", {
      chat_id: this.chatId,
      text: msg2,
      parse_mode: "Markdown"
    });

    const res3 = await this.sendRequest("sendMessage", {
      chat_id: this.chatId,
      text: msg3,
      parse_mode: "Markdown",
      reply_markup: { inline_keyboard: inlineKeyboard }
    });

    return res1 || res2 || res3;
  }

  async sendIntradayEmergencyAlertBurst(dailyLogId: number, alertText: string): Promise<boolean> {
    return this.sendWeatherAlertBurst(dailyLogId, alertText);
  }

  async sendCheckinPrompt(dailyLogId: number, scheduledTasks: Task[]): Promise<boolean> {
    if (!scheduledTasks || scheduledTasks.length === 0) {
      return true;
    }

    const taskListStr = scheduledTasks.map(t => `  • ${t.title} (${t.estimated_hours}h)`).join("\n");
    const message =
      `🌙 *CIERRE DE JORNADA*\n\n` +
      `Tareas agendadas hoy:\n${taskListStr}\n\n` +
      `¿Se completaron *todas*?`;

    const inlineKeyboard = [
      [
        { text: "✅ Sí, todas", callback_data: `chkall:${dailyLogId}` },
        { text: "✍️ No, marcar cuáles", callback_data: `chkpick:${dailyLogId}` }
      ]
    ];

    return this.sendRequest("sendMessage", {
      chat_id: this.chatId,
      text: message,
      parse_mode: "Markdown",
      reply_markup: { inline_keyboard: inlineKeyboard }
    });
  }

  private buildPickerKeyboard(dailyLogId: number, scheduledTasks: Task[], checkedIds: Set<number>): any[] {
    const rows: any[] = [];
    for (const t of scheduledTasks) {
      const mark = checkedIds.has(t.id) ? "✅" : "🔁";
      rows.push([{ text: `${mark} Tarea: ${t.title}`, callback_data: `chk:${dailyLogId}:${t.id}` }]);
    }
    rows.push([{ text: "💾 FINALIZAR CHECK-IN", callback_data: `chkconfirm:${dailyLogId}` }]);
    return rows;
  }

  private async editMessageKeyboard(chatId: string | number, messageId: number, keyboard: any[]): Promise<boolean> {
    return this.sendRequest("editMessageReplyMarkup", {
      chat_id: chatId,
      message_id: messageId,
      reply_markup: { inline_keyboard: keyboard }
    });
  }

  private async editMessageText(chatId: string | number, messageId: number, text: string, keyboard?: any[]): Promise<boolean> {
    const payload: any = {
      chat_id: chatId,
      message_id: messageId,
      text: text,
      parse_mode: "Markdown"
    };
    if (keyboard) {
      payload.reply_markup = { inline_keyboard: keyboard };
    }
    return this.sendRequest("editMessageText", payload);
  }

  async handleIncomingMessage(msg: any): Promise<{ status: string; message: string }> {
    const rawChatId = msg.chat?.id || msg.from?.id;
    if (!rawChatId) {
      return { status: "error", message: "No chat ID in message" };
    }

    const chatStr = String(rawChatId).trim();
    const text: string = (msg.text || "").trim();
    const cleanText = text.toLowerCase().trim();
    const replyBot = new TelegramBotService(this.token, chatStr);
    const user = store.getUserByTelegramChatId(chatStr);

    // Permitir /start y /help ANTES de verificar usuario para mostrar Chat ID si no está vinculado
    if (cleanText.startsWith("/start") || cleanText.startsWith("/help")) {
      let startMsg = `👋 *¡Hola!*\nTu Chat ID de Telegram es: \`${chatStr}\`\n\n`;
      if (user) {
        startMsg += `✅ Tu cuenta está correctamente vinculada a AGENDAPP con el correo *${user.email}*.\n\n*Comandos disponibles:*\n• \`/materiales\` - Ver insumos pendientes por comprar (🔴)`;
      } else {
        startMsg += `⚠️ *Aviso:* Este Chat ID no está vinculado a ninguna cuenta en AGENDAPP.\nAsegúrate de copiar el número \`${chatStr}\` y registrarlo en la Configuración de AGENDAPP.`;
      }

      await replyBot.sendRequest("sendMessage", {
        chat_id: chatStr,
        text: startMsg,
        parse_mode: "Markdown"
      });
      return { status: "ok", message: "Responded to /start" };
    }

    // /vincular <código> tiene que poder ejecutarse ANTES de la verificación de usuario,
    // porque justamente un chat todavía no vinculado necesita poder mandar este comando.
    if (cleanText.startsWith("/vincular") || cleanText.startsWith("vincular")) {
      const parts = text.trim().split(/\s+/);
      const code = parts.length > 1 ? parts[1] : "";

      if (!code) {
        await replyBot.sendRequest("sendMessage", {
          chat_id: chatStr,
          text: `⚠️ Escribí el código junto al comando, por ejemplo:\n\`/vincular 123456\`\n\nGenerá tu código desde Ajustes en la app web.`,
          parse_mode: "Markdown"
        });
        return { status: "ok", message: "Missing code for /vincular" };
      }

      const result = store.consumeTelegramLinkCode(code, chatStr);

      if (result.success) {
        await replyBot.sendRequest("sendMessage", {
          chat_id: chatStr,
          text: `✅ *¡Vinculación exitosa!*\nEste chat quedó conectado a AGENDAPP con el correo *${result.email}*.\n\n*Comandos disponibles:*\n• \`/materiales\` - Ver insumos pendientes por comprar (🔴)`,
          parse_mode: "Markdown"
        });
      } else {
        await replyBot.sendRequest("sendMessage", {
          chat_id: chatStr,
          text: `⚠️ ${result.error || "Código inválido o expirado. Generá uno nuevo desde la app."}`,
          parse_mode: "Markdown"
        });
      }
      return { status: result.success ? "ok" : "invalid_code", message: result.success ? "Telegram linked" : "Invalid or expired code" };
    }

    if (!user) {
      await replyBot.sendRequest("sendMessage", {
        chat_id: chatStr,
        text: `⚠️ Este chat de Telegram no está vinculado a ninguna cuenta en AGENDAPP.\n\nTu Chat ID es: \`${chatStr}\`.\nPara vincularlo: generá un código desde *Ajustes* en la app web, y mandalo acá como \`/vincular 123456\`.`,
        parse_mode: "Markdown"
      });
      return {
        status: "unauthorized",
        message: "⚠️ Este chat de Telegram no está vinculado a ninguna cuenta en AGENDAPP."
      };
    }

    if (cleanText === "/materiales" || cleanText === "materiales" || cleanText.startsWith("/materiales")) {
      const pendingByProject = store.getPendingMaterialsGroupedByProject(user.id);
      const pendingTools = store.getPendingTools(user.id);

      if (pendingByProject.length === 0 && pendingTools.length === 0) {
        await replyBot.sendRequest("sendMessage", {
          chat_id: chatStr,
          text: `📦 *COMPRAS PENDIENTES* (🔴)\n\n✅ ¡Excelente! No tienes insumos ni herramientas pendientes por comprar.`,
          parse_mode: "Markdown"
        });
      } else {
        let msgText = `📦 *RESUMEN DE COMPRAS PENDIENTES* (🔴)\n\n`;
        let totalItems = 0;
        if (pendingByProject.length > 0) {
          msgText += `*Insumos / Materiales:*\n`;
          for (const projGroup of pendingByProject) {
            msgText += `📁 *Proyecto: ${projGroup.project_name}*\n`;
            for (const m of projGroup.materials) {
              const icon = m.status === 'out_of_stock' ? '⚠️' : '🔴';
              msgText += `  • ${icon} *${m.quantity} ${m.unit}* - ${m.name} _[${m.category}]_\n`;
              totalItems++;
            }
            msgText += `\n`;
          }
        }
        if (pendingTools.length > 0) {
          msgText += `🛠️ *Herramientas Por Comprar:*\n`;
          for (const t of pendingTools) {
            msgText += `  • 🔴 *${t.name}* _[${t.category}]_${t.notes ? ` - ${t.notes}` : ''}\n`;
            totalItems++;
          }
          msgText += `\n`;
        }
        msgText += `📌 *Total:* ${totalItems} ítems pendientes por comprar.`;
        await replyBot.sendRequest("sendMessage", {
          chat_id: chatStr,
          text: msgText,
          parse_mode: "Markdown"
        });
      }
    } else {
      await replyBot.sendRequest("sendMessage", {
        chat_id: chatStr,
        text: `🤖 *AGENDAPP (Workshop OS)* (${user.email})\nRecibido: "${text}".\nUsa \`/materiales\` para consultar insumos pendientes o responde a las alertas de taller.`,
        parse_mode: "Markdown"
      });
    }

    return { status: "ok", message: "Message processed" };
  }

  public async answerCallbackQuery(callbackQueryId: string, text?: string, showAlert: boolean = false): Promise<boolean> {
    if (!callbackQueryId) return false;
    return this.sendRequest("answerCallbackQuery", {
      callback_query_id: callbackQueryId,
      text: text || undefined,
      show_alert: showAlert
    });
  }

  async processCallbackQuery(callbackQuery: any): Promise<{ status: string; message: string }> {
    const cbId = callbackQuery?.id;
    const data: string = (callbackQuery?.data || "").trim();
    const message = callbackQuery?.message || {};
    const messageId = message.message_id;
    const rawChatId = (message.chat || {}).id || callbackQuery?.from?.id || this.chatId;
    const chatStr = String(rawChatId).trim();

    let cbAnswered = false;
    let responseText = "Actualizado";
    let showAlert = false;

    const replyBot = new TelegramBotService(this.token, chatStr);

    try {
      const user = store.getUserByTelegramChatId(chatStr);
      if (!user) {
        responseText = "⚠️ Este chat de Telegram no está vinculado a ninguna cuenta en AGENDAPP.";
        showAlert = true;
        if (cbId) {
          await replyBot.answerCallbackQuery(cbId, responseText, true);
          cbAnswered = true;
        }
        await replyBot.sendRequest("sendMessage", {
          chat_id: chatStr,
          text: "⚠️ Este chat de Telegram no está vinculado a ninguna cuenta en AGENDAPP."
        });
        return { status: "unauthorized", message: responseText };
      }

      const userId = user.id;

      if (data.startsWith("ack_alarm") || data.startsWith("wxack:") || data.startsWith("ack_intraday_alert:") || data.startsWith("intraday_ack:")) {
        const parts = data.split(":");
        let dailyLogId = parts[1] ? parseInt(parts[1], 10) : NaN;

        let dailyLog = !isNaN(dailyLogId) ? store.getDailyLogById(userId, dailyLogId) : null;
        if (!dailyLog) {
          const appSettings = store.getAppSettings(userId);
          const userTz = (appSettings as any)?.timezone || process.env.TIMEZONE || "America/Santiago";
          const todayIso = getLocalDateIso(new Date(), userTz);
          dailyLog = store.getDailyLogByDate(userId, todayIso);
        }

        if (dailyLog && dailyLog.user_id === userId) {
          store.updateDailyLog(userId, dailyLog.id, {
            intraday_alert_acknowledged: true,
            weather_alert_acknowledged: true
          });
        }

        responseText = "Alarma silenciada para la jornada actual ✅";
        showAlert = true;

        if (cbId) {
          await replyBot.answerCallbackQuery(cbId, responseText, true);
          cbAnswered = true;
        }

        if (messageId) {
          await replyBot.editMessageText(
            chatStr,
            messageId,
            "🔕 *Alarma silenciada para la jornada actual ✅*\n_Notificaciones de alerta pausadas por el resto del día._"
          );
        }
      } else if (data.startsWith("task_complete:")) {
        const parts = data.split(":");
        const taskId = parseInt(parts[1], 10);
        const targetUserId = parts[2] ? parseInt(parts[2], 10) : userId;

        if (isNaN(taskId)) {
          responseText = "ID de tarea no válido";
          showAlert = true;
        } else if (targetUserId !== userId) {
          responseText = "No tienes permiso para modificar esta tarea";
          showAlert = true;
        } else {
          const task = store.getTask(userId, taskId);
          if (!task || task.user_id !== userId) {
            responseText = "No tienes permiso para modificar esta tarea";
            showAlert = true;
          } else {
            const nowIso = new Date().toISOString();
            store.updateTask(userId, task.id, {
              status: TaskStatus.COMPLETED,
              progress_percentage: 100,
              completed_at: nowIso
            });
            responseText = "✅ Tarea completada";
            showAlert = false;

            if (cbId) {
              await replyBot.answerCallbackQuery(cbId, responseText, showAlert);
              cbAnswered = true;
            }

            if (messageId) {
              await replyBot.editMessageText(
                chatStr,
                messageId,
                `✅ *Tarea completada:* ${task.title}`
              );
            }
          }
        }
      } else if (data.startsWith("chkall:") || data.startsWith("checkin_all:") || data.startsWith("checkin_yes:")) {
        const dailyLogId = parseInt(data.split(":")[1], 10);
        const dailyLog = store.getDailyLogById(userId, dailyLogId);
        if (!dailyLog || dailyLog.user_id !== userId) {
          responseText = "No tienes permiso para modificar este registro";
          showAlert = true;
        } else {
          if (!dailyLog.checkin_resolved) {
            let taskIds: number[] = [];
            try {
              taskIds = JSON.parse(dailyLog.scheduled_task_ids || "[]");
            } catch (_) {}
            const nowIso = new Date().toISOString();
            for (const tid of taskIds) {
              const t = store.getTask(userId, tid);
              if (t && t.user_id === userId && t.status !== TaskStatus.COMPLETED) {
                store.updateTask(userId, t.id, {
                  status: TaskStatus.COMPLETED,
                  progress_percentage: 100,
                  completed_at: nowIso
                });
              }
            }
            store.updateDailyLog(userId, dailyLogId, { checkin_sent: true, checkin_resolved: true });
            await triggerSilentReevaluation(userId, dailyLog.eval_date);
          }
          responseText = "✅ Día completo. ¡Buen trabajo!";
          showAlert = false;

          if (cbId) {
            await replyBot.answerCallbackQuery(cbId, responseText, showAlert);
            cbAnswered = true;
          }

          if (messageId) {
            await replyBot.editMessageText(chatStr, messageId, "✅ *Día completo.* ¡Excelente trabajo!");
          }
        }
      } else if (data.startsWith("chkpick:") || data.startsWith("checkin_pick:") || data.startsWith("checkin_partial:") || data.startsWith("checkin_no:")) {
        const dailyLogId = parseInt(data.split(":")[1], 10);
        const dailyLog = store.getDailyLogById(userId, dailyLogId);
        if (!dailyLog || dailyLog.user_id !== userId) {
          responseText = "No tienes permiso para modificar este registro";
          showAlert = true;
        } else {
          let taskIds: number[] = [];
          try {
            taskIds = JSON.parse(dailyLog.scheduled_task_ids || "[]");
          } catch (_) {}
          const scheduledTasks = taskIds.map(tid => store.getTask(userId, tid)).filter((t): t is Task => t != null && t.user_id === userId);
          responseText = "Marca el estado de cada tarea";
          showAlert = false;

          if (cbId) {
            await replyBot.answerCallbackQuery(cbId, responseText, showAlert);
            cbAnswered = true;
          }

          if (scheduledTasks.length === 0) {
            if (messageId) {
              await replyBot.editMessageText(chatStr, messageId, "ℹ️ No hay tareas agendadas para hoy.");
            }
          } else if (messageId) {
            const initialCompletedIds = new Set(scheduledTasks.map(t => t.id));
            const keyboard = this.buildPickerKeyboard(dailyLogId, scheduledTasks, initialCompletedIds);
            await replyBot.editMessageText(
              chatStr,
              messageId,
              "🌙 *Selección de Tareas de la Jornada*\n\nToca cada tarea para alternar entre Completada (✅) y Reagendar (🔁). Al finalizar, presiona *FINALIZAR CHECK-IN*.",
              keyboard
            );
          }
        }
      } else if (data.startsWith("chk:") || data.startsWith("checkin_toggle:")) {
        const parts = data.split(":");
        const dailyLogId = parseInt(parts[1], 10);
        const taskId = parseInt(parts[2], 10);

        const dailyLog = store.getDailyLogById(userId, dailyLogId);
        if (!dailyLog || dailyLog.user_id !== userId) {
          responseText = "No tienes permiso para modificar este registro";
          showAlert = true;
        } else {
          const currentKeyboard = (message.reply_markup || {}).inline_keyboard || [];
          const checkedIds = new Set<number>();
          const scheduledIdsInOrder: number[] = [];

          for (const row of currentKeyboard) {
            for (const btn of row) {
              const cb = btn.callback_data || "";
              if (cb.startsWith("chk:") || cb.startsWith("checkin_toggle:")) {
                const tid = parseInt(cb.split(":")[2], 10);
                if (!isNaN(tid)) {
                  if (!scheduledIdsInOrder.includes(tid)) scheduledIdsInOrder.push(tid);
                  if ((btn.text || "").startsWith("✅")) {
                    checkedIds.add(tid);
                  }
                }
              }
            }
          }

          if (checkedIds.has(taskId)) {
            checkedIds.delete(taskId);
          } else {
            checkedIds.add(taskId);
          }

          let scheduledTasks = scheduledIdsInOrder.map(tid => store.getTask(userId, tid)).filter((t): t is Task => t != null && t.user_id === userId);
          if (scheduledTasks.length === 0 && dailyLog.scheduled_task_ids) {
            try {
              const ids: number[] = JSON.parse(dailyLog.scheduled_task_ids);
              scheduledTasks = ids.map(tid => store.getTask(userId, tid)).filter((t): t is Task => t != null && t.user_id === userId);
            } catch (_) {}
          }

          responseText = "Estado alternado";
          showAlert = false;

          if (cbId) {
            await replyBot.answerCallbackQuery(cbId, responseText, showAlert);
            cbAnswered = true;
          }

          if (messageId) {
            const keyboard = this.buildPickerKeyboard(dailyLogId, scheduledTasks, checkedIds);
            await replyBot.editMessageKeyboard(chatStr, messageId, keyboard);
          }
        }
      } else if (data.startsWith("chkconfirm:") || data.startsWith("checkin_confirm:") || data.startsWith("checkin_finish:")) {
        const dailyLogId = parseInt(data.split(":")[1], 10);
        const dailyLog = store.getDailyLogById(userId, dailyLogId);
        if (!dailyLog || dailyLog.user_id !== userId) {
          responseText = "No tienes permiso para modificar este registro";
          showAlert = true;
        } else {
          const currentKeyboard = (message.reply_markup || {}).inline_keyboard || [];
          const checkedIds = new Set<number>();
          const allIds: number[] = [];

          for (const row of currentKeyboard) {
            for (const btn of row) {
              const cb = btn.callback_data || "";
              if (cb.startsWith("chk:") || cb.startsWith("checkin_toggle:")) {
                const tid = parseInt(cb.split(":")[2], 10);
                if (!isNaN(tid)) {
                  if (!allIds.includes(tid)) allIds.push(tid);
                  if ((btn.text || "").startsWith("✅")) {
                    checkedIds.add(tid);
                  }
                }
              }
            }
          }

          if (allIds.length === 0 && dailyLog.scheduled_task_ids) {
            try {
              const ids: number[] = JSON.parse(dailyLog.scheduled_task_ids);
              allIds.push(...ids);
            } catch (_) {}
          }

          const nowIso = new Date().toISOString();
          let completedCount = 0;
          let rescheduledCount = 0;

          for (const tid of allIds) {
            const t = store.getTask(userId, tid);
            if (!t || t.user_id !== userId) continue;
            if (checkedIds.has(tid)) {
              store.updateTask(userId, t.id, {
                status: TaskStatus.COMPLETED,
                progress_percentage: 100,
                completed_at: nowIso
              });
              completedCount++;
            } else {
              store.updateTask(userId, t.id, {
                status: TaskStatus.PENDING,
                completed_at: null
              });
              rescheduledCount++;
            }
          }

          store.updateDailyLog(userId, dailyLogId, { checkin_sent: true, checkin_resolved: true });
          await triggerSilentReevaluation(userId, dailyLog.eval_date);
          responseText = "Check-in finalizado";
          showAlert = false;

          if (cbId) {
            await replyBot.answerCallbackQuery(cbId, responseText, showAlert);
            cbAnswered = true;
          }

          if (messageId) {
            const summaryText = `📝 **Check-in completado exitosamente.** Resumen: ${completedCount} tareas completadas, ${rescheduledCount} reagendadas.`;
            await replyBot.editMessageText(chatStr, messageId, summaryText);
          }
        }
      }
    } catch (err: any) {
      console.error("[Telegram] Error processing callback query:", err);
      responseText = "Error procesando solicitud";
    } finally {
      if (cbId && !cbAnswered) {
        try {
          await replyBot.answerCallbackQuery(cbId, responseText, showAlert);
        } catch (e) {
          console.error("[Telegram] Failed to answer callback query in finally block:", e);
        }
      }
    }

    return { status: "ok", message: responseText };
  }
}
