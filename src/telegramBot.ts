import { DayEvaluation, Task } from "./types.js";
import { loadPersistedOffset, persistOffset, alreadyProcessed } from "./telegram/state.js";
import { sendRequest, sendTelegramMessage, answerCallbackQuery, editMessageText, editMessageKeyboard } from "./telegram/apiClient.js";
import { buildPickerKeyboard, buildCheckinPromptKeyboard, buildEmergencyAlertKeyboard } from "./telegram/keyboards.js";
import { sendWorkStartNotification, sendMorningEvaluation, sendWeatherAlertBurst, sendCheckinPrompt } from "./telegram/notifications.js";
import { handleIncomingMessage } from "./telegram/commandHandlers.js";
import { processCallbackQuery } from "./telegram/callbackHandlers.js";
import { startPolling, stopPolling } from "./telegram/pollingEngine.js";

export class TelegramBotService {
  private token: string;
  private chatId: string;

  public static startPolling(token: string = process.env.TELEGRAM_BOT_TOKEN || ""): void {
    startPolling(token);
  }

  public static stopPolling(): void {
    stopPolling();
  }

  public static loadPersistedOffset(token: string): number {
    return loadPersistedOffset(token);
  }

  public static persistOffset(token: string, updateId: number): void {
    persistOffset(token, updateId);
  }

  public static alreadyProcessed(updateId: number): boolean {
    return alreadyProcessed(updateId);
  }

  constructor(
    token: string = process.env.TELEGRAM_BOT_TOKEN || "",
    chatId: string = ""
  ) {
    this.token = token;
    this.chatId = chatId ? String(chatId).trim() : "";
  }

  public async sendTelegramMessage(chatId: string | number, text: string, options: any = {}): Promise<boolean> {
    return sendTelegramMessage(this.token, this.chatId, chatId, text, options);
  }

  public async sendRequest(method: string, payload: any): Promise<boolean> {
    return sendRequest(this.token, this.chatId, method, payload);
  }

  public async sendWorkStartNotification(evalResult: DayEvaluation): Promise<boolean> {
    return sendWorkStartNotification(evalResult, this.token, this.chatId, (m, p) => this.sendRequest(m, p));
  }

  public async sendMorningEvaluation(evalResult: DayEvaluation): Promise<boolean> {
    return sendMorningEvaluation(evalResult, this.token, this.chatId, (m, p) => this.sendRequest(m, p));
  }

  public async sendWeatherAlertBurst(dailyLogId: number, alertText: string): Promise<boolean> {
    return sendWeatherAlertBurst(dailyLogId, alertText, this.token, this.chatId, (m, p) => this.sendRequest(m, p));
  }

  public async sendIntradayEmergencyAlertBurst(dailyLogId: number, alertText: string): Promise<boolean> {
    return this.sendWeatherAlertBurst(dailyLogId, alertText);
  }

  public async sendCheckinPrompt(dailyLogId: number, scheduledTasks: Task[]): Promise<boolean> {
    return sendCheckinPrompt(dailyLogId, scheduledTasks, this.token, this.chatId, (m, p) => this.sendRequest(m, p));
  }

  public async handleIncomingMessage(msg: any): Promise<{ status: string; message: string }> {
    return handleIncomingMessage(msg, this.token, (m, p) => this.sendRequest(m, p));
  }

  public async processCallbackQuery(callbackQuery: any): Promise<{ status: string; message: string }> {
    return processCallbackQuery(callbackQuery, this.token, this.chatId, (m, p) => this.sendRequest(m, p));
  }

  public async answerCallbackQuery(callbackQueryId: string, text?: string, showAlert: boolean = false): Promise<boolean> {
    return answerCallbackQuery(this.token, callbackQueryId, text, showAlert);
  }

  public buildPickerKeyboard(dailyLogId: number, scheduledTasks: Task[], checkedIds: Set<number>): any[] {
    return buildPickerKeyboard(dailyLogId, scheduledTasks, checkedIds);
  }

  public async editMessageKeyboard(chatId: string | number, messageId: number, keyboard: any[]): Promise<boolean> {
    return editMessageKeyboard(this.token, chatId, messageId, keyboard);
  }

  public async editMessageText(chatId: string | number, messageId: number, text: string, keyboard?: any[]): Promise<boolean> {
    return editMessageText(this.token, chatId, messageId, text, keyboard);
  }
}

export {
  loadPersistedOffset,
  persistOffset,
  alreadyProcessed,
  sendRequest,
  sendTelegramMessage,
  answerCallbackQuery,
  editMessageText,
  editMessageKeyboard,
  buildPickerKeyboard,
  buildCheckinPromptKeyboard,
  buildEmergencyAlertKeyboard,
  sendWorkStartNotification,
  sendMorningEvaluation,
  sendWeatherAlertBurst,
  sendCheckinPrompt,
  handleIncomingMessage,
  processCallbackQuery,
  startPolling,
  stopPolling
};
