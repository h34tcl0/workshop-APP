import {
  HourlyForecast,
  ClimateSegment,
  FreeWindow
} from "../types.js";
import { formatHour } from "../dateUtils.js";

export const DEFAULT_MAX_RAIN_PROBABILITY = 40.0;

export function isRainyForecast(
  wf: HourlyForecast,
  minRainMm = 0.1,
  maxRainProbability = DEFAULT_MAX_RAIN_PROBABILITY
): boolean {
  return (wf.precipitation_mm ?? 0) >= minRainMm || ((wf.precipitation_probability ?? 0) >= maxRainProbability);
}

export function computeHourlyClimateMap(
  forecasts: HourlyForecast[],
  startHour: number,
  endHour: number,
  minRainMm: number,
  maxHumidityPercent: number,
  workshopType: 'outdoor' | 'covered' | 'indoor' = 'outdoor',
  maxRainProbability: number = DEFAULT_MAX_RAIN_PROBABILITY
): { hour: number; condition: "clear" | "rain" | "humid" }[] {
  const hourlyWeather = new Map<number, HourlyForecast>();
  for (const f of forecasts) {
    if (f.hour != null) {
      hourlyWeather.set(f.hour, f);
    }
  }

  const isRainShielded = (workshopType === 'covered' || workshopType === 'indoor');

  const climateMap: { hour: number; condition: "clear" | "rain" | "humid" }[] = [];
  for (let h = startHour; h < endHour; h++) {
    const wf = hourlyWeather.get(h);
    let condition: "clear" | "rain" | "humid" = "clear";
    if (wf) {
      if (!isRainShielded && isRainyForecast(wf, minRainMm, maxRainProbability)) {
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
