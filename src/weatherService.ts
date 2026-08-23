import { HourlyForecast } from "./types.js";
import { LocalDate } from "./LocalDate.js";

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

  // In-memory cache shared across instances: key -> { timestamp: number, data: Map<string, HourlyForecast[]> }
  private static cache = new Map<string, { timestamp: number; data: Map<string, HourlyForecast[]> }>();
  private static readonly TTL_MS = 15 * 60 * 1000; // 15 minutos de caché activo
  private static readonly STALE_MAX_MS = 6 * 60 * 60 * 1000; // Hasta 6 horas de datos previos en caso de falla de red

  constructor(lat = -32.99, lon = -71.27) {
    this.lat = typeof lat === "number" && !isNaN(lat) ? lat : -32.99;
    this.lon = typeof lon === "number" && !isNaN(lon) ? lon : -71.27;
  }

  public static clearCache(): void {
    OpenMeteoWeatherService.cache.clear();
  }

  private getCacheKey(days: number): string {
    return `${this.lat.toFixed(4)}_${this.lon.toFixed(4)}_${days}`;
  }

  async getWeeklyForecast(startDate: string, days = 7): Promise<Map<string, HourlyForecast[]>> {
    const numDays = Math.max(days, 3);
    const cacheKey = this.getCacheKey(numDays);
    const now = Date.now();

    // 1. En ambiente de pruebas (test/vitest), usar mock determinista "sunny" directamente
    if ((process.env.NODE_ENV === "test" || process.env.VITEST) && !process.env.ALLOW_REAL_WEATHER_IN_TESTS) {
      const mock = new MockWeatherService("sunny");
      const fallbackMap = new Map<string, HourlyForecast[]>();
      const startLocal = LocalDate.fromIso(startDate);
      for (let i = 0; i < numDays; i++) {
        const dateIso = startLocal.addDays(i).toIso();
        fallbackMap.set(dateIso, mock.getHourlyForecast(dateIso));
      }
      return fallbackMap;
    }

    // 2. Verificar si tenemos datos en caché vigentes (< 15 min)
    const cached = OpenMeteoWeatherService.cache.get(cacheKey);
    if (cached && (now - cached.timestamp) < OpenMeteoWeatherService.TTL_MS) {
      console.log(`[OpenMeteoWeatherService] Using active cached forecast for lat:${this.lat}, lon:${this.lon} (age: ${Math.round((now - cached.timestamp) / 1000)}s)`);
      return new Map(cached.data);
    }

    const url = `https://api.open-meteo.com/v1/forecast?latitude=${this.lat}&longitude=${this.lon}&hourly=temperature_2m,relative_humidity_2m,precipitation_probability,precipitation,cloud_cover&timezone=auto&forecast_days=${numDays}`;

    try {
      console.log(`[OpenMeteoWeatherService] Fetching real weather forecast from Open-Meteo API (lat:${this.lat}, lon:${this.lon}, days:${numDays})...`);
      const response = await fetch(url, { signal: AbortSignal.timeout(6000) });
      if (!response.ok) {
        throw new Error(`OpenMeteo returned HTTP ${response.status} (${response.statusText})`);
      }
      const data = await response.json();
      const times: string[] = data.hourly?.time || [];
      const temps: number[] = data.hourly?.temperature_2m || [];
      const humidities: number[] = data.hourly?.relative_humidity_2m || [];
      const precipPops: number[] = data.hourly?.precipitation_probability || [];
      const precipMms: number[] = data.hourly?.precipitation || [];
      const clouds: number[] = data.hourly?.cloud_cover || [];

      const forecastMap = new Map<string, HourlyForecast[]>();

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

      // Guardar en caché activo
      OpenMeteoWeatherService.cache.set(cacheKey, {
        timestamp: now,
        data: forecastMap
      });

      console.log(`[OpenMeteoWeatherService] Successfully fetched and cached real forecast for ${forecastMap.size} days.`);
      return forecastMap;
    } catch (err: any) {
      // 2. Si falló la llamada a la API pero tenemos caché previo (hasta 6h), usar el caché previo real
      if (cached && (now - cached.timestamp) < OpenMeteoWeatherService.STALE_MAX_MS) {
        console.warn(`[OpenMeteoWeatherService] Warning: API request failed (${err.message}). Using previous real cached weather from ${new Date(cached.timestamp).toISOString()} to avoid simulation corruption.`);
        return new Map(cached.data);
      }

      // 3. Si estamos en ambiente de tests, proveer mock determinista
      if (process.env.NODE_ENV === "test") {
        console.warn(`[OpenMeteoWeatherService] Test environment fallback for lat:${this.lat}, lon:${this.lon}`);
        const mock = new MockWeatherService("sunny");
        const fallbackMap = new Map<string, HourlyForecast[]>();
        const startLocal = LocalDate.fromIso(startDate);
        for (let i = 0; i < numDays; i++) {
          const dateIso = startLocal.addDays(i).toIso();
          fallbackMap.set(dateIso, mock.getHourlyForecast(dateIso));
        }
        return fallbackMap;
      }

      // 4. En producción sin caché disponible: NO generar silenciosamente "sunny". Registrar error crítico y arrojarlo.
      console.error(`[OpenMeteoWeatherService] CRITICAL: Failed to fetch weather from Open-Meteo (${err.message}) and no cached data is available.`);
      throw new Error(`WEATHER_SERVICE_UNAVAILABLE: ${err.message}`);
    }
  }
}

export async function getHourlyForecast(dateIso: string, lat?: number, lon?: number): Promise<HourlyForecast[]> {
  const service = new OpenMeteoWeatherService(lat, lon);
  const map = await service.getWeeklyForecast(dateIso, 7);
  if (map.has(dateIso) && map.get(dateIso)!.length > 0) {
    return map.get(dateIso)!;
  }
  const firstAvailableKey = Array.from(map.keys())[0];
  if (firstAvailableKey && map.get(firstAvailableKey)?.length) {
    return map.get(firstAvailableKey)!;
  }
  return [];
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
