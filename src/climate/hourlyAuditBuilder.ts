import { AppSettings, Task, TaskCategory, HourlyForecast, TimeWindow, ClimateSegment } from "../types.js";
import { isRainyForecast, DEFAULT_MAX_RAIN_PROBABILITY } from "./segments.js";
import {
  DEFAULT_MAX_HUMIDITY_CARPENTRY,
  DEFAULT_MAX_HUMIDITY_PVA,
  DEFAULT_MIN_TEMP_PVA,
  DEFAULT_MAX_HUMIDITY_VARNISH,
  DEFAULT_MAX_HUMIDITY_EPOXY,
  DEFAULT_MIN_TEMP_EPOXY,
  DEFAULT_DEW_POINT_MARGIN_C,
  DEFAULT_MAX_WIND_GUST_PAINT,
  DEFAULT_MAX_WIND_GUST_CARPENTRY
} from "./rules.js";

export interface HourlyClimateAuditItem {
  hour: number;
  time_label: string;
  forecast: HourlyForecast;
  phase: "NONE" | "SETUP" | "WORK" | "TEARDOWN" | "CURING";
  phase_label: string;
  is_active_work: boolean;
  is_curing: boolean;
  has_temp_risk: boolean;
  has_humidity_risk: boolean;
  has_rain_risk: boolean;
  has_wind_risk: boolean;
  has_any_risk: boolean;
  risk_reasons: string[];
}

function evaluateTaskRisks(task: Task, f: HourlyForecast, cfg: AppSettings, isWindShielded: boolean, reasons: string[]) {
  let hasH = false, hasT = false, hasW = false;
  const cat = task.category as string;
  if (cat === TaskCategory.EPOXY || cat === "epoxy") {
    const maxH = Math.min(cfg.max_humidity_percent, DEFAULT_MAX_HUMIDITY_EPOXY);
    if (f.relative_humidity > maxH) { hasH = true; reasons.push(`Epoxi: Humedad ${f.relative_humidity}% > ${maxH}%`); }
    const minT = cfg.min_temp_epoxy_c ?? DEFAULT_MIN_TEMP_EPOXY;
    if (f.temperature_c < minT) { hasT = true; reasons.push(`Epoxi: Temp ${f.temperature_c}°C < ${minT}°C`); }
  } else if (cat === TaskCategory.PVA_GLUE || cat === "pva_glue") {
    const maxH = cfg.max_humidity_pva ?? DEFAULT_MAX_HUMIDITY_PVA;
    if (f.relative_humidity > maxH) { hasH = true; reasons.push(`Cola PVA: Humedad ${f.relative_humidity}% > ${maxH}%`); }
    const minT = cfg.min_temp_pva_c ?? DEFAULT_MIN_TEMP_PVA;
    if (f.temperature_c < minT) { hasT = true; reasons.push(`Cola PVA: Temp ${f.temperature_c}°C < ${minT}°C`); }
  } else if (cat === TaskCategory.VARNISH_PAINT || cat === "varnish_paint") {
    const maxH = Math.min(cfg.max_humidity_percent, cfg.max_humidity_varnish ?? DEFAULT_MAX_HUMIDITY_VARNISH);
    if (f.relative_humidity > maxH) { hasH = true; reasons.push(`Barniz: Humedad ${f.relative_humidity}% > ${maxH}%`); }
    const dewMargin = cfg.dew_point_margin_c ?? DEFAULT_DEW_POINT_MARGIN_C;
    if (f.dew_point_c != null && (f.temperature_c - f.dew_point_c) < dewMargin) {
      hasH = true;
      reasons.push(`Barniz: Punto de rocío cercano (ΔT=${(f.temperature_c - f.dew_point_c).toFixed(1)}°C < ${dewMargin}°C)`);
    }
    if (!isWindShielded && f.wind_gusts_kmh != null && f.wind_gusts_kmh > (cfg.max_wind_gust_paint ?? DEFAULT_MAX_WIND_GUST_PAINT)) {
      hasW = true;
      reasons.push(`Barniz: Viento ${f.wind_gusts_kmh} km/h > ${cfg.max_wind_gust_paint ?? DEFAULT_MAX_WIND_GUST_PAINT} km/h`);
    }
  } else if ((cat === TaskCategory.CARPENTRY || cat === "carpentry") && !isWindShielded) {
    if (f.wind_gusts_kmh != null && f.wind_gusts_kmh > (cfg.max_wind_gust_carpentry ?? DEFAULT_MAX_WIND_GUST_CARPENTRY)) {
      hasW = true;
      reasons.push(`Carpintería: Viento ${f.wind_gusts_kmh} km/h > ${cfg.max_wind_gust_carpentry ?? DEFAULT_MAX_WIND_GUST_CARPENTRY} km/h`);
    }
  }
  return { hasH, hasT, hasW };
}

