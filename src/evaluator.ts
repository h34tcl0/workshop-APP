import {
  AppSettings,
  Task,
  TaskCategory,
  HourlyForecast,
  TimeWindow,
  DayEvaluation,
  DayStatus,
  TaskStatus,
  ClimateSegment,
  FreeWindow,
  BarSegments,
  WeatherSummary,
  TimelineItem,
  DayOverride,
  ForcedTaskWithDetails
} from "./types.js";
import { getSpanishDate, formatHour, formatHourCrossDay } from "./dateUtils.js";

const MIN_RAIN_PROBABILITY_PERCENT = 30;

export function isRainyForecast(wf: HourlyForecast, minRainMm = 0.2): boolean {
  return wf.precipitation_mm >= minRainMm;
}

export function computeHourlyClimateMap(
  forecasts: HourlyForecast[],
  startHour: number,
  endHour: number,
  minRainMm: number,
  maxHumidityPercent: number
): { hour: number; condition: "clear" | "rain" | "humid" }[] {
  const hourlyWeather = new Map<number, HourlyForecast>();
  for (const f of forecasts) {
    if (f.hour != null) {
      hourlyWeather.set(f.hour, f);
    }
  }

  const climateMap: { hour: number; condition: "clear" | "rain" | "humid" }[] = [];
  for (let h = startHour; h < endHour; h++) {
    const wf = hourlyWeather.get(h);
    let condition: "clear" | "rain" | "humid" = "clear";
    if (wf) {
      if (isRainyForecast(wf, minRainMm)) {
        condition = "rain";
      } else if (wf.relative_humidity > maxHumidityPercent) {
        condition = "humid";
      }
    }
    climateMap.push({ hour: h, condition });
  }
  return climateMap;
}

export function compressClimateSegments(
  climateMap: { hour: number; condition: "clear" | "rain" | "humid" }[]
): ClimateSegment[] {
  if (climateMap.length === 0) return [];
  const segments: ClimateSegment[] = [];
  let current: ClimateSegment = {
    start_h: climateMap[0].hour,
    end_h: climateMap[0].hour + 1,
    condition: climateMap[0].condition
  };

  for (let i = 1; i < climateMap.length; i++) {
    const entry = climateMap[i];
    if (entry.condition === current.condition) {
      current.end_h = entry.hour + 1;
    } else {
      segments.push(current);
      current = { start_h: entry.hour, end_h: entry.hour + 1, condition: entry.condition };
    }
  }
  segments.push(current);
  return segments;
}

export function extractFreeWindows(
  climateMap: { hour: number; condition: "clear" | "rain" | "humid" }[],
  minDurationHours = 0.0
): FreeWindow[] {
  const segments = compressClimateSegments(climateMap);
  const windows: FreeWindow[] = [];
  for (const seg of segments) {
    if (seg.condition === "clear") {
      const duration = seg.end_h - seg.start_h;
      if (duration >= minDurationHours) {
        windows.push({
          start_hour: seg.start_h,
          end_hour: seg.end_h,
          duration_hours: duration,
          start_label: formatHour(seg.start_h),
          end_label: formatHour(seg.end_h)
        });
      }
    }
  }
  return windows;
}

