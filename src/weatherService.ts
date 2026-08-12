import { HourlyForecast } from "./types.js";

export class MockWeatherService {
  scenario: string;

  constructor(scenario = "sunny") {
    this.scenario = scenario;
  }

  getHourlyForecast(dateIso: string): HourlyForecast[] {
    const forecasts: HourlyForecast[] = [];
    for (let h = 0; h < 24; h++) {
      let temp = 22 + Math.sin((h - 6) / 3) * 4;
      let humidity = 45;
      let precipMm = 0;
      let precipPop = 0;
      let cloudCover = 20;

      if (this.scenario === "rainy") {
        if (h >= 11 && h <= 14) {
          precipMm = 3.5;
          precipPop = 90;
          cloudCover = 85;
          humidity = 85;
        }
      } else if (this.scenario === "humid") {
        humidity = 88;
        cloudCover = 75;
      } else if (this.scenario === "variable") {
        if (h >= 14) {
          humidity = 85;
          cloudCover = 80;
        }
      } else if (this.scenario === "intermittent_rain") {
        if ((h >= 10 && h <= 11) || (h >= 15 && h <= 16)) {
          precipMm = 2.0;
          precipPop = 80;
          humidity = 80;
          cloudCover = 90;
        }
      }

      forecasts.push({
        hour: h,
        temperature_c: Math.round(temp * 10) / 10,
        relative_humidity: humidity,
        precipitation_mm: precipMm,
        precipitation_probability: precipPop,
        cloud_cover_percent: cloudCover
      });
    }
    return forecasts;
  }
}

export class OpenMeteoWeatherService {
  lat: number;
  lon: number;

  constructor(lat = -32.99, lon = -71.27) {
    this.lat = typeof lat === "number" && !isNaN(lat) ? lat : -32.99;
    this.lon = typeof lon === "number" && !isNaN(lon) ? lon : -71.27;
  }

  async getWeeklyForecast(startDate: string, days = 7): Promise<Map<string, HourlyForecast[]>> {
    const forecastMap = new Map<string, HourlyForecast[]>();
    const numDays = Math.max(days, 3);
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${this.lat}&longitude=${this.lon}&hourly=temperature_2m,relative_humidity_2m,precipitation_probability,precipitation,cloud_cover&timezone=auto&forecast_days=${numDays}`;

    try {
      if (process.env.NODE_ENV === "test" && !process.env.ALLOW_REAL_WEATHER_IN_TESTS) {
        throw new Error("Test environment: using deterministic mock weather");
      }
      const response = await fetch(url, { signal: AbortSignal.timeout(5000) });
      if (!response.ok) {
        throw new Error(`OpenMeteo returned status ${response.status}`);
      }
      const data = await response.json();
      const times: string[] = data.hourly?.time || [];
      const temps: number[] = data.hourly?.temperature_2m || [];
      const humidities: number[] = data.hourly?.relative_humidity_2m || [];
      const precipPops: number[] = data.hourly?.precipitation_probability || [];
      const precipMms: number[] = data.hourly?.precipitation || [];
      const clouds: number[] = data.hourly?.cloud_cover || [];

      for (let i = 0; i < times.length; i++) {
        const fullTime = times[i]; // "2026-07-31T09:00"
        const [datePart, timePart] = fullTime.split("T");
        const hour = parseInt(timePart.split(":")[0], 10);

        if (!forecastMap.has(datePart)) {
          forecastMap.set(datePart, []);
        }

        forecastMap.get(datePart)!.push({
          hour,
          temperature_c: temps[i] ?? 20,
          relative_humidity: humidities[i] ?? 50,
          precipitation_mm: precipMms[i] ?? 0,
          precipitation_probability: precipPops[i] ?? 0,
          cloud_cover_percent: clouds[i] ?? 20
        });
      }
    } catch (err) {
      console.warn(`[OpenMeteoWeatherService] Error fetching weather for lat:${this.lat}, lon:${this.lon}, falling back to mock:`, err);
      const mock = new MockWeatherService("sunny");
      const d = new Date(startDate);
      for (let i = 0; i < numDays; i++) {
        const curDate = new Date(d);
        curDate.setDate(curDate.getDate() + i);
        const dateIso = curDate.toISOString().split("T")[0];
        forecastMap.set(dateIso, mock.getHourlyForecast(dateIso));
      }
    }

    return forecastMap;
  }
}

export async function getHourlyForecast(dateIso: string, lat?: number, lon?: number): Promise<HourlyForecast[]> {
  const service = new OpenMeteoWeatherService(lat, lon);
  const map = await service.getWeeklyForecast(dateIso, 3);
  if (map.has(dateIso) && map.get(dateIso)!.length > 0) {
    return map.get(dateIso)!;
  }
  const firstAvailableKey = Array.from(map.keys())[0];
  if (firstAvailableKey && map.get(firstAvailableKey)?.length) {
    return map.get(firstAvailableKey)!;
  }
  return new MockWeatherService("sunny").getHourlyForecast(dateIso);
}

export async function getWeeklyForecast(startDateIso: string, days = 7, lat?: number, lon?: number): Promise<Record<string, HourlyForecast[]>> {
  const service = new OpenMeteoWeatherService(lat, lon);
  const map = await service.getWeeklyForecast(startDateIso, days);
  const result: Record<string, HourlyForecast[]> = {};
  for (const [key, val] of map.entries()) {
    result[key] = val;
  }
  return result;
}
