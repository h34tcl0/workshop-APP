const DAYS_ES = ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"];

export function getSpanishDate(dateObj: Date): string {
  const dayName = DAYS_ES[dateObj.getDay()];
  const dd = String(dateObj.getDate()).padStart(2, "0");
  const mm = String(dateObj.getMonth() + 1).padStart(2, "0");
  return `${dayName} ${dd}/${mm}`;
}

export function formatDateShortEs(dateStrOrObj: string | Date): string {
  const dateObj = typeof dateStrOrObj === "string" ? new Date(dateStrOrObj + "T00:00:00") : dateStrOrObj;
  return getSpanishDate(dateObj);
}

export function formatDateIso(dateObj: Date): string {
  const yyyy = dateObj.getFullYear();
  const mm = String(dateObj.getMonth() + 1).padStart(2, "0");
  const dd = String(dateObj.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

export function formatHour(h: number): string {
  let hours = Math.floor(h);
  let minutes = Math.round((h - hours) * 60);
  if (minutes >= 60) {
    hours += 1;
    minutes = 0;
  }
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

export function formatHourCrossDay(h: number): string {
  let hours = Math.floor(h);
  let minutes = Math.round((h - hours) * 60);
  if (minutes >= 60) {
    hours += 1;
    minutes = 0;
  }
  const dayOffset = Math.floor(hours / 24);
  const hoursInDay = hours % 24;
  const suffix = dayOffset > 0 ? ` (+${dayOffset} día${dayOffset > 1 ? "s" : ""})` : "";
  return `${String(hoursInDay).padStart(2, "0")}:${String(minutes).padStart(2, "0")}${suffix}`;
}
