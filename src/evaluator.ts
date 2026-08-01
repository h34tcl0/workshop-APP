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
  return wf.precipitation_mm >= minRainMm || wf.precipitation_probability >= MIN_RAIN_PROBABILITY_PERCENT;
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

  return { condition, label, min_temp: minTemp, max_temp: maxTemp };
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
    climate_only_status: climateOnlyStatus as "clear" | "blocked"
  };

  const weekday = evalDateObj.getDay(); // 0=Sunday, 6=Saturday
  const blockedLabels: string[] = [];
  if (cfg.exclude_saturdays && weekday === 6) blockedLabels.push("sábado");
  if (cfg.exclude_sundays && weekday === 0) blockedLabels.push("domingo");
  if (cfg.exclude_holidays && holidayDates && holidayDates.has(evalDateIso)) blockedLabels.push("feriado");

  if (blockedLabels.length > 0) {
    return {
      ...commonFields,
      status: DayStatus.DAY_BLOCKED,
      reason: `Día no laborable (${blockedLabels.join(" / ")}, desactivado en configuración).`
    };
  }

  const pendingTasks = backlogTasks.filter(t => t.status !== TaskStatus.COMPLETED).sort((a, b) => a.order - b.order);

  if (pendingTasks.length === 0) {
    return {
      ...commonFields,
      status: DayStatus.DAY_BLOCKED,
      reason: "No hay tareas pendientes en el backlog."
    };
  }

  const totalActivePending = pendingTasks.reduce((acc, t) => acc + t.estimated_hours, 0);
  if (totalActivePending < cfg.min_work_hours) {
    return {
      ...commonFields,
      status: DayStatus.DAY_BLOCKED,
      reason: `Trabajo insuficiente (${totalActivePending.toFixed(1)}h < ${cfg.min_work_hours}h mínimas).`
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
            break;
          }

          let nextOffset = currentOffset + task.estimated_hours;
          const requiresCuring = task.requires_curing || task.curing_hours > 0 || task.category === TaskCategory.PVA_GLUE || task.category === TaskCategory.VARNISH_PAINT || task.category === TaskCategory.EPOXY;

          if (requiresCuring) {
            const cureDur = task.curing_hours > 0 ? task.curing_hours : (task.category === TaskCategory.EPOXY ? 6.0 : 2.0);
            nextOffset = currentOffset + task.estimated_hours + cureDur;
          }

          scheduledPackage.push(task);
          accumulatedActiveHours += task.estimated_hours;
          lastActiveEndOffset = currentOffset + task.estimated_hours;
          currentOffset = nextOffset;
        }
      }

      if (accumulatedActiveHours < cfg.min_work_hours || scheduledPackage.length === 0) continue;

      const actualTeardownEnd = startHour + lastActiveEndOffset + cfg.teardown_hours;
      let maxCuringEnd = actualTeardownEnd;
      let taskCursor = cfg.setup_hours;

      for (const t of scheduledPackage) {
        const reqCur = t.requires_curing || t.curing_hours > 0 || t.category === TaskCategory.PVA_GLUE || t.category === TaskCategory.VARNISH_PAINT || t.category === TaskCategory.EPOXY;
        if (reqCur) {
          const cDur = t.curing_hours > 0 ? t.curing_hours : (t.category === TaskCategory.EPOXY ? 6.0 : 2.0);
          const cEnd = startHour + taskCursor + t.estimated_hours + cDur;
          if (cEnd > maxCuringEnd) maxCuringEnd = cEnd;
          taskCursor += t.estimated_hours + cDur;
        } else {
          taskCursor += t.estimated_hours;
        }
      }

      const bufferEndHour = Math.min(23, Math.floor(Math.max(actualTeardownEnd + 1, maxCuringEnd)));

      const hasEpoxyTask = scheduledPackage.some(t => t.category === TaskCategory.EPOXY || (t.category as string) === "epoxy");

      let hasWeatherConflict = false;
      for (let h = startHour; h <= bufferEndHour; h++) {
        const wf = hourlyWeather.get(h);
        if (wf) {
          if (isRainyForecast(wf, cfg.min_rain_precipitation_mm)) {
            hasWeatherConflict = true;
            if (!firstWeatherConflictDetail) {
              firstWeatherConflictDetail = `Riesgo de lluvia detectado a las ${String(h).padStart(2, "0")}:00 hrs (Probabilidad: ${wf.precipitation_probability}%, Precipitación: ${wf.precipitation_mm}mm).`;
            }
            break;
          }
          if (h >= startHour + cfg.setup_hours && wf.relative_humidity > cfg.max_humidity_percent) {
            hasWeatherConflict = true;
            if (!firstWeatherConflictDetail) {
              firstWeatherConflictDetail = `Exceso de humedad detectado a las ${String(h).padStart(2, "0")}:00 hrs (${wf.relative_humidity}%, Máx permitido: ${cfg.max_humidity_percent}%).`;
            }
            break;
          }
          // Requirement 5: Specific epoxy category weather threshold rules (temp >= 15°C, humidity <= 75%)
          if (hasEpoxyTask) {
            if (wf.temperature_c < 15.0) {
              hasWeatherConflict = true;
              if (!firstWeatherConflictDetail) {
                firstWeatherConflictDetail = `Temperatura ambiente baja para Epoxi a las ${String(h).padStart(2, "0")}:00 hrs (${wf.temperature_c}°C, Mínimo requerido: 15°C).`;
              }
              break;
            }
            if (wf.relative_humidity > 75.0) {
              hasWeatherConflict = true;
              if (!firstWeatherConflictDetail) {
                firstWeatherConflictDetail = `Humedad relativa excesiva para Epoxi a las ${String(h).padStart(2, "0")}:00 hrs (${wf.relative_humidity}%, Máximo permitido para epoxi: 75%).`;
              }
              break;
            }
          }
        }
      }

      if (hasWeatherConflict) continue;

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

  if (bestWindow) {
    const timeline: TimelineItem[] = [];
    let currH = bestWindow.start_hour;

    const setupEnd = currH + cfg.setup_hours;
    timeline.push({
      time_range: `${formatHour(currH)} — ${formatHour(setupEnd)}`,
      title: "🛠️ Setup / Preparación de taller",
      duration: `${cfg.setup_hours.toFixed(1)}h`
    });
    currH = setupEnd;

    let maxCuringEnd = currH;
    for (let i = 0; i < bestScheduledTasks.length; i++) {
      const task = bestScheduledTasks[i];
      const tEnd = currH + task.estimated_hours;
      timeline.push({
        time_range: `${formatHour(currH)} — ${formatHour(tEnd)}`,
        title: ` [#${task.order}] ${task.title}`,
        duration: `${task.estimated_hours.toFixed(1)}h`
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
            title: "🧪 Curado / Secado (bloquea el inicio de la siguiente tarea)",
            duration: `${cDur.toFixed(1)}h`
          });
          currH = cEnd;
        }
      }
    }

    const teardownEnd = currH + cfg.teardown_hours;
    timeline.push({
      time_range: `${formatHour(currH)} — ${formatHour(teardownEnd)}`,
      title: "🧹 Teardown / Guardado de herramientas",
      duration: `${cfg.teardown_hours.toFixed(1)}h`
    });

    if (maxCuringEnd > teardownEnd) {
      timeline.push({
        time_range: `${formatHour(teardownEnd)} — ${formatHourCrossDay(maxCuringEnd)}`,
        title: "🧪 Curado / Secado pasivo en taller",
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

    return {
      ...commonFields,
      status: DayStatus.DAY_VIABLE,
      window: bestWindow,
      scheduled_tasks: bestScheduledTasks,
      reason: `Ventana viable (${bestWindow.start_time} a ${bestWindow.end_time}).`,
      timeline,
      cutoff_reason: cutoffReason,
      bar_segments: barSegments
    };
  }

  if (hadWeatherViableButTooShort) {
    return {
      ...commonFields,
      status: DayStatus.DAY_BLOCKED,
      reason: `Existían ventanas climáticamente viables, pero ninguna alcanzó el mínimo de ${cfg.min_work_hours_unless_final.toFixed(1)}h de trabajo neto para abrir el taller.`
    };
  }

  if (firstWeatherConflictDetail) {
    return {
      ...commonFields,
      status: DayStatus.DAY_BLOCKED,
      reason: `Ninguna ventana entre ${startLimit}:00 y ${endLimit}:00 hrs quedó libre de interferencias meteorológicas. ${firstWeatherConflictDetail}`
    };
  }

  return {
    ...commonFields,
    status: DayStatus.DAY_BLOCKED,
    reason: `Sin ventana viable entre ${startLimit}:00 y ${endLimit}:00 hrs debido a restricciones climáticas.`
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
      weather_summary: extractWorkdayWeatherSummary(forecasts, startLimit, endLimit, settings.min_rain_precipitation_mm),
      climate_segments: climateSegments,
      free_windows: freeWindows,
      climate_only_status: freeWindows.length > 0 ? "clear" : "blocked",
      is_manually_blocked: true,
      forced_tasks: forcedTasksDetails,
      day_override: dayOverride
    };
  }

  let effectiveCfg = { ...settings };
  if (dayOverride) {
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

