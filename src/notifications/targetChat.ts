/**
 * Resuelve el ID de chat de Telegram configurado para el usuario o fallback del sistema.
 */
export function getTargetChatId(userId: number, telegramChatIdFromSettings?: string | null): string {
  let targetChatId = telegramChatIdFromSettings ? telegramChatIdFromSettings.trim() : "";
  if (!targetChatId && userId === 1 && process.env.TELEGRAM_CHAT_ID) {
    targetChatId = process.env.TELEGRAM_CHAT_ID.trim();
  }
  return targetChatId;
}
