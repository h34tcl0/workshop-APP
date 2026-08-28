import {
  AppSettings,
  DayEvaluation,
  DayStatus,
  HourlyForecast,
  Task,
  TimeWindow,
  WeatherCutoffInfo
} from "../types.js";
import {
  computeHourlyClimateMap,
  compressClimateSegments,
  extractFreeWindows,
  DEFAULT_MAX_RAIN_PROBABILITY
} from "../climate/segments.js";
import {
  getHourlyClimateAudit,
  calculateWeatherCutoff,
  extractWorkdayWeatherSummary,
  calculateClimateEfficiency,
  calculateBarSegments
} from "../climate/audit.js";
import { getCategoryMaxHumidity } from "../climate/rules.js";
import { buildScheduledTimeline } from "./timeline.js";
import { buildUnassignedDiagnosticReason } from "./diagnostics.js";

export function buildCommonEvaluationFields(
  evalDateIso: string,
  dateStr: string,
  forecasts: HourlyForecast[],
  startLimit: number,
  endLimit: number,
  pendingTasks: Task[],
  cfg: AppSettings,
  effectiveMinWorkHours: number
) {
  const weatherSummary = extractWorkdayWeatherSummary(forecasts, startLimit, endLimit, cfg.min_rain_precipitation_mm);
  const effectiveMaxHumidity = pendingTasks.length > 0
    ? Math.max(...pendingTasks.map(t => getCategoryMaxHumidity(t.category, cfg.max_humidity_percent)))
    : cfg.max_humidity_percent;

  const climateMap = computeHourlyClimateMap(
    forecasts, startLimit, endLimit, cfg.min_rain_precipitation_mm,
    effectiveMaxHumidity, cfg.workshop_type || "outdoor", cfg.max_rain_probability ?? DEFAULT_MAX_RAIN_PROBABILITY
  );
  const climateSegments = compressClimateSegments(climateMap);
  const freeWindows = extractFreeWindows(climateMap, effectiveMinWorkHours);

  const climateEfficiency = calculateClimateEfficiency(
    forecasts, startLimit, endLimit, cfg.min_rain_precipitation_mm,
    cfg.max_humidity_percent, false, null, cfg.workshop_type || "outdoor", cfg.max_rain_probability ?? DEFAULT_MAX_RAIN_PROBABILITY
  );

  return {
    eval_date: evalDateIso,
    date_str: dateStr,
    weather_summary: weatherSummary,
    climate_segments: climateSegments,
    free_windows: freeWindows,
    climate_only_status: (freeWindows.length > 0 ? "clear" : "blocked") as "clear" | "blocked",
    hourly_forecast: forecasts,
    hourly_audit: getHourlyClimateAudit(forecasts, null, [], cfg),
    climate_efficiency: climateEfficiency,
    weather_cutoff: { is_cutoff_by_weather: false, primary_factor: "none" } as WeatherCutoffInfo
  };
}

export function buildViableEvaluation(
  commonFields: any,
  bestWindow: TimeWindow,
  bestScheduledTasks: Task[],
  pendingTasks: Task[],
  forecasts: HourlyForecast[],
  startLimit: number,
  endLimit: number,
  cfg: AppSettings
): DayEvaluation {
  const { timeline, cutoffReason } = buildScheduledTimeline(bestScheduledTasks, bestWindow, cfg, pendingTasks);
  const barSegments = calculateBarSegments(bestWindow, timeline, cfg, commonFields.climate_segments);
  const hourlyAudit = getHourlyClimateAudit(forecasts, bestWindow, bestScheduledTasks, cfg);
  const viableCutoff = calculateWeatherCutoff(
    forecasts, startLimit, endLimit, cfg.min_rain_precipitation_mm,
    cfg.max_humidity_percent, true, bestWindow.end_hour, cfg.workshop_type || "outdoor", cfg.max_rain_probability ?? DEFAULT_MAX_RAIN_PROBABILITY
  );

  return {
    ...commonFields,
    status: DayStatus.DAY_VIABLE,
    window: bestWindow,
    scheduled_tasks: bestScheduledTasks,
    reason: `Ventana viable (${bestWindow.start_time} a ${bestWindow.end_time}).`,
    timeline,
    cutoff_reason: cutoffReason,
    bar_segments: barSegments,
    hourly_audit: hourlyAudit,
    weather_cutoff: viableCutoff
  };
}

export function buildBlockedDayEvaluation(
  pre: any,
  forecasts: HourlyForecast[],
  cfg: AppSettings,
  firstConflict: string | null,
  tooShort: boolean
): DayEvaluation {
  const reason = buildUnassignedDiagnosticReason(
    pre.startLimit, pre.endLimit, pre.hourlyWeather, cfg, pre.common.weather_summary,
    pre.common.free_windows, pre.pendingTasks, pre.effectiveMinWorkHours, firstConflict, tooShort
  );
  const cutoff = calculateWeatherCutoff(forecasts, pre.startLimit, pre.endLimit, cfg.min_rain_precipitation_mm, cfg.max_humidity_percent, false, undefined, cfg.workshop_type || "outdoor", cfg.max_rain_probability ?? DEFAULT_MAX_RAIN_PROBABILITY);
  return { ...pre.common, status: DayStatus.DAY_BLOCKED, reason, unassigned_reason: reason, weather_cutoff: cutoff };
}
