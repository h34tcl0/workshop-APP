import { HourlyForecast, TimeWindow, WeatherSummary, ClimateEfficiency } from "../types.js";
import { isRainyForecast, DEFAULT_MAX_RAIN_PROBABILITY } from "./segments.js";

export function calculateClimateEfficiency(
  forecasts: HourlyForecast[],
  startLimit: number,
  endLimit: number,
  minRainMm: number,
  maxHumidityPercent: number,
  isViable: boolean = false,
  window?: TimeWindow | null,
  workshopType: "outdoor" | "covered" | "indoor" = "outdoor",
  maxRainProbability: number = DEFAULT_MAX_RAIN_PROBABILITY
): ClimateEfficiency {
  let jornadaGood = 0, jornadaTotal = 0;
  let fueraGood = 0, fueraTotal = 0;
  const isRainShielded = (workshopType === "covered" || workshopType === "indoor");

  if (Array.isArray(forecasts) && forecasts.length > 0) {
    for (const f of forecasts) {
      const h = f.hour;
      const isJornada = (h >= startLimit && h < endLimit);
      const isOk = ((isRainShielded || !isRainyForecast(f, minRainMm, maxRainProbability)) && f.relative_humidity <= maxHumidityPercent);

      if (isJornada) {
        jornadaTotal++;
        if (isOk) jornadaGood++;
      } else {
        fueraTotal++;
        if (isOk) fueraGood++;
      }
    }
  }

  const pJornada = jornadaTotal > 0 ? (jornadaGood / jornadaTotal) : 0;
  const pFuera = fueraTotal > 0 ? (fueraGood / fueraTotal) : 0;
  const pctJornada = Math.round(pJornada * 100);
  const pctFuera = Math.round(pFuera * 100);

  let score = 0;
  if (jornadaTotal > 0 || fueraTotal > 0) {
    score = (fueraTotal === 0) ? pctJornada : Math.round((pJornada * 0.80 + pFuera * 0.20) * 100);
  } else {
    let windowHours = (isViable && window) ? Math.max(0, window.end_hour - window.start_hour) : 0;
    const totalShiftHours = Math.max(1, endLimit - startLimit);
    score = Math.min(100, Math.max(0, Math.round((windowHours / totalShiftHours) * 100)));
  }
  score = Math.min(100, Math.max(0, score));

  let ringColor: "var(--w-ok)" | "var(--w-warn)" | "var(--w-rust)" = "var(--w-ok)";
  if (score < 30) {
    ringColor = "var(--w-rust)";
  } else if (score < 70) {
    ringColor = "var(--w-warn)";
  }

  const strokeDash = ((score / 100) * 163.4).toFixed(1) + " 163.4";
  const strJornada = `Jornada: ${jornadaGood}/${jornadaTotal}h óptimas (${pctJornada}%)`;
  const strFuera = `Resto del día: ${fueraGood}/${fueraTotal}h despejadas (${pctFuera}%)`;

  return {
    score,
    jornada_good: jornadaGood,
    jornada_total: jornadaTotal,
    jornada_pct: pctJornada,
    fuera_good: fueraGood,
    fuera_total: fueraTotal,
    fuera_pct: pctFuera,
    tooltip: `${strJornada} · ${strFuera} · Índice: ${score}%`,
    ring_color: ringColor,
    stroke_dash: strokeDash
  };
}

export function extractWorkdayWeatherSummary(
  forecasts: HourlyForecast[],
  startHour: number,
  endHour: number,
  minRainMm = 0.1
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

  const maxPop = Math.max(0, ...workForecasts.map(f => f.precipitation_probability || 0));
  const maxPrecip = Math.max(0, ...workForecasts.map(f => f.precipitation_mm || 0));
  const avgClouds = workForecasts.reduce((acc, f) => acc + (f.cloud_cover_percent || 0), 0) / Math.max(workForecasts.length, 1);

  let condition: "sunny" | "partly" | "cloudy" | "rain" = "sunny";
  let label = "Soleado";

  if (maxPrecip >= minRainMm || maxPop >= DEFAULT_MAX_RAIN_PROBABILITY) {
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
