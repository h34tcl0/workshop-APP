import { describe, it, expect, beforeEach, vi } from "vitest";
import { initDatabase, store } from "../src/db.js";
import { TaskStatus } from "../src/types.js";
import { parseKeyboardState } from "../src/telegram/callbackParser.js";
import { buildPickerKeyboard } from "../src/telegram/keyboards.js";
import { sanitizeMarkdown } from "../src/notifications/markdownUtils.js";
import { processCallbackQuery } from "../src/telegram/callbackHandlers.js";

describe("Telegram Callback Determinism & Keyboard Parsing", () => {
  const userId = 1;
  const testChatId = "123456789";

  beforeEach(async () => {
    await initDatabase();
    store.updateAppSettings(userId, {
      telegram_chat_id: testChatId,
      operational_start_hour: 8,
      operational_end_hour: 19
    });
  });

  describe("sanitizeMarkdown Helper", () => {
    it("elimina caracteres problemáticos de Markdown para evitar errores 400 en Telegram", () => {
      const input = "Mesa_roble * 2 [urgente] `fresado` \\ final";
      const sanitized = sanitizeMarkdown(input);
      expect(sanitized).toBe("Mesa roble 2 urgente fresado final");
      expect(sanitized).not.toContain("_");
      expect(sanitized).not.toContain("*");
      expect(sanitized).not.toContain("[");
      expect(sanitized).not.toContain("]");
    });
  });

  describe("buildPickerKeyboard & parseKeyboardState", () => {
    it("construye el teclado con callback_data determinista (:1 y :0) y parsea el estado exacto sin depender de emojis de texto", () => {
      const dummyTasks: any[] = [
        { id: 10, title: "Lijado fino", estimated_hours: 2 },
        { id: 20, title: "Encolado lateral", estimated_hours: 1.5 },
        { id: 30, title: "Barniz protector", estimated_hours: 3 }
      ];

      const checkedSet = new Set([10, 30]); // Tareas 10 y 30 completadas, 20 pendiente
      const keyboard = buildPickerKeyboard(99, dummyTasks, checkedSet);

      expect(keyboard.length).toBe(4); // 3 tareas + 1 botón confirmar
      expect(keyboard[0][0].callback_data).toBe("chk:99:10:1");
      expect(keyboard[1][0].callback_data).toBe("chk:99:20:0");
      expect(keyboard[2][0].callback_data).toBe("chk:99:30:1");
      expect(keyboard[3][0].callback_data).toBe("chkconfirm:99");

      // Parse determinista
      const parsed = parseKeyboardState(keyboard);
      expect(parsed.checkedIds.has(10)).toBe(true);
      expect(parsed.checkedIds.has(20)).toBe(false);
      expect(parsed.checkedIds.has(30)).toBe(true);
      expect(parsed.orderedIds).toEqual([10, 20, 30]);
    });
  });

  describe("processCallbackQuery Execution Flow", () => {
    it("procesa alternancia (toggle) de tarea y responde inmediatamente con answerCallbackQuery", async () => {
      const task1 = store.addTask(userId, { project_id: 1, title: "Corte", estimated_hours: 1 });
      const task2 = store.addTask(userId, { project_id: 1, title: "Armado", estimated_hours: 2 });

      const dailyLog = store.saveDailyLog(userId, {
        eval_date: "2026-08-10",
        status: "DAY_VIABLE" as any,
        window_start: "08:00",
        window_end: "18:00",
        scheduled_task_ids: JSON.stringify([task1.id, task2.id]),
        checkin_sent: true,
        checkin_resolved: false
      });

      const sentRequests: any[] = [];
      const mockSendRequest = async (method: string, payload: any) => {
        sentRequests.push({ method, payload });
        return true;
      };

      const callbackQuery = {
        id: "cb_12345",
        data: `chk:${dailyLog.id}:${task1.id}:1`,
        message: {
          message_id: 777,
          chat: { id: testChatId },
          reply_markup: {
            inline_keyboard: [
              [{ text: "✅ Corte", callback_data: `chk:${dailyLog.id}:${task1.id}:1` }],
              [{ text: "🔁 Armado", callback_data: `chk:${dailyLog.id}:${task2.id}:0` }],
              [{ text: "💾 FINALIZAR CHECK-IN", callback_data: `chkconfirm:${dailyLog.id}` }]
            ]
          }
        }
      };

      const result = await processCallbackQuery(callbackQuery, "MOCK_TOKEN", testChatId, mockSendRequest);

      expect(result.status).toBe("ok");
      // Verifica que answerCallbackQuery fue llamado
      const ansCall = sentRequests.find(r => r.method === "answerCallbackQuery");
      expect(ansCall).toBeDefined();
      expect(ansCall.payload.callback_query_id).toBe("cb_12345");

      // Verifica que se editó el teclado alternando la tarea 1 de 1 a 0
      const editMarkupCall = sentRequests.find(r => r.method === "editMessageReplyMarkup");
      expect(editMarkupCall).toBeDefined();
      const updatedButtons = editMarkupCall.payload.reply_markup.inline_keyboard;
      expect(updatedButtons[0][0].callback_data).toBe(`chk:${dailyLog.id}:${task1.id}:0`); // Ahora desmarcada
    });

    it("confirma el check-in (chkconfirm) y actualiza correctamente las tareas en DB", async () => {
      const task1 = store.addTask(userId, { project_id: 1, title: "Lijado", estimated_hours: 1, status: TaskStatus.PENDING });
      const task2 = store.addTask(userId, { project_id: 1, title: "Pintura", estimated_hours: 2, status: TaskStatus.PENDING });

      const dailyLog = store.saveDailyLog(userId, {
        eval_date: "2026-08-10",
        status: "DAY_VIABLE" as any,
        window_start: "08:00",
        window_end: "18:00",
        scheduled_task_ids: JSON.stringify([task1.id, task2.id]),
        checkin_sent: true,
        checkin_resolved: false
      });

      const sentRequests: any[] = [];
      const mockSendRequest = async (method: string, payload: any) => {
        sentRequests.push({ method, payload });
        return true;
      };

      const callbackQuery = {
        id: "cb_confirm_999",
        data: `chkconfirm:${dailyLog.id}`,
        message: {
          message_id: 888,
          chat: { id: testChatId },
          reply_markup: {
            inline_keyboard: [
              [{ text: "✅ Lijado", callback_data: `chk:${dailyLog.id}:${task1.id}:1` }], // completada
              [{ text: "🔁 Pintura", callback_data: `chk:${dailyLog.id}:${task2.id}:0` }], // reagendada
              [{ text: "💾 FINALIZAR CHECK-IN", callback_data: `chkconfirm:${dailyLog.id}` }]
            ]
          }
        }
      };

      const result = await processCallbackQuery(callbackQuery, "MOCK_TOKEN", testChatId, mockSendRequest);

      expect(result.status).toBe("ok");

      // Verifica estado en DB
      const updatedT1 = store.getTask(userId, task1.id)!;
      const updatedT2 = store.getTask(userId, task2.id)!;
      const updatedLog = store.getDailyLogById(userId, dailyLog.id)!;

      expect(updatedT1.status).toBe(TaskStatus.COMPLETED);
      expect(updatedT2.status).toBe(TaskStatus.PENDING);
      expect(updatedLog.checkin_resolved).toBe(true);
    });
  });
});
