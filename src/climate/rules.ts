import {
  AppSettings,
  Task,
  TaskCategory,
  HourlyForecast
} from "../types.js";
import { isRainyForecast, DEFAULT_MAX_RAIN_PROBABILITY } from "./segments.js";

export { DEFAULT_MAX_RAIN_PROBABILITY };

export const DEFAULT_MAX_HUMIDITY_CARPENTRY = 95.0;
export const DEFAULT_MAX_HUMIDITY_PVA = 90.0;     // Tolerante: la humedad solo alarga el prensado, no arruina la cola
export const DEFAULT_MIN_TEMP_PVA = 10.0;         // Crítico: bajo 10°C la cola tiza y no polimeriza
export const DEFAULT_MAX_HUMIDITY_VARNISH = 80.0; // Crítico: sobre 80% produce velado blanco
export const DEFAULT_MAX_HUMIDITY_EPOXY = 75.0;   // Crítico: sobre 75% produce amine blush
export const DEFAULT_MIN_TEMP_EPOXY = 15.0;

export const DEFAULT_DEW_POINT_MARGIN_C = 3.0;    // Margen de seguridad ΔT: Temp - PuntoRocío >= 3°C
export const DEFAULT_MAX_WIND_GUST_PAINT = 25.0;   // km/h: Máximo para barnizar/pintar (polvo y spray)
export const DEFAULT_MAX_WIND_GUST_CARPENTRY = 40.0; // km/h: Máximo para cortar tableros en patio

export interface ClimateCheckResult {
  acceptable: boolean;
  reason?: string;
}

/**
 * Returns the maximum acceptable relative humidity for a specific task category.
 */
export function getCategoryMaxHumidity(category: TaskCategory | string, cfgMaxHumidity: number = 80.0): number {
  switch (category) {
    case TaskCategory.CARPENTRY:
    case "carpentry":
      return DEFAULT_MAX_HUMIDITY_CARPENTRY;
    case TaskCategory.PVA_GLUE:
    case "pva_glue":
      return DEFAULT_MAX_HUMIDITY_PVA;
    case TaskCategory.VARNISH_PAINT:
    case "varnish_paint":
      return Math.min(cfgMaxHumidity, DEFAULT_MAX_HUMIDITY_VARNISH);
    case TaskCategory.EPOXY:
    case "epoxy":
      return Math.min(cfgMaxHumidity, DEFAULT_MAX_HUMIDITY_EPOXY);
    default:
      return cfgMaxHumidity;
  }
}

/**
 * Consolidates climate evaluation for a task during its active work or curing phase.
 * Decouples thresholds by category:
 * - CARPENTRY: tolerant to humidity up to 95%, blocked by rain and high wind gusts (>40 km/h).
 * - PVA_GLUE: tolerant to humidity up to 90%, strictly blocked by cold (<10°C) and rain.
 * - VARNISH_PAINT: strictly blocked by high humidity (>80%), close dew point (ΔT < 3°C), wind gusts (>25 km/h) and rain.
 * - EPOXY: strictly blocked by high humidity (>75%), cold (<15°C) and rain.
 */
