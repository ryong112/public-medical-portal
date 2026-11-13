export interface DashboardSchedule {
  id: number;
  title: string;
  date: string;
  end_date?: string | null;
  start_time: string | null;
  end_time: string | null;
  is_notice?: boolean;
  is_completed?: boolean;
  is_todo?: boolean;
  is_urgent?: boolean;
  schedule_type?: 'meeting' | 'business_trip' | 'internal' | 'leave' | 'unclassified';
  absence_type?: 'annual' | 'early' | 'outing' | 'early_am' | 'early_pm';
  created_at?: string;
  owner_name?: string | null;
  owner_member_id?: string | null;
  attendee_names?: string[];
  attendee_member_ids?: string[];
  location?: string | null;
  linked_file_ids?: number[];
}

export const toLocalDateKey = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;

export const parseLocalDateKey = (key: string): Date | null => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) return null;
  const date = new Date(`${key}T12:00:00`);
  return Number.isFinite(date.getTime()) && toLocalDateKey(date) === key ? date : null;
};

export const shiftDateKey = (key: string, days: number): string => {
  const date = parseLocalDateKey(key);
  if (!date) return '';
  date.setDate(date.getDate() + days);
  return toLocalDateKey(date);
};

export const getScheduleEndDate = (schedule: Pick<DashboardSchedule, 'date' | 'end_date'>) => schedule.end_date && schedule.end_date >= schedule.date ? schedule.end_date : schedule.date;

export const scheduleOccursOn = (schedule: Pick<DashboardSchedule, 'date' | 'end_date'>, key: string) => schedule.date <= key && getScheduleEndDate(schedule) >= key;

export const scheduleOverlaps = (schedule: Pick<DashboardSchedule, 'date' | 'end_date'>, start: string, end: string) => start <= end && schedule.date <= end && getScheduleEndDate(schedule) >= start;

export const getTodoStatus = (schedule: DashboardSchedule, today: string): '기한 지남' | '오늘' | '완료' | '예정' => {
  if (schedule.is_completed) return '완료';
  if (getScheduleEndDate(schedule) < today) return '기한 지남';
  return schedule.date <= today ? '오늘' : '예정';
};

// Retain every unfinished overdue item; completed history outside today does not
// inflate the dashboard's current-work count.
export const getDashboardTodos = <T extends DashboardSchedule>(schedules: T[], today: string): T[] => schedules
  .filter((schedule) => schedule.is_todo && (scheduleOccursOn(schedule, today) || (!schedule.is_completed && getScheduleEndDate(schedule) < today)))
  .sort((a, b) => Number(Boolean(a.is_completed)) - Number(Boolean(b.is_completed)) || getScheduleEndDate(a).localeCompare(getScheduleEndDate(b)) || (a.start_time ?? a.end_time ?? '99:99').localeCompare(b.start_time ?? b.end_time ?? '99:99') || a.id - b.id);

export const getSevenDayKeys = (start: string) => parseLocalDateKey(start) ? Array.from({ length: 7 }, (_, index) => shiftDateKey(start, index)) : [];

export const formatScheduleTime = (schedule: Pick<DashboardSchedule, 'start_time' | 'end_time'>) => {
  if (schedule.start_time && schedule.end_time) return `${schedule.start_time} - ${schedule.end_time}`;
  if (schedule.start_time) return `${schedule.start_time}부터`;
  if (schedule.end_time) return `${schedule.end_time}까지`;
  return '시간 미정';
};

export const formatScheduleDateRange = (schedule: Pick<DashboardSchedule, 'date' | 'end_date'>) => getScheduleEndDate(schedule) === schedule.date ? schedule.date : `${schedule.date} ~ ${getScheduleEndDate(schedule)}`;

export const getAbsenceTypeLabel = (schedule: Pick<DashboardSchedule, 'title' | 'absence_type'>) => {
  if (schedule.absence_type === 'early_am') return '오전 조퇴';
  if (schedule.absence_type === 'early_pm') return '오후 조퇴';
  if (schedule.absence_type === 'early' || schedule.title.includes('조퇴')) return '조퇴';
  if (schedule.absence_type === 'outing' || schedule.title.includes('외출')) return '외출';
  return '연차';
};
