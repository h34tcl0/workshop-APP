import { Task } from "../types.js";
import { sanitizeMarkdown } from "../notifications/markdownUtils.js";

/**
 * Genera el teclado interactivo para el selector de tareas del Check-in nocturno.
 * El estado se codifica limpiamente en callback_data (:1 para completada, :0 para pendiente).
 */
export function buildPickerKeyboard(dailyLogId: number, scheduledTasks: Task[], checkedIds: Set<number>): any[] {
  const rows: any[] = [];
  for (const t of scheduledTasks) {
    const isChecked = checkedIds.has(t.id);
    const mark = isChecked ? "✅" : "🔁";
    const statusFlag = isChecked ? "1" : "0";
    const cleanTitle = sanitizeMarkdown(t.title) || `Tarea #${t.id}`;
    rows.push([{
      text: `${mark} ${cleanTitle}`,
      callback_data: `chk:${dailyLogId}:${t.id}:${statusFlag}`
    }]);
  }
  rows.push([{ text: "💾 FINALIZAR CHECK-IN", callback_data: `chkconfirm:${dailyLogId}` }]);
  return rows;
}

export function buildCheckinPromptKeyboard(dailyLogId: number, _scheduledTasks?: Task[]): any[] {
  return [
    [
      { text: "✅ Sí, todas", callback_data: `chkall:${dailyLogId}` },
      { text: "✍️ No, marcar cuáles", callback_data: `chkpick:${dailyLogId}` }
    ]
  ];
}

export function buildEmergencyAlertKeyboard(dailyLogId: number): any[] {
  return [
    [
      { text: "🔕 Silenciar Alarma / Enterado", callback_data: `ack_alarm:${dailyLogId}` }
    ]
  ];
}