export function extractWorkdayWeatherSummary(
  forecasts: HourlyForecast[],
  startHour: number,
  endHour: number,
  minRainMm = 0.2
): WeatherSummary {
  let workForecasts = forecasts.filter(f => f.hour >= startHour && f.hour < endHour);
  if (workForecasts.length === 0) workForecasts = forecasts;

  const temps = workForecasts.map(f => f.temperature_c);
  const minTemp = temps.length > 0 ? Math.round(Math.min(...temps) * 10) / 10 : 0.0;
  const maxTemp = temps.length > 0 ? Math.round(Math.max(...temps) * 10) / 10 : 0.0;

  const humidities = workForecasts.map(f => Math.round(f.relative_humidity));
  const minHumidity = humidities.length > 0 ? Math.min(...humidities) : 0;
  const maxHumidity = humidities.length > 0 ? Math.max(...humidities) : 0;

  const totalRainMm = Math.round(
    workForecasts.reduce((acc, f) => acc + (f.precipitation_mm || 0), 0) * 10
  ) / 10;

  const maxPop = Math.max(0, ...workForecasts.map(f => f.precipitation_probability));
  const maxPrecip = Math.max(0, ...workForecasts.map(f => f.precipitation_mm));
  const avgClouds = workForecasts.reduce((acc, f) => acc + f.cloud_cover_percent, 0) / Math.max(workForecasts.length, 1);

  let condition: "sunny" | "partly" | "cloudy" | "rain" = "sunny";
  let label = "Soleado";

  if (maxPrecip >= minRainMm || maxPop >= MIN_RAIN_PROBABILITY_PERCENT) {
    condition = "rain";
    label = "Lluvia";
  } else if (avgClouds > 70) {
    condition = "cloudy";
    label = "Nublado";
  } else if (avgClouds > 30) {
    condition = "partly";
    label = "Parcial";
  }

  return {
    condition,
    label,
    min_temp: minTemp,
    max_temp: maxTemp,
    min_humidity: minHumidity,
    max_humidity: maxHumidity,
    total_rain_mm: totalRainMm
  };
}

export function sliceClimateSegments(
  climateSegments: ClimateSegment[],
  rangeStart: number,
  rangeEnd: number
): ClimateSegment[] {
  if (rangeEnd <= rangeStart) return [];
  const sliced: ClimateSegment[] = [];
  for (const seg of climateSegments) {
    const s = Math.max(seg.start_h, rangeStart);
    const e = Math.min(seg.end_h, rangeEnd);
    if (e > s) {
      sliced.push({ start_h: s, end_h: e, condition: seg.condition });
    }
  }
  return sliced;
}

export function calculateBarSegments(
  window: TimeWindow,
  timeline: TimelineItem[],
  cfg: AppSettings,
  climateSegments: ClimateSegment[] = []
): BarSegments {
  const totalDayHours = Math.max(1.0, cfg.operational_end_hour - cfg.operational_start_hour);

  const [sH, sM] = window.start_time.split(":").map(Number);
  const startH = sH + sM / 60.0;
  const closedBeforeH = Math.max(0.0, startH - cfg.operational_start_hour);
  const setupH = cfg.setup_hours;
  const workH = window.net_work_hours;
  const teardownH = cfg.teardown_hours;

  let curingH = 0.0;
  for (const item of timeline) {
    if (item.title.includes("Curado") || item.title.includes("Secado")) {
      const match = item.duration.match(/([0-9.]+)/);
      if (match) {
        curingH += parseFloat(match[1]) || 0.0;
      }
    }
  }

  const endActivityH = startH + setupH + workH + teardownH + curingH;
  const closedAfterH = Math.max(0.0, cfg.operational_end_hour - endActivityH);

  const beforeClimate = sliceClimateSegments(climateSegments, cfg.operational_start_hour, startH);
  const afterClimate = sliceClimateSegments(
    climateSegments,
    Math.min(endActivityH, cfg.operational_end_hour),
    cfg.operational_end_hour
  );

  return {
    closed_before_h: closedBeforeH,
    pct_closed_before: (closedBeforeH / totalDayHours) * 100,
    before_segments: beforeClimate.map(seg => ({
      pct: ((seg.end_h - seg.start_h) / totalDayHours) * 100,
      condition: seg.condition,
      start_h: seg.start_h,
      end_h: seg.end_h
    })),
    setup_h: setupH,
    pct_setup: (setupH / totalDayHours) * 100,
    work_h: workH,
    pct_work: (workH / totalDayHours) * 100,
    teardown_h: teardownH,
    pct_teardown: (teardownH / totalDayHours) * 100,
    curing_h: curingH,
    pct_curing: (curingH / totalDayHours) * 100,
    closed_after_h: closedAfterH,
    pct_closed_after: (closedAfterH / totalDayHours) * 100,
    after_segments: afterClimate.map(seg => ({
      pct: ((seg.end_h - seg.start_h) / totalDayHours) * 100,
      condition: seg.condition,
      start_h: seg.start_h,
      end_h: seg.end_h
    }))
  };
}

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
  has_any_risk: boolean;
  risk_reasons: string[];
}

