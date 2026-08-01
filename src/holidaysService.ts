const holidayCache: Record<string, Set<string>> = {};

export async function getHolidayDates(year: number, countryCode: string = 'CL'): Promise<Set<string>> {
  const cacheKey = `${year}_${countryCode}`;
  if (holidayCache[cacheKey]) {
    return holidayCache[cacheKey];
  }

  const dates = new Set<string>();
  try {
    const url = `https://date.nager.at/api/v3/PublicHolidays/${year}/${countryCode}`;
    const response = await fetch(url, { headers: { 'User-Agent': 'WorkshopOS/1.0' } });
    if (response.ok) {
      const data = await response.json();
      if (Array.isArray(data)) {
        for (const item of data) {
          if (item.date) {
            dates.add(item.date);
          }
        }
      }
    }
  } catch (err) {
    console.warn(`[HolidaysService] No se pudieron obtener feriados ${year}/${countryCode}:`, err);
  }

  holidayCache[cacheKey] = dates;
  return dates;
}

export function getHolidayDatesForRange(startIso: string, endIso: string, countryCode: string = 'CL'): Set<string> {
  const startYear = parseInt(startIso.split('-')[0], 10);
  const endYear = parseInt(endIso.split('-')[0], 10);
  const result = new Set<string>();

  for (let y = startYear; y <= endYear; y++) {
    const cacheKey = `${y}_${countryCode}`;
    if (holidayCache[cacheKey]) {
      for (const d of holidayCache[cacheKey]) {
        result.add(d);
      }
    } else {
      // Trigger async fetch for cache in background
      getHolidayDates(y, countryCode);
    }
  }

  return result;
}
