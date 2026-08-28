import { DayEvaluation, DayStatus, Task } from "../types.js";
import { sendRequest } from "./apiClient.js";
import { buildCheckinPromptKeyboard, buildEmergencyAlertKeyboard } from "./keyboards.js";
import { sanitizeMarkdown } from "../notifications/markdownUtils.js";

type SendRequestFn = (method: string, payload: any) => Promise<boolean>;

export async function sendWorkStartNotification(
  evalResult: DayEvaluation,
  token: string,
  chatId: string,
  sendRequestFn?: SendRequestFn
): Promise<boolean> {
  const req: SendRequestFn = sendRequestFn || ((method, payload) => sendRequest(token, chatId, method, payload));
  if (!chatId) return false;

  const tasksList = (evalResult.scheduled_tasks || [])
    .map((t, idx) => `  ${idx + 1}. *${sanitizeMarkdown(t.title)}* (${t.estimated_hours}h)`)
    .join("\n");

  const startStr = evalResult.window?.start_time || "08:00";
  const endStr = evalResult.window?.end_time || "18:00";
  const viableHours = evalResult.window?.net_work_hours ?? 0;

  const msg = [
    `🔔 *INICIO DE JORNADA*`,
    `📅 *Fecha:* ${evalResult.eval_date}`,
    `⏰ *Horario:* ${startStr} - ${endStr} (${viableHours}h viables)`,
    ``,
    `📋 *Tareas programadas para hoy:*`,
    tasksList || "  _(Sin tareas programadas)_",
    ``,
    `🌤️ _Condiciones climáticas verificadas y viables._`,
    `¡Buen trabajo en el taller!`
  ].join("\n");

  return req("sendMessage", {
    chat_id: chatId,
    text: msg,
    parse_mode: "Markdown"
  });
}

export async function sendMorningEvaluation(
  evalResult: DayEvaluation,
  token: string,
  chatId: string,
  sendRequestFn?: SendRequestFn
): Promise<boolean> {
  const req: SendRequestFn = sendRequestFn || ((method, payload) => sendRequest(token, chatId, method, payload));
  if (!chatId) return false;

  const isViable = evalResult.status === DayStatus.DAY_VIABLE;
  const icon = isViable ? "🟢" : "🔴";
  const tasksList = (evalResult.scheduled_tasks || [])
    .map((t, idx) => `  ${idx + 1}. *${sanitizeMarkdown(t.title)}* (${t.estimated_hours}h)`)
    .join("\n");

  const startStr = evalResult.window?.start_time || "--";
  const endStr = evalResult.window?.end_time || "--";
  const viableHours = evalResult.window?.net_work_hours ?? 0;
  const safeReason = sanitizeMarkdown(evalResult.reason) || "Condiciones climáticas desfavorables.";

  const msg = [
    `🌅 *PLANIFICACIÓN MATUTINA DEL DÍA*`,
    `📅 *Fecha:* ${evalResult.eval_date}`,
    `📊 *Estado:* ${icon} *${evalResult.status}*`,
    `⏰ *Ventana viable:* ${startStr} - ${endStr} (${viableHours}h)`,
    ``,
    isViable ? `📋 *Tareas a realizar:*` : `⚠️ *Motivo de inviabilidad:*`,
    isViable ? (tasksList || "  _(Sin tareas asignadas)_") : `  ${safeReason}`,
    ``,
    `🤖 _Evaluado automáticamente por AGENDAPP_`
  ].join("\n");

  return req("sendMessage", {
    chat_id: chatId,
    text: msg,
    parse_mode: "Markdown"
  });
}

export async function sendWeatherAlertBurst(
  dailyLogId: number,
  alertText: string,
  token: string,
  chatId: string,
  sendRequestFn?: SendRequestFn
): Promise<boolean> {
  const req: SendRequestFn = sendRequestFn || ((method, payload) => sendRequest(token, chatId, method, payload));
  if (!chatId) return false;

  const msg = [
    `🚨 *ALERTA CLIMÁTICA EN TALLER* 🚨`,
    ``,
    `⚠️ ${alertText}`,
    ``,
    `_Por favor verifica las condiciones del taller y resguarda los materiales sensibles._`
  ].join("\n");

  const keyboard = buildEmergencyAlertKeyboard(dailyLogId);

  return req("sendMessage", {
    chat_id: chatId,
    text: msg,
    parse_mode: "Markdown",
    reply_markup: { inline_keyboard: keyboard }
  });
}

export async function sendCheckinPrompt(
  dailyLogId: number,
  scheduledTasks: Task[],
  token: string,
  chatId: string,
  sendRequestFn?: SendRequestFn
): Promise<boolean> {
  const req: SendRequestFn = sendRequestFn || ((method, payload) => sendRequest(token, chatId, method, payload));
  if (!chatId) return false;

  const tasksList = scheduledTasks
    .map((t, idx) => `  ${idx + 1}. *${sanitizeMarkdown(t.title)}* (${t.estimated_hours}h)`)
    .join("\n");

  const msg = [
    `🌙 *CIERRE DE JORNADA - CHECK-IN*`,
    ``,
    `¿Pudiste completar todas las tareas programadas para hoy?`,
    ``,
    `📋 *Tareas del día:*`,
    tasksList || "  _(Sin tareas registradas)_",
    ``,
    `_Selecciona una opción para actualizar el estado en AGENDAPP:_`
  ].join("\n");

  const keyboard = buildCheckinPromptKeyboard(dailyLogId, scheduledTasks);

  return req("sendMessage", {
    chat_id: chatId,
    text: msg,
    parse_mode: "Markdown",
    reply_markup: { inline_keyboard: keyboard }
  });
}
