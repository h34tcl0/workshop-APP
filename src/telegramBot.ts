import { DayEvaluation, DayStatus, Task, TaskStatus, DailyLog } from "./types.js";
import { store } from "./db.js";

export class TelegramBotService {
  private token: string;
  private chatId: string;
  private apiUrl: string;

  constructor(
    token: string = process.env.TELEGRAM_BOT_TOKEN || "",
    chatId: string = ""
  ) {
    this.token = token;
    this.chatId = chatId ? String(chatId).trim() : "";
    this.apiUrl = `https://api.telegram.org/bot${token}`;
  }

  public async sendTelegramMessage(chatId: string | number, text: string, options: any = {}): Promise<boolean> {
    const targetChatId = chatId ? String(chatId).trim() : this.chatId;
    if (!this.token || !targetChatId) {
      console.log(`[Telegram] SKIPPED: No valid chatId provided for request '${options.method || 'sendMessage'}'`);
      return false;
    }

    console.log(`[Telegram] Attempting to send message to chatId: ${targetChatId}...`);
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
        body: JSON.stringify(payload)
      });
      const data = await response.json();
      if (data && data.ok) {
        console.log(`[Telegram] SUCCESS: Message sent to chatId ${targetChatId}`);
        return true;
      } else {
        const errDetail = data?.description || JSON.stringify(data);
        console.error(`[Telegram] ERROR sending to chatId ${targetChatId}: ${errDetail}`);
        return false;
      }
    } catch (err) {
      console.error(`[Telegram] ERROR sending to chatId ${targetChatId}:`, err);
      return false;
    }
  }

  public async sendRequest(method: string, payload: any): Promise<boolean> {
    const targetChatId = payload.chat_id || this.chatId;
    if (!this.token || !targetChatId) {
      const textPreview = (payload.text || "").substring(0, 60).replace(/\n/g, " ");
      console.log(`[Telegram] SKIPPED: No valid chatId provided for method '${method}': ${textPreview}`);
      return false;
    }

    console.log(`[Telegram] Attempting to send message to chatId: ${targetChatId}...`);
    try {
      const response = await fetch(`${this.apiUrl}/${method}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      const data = await response.json();
      if (data && data.ok) {
        console.log(`[Telegram] SUCCESS: Message sent to chatId ${targetChatId}`);
        return true;
      } else {
        const errDetail = data?.description || JSON.stringify(data);
        console.error(`[Telegram] ERROR sending to chatId ${targetChatId}: ${errDetail}`);
        return false;
      }
    } catch (err) {
      console.error(`[Telegram] ERROR sending to chatId ${targetChatId}:`, err);
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
    const msg1 = "🚨 ⚠️ *¡ALERTA DE EMERGENCIA EN TALLER!*";
    const msg2 = alertText.startsWith("🌧️") || alertText.startsWith("💨")
      ? alertText
      : `🌧️ *CAMBIO CLIMÁTICO IMPREVISTO:* ${alertText}`;
    const msg3 = "🛠️ *ACCIÓN REQUERIDA:* Cubre la madera expuesta, suspende aplicados de encolado/barniz y resguarda el taller.";

    const inlineKeyboard = [[{ text: "✅ ACEPTAR Y ENTENDIDO", callback_data: `ack_intraday_alert:${dailyLogId}` }]];

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

    return res1 && res2 && res3;
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
    const user = store.getUserByTelegramChatId(chatStr);

    if (!user) {
      const replyBot = new TelegramBotService(this.token, chatStr);
      await replyBot.sendRequest("sendMessage", {
        chat_id: chatStr,
        text: "Your Telegram account is not linked to any Workshop OS account. Please set your Telegram Chat ID in Workshop OS settings."
      });
      return {
        status: "unauthorized",
        message: "Your Telegram account is not linked to any Workshop OS account. Please set your Telegram Chat ID in Workshop OS settings."
      };
    }

    const text: string = (msg.text || "").trim();
    const replyBot = new TelegramBotService(this.token, chatStr);

    if (text.startsWith("/start") || text.startsWith("/help")) {
      await replyBot.sendRequest("sendMessage", {
        chat_id: chatStr,
        text: `👋 *Hola (${user.email})*\nTu cuenta de Telegram está correctamente vinculada a Workshop OS.\n\n*Comandos disponibles:*\n• \`/materiales\` - Ver insumos pendientes por comprar (🔴)`,
        parse_mode: "Markdown"
      });
    } else if (text.toLowerCase() === "/materiales" || text.toLowerCase() === "materiales" || text.toLowerCase().startsWith("/materiales")) {
      const pendingByProject = store.getPendingMaterialsGroupedByProject(user.id);
      if (pendingByProject.length === 0) {
        await replyBot.sendRequest("sendMessage", {
          chat_id: chatStr,
          text: `📦 *MATERIALES POR COMPRAR* (🔴)\n\n✅ ¡Excelente! No tienes insumos pendientes por comprar en tus proyectos.`,
          parse_mode: "Markdown"
        });
      } else {
        let msgText = `📦 *RESUMEN DE MATERIALES POR COMPRAR* (🔴)\n\n`;
        let totalItems = 0;
        for (const projGroup of pendingByProject) {
          msgText += `📁 *Proyecto: ${projGroup.project_name}*\n`;
          for (const m of projGroup.materials) {
            msgText += `  • *${m.quantity} ${m.unit}* - ${m.name} _[${m.category}]_\n`;
            totalItems++;
          }
          msgText += `\n`;
        }
        msgText += `📌 *Total:* ${totalItems} insumos pendientes.`;
        await replyBot.sendRequest("sendMessage", {
          chat_id: chatStr,
          text: msgText,
          parse_mode: "Markdown"
        });
      }
    } else {
      await replyBot.sendRequest("sendMessage", {
        chat_id: chatStr,
        text: `🤖 *Workshop OS* (${user.email})\nRecibido: "${text}".\nUsa los botones interactivos de la aplicación para responder a los check-ins y alertas.`,
        parse_mode: "Markdown"
      });
    }

    return { status: "ok", message: "Message processed" };
  }

  public async answerCallbackQuery(callbackQueryId: string, text?: string, showAlert: boolean = false): Promise<boolean> {
    if (!callbackQueryId) return false;
    return this.sendRequest("answerCallbackQuery", {
      callback_query_id: callbackQueryId,
      text,
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
        responseText = "No tienes permiso para modificar esta tarea";
        showAlert = true;
        if (cbId) {
          await replyBot.answerCallbackQuery(cbId, responseText, true);
          cbAnswered = true;
        }
        await replyBot.sendRequest("sendMessage", {
          chat_id: chatStr,
          text: "Su cuenta de Telegram no está vinculada a ningún usuario de Workshop OS."
        });
        return { status: "unauthorized", message: responseText };
      }

      const userId = user.id;

      if (data.startsWith("task_complete:")) {
        // Format: task_complete:<taskId> or task_complete:<taskId>:<userId>
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
          }
          responseText = "✅ Día completo. ¡Buen trabajo!";
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
          responseText = "Check-in finalizado";

          if (messageId) {
            const summaryText = `📝 **Check-in completado exitosamente.** Resumen: ${completedCount} tareas completadas, ${rescheduledCount} reagendadas.`;
            await replyBot.editMessageText(chatStr, messageId, summaryText);
          }
        }
      } else if (data.startsWith("wxack:") || data.startsWith("ack_intraday_alert:") || data.startsWith("intraday_ack:")) {
        const dailyLogId = parseInt(data.split(":")[1], 10);
        const dailyLog = store.getDailyLogById(userId, dailyLogId);
        if (!dailyLog || dailyLog.user_id !== userId) {
          responseText = "No tienes permiso para modificar este registro";
          showAlert = true;
        } else {
          store.updateDailyLog(userId, dailyLogId, {
            intraday_alert_acknowledged: true,
            weather_alert_acknowledged: true
          });
          responseText = "Alerta confirmada";
          if (messageId) {
            await replyBot.editMessageText(chatStr, messageId, "✅ **Alerta Aceptada por el Operario**");
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
