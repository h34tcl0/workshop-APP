import {
  AppSettings,
  Task,
  HourlyForecast,
  FreeWindow,
  WeatherSummary,
  TaskCategory
} from "../types.js";
import { formatHour } from "../dateUtils.js";
import { isRainyForecast } from "../climate/segments.js";
import { getCategoryMaxHumidity } from "../climate/rules.js";

/**
 * Builds a hierarchical diagnostic explanation (unassigned_reason) when a day cannot be scheduled.
 * Priority of analysis:
 * 1. Specific category conflict detected for a task (Epoxy temp/hum, PVA cold/hum, Varnish hum) or Setup/Teardown.
 * 2. Pervasive rain covering >=50% of the operational day with no dry windows.
 * 3. Pervasive humidity across >=60% of the operational window.
 * 4. Dry window exists but is shorter than the required duration (with climate cause explanation).
 * 5. Window exists but too short without explicit conflict.
 * 6. Partial rain without usable dry window.
 * 7. Generic fallback.
 */
export function buildUnassignedDiagnosticReason(
  startLimit: number,
  endLimit: number,
  hourlyWeather: Map<number, HourlyForecast>,
  cfg: AppSettings,
  weatherSummary: WeatherSummary,
  freeWindows: FreeWindow[],
  pendingTasks: Task[],
  effectiveMinWorkHours: number,
  firstWeatherConflictDetail: string | null,
  hadWeatherViableButTooShort = false
): string {
  const operationalHours = endLimit - startLimit;
  let rainyHoursCount = 0;
  let highHumidityHoursCount = 0;
  let firstRainyHour: number | null = null;
  let lastRainyHour: number | null = null;

  const firstPendingTask = pendingTasks.length > 0 ? pendingTasks[0] : null;
  const effectiveMaxHumidity = firstPendingTask
    ? getCategoryMaxHumidity(firstPendingTask.category, cfg.max_humidity_percent)
    : cfg.max_humidity_percent;

  for (let h = startLimit; h < endLimit; h++) {
    const wf = hourlyWeather.get(h);
    if (wf) {
      if (isRainyForecast(wf, cfg.min_rain_precipitation_mm)) {
        rainyHoursCount++;
        if (firstRainyHour === null) firstRainyHour = h;
        lastRainyHour = h;
      }
      if (wf.relative_humidity > effectiveMaxHumidity) {
        highHumidityHoursCount++;
      }
    }
  }

  const rainCoverageRatio = operationalHours > 0 ? rainyHoursCount / operationalHours : 0;
  const humidityCoverageRatio = operationalHours > 0 ? highHumidityHoursCount / operationalHours : 0;
  const totalRain = weatherSummary.total_rain_mm ?? 0;
  const maxHumidity = weatherSummary.max_humidity ?? 0;

  const hasPervasiveRain = rainCoverageRatio >= 0.5;
  const hasPervasiveHumidity = humidityCoverageRatio >= 0.6 && maxHumidity > effectiveMaxHumidity;

  const bestFreeWindow = freeWindows.length > 0
    ? freeWindows.reduce((best, w) => w.duration_hours > best.duration_hours ? w : best, freeWindows[0])
    : null;

  const firstTaskHours = firstPendingTask ? (firstPendingTask.estimated_hours || 0) : effectiveMinWorkHours;
  const requiredHours = Math.max(
    firstTaskHours + cfg.setup_hours + cfg.teardown_hours,
    effectiveMinWorkHours + cfg.setup_hours + cfg.teardown_hours
  );

  function buildClimateCause(): string {
    const parts: string[] = [];
    if (totalRain > 0 && firstRainyHour !== null) {
      const rainDesc = hasPervasiveRain
        ? `lluvia frecuente en horario operativo (${totalRain.toFixed(1)} mm)`
        : `lluvia a partir de las ${String(firstRainyHour).padStart(2, "0")}:00 hrs (${totalRain.toFixed(1)} mm)`;
      parts.push(rainDesc);
    } else if (rainyHoursCount > 0 && firstRainyHour !== null) {
      parts.push(`riesgo de lluvia a partir de las ${String(firstRainyHour).padStart(2, "0")}:00 hrs`);
    }
    if (maxHumidity > effectiveMaxHumidity) {
      parts.push(`humedad ${maxHumidity}% (límite: ${effectiveMaxHumidity}%)`);
    }
    return parts.length > 0 ? parts.join(" y ") : "límite de horario operativo";
  }

  // CASO 1: Conflicto puntual detectado en la tarea (frío PVA/Epoxi, humedad barniz/epoxi, o lluvia)
  if (firstWeatherConflictDetail) {
    return `Sin agendamiento: ${firstWeatherConflictDetail}`;
  }

  // CASO 2: Lluvia generalizada — no hay ninguna ventana seca viable
  if (hasPervasiveRain && freeWindows.length === 0) {
    const rainSpan = (firstRainyHour !== null && lastRainyHour !== null)
      ? ` (${String(firstRainyHour).padStart(2, "0")}:00 – ${String(lastRainyHour + 1).padStart(2, "0")}:00)`
      : "";
    const rainDetail = totalRain > 0
      ? `${totalRain.toFixed(1)} mm acumulados`
      : "probabilidad de lluvia crítica";
    return `Jornada no viable por lluvia: Precipitaciones frecuentes durante el horario operativo${rainSpan} — ${rainDetail}, sin ventana seca continua disponible.`;
  }

  // CASO 3: Humedad persistente sin ventanas aptas
  if (hasPervasiveHumidity && freeWindows.length === 0) {
    return `Jornada no viable por exceso de humedad: La humedad ambiental (${maxHumidity}%) supera el límite (${effectiveMaxHumidity}%) durante el ${Math.round(humidityCoverageRatio * 100)}% del horario operativo.`;
  }

  // CASO 4: Hay ventana seca pero es insuficiente — incluir causa climática y nombre de tarea
  if (bestFreeWindow !== null && bestFreeWindow.duration_hours < requiredHours) {
    const climateCause = buildClimateCause();
    const windowStart = formatHour(bestFreeWindow.start_hour ?? startLimit);
    const windowEnd = formatHour((bestFreeWindow.start_hour ?? startLimit) + bestFreeWindow.duration_hours);
    const taskTargetLabel = firstPendingTask
      ? `la tarea prioritaria #${firstPendingTask.order || 1} '${firstPendingTask.title}' (${(firstPendingTask.estimated_hours || 0).toFixed(1)}h)`
      : "las tareas pendientes";
    return `Tiempo insuficiente: Se detectó una ventana libre de ${bestFreeWindow.duration_hours.toFixed(1)}h (${windowStart} a ${windowEnd}), pero se requieren al menos ${requiredHours.toFixed(1)}h para cubrir ${taskTargetLabel} con su preparación y cierre (por ${climateCause}).`;
  }

  // CASO 5: Ventana existe pero demasiado corta sin causa climática clara
  if (hadWeatherViableButTooShort || (bestFreeWindow !== null)) {
    const climateCause = buildClimateCause();
    const availH = bestFreeWindow ? bestFreeWindow.duration_hours.toFixed(1) : "< " + requiredHours.toFixed(1);
    const taskTargetLabel = firstPendingTask
      ? `la tarea prioritaria #${firstPendingTask.order || 1} '${firstPendingTask.title}' (${(firstPendingTask.estimated_hours || 0).toFixed(1)}h)`
      : "las tareas pendientes";
    return `Tiempo insuficiente: Ventana libre disponible (${availH}h) insuficiente para ${taskTargetLabel} que requiere al menos ${requiredHours.toFixed(1)}h (por ${climateCause}).`;
  }

  // CASO 6: Algo de lluvia sin ventana viable
  if (totalRain > 0 || rainyHoursCount > 0) {
    const rainDetail = totalRain > 0
      ? `${totalRain.toFixed(1)} mm de precipitación acumulada`
      : "probabilidad de lluvia desfavorable";
    return `Jornada no viable por lluvia: ${rainDetail} en horario operativo sin ventana seca aprovechable.`;
  }

  // FALLBACK
  return "Sin agendamiento: Las condiciones climáticas o los tiempos de secado no permiten completar las tareas mínimas requeridas.";
}
