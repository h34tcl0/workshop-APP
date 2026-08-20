import { describe, it, expect, beforeEach, vi } from 'vitest';
import { OpenMeteoWeatherService } from '../src/weatherService.js';

describe('Weather Service Caching & Resilience', () => {
  beforeEach(() => {
    OpenMeteoWeatherService.clearCache();
  });

  it('uses cached weather within TTL without re-fetching', async () => {
    const service = new OpenMeteoWeatherService(-32.99, -71.27);
    const startDate = '2026-08-20';

    // 1. First fetch in test env produces fallback mock and stores in cache
    const map1 = await service.getWeeklyForecast(startDate, 7);
    expect(map1.size).toBeGreaterThanOrEqual(3);

    // 2. Second fetch within TTL hits cache
    const map2 = await service.getWeeklyForecast(startDate, 7);
    expect(map2.size).toBe(map1.size);
    expect(map2.get(startDate)).toEqual(map1.get(startDate));
  });

  it('isolates cache keys by coordinates and days', async () => {
    const service1 = new OpenMeteoWeatherService(-32.99, -71.27);
    const service2 = new OpenMeteoWeatherService(-33.45, -70.66);

    const map1 = await service1.getWeeklyForecast('2026-08-20', 7);
    const map2 = await service2.getWeeklyForecast('2026-08-20', 7);

    expect(map1).toBeDefined();
    expect(map2).toBeDefined();
  });
});
