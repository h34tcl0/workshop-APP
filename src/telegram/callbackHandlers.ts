import { store } from "../db.js";
import { Task, TaskStatus } from "../types.js";
import { getLocalDateIso } from "../dateUtils.js";
import { triggerSilentReevaluation } from "../scheduler.js";
import { sendRequest } from "./apiClient.js";
import { buildPickerKeyboard } from "./keyboards.js";
import { parseKeyboardState } from "./callbackParser.js";

type SendRequestFn = (method: string, payload: any) => Promise<boolean>;

export { parseKeyboardState };

export async function processCallbackQuery(
  callbackQuery: any,
  token: string,
  defaultChatId?: string,
  sendRequestFn?: SendRequestFn
): Promise<{ status: string; message: string }> {
  const cbId = callbackQuery?.id;
  const data: string = (callbackQuery?.data || "").trim();
  const message = callbackQuery?.message || {};
  const messageId = message.message_id;
  const rawChatId = (message.chat || {}).id || callbackQuery?.from?.id || defaultChatId;
  const chatStr = String(rawChatId).trim();
  const req: SendRequestFn = sendRequestFn || ((m, p) => sendRequest(token, chatStr, m, p));
  let cbAnswered = false;
  let responseText = "Actualizado";
  let showAlert = false;

  const answerCb = async (text?: string, alert = false) => {
    if (cbId && !cbAnswered) {
      cbAnswered = true;
      try {
        await req("answerCallbackQuery", { callback_query_id: cbId, text: text || undefined, show_alert: alert });
      } catch (e) {
        console.error("[Telegram] Error answering callback query:", e);
      }
    }
  };

  try {
    const user = store.getUserByTelegramChatId(chatStr);
    if (!user) {
      responseText = "⚠️ Este chat de Telegram no está vinculado a ninguna cuenta en AGENDAPP.";
      await answerCb(responseText, true);
      await req("sendMessage", { chat_id: chatStr, text: responseText });
      return { status: "unauthorized", message: responseText };
    }
    const userId = user.id;

    if (data.startsWith("ack_alarm") || data.startsWith("wxack:") || data.startsWith("ack_intraday_alert:") || data.startsWith("intraday_ack:")) {
      responseText = "Alarma silenciada para la jornada actual ✅";
      showAlert = true;
      await answerCb(responseText, true);

      const dailyLogId = parseInt(data.split(":")[1] || "", 10);
      const userTz = (store.getAppSettings(userId) as any)?.timezone || process.env.TIMEZONE || "America/Santiago";
      const dailyLog = !isNaN(dailyLogId) ? store.getDailyLogById(userId, dailyLogId) : store.getDailyLogByDate(userId, getLocalDateIso(new Date(), userTz));
      if (dailyLog && dailyLog.user_id === userId) {
        store.updateDailyLog(userId, dailyLog.id, { intraday_alert_acknowledged: true });
      }
      if (messageId) {
        await req("editMessageText", {
          chat_id: chatStr,
          message_id: messageId,
          text: "🔕 *Alarma silenciada para la jornada actual ✅*\n_Notificaciones de alerta pausadas por el resto del día._",
          parse_mode: "Markdown"
        });
      }
    } else if (data.startsWith("task_complete:")) {
      const [, tStr, uStr] = data.split(":");
      const taskId = parseInt(tStr, 10);
      const targetUserId = uStr ? parseInt(uStr, 10) : userId;
      const task = !isNaN(taskId) ? store.getTask(userId, taskId) : null;

      if (isNaN(taskId) || targetUserId !== userId || !task || task.user_id !== userId) {
        responseText = isNaN(taskId) ? "ID de tarea no válido" : "No tienes permiso para modificar esta tarea";
        showAlert = true;
        await answerCb(responseText, true);
      } else {
        responseText = "✅ Tarea completada";
        await answerCb(responseText, false);
        store.updateTask(userId, task.id, { status: TaskStatus.COMPLETED, progress_percentage: 100, completed_at: new Date().toISOString() });
        if (messageId) {
          await req("editMessageText", { chat_id: chatStr, message_id: messageId, text: `✅ *Tarea completada:* ${task.title}`, parse_mode: "Markdown" });
        }
      }
    } else if (data.startsWith("chkall:") || data.startsWith("checkin_all:") || data.startsWith("checkin_yes:")) {
      const dailyLog = store.getDailyLogById(userId, parseInt(data.split(":")[1], 10));
      if (!dailyLog || dailyLog.user_id !== userId) {
        responseText = "No tienes permiso para modificar este registro";
        showAlert = true;
        await answerCb(responseText, true);
      } else {
        responseText = "✅ Día completo. ¡Buen trabajo!";
        await answerCb(responseText, false);

        if (!dailyLog.checkin_resolved) {
          const nowIso = new Date().toISOString();
          const scheduledIds: number[] = JSON.parse(dailyLog.scheduled_task_ids || "[]");
          for (const tid of scheduledIds) {
            const t = store.getTask(userId, tid);
            if (t && t.user_id === userId && t.status !== TaskStatus.COMPLETED) {
              store.updateTask(userId, t.id, { status: TaskStatus.COMPLETED, progress_percentage: 100, completed_at: nowIso });
            }
          }
          store.updateDailyLog(userId, dailyLog.id, { checkin_sent: true, checkin_resolved: true });
          await triggerSilentReevaluation(userId, dailyLog.eval_date);
        }
        if (messageId) {
          await req("editMessageText", { chat_id: chatStr, message_id: messageId, text: "✅ *Día completo.* ¡Excelente trabajo!", parse_mode: "Markdown" });
        }
      }
    } else if (data.startsWith("chkpick:") || data.startsWith("checkin_pick:") || data.startsWith("checkin_partial:") || data.startsWith("checkin_no:")) {
      const dailyLog = store.getDailyLogById(userId, parseInt(data.split(":")[1], 10));
      if (!dailyLog || dailyLog.user_id !== userId) {
        responseText = "No tienes permiso para modificar este registro";
        showAlert = true;
        await answerCb(responseText, true);
      } else {
        responseText = "Marca el estado de cada tarea";
        await answerCb(responseText, false);

        const taskIds: number[] = JSON.parse(dailyLog.scheduled_task_ids || "[]");
        const tasks = taskIds.map(tid => store.getTask(userId, tid)).filter((t): t is Task => t != null && t.user_id === userId);
        if (messageId) {
          const text = tasks.length === 0
            ? "ℹ️ No hay tareas agendadas para hoy."
            : "🌙 *Selección de Tareas de la Jornada*\n\nToca cada tarea para alternar entre Completada (✅) y Reagendar (🔁). Al finalizar, presiona *FINALIZAR CHECK-IN*.";
          const payload: any = { chat_id: chatStr, message_id: messageId, text, parse_mode: "Markdown" };
          if (tasks.length > 0) {
            payload.reply_markup = { inline_keyboard: buildPickerKeyboard(dailyLog.id, tasks, new Set(tasks.map(t => t.id))) };
          }
          await req("editMessageText", payload);
        }
      }
    } else if (data.startsWith("chk:") || data.startsWith("checkin_toggle:")) {
      responseText = "Estado alternado";
      await answerCb(responseText, false);

      const [, dlId, tId] = data.split(":");
      const dailyLog = store.getDailyLogById(userId, parseInt(dlId, 10));
      if (dailyLog && dailyLog.user_id === userId) {
        const taskId = parseInt(tId, 10);
        const { checkedIds, orderedIds } = parseKeyboardState((message.reply_markup || {}).inline_keyboard || []);
        if (checkedIds.has(taskId)) {
          checkedIds.delete(taskId);
        } else {
          checkedIds.add(taskId);
        }

        let scheduledTasks = orderedIds.map(tid => store.getTask(userId, tid)).filter((t): t is Task => t != null && t.user_id === userId);
        if (scheduledTasks.length === 0 && dailyLog.scheduled_task_ids) {
          scheduledTasks = (JSON.parse(dailyLog.scheduled_task_ids) as number[]).map(tid => store.getTask(userId, tid)).filter((t): t is Task => t != null && t.user_id === userId);
        }

        if (messageId) {
          await req("editMessageReplyMarkup", {
            chat_id: chatStr,
            message_id: messageId,
            reply_markup: { inline_keyboard: buildPickerKeyboard(dailyLog.id, scheduledTasks, checkedIds) }
          });
        }
      }
    } else if (data.startsWith("chkconfirm:") || data.startsWith("checkin_confirm:") || data.startsWith("checkin_finish:")) {
      const dailyLog = store.getDailyLogById(userId, parseInt(data.split(":")[1], 10));
      if (!dailyLog || dailyLog.user_id !== userId) {
        responseText = "No tienes permiso para modificar este registro";
        showAlert = true;
        await answerCb(responseText, true);
      } else {
        responseText = "Check-in finalizado";
        await answerCb(responseText, false);

        const { checkedIds, orderedIds } = parseKeyboardState((message.reply_markup || {}).inline_keyboard || []);
        const allIds = orderedIds.length > 0 ? orderedIds : (dailyLog.scheduled_task_ids ? JSON.parse(dailyLog.scheduled_task_ids) : []);
        const nowIso = new Date().toISOString();
        let completed = 0;
        let rescheduled = 0;

        for (const tid of allIds) {
          const t = store.getTask(userId, tid);
          if (!t || t.user_id !== userId) continue;
          if (checkedIds.has(tid)) {
            store.updateTask(userId, t.id, { status: TaskStatus.COMPLETED, progress_percentage: 100, completed_at: nowIso });
            completed++;
          } else {
            store.updateTask(userId, t.id, { status: TaskStatus.PENDING, completed_at: null });
            rescheduled++;
          }
        }

        store.updateDailyLog(userId, dailyLog.id, { checkin_sent: true, checkin_resolved: true });
        await triggerSilentReevaluation(userId, dailyLog.eval_date);
        if (messageId) {
          await req("editMessageText", {
            chat_id: chatStr,
            message_id: messageId,
            text: `📝 *Check-in completado exitosamente.*\n\nResumen: *${completed}* completadas, *${rescheduled}* reagendadas.`,
            parse_mode: "Markdown"
          });
        }
      }
    }
  } catch (err: any) {
    console.error("[Telegram] Error processing callback query:", err);
    responseText = "Error procesando solicitud";
  } finally {
    if (cbId && !cbAnswered) {
      try {
        await answerCb(responseText, showAlert);
      } catch (e) {
        console.error("[Telegram] Failed to answer callback query in finally block:", e);
      }
    }
  }

  return { status: "ok", message: responseText };
}
