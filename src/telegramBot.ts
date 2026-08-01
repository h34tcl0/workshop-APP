import { DayEvaluation, DayStatus, Task, TaskStatus, DailyLog } from "./types.js";
import { store } from "./db.js";

export class TelegramBotService {
  private token: string;
  private chatId: string;
  private apiUrl: string;

  constructor(
    token: string = process.env.TELEGRAM_BOT_TOKEN || "",
    chatId: string = process.env.TELEGRAM_CHAT_ID || ""
  ) {
    this.token = token;
    this.chatId = chatId;
    this.apiUrl = `https://api.telegram.org/bot${token}`;
  }

  private async sendRequest(method: string, payload: any): Promise<boolean> {
    if (!this.token || !this.chatId) {
      const textPreview = (payload.text || "").substring(0, 60).replace(/\n/g, " ");
      console.log(`[TelegramBotService] Token/ChatID not configured. Simulated '${method}': ${textPreview}`);
      return true;
    }

    try {
      const response = await fetch(`${this.apiUrl}/${method}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      const data = await response.json();
      return Boolean(data && data.ok);
    } catch (err) {
      console.error(`[TelegramBotService] Failed request to Telegram (${method}):`, err);
      return false;
    }
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
    const message =
      `🚨🚨🚨 *CAMBIÓ EL CLIMA* 🚨🚨🚨\n\n` +
      `${alertText}\n\n` +
      `Estás dentro de tu ventana de trabajo de hoy — revisa si conviene guardar herramientas y material.`;

    const inlineKeyboard = [[{ text: "✅ OK, ya lo vi", callback_data: `wxack:${dailyLogId}` }]];

    let allOk = true;
    for (let i = 0; i < 3; i++) {
      const ok = await this.sendRequest("sendMessage", {
        chat_id: this.chatId,
        text: message,
        parse_mode: "Markdown",
        reply_markup: { inline_keyboard: inlineKeyboard }
      });
      allOk = allOk && ok;
    }
    return allOk;
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
      const mark = checkedIds.has(t.id) ? "✅" : "⬜";
      rows.push([{ text: `${mark} ${t.title}`, callback_data: `chk:${dailyLogId}:${t.id}` }]);
    }
    rows.push([{ text: "Confirmar", callback_data: `chkconfirm:${dailyLogId}` }]);
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

  async processCallbackQuery(callbackQuery: any): Promise<{ status: string; message: string }> {
    const cbId = callbackQuery.id;
    const data: string = callbackQuery.data || "";
    const message = callbackQuery.message || {};
    const messageId = message.message_id;
    const chatId = (message.chat || {}).id || this.chatId;

    let responseText = "Actualizado";

    if (data.startsWith("chkall:")) {
      const dailyLogId = parseInt(data.split(":")[1]);
      const dailyLog = store.getDailyLogById(dailyLogId);
      if (dailyLog && !dailyLog.checkin_resolved) {
        let taskIds: number[] = [];
        try {
          taskIds = JSON.parse(dailyLog.scheduled_task_ids || "[]");
        } catch (_) {}
        const nowIso = new Date().toISOString();
        for (const tid of taskIds) {
          const t = store.getTask(tid);
          if (t && t.status !== TaskStatus.COMPLETED) {
            store.updateTask(t.id, {
              status: TaskStatus.COMPLETED,
              progress_percentage: 100,
              completed_at: nowIso
            });
          }
        }
        store.updateDailyLog(dailyLogId, { checkin_resolved: true });
      }
      responseText = "✅ Día completo. ¡Buen trabajo!";
      if (messageId) {
        await this.editMessageText(chatId, messageId, "✅ *Día completo.* ¡Buen trabajo!");
      }
    } else if (data.startsWith("chkpick:")) {
      const dailyLogId = parseInt(data.split(":")[1]);
      const dailyLog = store.getDailyLogById(dailyLogId);
      let taskIds: number[] = [];
      if (dailyLog) {
        try {
          taskIds = JSON.parse(dailyLog.scheduled_task_ids || "[]");
        } catch (_) {}
      }
      const scheduledTasks = taskIds.map(tid => store.getTask(tid)).filter((t): t is Task => t != null);
      responseText = "Marca cuáles se completaron";
      if (messageId && scheduledTasks.length > 0) {
        const keyboard = this.buildPickerKeyboard(dailyLogId, scheduledTasks, new Set());
        await this.editMessageText(
          chatId,
          messageId,
          "🌙 *¿Cuáles tareas se completaron?*\nTócalas para marcar/desmarcar, luego *Confirmar*.",
          keyboard
        );
      }
    } else if (data.startsWith("chk:")) {
      const parts = data.split(":");
      const dailyLogId = parseInt(parts[1]);
      const taskId = parseInt(parts[2]);

      const currentKeyboard = (message.reply_markup || {}).inline_keyboard || [];
      const checkedIds = new Set<number>();
      const scheduledIdsInOrder: number[] = [];

      for (const row of currentKeyboard) {
        for (const btn of row) {
          const cb = btn.callback_data || "";
          if (cb.startsWith("chk:")) {
            const tid = parseInt(cb.split(":")[2]);
            scheduledIdsInOrder.push(tid);
            if ((btn.text || "").startsWith("✅")) {
              checkedIds.add(tid);
            }
          }
        }
      }

      if (checkedIds.has(taskId)) {
        checkedIds.delete(taskId);
      } else {
        checkedIds.add(taskId);
      }

      const scheduledTasks = scheduledIdsInOrder.map(tid => store.getTask(tid)).filter((t): t is Task => t != null);
      responseText = "Marcado";
      if (messageId) {
        const keyboard = this.buildPickerKeyboard(dailyLogId, scheduledTasks, checkedIds);
        await this.editMessageKeyboard(chatId, messageId, keyboard);
      }
    } else if (data.startsWith("chkconfirm:")) {
      const dailyLogId = parseInt(data.split(":")[1]);
      const currentKeyboard = (message.reply_markup || {}).inline_keyboard || [];
      const checkedIds = new Set<number>();
      const allIds: number[] = [];

      for (const row of currentKeyboard) {
        for (const btn of row) {
          const cb = btn.callback_data || "";
          if (cb.startsWith("chk:")) {
            const tid = parseInt(cb.split(":")[2]);
            allIds.push(tid);
            if ((btn.text || "").startsWith("✅")) {
              checkedIds.add(tid);
            }
          }
        }
      }

      const nowIso = new Date().toISOString();
      const completedTitles: string[] = [];
      const pendingTitles: string[] = [];

      for (const tid of allIds) {
        const t = store.getTask(tid);
        if (!t) continue;
        if (checkedIds.has(tid)) {
          store.updateTask(t.id, {
            status: TaskStatus.COMPLETED,
            progress_percentage: 100,
            completed_at: nowIso
          });
          completedTitles.push(t.title);
        } else {
          pendingTitles.push(t.title);
        }
      }

      store.updateDailyLog(dailyLogId, { checkin_resolved: true });
      responseText = "Confirmado";

      if (messageId) {
        let summary = `✅ *Completadas:* ${completedTitles.length > 0 ? completedTitles.join(", ") : "ninguna"}\n`;
        if (pendingTitles.length > 0) {
          summary += `↩️ *Vuelven al backlog:* ${pendingTitles.join(", ")}`;
        }
        await this.editMessageText(chatId, messageId, summary);
      }
    } else if (data.startsWith("wxack:")) {
      const dailyLogId = parseInt(data.split(":")[1]);
      store.updateDailyLog(dailyLogId, { weather_alert_acknowledged: true });
      responseText = "✅ Confirmado, no se insiste más.";
      if (messageId) {
        await this.editMessageText(chatId, messageId, "✅ *Confirmado.* No se insiste más con esta alerta.");
      }
    }

    await this.sendRequest("answerCallbackQuery", {
      callback_query_id: cbId,
      text: responseText
    });

    return { status: "ok", message: responseText };
  }
}