export function getHourlyClimateAudit(
  forecasts: HourlyForecast[],
  window: TimeWindow | null | undefined,
  scheduledTasks: Task[] = [],
  cfg: AppSettings
): HourlyClimateAuditItem[] {
  const forecastMap = new Map<number, HourlyForecast>();
  if (Array.isArray(forecasts)) {
    for (const f of forecasts) {
      forecastMap.set(f.hour, f);
    }
  }

  let startH = window ? window.start_hour : cfg.operational_start_hour;
  let setupEnd = window ? startH + cfg.setup_hours : startH;
  let workEnd = window ? setupEnd + window.net_work_hours : setupEnd;
  let teardownEnd = window ? workEnd + cfg.teardown_hours : workEnd;

  let maxCuringEnd = teardownEnd;
  if (window && scheduledTasks.length > 0) {
    let currH = setupEnd;
    for (const task of scheduledTasks) {
      const tEnd = currH + task.estimated_hours;
      currH = tEnd;
      const reqCur = task.requires_curing || task.curing_hours > 0 || task.category === TaskCategory.PVA_GLUE || task.category === TaskCategory.VARNISH_PAINT || task.category === TaskCategory.EPOXY;
      if (reqCur) {
        const cDur = task.curing_hours > 0 ? task.curing_hours : (task.category === TaskCategory.EPOXY ? 6.0 : 2.0);
        const cEnd = tEnd + cDur;
        if (cEnd > maxCuringEnd) maxCuringEnd = cEnd;
      }
    }
  }

  const result: HourlyClimateAuditItem[] = [];

  for (let h = 0; h < 24; h++) {
    const f = forecastMap.get(h) || {
      hour: h,
      temperature_c: 20,
      relative_humidity: 50,
      precipitation_mm: 0,
      precipitation_probability: 0,
      cloud_cover_percent: 0,
      wind_speed_kmh: 0,
      weather_code: 0,
      description: "Sin datos"
    };

    let phase: "NONE" | "SETUP" | "WORK" | "TEARDOWN" | "CURING" = "NONE";
    let phase_label = "";
    let isActiveWork = false;
    let isCuring = false;

    if (window) {
      if (h >= startH && h < setupEnd) {
        phase = "SETUP";
        phase_label = "PREP";
        isActiveWork = true;
      } else if (h >= setupEnd && h < workEnd) {
        phase = "WORK";
        phase_label = "TRABAJO";
        isActiveWork = true;
      } else if (h >= workEnd && h < teardownEnd) {
        phase = "TEARDOWN";
        phase_label = "CIERRE";
        isActiveWork = true;
      } else {
        const checkH = (h < startH) ? h + 24 : h;
        if (checkH >= teardownEnd && checkH < maxCuringEnd) {
          phase = "CURING";
          phase_label = "CURADO";
          isCuring = true;
        }
      }
    }

    const risk_reasons: string[] = [];
    let has_humidity_risk = false;
    let has_rain_risk = false;
    let has_temp_risk = false;

    if (f.relative_humidity > cfg.max_humidity_percent) {
      has_humidity_risk = true;
      risk_reasons.push(`Humedad ${f.relative_humidity}% (límite ${cfg.max_humidity_percent}%)`);
    }

    if (f.precipitation_mm >= cfg.min_rain_precipitation_mm) {
      has_rain_risk = true;
      const rainMsg = isCuring
        ? `Lluvia en curado pasivo: ${f.precipitation_mm}mm (${f.precipitation_probability}%)`
        : `Lluvia ${f.precipitation_mm}mm (${f.precipitation_probability}%)`;
      risk_reasons.push(rainMsg);
    } else if (f.precipitation_probability >= 50) {
      risk_reasons.push(`Probabilidad de lluvia (${f.precipitation_probability}%)`);
    }

    if (isActiveWork || isCuring) {
      for (const t of scheduledTasks) {
        if (t.category === TaskCategory.EPOXY) {
          if (f.relative_humidity > 75) {
            has_humidity_risk = true;
            if (!risk_reasons.some(r => r.includes("Epoxi"))) {
              risk_reasons.push(`Epoxi: Humedad ${f.relative_humidity}% > 75%`);
            }
          }
          if (f.temperature_c < 15.0) {
            has_temp_risk = true;
            risk_reasons.push(`Epoxi: Temp ${f.temperature_c}°C < 15°C`);
          }
        }
      }
    }

    const has_any_risk = has_humidity_risk || has_rain_risk || has_temp_risk;

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
      has_any_risk,
      risk_reasons
    });
  }

  return result;
}

