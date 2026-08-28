import { HourlyForecast } from "../types.js";
import { LocalDate } from "../dateUtils.js";
import { OpenMeteoWeatherService, MockWeatherService } from "../weatherService.js";

export async function loadHorizonWeeklyForecast(
  userId: number,
  todayIso: string,
  forecastDaysCount: number,
  latitude: number,
  longitude: number,
  mockScenario?: string
): Promise<Map<string, HourlyForecast[]>> {
  const startLocalDate = LocalDate.fromIso(todayIso);
  let weeklyForecastMap = new Map<string, HourlyForecast[]>();

  if (mockScenario) {
    console.log(`[Scheduler] Using Mock Weather Scenario '${mockScenario}' for User #${userId}`);
    const mockSvc = new MockWeatherService(mockScenario);
    for (let i = 0; i < forecastDaysCount; i++) {
      const dateIso = startLocalDate.addDays(i).toIso();
      weeklyForecastMap.set(dateIso, mockSvc.getHourlyForecast(dateIso));
    }
  } else {
    const weatherSvc = new OpenMeteoWeatherService(latitude, longitude);
    weeklyForecastMap = await weatherSvc.getWeeklyForecast(todayIso, forecastDaysCount);
    console.log(`[Scheduler] Weather loaded for User #${userId}: ${weeklyForecastMap.size} days via OpenMeteo/Cache (${latitude}, ${longitude})`);
  }

  return weeklyForecastMap;
}
