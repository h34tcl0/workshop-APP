import tzlookup from "tz-lookup";
import { LocalDate } from "./LocalDate.js";

export { LocalDate };

const DAYS_ES = ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"];

export function getTimezoneByCoords(lat: number, lon: number): string {
  try {
    if (typeof lat === "number" && typeof lon === "number" && !isNaN(lat) && !isNaN(lon)) {
      const tz = tzlookup(lat, lon);
      if (tz && typeof tz === "string") return tz;
    }
  } catch (err) {
    console.warn(`[Timezone] tz-lookup error for coords (${lat}, ${lon}):`, err);
  }
  return process.env.TIMEZONE || "America/Santiago";
}

export function getWorkshopLocalTime(d: Date = new Date(), timeZone?: string | null) {
  const tz = getTargetTimeZone(timeZone);
  const localHm = getLocalHoursAndMinutes(d, tz);
  const formattedTime = `${String(localHm.hours).padStart(2, "0")}:${String(localHm.minutes).padStart(2, "0")}`;
  const dateIso = getLocalDateIso(d, tz);
  return {
    timeZone: tz,
    timeStr: formattedTime,
    dateIso,
    hours: localHm.hours,
    minutes: localHm.minutes,
    totalHours: localHm.totalHours,
    formattedDisplay: `${formattedTime} (${tz})`
  };
}

export function getSpanishDate(dateObj: Date): string {
  const dayName = DAYS_ES[dateObj.getDay()];
  const dd = String(dateObj.getDate()).padStart(2, "0");
  const mm = String(dateObj.getMonth() + 1).padStart(2, "0");
  return `${dayName} ${dd}/${mm}`;
}

export function formatDateShortEs(dateStrOrObj: string | Date): string {
  if (typeof dateStrOrObj === "string") {
    const parts = dateStrOrObj.split("-");
    if (parts.length === 3) {
      const year = parseInt(parts[0], 10);
      const month = parseInt(parts[1], 10) - 1;
      const day = parseInt(parts[2], 10);
      const dateObj = new Date(Date.UTC(year, month, day, 12, 0, 0));
      const dayIndex = dateObj.getUTCDay();
      const dd = String(day).padStart(2, "0");
      const mm = String(month + 1).padStart(2, "0");
      return `${DAYS_ES[dayIndex]} ${dd}/${mm}`;
    }
  }
  const dateObj = typeof dateStrOrObj === "string" ? new Date(dateStrOrObj) : dateStrOrObj;
  return getSpanishDate(dateObj);
}

export function formatDateIso(dateObj: Date): string {
  const yyyy = dateObj.getFullYear();
  const mm = String(dateObj.getMonth() + 1).padStart(2, "0");
  const dd = String(dateObj.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

export function getTargetTimeZone(preferredTz?: string | null): string {
  if (preferredTz && preferredTz.trim()) {
    return preferredTz.trim();
  }
  if (process.env.TIMEZONE && process.env.TIMEZONE.trim()) {
    return process.env.TIMEZONE.trim();
  }
  return "America/Santiago";
}

export function getLocalDateIso(d: Date = new Date(), timeZone?: string | null): string {
  const tz = getTargetTimeZone(timeZone);
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  });
  return formatter.format(d);
}

export function getLocalHoursAndMinutes(d: Date = new Date(), timeZone?: string | null): { hours: number; minutes: number; totalHours: number } {
  const tz = getTargetTimeZone(timeZone);
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hour: "numeric",
    minute: "numeric",
    hourCycle: "h23"
  });
  const parts = formatter.formatToParts(d);
  let hours = 0;
  let minutes = 0;
  for (const part of parts) {
    if (part.type === "hour") {
      hours = parseInt(part.value, 10);
      if (hours === 24) hours = 0;
    } else if (part.type === "minute") {
      minutes = parseInt(part.value, 10);
    }
  }
  return {
    hours,
    minutes,
    totalHours: hours + minutes / 60.0
  };
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
