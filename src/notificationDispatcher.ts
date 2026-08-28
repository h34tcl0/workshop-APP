import { getTargetChatId } from "./notifications/targetChat.js";
import { processWorkStartNotification } from "./notifications/workStartNotifier.js";
import { processCheckinNotification } from "./notifications/checkinNotifier.js";
import { processWeatherAlert } from "./notifications/weatherAlertNotifier.js";
import { sanitizeMarkdown } from "./notifications/markdownUtils.js";

/**
 * NotificationDispatcher: Fachada central para la gestión y orquestación
 * de notificaciones multicanal (Tier 2, Tier 3, Tier 4).
 */
export class NotificationDispatcher {
  public static getTargetChatId(userId: number, telegramChatIdFromSettings?: string | null): string {
    return getTargetChatId(userId, telegramChatIdFromSettings);
  }

  public static async processWorkStartNotification(
    userId: number,
    nowDate?: Date,
    force: boolean = false
  ): Promise<{ sent: boolean; reason: string }> {
    return processWorkStartNotification(userId, nowDate, force);
  }

  public static async processCheckinNotification(
    userId: number,
    nowDate?: Date,
    force: boolean = false
  ): Promise<boolean> {
    return processCheckinNotification(userId, nowDate, force);
  }

  public static async processWeatherAlert(
    userId: number,
    nowDate?: Date
  ): Promise<void> {
    return processWeatherAlert(userId, nowDate);
  }
}

export {
  getTargetChatId,
  processWorkStartNotification,
  processCheckinNotification,
  processWeatherAlert,
  sanitizeMarkdown
};