export function isHourAcceptableForTask(
  forecast: HourlyForecast,
  task: Task,
  cfg: AppSettings
): ClimateCheckResult {
  const h = forecast.hour;
  const taskLabel = `[${task.project_name || "Tarea"}] "${task.title}"`;
  const workshopType = cfg.workshop_type || "outdoor";

  // 1. Rain check: only if outdoor (covered and indoor are protected from rain)
  if (workshopType !== "indoor" && workshopType !== "covered") {
    const maxRainProb = cfg.max_rain_probability ?? DEFAULT_MAX_RAIN_PROBABILITY;
    if (isRainyForecast(forecast, cfg.min_rain_precipitation_mm, maxRainProb)) {
      const rainInfo = forecast.precipitation_mm > 0
        ? `${forecast.precipitation_mm}mm`
        : `${forecast.precipitation_probability ?? 0}% prob de lluvia`;
      return {
        acceptable: false,
        reason: `Riesgo de lluvia a las ${String(h).padStart(2, "0")}:00 hrs (${rainInfo}) en ventana de tarea/secado ${taskLabel}.`
      };
    }
  }

  // 2. Category-specific checks
  const category = task.category;
  if (category === TaskCategory.CARPENTRY || (category as string) === "carpentry") {
    if (forecast.relative_humidity > DEFAULT_MAX_HUMIDITY_CARPENTRY) {
      return {
        acceptable: false,
        reason: `Exceso de humedad extrema (>95%) a las ${String(h).padStart(2, "0")}:00 hrs (${forecast.relative_humidity}%) durante ${taskLabel}.`
      };
    }
    // Wind gusts only affect outdoor and covered workshops (indoor is shielded)
    if (workshopType !== "indoor") {
      const maxWindGustCarpentry = cfg.max_wind_gust_carpentry ?? DEFAULT_MAX_WIND_GUST_CARPENTRY;
      if (forecast.wind_gusts_kmh != null && forecast.wind_gusts_kmh > maxWindGustCarpentry) {
        return {
          acceptable: false,
          reason: `Ráfagas de viento peligrosas (>${maxWindGustCarpentry} km/h) para corte y maquinado a las ${String(h).padStart(2, "0")}:00 hrs (${forecast.wind_gusts_kmh} km/h) en ${taskLabel}.`
        };
      }
    }
  } else if (category === TaskCategory.PVA_GLUE || (category as string) === "pva_glue") {
    const minTempPva = cfg.min_temp_pva_c ?? DEFAULT_MIN_TEMP_PVA;
    if (forecast.temperature_c < minTempPva) {
      return {
        acceptable: false,
        reason: `Temperatura baja (<${minTempPva}°C) para Cola PVA a las ${String(h).padStart(2, "0")}:00 hrs (${forecast.temperature_c}°C) en ${taskLabel}.`
      };
    }
    const maxHumPva = cfg.max_humidity_pva ?? DEFAULT_MAX_HUMIDITY_PVA;
    if (forecast.relative_humidity > maxHumPva) {
      return {
        acceptable: false,
        reason: `Humedad excesiva (>${maxHumPva}%) para Cola PVA a las ${String(h).padStart(2, "0")}:00 hrs (${forecast.relative_humidity}%) en ${taskLabel}.`
      };
    }
  } else if (category === TaskCategory.VARNISH_PAINT || (category as string) === "varnish_paint") {
    const maxVarnishHumSetting = cfg.max_humidity_varnish ?? DEFAULT_MAX_HUMIDITY_VARNISH;
    const maxVarnishHum = Math.min(cfg.max_humidity_percent, maxVarnishHumSetting);
    if (forecast.relative_humidity > maxVarnishHum) {
      return {
        acceptable: false,
        reason: `Humedad alta (>${maxVarnishHum}%) para Barniz/Pintura a las ${String(h).padStart(2, "0")}:00 hrs (${forecast.relative_humidity}%) en ${taskLabel}.`
      };
    }
    const dewMargin = cfg.dew_point_margin_c ?? DEFAULT_DEW_POINT_MARGIN_C;
    if (forecast.dew_point_c != null && (forecast.temperature_c - forecast.dew_point_c) < dewMargin) {
      const deltaT = (forecast.temperature_c - forecast.dew_point_c).toFixed(1);
      return {
        acceptable: false,
        reason: `Cercanía al punto de rocío (ΔT=${deltaT}°C < ${dewMargin}°C, T:${forecast.temperature_c}°C, Rocío:${forecast.dew_point_c}°C) con riesgo de condensación en ${taskLabel}.`
      };
    }
    // Wind gusts only affect outdoor and covered workshops (indoor is shielded)
    if (workshopType !== "indoor") {
      const maxWindGustPaint = cfg.max_wind_gust_paint ?? DEFAULT_MAX_WIND_GUST_PAINT;
      if (forecast.wind_gusts_kmh != null && forecast.wind_gusts_kmh > maxWindGustPaint) {
        return {
          acceptable: false,
          reason: `Ráfagas de viento excesivas (>${maxWindGustPaint} km/h) para Barniz/Pintura a las ${String(h).padStart(2, "0")}:00 hrs (${forecast.wind_gusts_kmh} km/h) en ${taskLabel}.`
        };
      }
    }
  } else if (category === TaskCategory.EPOXY || (category as string) === "epoxy") {
    const minTempEpoxy = cfg.min_temp_epoxy_c ?? DEFAULT_MIN_TEMP_EPOXY;
    if (forecast.temperature_c < minTempEpoxy) {
      return {
        acceptable: false,
        reason: `Temperatura baja (<${minTempEpoxy}°C) para Epoxi a las ${String(h).padStart(2, "0")}:00 hrs en ${taskLabel}.`
      };
    }
    const maxEpoxyHum = Math.min(cfg.max_humidity_percent, DEFAULT_MAX_HUMIDITY_EPOXY);
    if (forecast.relative_humidity > maxEpoxyHum) {
      return {
        acceptable: false,
        reason: `Humedad alta (>${maxEpoxyHum}%) para Epoxi a las ${String(h).padStart(2, "0")}:00 hrs en ${taskLabel}.`
      };
    }
  } else {
    // Default fallback for generic / uncategorized tasks
    if (forecast.relative_humidity > cfg.max_humidity_percent) {
      return {
        acceptable: false,
        reason: `Exceso de humedad a las ${String(h).padStart(2, "0")}:00 hrs (${forecast.relative_humidity}%) durante ${taskLabel}.`
      };
    }
  }

  return { acceptable: true };
}

/**
 * Evaluates weather conditions for workshop general phases (SETUP / TEARDOWN).
 * Workshop setup and teardown are only blocked by rain / precipitation risk, not by ambient humidity.
 */
export function isHourAcceptableForWorkshopPhase(
  forecast: HourlyForecast,
  phaseName: "Setup / Preparación de taller" | "Teardown / Cierre de taller",
  cfg: AppSettings
): ClimateCheckResult {
  const h = forecast.hour;
  const workshopType = cfg.workshop_type || "outdoor";

  // Covered and Indoor workshops are protected from rain during setup/teardown
  if (workshopType !== "indoor" && workshopType !== "covered") {
    const maxRainProb = cfg.max_rain_probability ?? DEFAULT_MAX_RAIN_PROBABILITY;
    if (isRainyForecast(forecast, cfg.min_rain_precipitation_mm, maxRainProb)) {
      const rainInfo = forecast.precipitation_mm > 0
        ? `${forecast.precipitation_mm}mm`
        : `${forecast.precipitation_probability ?? 0}% prob`;
      return {
        acceptable: false,
        reason: `Riesgo de lluvia a las ${String(h).padStart(2, "0")}:00 hrs (${rainInfo}) durante la fase de ${phaseName}.`
      };
    }
  }

  return { acceptable: true };
}
