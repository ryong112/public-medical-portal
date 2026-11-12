import { getSevenDayKeys, parseLocalDateKey } from './dashboard-schedules';

export interface KoreanHoliday {
  date: string;
  name: string;
}

const isSupportedYear = (year: number) => Number.isInteger(year) && year >= 2000 && year <= 2100;

/** The selected calendar year must not replace the dashboard's actual week. */
export const getRequiredHolidayYears = (calendarYear: number, referenceDate: string): number[] => {
  const years = new Set<number>();
  if (isSupportedYear(calendarYear)) years.add(calendarYear);
  for (const date of getSevenDayKeys(referenceDate)) {
    const year = Number(date.slice(0, 4));
    if (isSupportedYear(year)) years.add(year);
  }
  return [...years].sort((first, second) => first - second);
};

/** Replace a successful year's snapshot, retaining all other loaded years. */
export const mergeHolidayYear = (
  previous: Record<string, string[]>,
  year: number,
  holidays: readonly KoreanHoliday[],
): Record<string, string[]> => {
  if (!isSupportedYear(year)) return previous;
  const prefix = `${year}-`;
  const merged = Object.fromEntries(Object.entries(previous).filter(([date]) => !date.startsWith(prefix)));
  for (const holiday of holidays) {
    if (!holiday || typeof holiday.date !== 'string' || !holiday.date.startsWith(prefix) || !parseLocalDateKey(holiday.date) || typeof holiday.name !== 'string') continue;
    const name = holiday.name.trim();
    if (!name) continue;
    const names = merged[holiday.date] ?? [];
    if (!names.includes(name)) merged[holiday.date] = [...names, name];
  }
  return merged;
};