export function evaluateDayFeasibility(
  evalDateInput: Date | string,
  backlogTasks: Task[],
  forecasts: HourlyForecast[],
  settings: AppSettings,
  holidayDates?: Set<string>
): DayEvaluation {
  const cfg = settings;
  const evalDateObj = typeof evalDateInput === "string" ? new Date(evalDateInput + "T00:00:00") : evalDateInput;
  const evalDateIso = evalDateObj.toISOString().split("T")[0];
  const dateStr = getSpanishDate(evalDateObj);

  const hourlyWeather = new Map<number, HourlyForecast>();
  for (const f of forecasts) {
    hourlyWeather.set(f.hour, f);
  }

  const startLimit = cfg.operational_start_hour;
  const endLimit = cfg.operational_end_hour;

  const weatherSummary = extractWorkdayWeatherSummary(forecasts, startLimit, endLimit, cfg.min_rain_precipitation_mm);

  const climateMap = computeHourlyClimateMap(
    forecasts,
    startLimit,
    endLimit,
    cfg.min_rain_precipitation_mm,
    cfg.max_humidity_percent
  );
  const climateSegments = compressClimateSegments(climateMap);
  const freeWindows = extractFreeWindows(climateMap, cfg.min_work_hours);
  const climateOnlyStatus = freeWindows.length > 0 ? "clear" : "blocked";

  const commonFields = {
    eval_date: evalDateIso,
    date_str: dateStr,
    weather_summary: weatherSummary,
    climate_segments: climateSegments,
    free_windows: freeWindows,
    climate_only_status: climateOnlyStatus as "clear" | "blocked",
    hourly_forecast: forecasts,
    hourly_audit: getHourlyClimateAudit(forecasts, null, [], cfg)
  };

  const weekday = evalDateObj.getDay(); // 0=Sunday, 6=Saturday
  const blockedLabels: string[] = [];
  if (cfg.exclude_saturdays && weekday === 6) blockedLabels.push("sábado");
  if (cfg.exclude_sundays && weekday === 0) blockedLabels.push("domingo");
  if (cfg.exclude_holidays && holidayDates && holidayDates.has(evalDateIso)) blockedLabels.push("feriado");

  if (blockedLabels.length > 0) {
    const reasonMsg = `Día no laborable (${blockedLabels.join(" / ")}, desactivado en configuración).`;
    return {
      ...commonFields,
      status: DayStatus.DAY_BLOCKED,
      reason: reasonMsg,
      unassigned_reason: reasonMsg
    };
  }

  const pendingTasks = backlogTasks.filter(t => t.status !== TaskStatus.COMPLETED).sort((a, b) => a.order - b.order);

  if (pendingTasks.length === 0) {
    const reasonMsg = "Sin agendamiento: No hay tareas pendientes compatibles en el backlog.";
    return {
      ...commonFields,
      status: DayStatus.DAY_BLOCKED,
      reason: reasonMsg,
      unassigned_reason: reasonMsg
    };
  }

  const totalActivePending = pendingTasks.reduce((acc, t) => acc + t.estimated_hours, 0);
  if (totalActivePending < cfg.min_work_hours) {
    const reasonMsg = `Sin agendamiento: La ventana de trabajo libre (${totalActivePending.toFixed(1)}h) es menor al tiempo mínimo requerido por las tareas en backlog (${cfg.min_work_hours.toFixed(1)}h).`;
    return {
      ...commonFields,
      status: DayStatus.DAY_BLOCKED,
      reason: reasonMsg,
      unassigned_reason: reasonMsg
    };
  }

  let bestWindow: TimeWindow | null = null;
  let bestScheduledTasks: Task[] = [];
  let maxWorkScheduled = -1.0;
  let hadWeatherViableButTooShort = false;
  let firstWeatherConflictDetail: string | null = null;

  const minSpan = Math.floor(cfg.setup_hours + cfg.min_work_hours);

  for (let startHour = startLimit; startHour <= endLimit - minSpan; startHour++) {
    for (let endHour = startHour + minSpan; endHour <= endLimit; endHour++) {
      const availableNetWork = endHour - startHour - cfg.setup_hours;
      if (availableNetWork < cfg.min_work_hours) continue;

      const scheduledPackage: Task[] = [];
      let accumulatedActiveHours = 0.0;
      let currentOffset = cfg.setup_hours;
      let lastActiveEndOffset = cfg.setup_hours;

      for (const task of pendingTasks) {
        if (accumulatedActiveHours + task.estimated_hours <= availableNetWork + 0.01) {
          const taskStart = startHour + currentOffset;
          const taskActiveEnd = taskStart + task.estimated_hours;

          if (taskActiveEnd > endHour - cfg.teardown_hours + 0.01) {
            continue;
          }

          let nextOffset = currentOffset + task.estimated_hours;
          const requiresCuring = task.requires_curing || task.curing_hours > 0 || task.category === TaskCategory.PVA_GLUE || task.category === TaskCategory.VARNISH_PAINT || task.category === TaskCategory.EPOXY;
          const cureDur = requiresCuring ? (task.curing_hours > 0 ? task.curing_hours : (task.category === TaskCategory.EPOXY ? 6.0 : 2.0)) : 0.0;

          if (requiresCuring) {
            nextOffset = currentOffset + task.estimated_hours + cureDur;
          }

          // Test weather compatibility specifically for this candidate task in this window
          const taskTeardownEnd = taskActiveEnd + cfg.teardown_hours;
          const taskMaxCuringEnd = requiresCuring ? taskStart + task.estimated_hours + cureDur : taskTeardownEnd;
          const checkBufferEnd = Math.min(23, Math.floor(Math.max(taskTeardownEnd + 1, taskMaxCuringEnd)));
          const isEpoxyTask = task.category === TaskCategory.EPOXY || (task.category as string) === "epoxy";

          let taskWeatherConflict = false;
          let conflictDetail: string | null = null;

          for (let h = startHour; h <= checkBufferEnd; h++) {
            const wf = hourlyWeather.get(h);
            if (wf) {
              if (isRainyForecast(wf, cfg.min_rain_precipitation_mm)) {
                taskWeatherConflict = true;
                conflictDetail = `Riesgo de lluvia a las ${String(h).padStart(2, "0")}:00 hrs durante [${task.project_name || 'Tarea'}] "${task.title}".`;
                break;
              }

              const isPostWorkPassiveCuring = h >= Math.floor(taskTeardownEnd) || h >= cfg.operational_end_hour;
              if (!isPostWorkPassiveCuring && h >= startHour + cfg.setup_hours && wf.relative_humidity > cfg.max_humidity_percent) {
                taskWeatherConflict = true;
                conflictDetail = `Exceso de humedad a las ${String(h).padStart(2, "0")}:00 hrs (${wf.relative_humidity}%) durante [${task.project_name || 'Tarea'}] "${task.title}".`;
                break;
              }

              if (isEpoxyTask) {
                if (wf.temperature_c < 15.0) {
                  taskWeatherConflict = true;
                  conflictDetail = `Temperatura baja (<15°C) para Epoxi a las ${String(h).padStart(2, "0")}:00 hrs en [${task.project_name || 'Tarea'}] "${task.title}".`;
                  break;
                }
                if (!isPostWorkPassiveCuring && wf.relative_humidity > 75.0) {
                  taskWeatherConflict = true;
                  conflictDetail = `Humedad alta (>75%) para Epoxi a las ${String(h).padStart(2, "0")}:00 hrs en [${task.project_name || 'Tarea'}] "${task.title}".`;
                  break;
                }
              }
            }
          }

          if (taskWeatherConflict) {
            if (!firstWeatherConflictDetail) {
              firstWeatherConflictDetail = conflictDetail;
            }
            // Skip this weather-incompatible task and try subsequent candidate tasks in the pool
            continue;
          }

          scheduledPackage.push(task);
          accumulatedActiveHours += task.estimated_hours;
          lastActiveEndOffset = currentOffset + task.estimated_hours;
          currentOffset = nextOffset;
        }
      }

      if (accumulatedActiveHours < cfg.min_work_hours || scheduledPackage.length === 0) continue;

      if (accumulatedActiveHours > maxWorkScheduled) {
        maxWorkScheduled = accumulatedActiveHours;
        bestScheduledTasks = scheduledPackage;

        const actualWorkEnd = startHour + lastActiveEndOffset;
        const actualTeardownEndVal = actualWorkEnd + cfg.teardown_hours;

        bestWindow = {
          start_time: formatHour(startHour),
          end_time: formatHour(actualTeardownEndVal),
          start_hour: startHour,
          end_hour: Math.ceil(actualTeardownEndVal),
          total_duration_hours: actualTeardownEndVal - startHour,
          net_work_hours: accumulatedActiveHours,
          is_viable: true
        };
      }
    }
  }

  if (bestWindow && bestScheduledTasks.length > 0) {
    console.log(`[EVALUATOR] Assigned ${bestScheduledTasks.length} task(s) to Date ${evalDateIso} (${maxWorkScheduled.toFixed(1)}h work):`, bestScheduledTasks.map(t => `#${t.order || t.id} ${t.title}`).join(", "));
  }

  if (bestWindow && bestScheduledTasks.length > 0) {
    const timeline: TimelineItem[] = [];
    let currH = bestWindow.start_hour;

    const setupEnd = currH + cfg.setup_hours;
    timeline.push({
      time_range: `${formatHour(currH)} — ${formatHour(setupEnd)}`,
      title: "Setup / Preparación de taller",
      duration: `${cfg.setup_hours.toFixed(1)}h`
    });
    currH = setupEnd;

    let maxCuringEnd = currH;
    for (let i = 0; i < bestScheduledTasks.length; i++) {
      const task = bestScheduledTasks[i];
      const tEnd = currH + task.estimated_hours;
      timeline.push({
        time_range: `${formatHour(currH)} — ${formatHour(tEnd)}`,
        title: `#${task.order || (i + 1)} ${task.title}`,
        duration: `${task.estimated_hours.toFixed(1)}h`,
        project_name: task.project_name || undefined
      });
      currH = tEnd;

      const reqCur = task.requires_curing || task.curing_hours > 0 || task.category === TaskCategory.PVA_GLUE || task.category === TaskCategory.VARNISH_PAINT || task.category === TaskCategory.EPOXY;
      if (reqCur) {
        const cDur = task.curing_hours > 0 ? task.curing_hours : (task.category === TaskCategory.EPOXY ? 6.0 : 2.0);
        const cEnd = tEnd + cDur;
        if (cEnd > maxCuringEnd) maxCuringEnd = cEnd;
        if (i < bestScheduledTasks.length - 1) {
          timeline.push({
            time_range: `${formatHour(tEnd)} — ${formatHour(cEnd)}`,
            title: "Curado / Secado (bloquea el inicio de la siguiente tarea)",
            duration: `${cDur.toFixed(1)}h`
          });
          currH = cEnd;
        }
      }
    }

    const teardownEnd = currH + cfg.teardown_hours;
    timeline.push({
      time_range: `${formatHour(currH)} — ${formatHour(teardownEnd)}`,
      title: "Teardown / Guardado de herramientas",
      duration: `${cfg.teardown_hours.toFixed(1)}h`
    });

    if (maxCuringEnd > teardownEnd) {
      timeline.push({
        time_range: `${formatHour(teardownEnd)} — ${formatHourCrossDay(maxCuringEnd)}`,
        title: "Curado / Secado pasivo en taller",
        duration: `${(maxCuringEnd - teardownEnd).toFixed(1)}h`
      });
    }

    const remaining = pendingTasks.filter(t => !bestScheduledTasks.includes(t));
    let cutoffReason = "";
    if (remaining.length === 0) {
      cutoffReason = "Todas las tareas pendientes fueron asignadas.";
    } else {
      const nextT = remaining[0];
      cutoffReason = `La siguiente tarea ('${nextT.title}' - ${nextT.estimated_hours.toFixed(1)}h activo) no pudo agendarse por límite de jornada o margen de tiempo.`;
    }

    const barSegments = calculateBarSegments(bestWindow, timeline, cfg, climateSegments);
    const hourlyAudit = getHourlyClimateAudit(forecasts, bestWindow, bestScheduledTasks, cfg);

    return {
      ...commonFields,
      status: DayStatus.DAY_VIABLE,
      window: bestWindow,
      scheduled_tasks: bestScheduledTasks,
      reason: `Ventana viable (${bestWindow.start_time} a ${bestWindow.end_time}).`,
      timeline,
      cutoff_reason: cutoffReason,
      bar_segments: barSegments,
      hourly_audit: hourlyAudit
    };
  }

  // Audit and construct explicit unassigned_reason when no tasks scheduled
  let auditUnassignedReason = "";

  if (firstWeatherConflictDetail) {
    auditUnassignedReason = `Sin agendamiento: ${firstWeatherConflictDetail}`;
  } else if (weatherSummary.max_humidity > cfg.max_humidity_percent) {
    auditUnassignedReason = `Sin agendamiento: La humedad máxima en horario laboral (${weatherSummary.max_humidity}%) excede el umbral límite configurado (${cfg.max_humidity_percent}%).`;
  } else if (freeWindows.length > 0) {
    const maxFreeH = Math.max(...freeWindows.map(w => w.duration_hours));
    const minTaskHours = Math.min(...pendingTasks.map(t => t.estimated_hours));
    const minNeededWithPrep = minTaskHours + cfg.setup_hours;
    const requiredThreshold = Math.max(minNeededWithPrep, cfg.min_work_hours);

    if (maxFreeH < requiredThreshold) {
      auditUnassignedReason = `Sin agendamiento: La ventana de trabajo libre (${maxFreeH.toFixed(1)}h) es menor al tiempo mínimo requerido por las tareas en backlog (${requiredThreshold.toFixed(1)}h).`;
    } else {
      const hasCuringTasks = pendingTasks.some(t => t.requires_curing || t.curing_hours > 0 || t.category === TaskCategory.PVA_GLUE || t.category === TaskCategory.VARNISH_PAINT || t.category === TaskCategory.EPOXY);
      if (hasCuringTasks) {
        auditUnassignedReason = `Sin agendamiento: Bloqueado por tiempo de curado activo de la jornada anterior o requerido para las tareas.`;
      } else {
        auditUnassignedReason = `Sin agendamiento: La ventana de trabajo libre (${maxFreeH.toFixed(1)}h) es menor al tiempo mínimo requerido por las tareas en backlog (${requiredThreshold.toFixed(1)}h).`;
      }
    }
  } else if (hadWeatherViableButTooShort) {
    auditUnassignedReason = `Sin agendamiento: La ventana de trabajo libre es menor al tiempo mínimo de ${cfg.min_work_hours_unless_final.toFixed(1)}h de trabajo neto requerido por las tareas en backlog.`;
  } else if (weatherSummary.total_rain_mm > 0) {
    auditUnassignedReason = `Sin agendamiento: Riesgo de lluvia detectado en la jornada (${weatherSummary.total_rain_mm} mm de precipitación acumulada).`;
  } else {
    auditUnassignedReason = `Sin agendamiento: No existe ventana climática viable disponible para las tareas en backlog.`;
  }

  return {
    ...commonFields,
    status: DayStatus.DAY_BLOCKED,
    reason: auditUnassignedReason,
    unassigned_reason: auditUnassignedReason
  };
}

