import { type DashboardSchedule, getScheduleEndDate, parseLocalDateKey, scheduleOccursOn } from './dashboard-schedules';

/** Calendar-day distance, independent of local daylight-saving transitions. */
export const getDayDistance = (date: string, referenceDate: string): number | null => {
  if (!parseLocalDateKey(date) || !parseLocalDateKey(referenceDate)) return null;
  return Math.round((Date.parse(`${date}T00:00:00Z`) - Date.parse(`${referenceDate}T00:00:00Z`)) / 86_400_000);
};

export const getDayProximityLabel = (date: string, referenceDate: string): string => {
  const days = getDayDistance(date, referenceDate);
  if (days === null) return '날짜 미정';
  if (days < 0) return '지난 일정';
  if (days === 0) return '오늘';
  if (days === 1) return '내일';
  return `D-${days}`;
};

export const getScheduleProximityLabel = (schedule: Pick<DashboardSchedule, 'date' | 'end_date'>, referenceDate: string): string => {
  if (getDayDistance(schedule.date, referenceDate) === null) return '날짜 미정';
  if (parseLocalDateKey(getScheduleEndDate(schedule)) && scheduleOccursOn(schedule, referenceDate)) return '오늘';
  return getDayProximityLabel(schedule.date, referenceDate);
};
