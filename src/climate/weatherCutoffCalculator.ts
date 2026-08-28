import { HourlyForecast, WeatherCutoffInfo } from "../types.js";
import { formatHour } from "../dateUtils.js";
import { isRainyForecast, DEFAULT_MAX_RAIN_PROBABILITY } from "./segments.js";

export function calculateWeatherCutoff(
  forecasts: HourlyForecast[],
  startLimit: number,
  endLimit: number,
  minRainMm: number,
  maxHumidityPercent: number,
  isViable: boolean,
  scheduledEndHour?: number,
  workshopType: "outdoor" | "covered" | "indoor" = "outdoor",
  maxRainProbability: number = DEFAULT_MAX_RAIN_PROBABILITY
): WeatherCutoffInfo {
  const hourlyWeather = new Map<number, HourlyForecast>();
  for (const f of forecasts) hourlyWeather.set(f.hour, f);

  const isRainShielded = (workshopType === "covered" || workshopType === "indoor");
  let firstBadHour: number | null = null;
  let primaryFactor: "rain" | "humidity" | "temperature" | "none" = "none";
  let factorDescription = "";

  for (let h = startLimit; h < endLimit; h++) {
    const f = hourlyWeather.get(h);
    if (!f) continue;

    const isRain = !isRainShielded && isRainyForecast(f, minRainMm, maxRainProbability);
    const isHighHumidity = f.relative_humidity > maxHumidityPercent;

    if (isRain) {
      firstBadHour = h;
      primaryFactor = "rain";
      factorDescription = f.precipitation_mm > 0
        ? `Lluvia de ${f.precipitation_mm.toFixed(1)}mm`
        : `Probabilidad de lluvia del ${f.precipitation_probability}%`;
      break;
    } else if (isHighHumidity) {
      firstBadHour = h;
      primaryFactor = "humidity";
      factorDescription = `Humedad del ${f.relative_humidity}%`;
      break;
    }
  }

  if (firstBadHour === null) {
    return { is_cutoff_by_weather: false, primary_factor: "none" };
  }

  if (isViable) {
    if (firstBadHour < endLimit) {
      return {
        is_cutoff_by_weather: true,
        cutoff_hour: firstBadHour,
        cutoff_time_label: formatHour(firstBadHour),
        primary_factor: primaryFactor,
        factor_description: factorDescription
      };
    }
    return { is_cutoff_by_weather: false, primary_factor: "none" };
  }

  return {
    is_cutoff_by_weather: true,
    cutoff_hour: firstBadHour,
    cutoff_time_label: formatHour(firstBadHour),
    primary_factor: primaryFactor,
    factor_description: factorDescription
  };
}
