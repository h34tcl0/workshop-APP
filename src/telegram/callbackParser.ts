/**
 * Parsea el estado actual de las tareas desde las filas del teclado inline de Telegram.
 * Utiliza el callback_data determinista (sufijo :1 o :0) en lugar de depender del texto del botón.
 */
export function parseKeyboardState(rows: any[]): { checkedIds: Set<number>; orderedIds: number[] } {
  const checkedIds = new Set<number>();
  const orderedIds: number[] = [];

  for (const row of rows || []) {
    for (const btn of row || []) {
      const cb = btn?.callback_data || "";
      if (cb.startsWith("chk:") || cb.startsWith("checkin_toggle:")) {
        const parts = cb.split(":");
        const tid = parseInt(parts[2], 10);
        if (!isNaN(tid)) {
          if (!orderedIds.includes(tid)) orderedIds.push(tid);
          if (parts[3] === "1" || parts[3] === "done" || parts[3] === "true") {
            checkedIds.add(tid);
          } else if (parts[3] === "0" || parts[3] === "pending" || parts[3] === "false") {
            // No seleccionada
          } else if ((btn.text || "").includes("✅")) {
            // Retrocompatibilidad
            checkedIds.add(tid);
          }
        }
      }
    }
  }
  return { checkedIds, orderedIds };
}