export function getHourlyClimateAudit(
  forecasts: HourlyForecast[],
  window: TimeWindow | null | undefined,
  scheduledTasks: Task[] = [],
  cfg: AppSettings
): HourlyClimateAuditItem[] {
  const forecastMap = new Map<number, HourlyForecast>();
  if (Array.isArray(forecasts)) {
    for (const f of forecasts) forecastMap.set(f.hour, f);
  }

  const startH = window ? window.start_hour : cfg.operational_start_hour;
  const setupEnd = window ? startH + cfg.setup_hours : startH;
  const workEnd = window ? setupEnd + window.net_work_hours : setupEnd;
  const teardownEnd = window ? workEnd + cfg.teardown_hours : workEnd;

  let maxCuringEnd = teardownEnd;
  if (window && scheduledTasks.length > 0) {
    let currH = setupEnd;
    for (const task of scheduledTasks) {
      const tEnd = currH + task.estimated_hours;
      currH = tEnd;
      const reqCur = task.requires_curing || task.curing_hours > 0 || task.category === TaskCategory.PVA_GLUE || task.category === TaskCategory.VARNISH_PAINT || task.category === TaskCategory.EPOXY;
      if (reqCur) {
        const cDur = task.curing_hours > 0 ? task.curing_hours : (task.category === TaskCategory.EPOXY ? 6.0 : 2.0);
        if (tEnd + cDur > maxCuringEnd) maxCuringEnd = tEnd + cDur;
      }
    }
  }

  const result: HourlyClimateAuditItem[] = [];
  const workshopType = cfg.workshop_type || "outdoor";
  const isRainShielded = (workshopType === "covered" || workshopType === "indoor");
  const isWindShielded = (workshopType === "indoor");

  for (let h = 0; h < 24; h++) {
    const f = forecastMap.get(h) || { hour: h, temperature_c: 20, relative_humidity: 50, precipitation_mm: 0, precipitation_probability: 0, cloud_cover_percent: 0, wind_speed_kmh: 0, weather_code: 0, description: "Sin datos" };
    let phase: "NONE" | "SETUP" | "WORK" | "TEARDOWN" | "CURING" = "NONE";
    let phase_label = "", isActiveWork = false, isCuring = false;

    if (window) {
      if (h >= startH && h < setupEnd) { phase = "SETUP"; phase_label = "PREP"; isActiveWork = true; }
      else if (h >= setupEnd && h < workEnd) { phase = "WORK"; phase_label = "TRABAJO"; isActiveWork = true; }
      else if (h >= workEnd && h < teardownEnd) { phase = "TEARDOWN"; phase_label = "CIERRE"; isActiveWork = true; }
      else if (h >= teardownEnd && h < maxCuringEnd) { phase = "CURING"; phase_label = "CURADO"; isCuring = true; }
    }

    const risk_reasons: string[] = [];
    let has_humidity_risk = f.relative_humidity > cfg.max_humidity_percent;
    if (has_humidity_risk) risk_reasons.push(`Humedad ${f.relative_humidity}% (límite ${cfg.max_humidity_percent}%)`);

    let has_rain_risk = !isRainShielded && isRainyForecast(f, cfg.min_rain_precipitation_mm, cfg.max_rain_probability ?? DEFAULT_MAX_RAIN_PROBABILITY);
    if (has_rain_risk) {
      risk_reasons.push(isCuring ? `Lluvia en curado pasivo: ${f.precipitation_mm}mm (${f.precipitation_probability ?? 0}%)` : (f.precipitation_mm > 0 ? `Lluvia ${f.precipitation_mm}mm (${f.precipitation_probability ?? 0}%)` : `Probabilidad de lluvia (${f.precipitation_probability ?? 0}%)`));
    }

    let has_temp_risk = false, has_wind_risk = false;
    if (isActiveWork || isCuring) {
      for (const t of scheduledTasks) {
        const { hasH, hasT, hasW } = evaluateTaskRisks(t, f, cfg, isWindShielded, risk_reasons);
        if (hasH) has_humidity_risk = true;
        if (hasT) has_temp_risk = true;
        if (hasW) has_wind_risk = true;
      }
    }

    result.push({
      hour: h,
      time_label: `${String(h).padStart(2, "0")}:00`,
      forecast: f,
      phase,
      phase_label,
      is_active_work: isActiveWork,
      is_curing: isCuring,
      has_temp_risk,
      has_humidity_risk,
      has_rain_risk,
      has_wind_risk,
      has_any_risk: has_humidity_risk || has_rain_risk || has_temp_risk || has_wind_risk,
      risk_reasons
    });
  }
  return result;
}

export function detectNewWeatherRisk(oldSegments: ClimateSegment[], newSegments: ClimateSegment[], windowStartH: number, windowEndH: number): string | null {
  const newMap = new Map<number, string>(), oldMap = new Map<number, string>();
  for (const s of newSegments) { for (let h = s.start_h; h < s.end_h; h++) newMap.set(h, s.condition); }
  for (const s of oldSegments) { for (let h = s.start_h; h < s.end_h; h++) oldMap.set(h, s.condition); }

  for (let h = Math.floor(windowStartH); h < Math.ceil(windowEndH); h++) {
    const oldCond = oldMap.get(h) || "clear", newCond = newMap.get(h) || "clear";
    if (newCond === "rain" && oldCond !== "rain") return `Se detectó lluvia imprevista a las ${String(h).padStart(2, "0")}:00 hrs.`;
    if (newCond === "humid" && oldCond === "clear") return `Se detectó alta humedad imprevista a las ${String(h).padStart(2, "0")}:00 hrs.`;
  }
  return null;
}
