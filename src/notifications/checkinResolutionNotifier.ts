import { TelegramBotService } from "../telegramBot.js";
import { store } from "../db.js";
import { getTargetChatId } from "./targetChat.js";

export type CheckinResolutionOrigin = 'user' | 'auto_midnight' | 'auto_catchup';

export interface SendCheckinResolutionNotificationParams {
  userId: number;
  dateStr: string;
  completedCount: number;
  totalCount: number;
  origin: CheckinResolutionOrigin; // OBLIGATORIO: Sin default ambiguo
}

/**
 * Notificación espejo a Telegram para cierres de jornada.
 *
 * REGLAS FUNDAMENTALES DE DOMINIO:
 * 1. origin === 'user': El usuario resolvió explícitamente el check-in (vía web o interacción manual).
 *    SÍ despacha mensaje a Telegram confirmando la acción.
 * 2. origin === 'auto_midnight' | 'auto_catchup': Auto-cierre de medianoche o catch-up de días acumulados.
 *    NUNCA debe notificar por ningún canal. Es estrictamente silencioso.
 *
 * PROHIBICIÓN: Queda estrictamente prohibido discriminar por fechas (ej. dateIso < todayIso).
 * La supresión se rige única y exclusivamente por el flag explícito 'origin'.
 */
export async function sendCheckinResolutionNotification(
  params: SendCheckinResolutionNotificationParams
): Promise<boolean> {
  // CRÍTICO: Si el origen no es explícitamente 'user', abortar inmediatamente sin llamar a Telegram.
  if (params.origin !== 'user') {
    return false;
  }

  const appSettings = store.getAppSettings(params.userId);
  const targetChatId = getTargetChatId(params.userId, appSettings?.telegram_chat_id);

  if (!targetChatId || !process.env.TELEGRAM_BOT_TOKEN) {
    return false;
  }

  try {
    let msg = `📋 <b>Cierre de Jornada Registrado (Vía Web)</b>\n`;
    msg += `📅 Fecha: <code>${params.dateStr}</code>\n\n`;
    msg += `✅ Tareas marcadas como completadas: <b>${params.completedCount} / ${params.totalCount}</b>\n`;
    msg += `✨ La agenda y el pronóstico de los próximos días han sido re-evaluados automáticamente.`;

    const telegramSvc = new TelegramBotService(process.env.TELEGRAM_BOT_TOKEN, targetChatId);
    await telegramSvc.sendTelegramMessage(targetChatId, msg);
    return true;
  } catch (tgErr) {
    console.warn('[Telegram Mirror] Error sending web checkin mirror message:', tgErr);
    return false;
  }
}