export function evaluateDayWithOverrides(
  evalDateInput: Date | string,
  backlogTasks: Task[],
  forecasts: HourlyForecast[],
  settings: AppSettings,
  holidayDates?: Set<string>,
  dayOverride?: DayOverride,
  forcedTasksDetails: ForcedTaskWithDetails[] = []
): DayEvaluation {
  const evalDateObj = typeof evalDateInput === "string" ? new Date(evalDateInput + "T00:00:00") : evalDateInput;
  const evalDateIso = evalDateObj.toISOString().split("T")[0];
  const dateStr = getSpanishDate(evalDateObj);

  if (dayOverride && dayOverride.force_status === "BLOCKED") {
    const startLimit = dayOverride.custom_start_hour ?? settings.operational_start_hour;
    const endLimit = dayOverride.custom_end_hour ?? settings.operational_end_hour;

    const climateMap = computeHourlyClimateMap(
      forecasts,
      startLimit,
      endLimit,
      settings.min_rain_precipitation_mm,
      settings.max_humidity_percent
    );
    const climateSegments = compressClimateSegments(climateMap);
    const freeWindows = extractFreeWindows(climateMap, settings.min_work_hours);

    return {
      eval_date: evalDateIso,
      date_str: dateStr,
      status: DayStatus.DAY_BLOCKED,
      reason: dayOverride.note || "Bloqueado manualmente desde el editor de día.",
      unassigned_reason: dayOverride.note || "Bloqueado manualmente desde el editor de día.",
      weather_summary: extractWorkdayWeatherSummary(forecasts, startLimit, endLimit, settings.min_rain_precipitation_mm),
      climate_segments: climateSegments,
      free_windows: freeWindows,
      climate_only_status: freeWindows.length > 0 ? "clear" : "blocked",
      is_manually_blocked: true,
      forced_tasks: forcedTasksDetails,
      day_override: dayOverride,
      hourly_forecast: forecasts,
      hourly_audit: getHourlyClimateAudit(forecasts, null, [], settings)
    };
  }

  let effectiveCfg = { ...settings };
  if (dayOverride) {
    // If a day override exists (e.g. force_status === "VIABLE" or custom start/end hours),
    // it takes precedence over default day exclusions (saturdays, sundays, holidays)
    if (dayOverride.force_status === "VIABLE" || dayOverride.custom_start_hour != null || dayOverride.custom_end_hour != null) {
      effectiveCfg.exclude_saturdays = false;
      effectiveCfg.exclude_sundays = false;
      effectiveCfg.exclude_holidays = false;
    }
    if (dayOverride.custom_start_hour != null) effectiveCfg.operational_start_hour = dayOverride.custom_start_hour;
    if (dayOverride.custom_end_hour != null) effectiveCfg.operational_end_hour = dayOverride.custom_end_hour;
  }

  const result = evaluateDayFeasibility(evalDateObj, backlogTasks, forecasts, effectiveCfg, holidayDates);

  if (dayOverride && dayOverride.removed_task_ids && result.scheduled_tasks) {
    try {
      const removedIds = new Set<number>(JSON.parse(dayOverride.removed_task_ids));
      result.scheduled_tasks = result.scheduled_tasks.filter(t => !removedIds.has(t.id));
    } catch {
      // ignore JSON parse error
    }
  }

  result.forced_tasks = forcedTasksDetails;
  result.day_override = dayOverride;
  if (result.status === DayStatus.DAY_VIABLE && result.window) {
    result.hourly_audit = getHourlyClimateAudit(forecasts, result.window, result.scheduled_tasks || [], effectiveCfg);
  }
  return result;
}

export function detectNewWeatherRisk(
  oldSegments: ClimateSegment[],
  newSegments: ClimateSegment[],
  windowStartH: number,
  windowEndH: number
): string | null {
  const newMap = new Map<number, string>();
  for (const seg of newSegments) {
    for (let h = seg.start_h; h < seg.end_h; h++) {
      newMap.set(h, seg.condition);
    }
  }

  const oldMap = new Map<number, string>();
  for (const seg of oldSegments) {
    for (let h = seg.start_h; h < seg.end_h; h++) {
      oldMap.set(h, seg.condition);
    }
  }

  for (let h = Math.floor(windowStartH); h < Math.ceil(windowEndH); h++) {
    const oldCond = oldMap.get(h) || "clear";
    const newCond = newMap.get(h) || "clear";

    if (newCond === "rain" && oldCond !== "rain") {
      return `Se detectó lluvia imprevista a las ${String(h).padStart(2, "0")}:00 hrs.`;
    }
    if (newCond === "humid" && oldCond === "clear") {
      return `Se detectó alta humedad imprevista a las ${String(h).padStart(2, "0")}:00 hrs.`;
    }
  }
  return null;
}

