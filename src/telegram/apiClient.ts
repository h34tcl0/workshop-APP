import { store } from "../db.js";

function handleUnlinkIfBlocked(targetChatId: string | number, errDetail: string): void {
  if (process.env.NODE_ENV !== "test" && targetChatId && (
    errDetail.includes("bot was blocked by the user") ||
    errDetail.includes("user is deactivated") ||
    errDetail.includes("chat not found")
  )) {
    console.warn(`[Telegram] Chat ID ${targetChatId} está deshabilitado/bloqueado (${errDetail}). Desvinculando automáticamente.`);
    try {
      store.unlinkTelegramByChatId(String(targetChatId).trim());
    } catch (_) {}
  }
}

export async function sendRequest(token: string, defaultChatId: string, method: string, payload: any): Promise<boolean> {
  const targetChatId = payload.chat_id || defaultChatId;
  const methodsWithoutChatId = ["answerCallbackQuery", "getUpdates", "setWebhook", "deleteWebhook", "getMe"];

  if (!token) {
    console.log(`[Telegram] SKIPPED: No TELEGRAM_BOT_TOKEN provided for method '${method}'`);
    return false;
  }

  if (!methodsWithoutChatId.includes(method) && !targetChatId) {
    const textPreview = (payload.text || "").substring(0, 60).replace(/\n/g, " ");
    console.log(`[Telegram] SKIPPED: No valid chatId provided for method '${method}': ${textPreview}`);
    return false;
  }

  const apiUrl = `https://api.telegram.org/bot${token}`;

  try {
    const response = await fetch(`${apiUrl}/${method}`, {
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
      handleUnlinkIfBlocked(targetChatId, errDetail);

      // Fallback automático: si falla Markdown, reintentar en texto plano
      if (payload.parse_mode) {
        console.warn(`[Telegram API Error] Method '${method}' failed with parse_mode='${payload.parse_mode}': ${errDetail}. Reintentando en texto plano sin parse_mode...`);
        const plainPayload = { ...payload };
        delete plainPayload.parse_mode;
        return await sendRequest(token, defaultChatId, method, plainPayload);
      }

      console.error(`[Telegram API Error] Method '${method}' failed: ${errDetail}`);
      return false;
    }
  } catch (err) {
    if (payload.parse_mode) {
      console.warn(`[Telegram HTTP Fetch Error] Method '${method}' falló: ${err}. Reintentando en texto plano sin parse_mode...`);
      const plainPayload = { ...payload };
      delete plainPayload.parse_mode;
      return await sendRequest(token, defaultChatId, method, plainPayload);
    }
    console.error(`[Telegram HTTP Fetch Error] Method '${method}' failed:`, err);
    return false;
  }
}

export async function sendTelegramMessage(
  token: string,
  defaultChatId: string,
  chatId: string | number,
  text: string,
  options: any = {}
): Promise<boolean> {
  const targetChatId = chatId ? String(chatId).trim() : defaultChatId;
  if (!token || !targetChatId) {
    console.log(`[Telegram] SKIPPED: Missing token or chatId for '${options.method || "sendMessage"}'`);
    return false;
  }

  try {
    const payload = {
      chat_id: targetChatId,
      text,
      parse_mode: options.parse_mode || "Markdown",
      ...options
    };
    const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
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
      handleUnlinkIfBlocked(targetChatId, errDetail);
      console.error(`[Telegram API Error] sendMessage to chatId ${targetChatId} failed: ${errDetail}`);
      return false;
    }
  } catch (err) {
    console.error(`[Telegram HTTP Fetch Error] sendMessage to chatId ${targetChatId}:`, err);
    return false;
  }
}

export async function answerCallbackQuery(
  token: string,
  callbackQueryId: string,
  text?: string,
  showAlert: boolean = false
): Promise<boolean> {
  if (!callbackQueryId) return false;
  return sendRequest(token, "", "answerCallbackQuery", {
    callback_query_id: callbackQueryId,
    text: text || undefined,
    show_alert: showAlert
  });
}

export async function editMessageText(
  token: string,
  chatId: string | number,
  messageId: number,
  text: string,
  keyboard?: any[]
): Promise<boolean> {
  const payload: any = {
    chat_id: chatId,
    message_id: messageId,
    text: text,
    parse_mode: "Markdown"
  };
  if (keyboard) {
    payload.reply_markup = { inline_keyboard: keyboard };
  }
  return sendRequest(token, String(chatId), "editMessageText", payload);
}

export async function editMessageKeyboard(
  token: string,
  chatId: string | number,
  messageId: number,
  keyboard: any[]
): Promise<boolean> {
  return sendRequest(token, String(chatId), "editMessageReplyMarkup", {
    chat_id: chatId,
    message_id: messageId,
    reply_markup: { inline_keyboard: keyboard }
  });
}
