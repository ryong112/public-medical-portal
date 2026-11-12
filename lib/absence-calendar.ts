import { getScheduleCategory } from './schedule-category';
import { type DashboardSchedule, getScheduleEndDate, parseLocalDateKey, scheduleOccursOn, shiftDateKey, toLocalDateKey } from './dashboard-schedules';

const splitPeople = (value: string) => value.split(/[,，/·ㆍ&]+/u).map((name) => name.trim()).filter(Boolean);

/** Prefer explicit ownership; prefix parsing only supports legacy records. */
export const getAbsencePeople = (schedule: Pick<DashboardSchedule, 'title' | 'owner_name'>): string[] => {
  const explicit = schedule.owner_name?.trim();
  if (explicit) return [...new Set(splitPeople(explicit))];
  let title = schedule.title.normalize('NFKC').trim();
  for (let index = 0; index < 5; index += 1) {
    const next = title.replace(/^(?:휴가|연차|(?:오전|오후)\s*(?:조퇴|반차)|반차|조퇴|외출)\s*[)\-:：]?\s*/u, '').trim();
    if (next === title) break;
    title = next;
  }
  const people = splitPeople(title).map((name) => name.replace(/\s*\((?:휴가|연차|반차|조퇴|외출)\)\s*$/u, '').trim()).filter(Boolean);
  return [...new Set(people.length ? people : ['이름 미상'])];
};

export const formatAbsenceDayLabel = (key: string): string => {
  const date = parseLocalDateKey(key);
  if (!date) return '';
  return `${date.getMonth() + 1}.${date.getDate()}(${new Intl.DateTimeFormat('ko-KR', { weekday: 'short' }).format(date)})`;
};

export const formatAbsenceRangeLabel = (schedule: Pick<DashboardSchedule, 'date' | 'end_date'>): string => {
  const start = formatAbsenceDayLabel(schedule.date);
  const end = getScheduleEndDate(schedule);
  return end === schedule.date ? start : `${start}–${formatAbsenceDayLabel(end)}`;
};

export const shiftAbsenceMonth = (monthKey: string, offset: number): string => {
  const date = parseLocalDateKey(`${monthKey}-01`);
  if (!date || !Number.isInteger(offset)) return '';
  return toLocalDateKey(new Date(date.getFullYear(), date.getMonth() + offset, 1)).slice(0, 7);
};

export interface AbsenceCalendarDay<T extends DashboardSchedule = DashboardSchedule> {
  date: string;
  items: T[];
  people: string[];
}

export interface AbsenceCalendarMonth<T extends DashboardSchedule = DashboardSchedule> {
  monthKey: string;
  label: string;
  leadingDays: number;
  days: AbsenceCalendarDay<T>[];
}

export const buildAbsenceMonth = <T extends DashboardSchedule>(schedules: T[], monthKey: string): AbsenceCalendarMonth<T> | null => {
  const first = parseLocalDateKey(`${monthKey}-01`);
  if (!first) return null;
  const count = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate();
  const absences = schedules.filter((schedule) => getScheduleCategory(schedule) === 'leave'
    && parseLocalDateKey(schedule.date) && parseLocalDateKey(getScheduleEndDate(schedule)));
  const days = Array.from({ length: count }, (_, index) => {
    const date = shiftDateKey(`${monthKey}-01`, index);
    const items = absences.filter((schedule) => scheduleOccursOn(schedule, date)).sort((a, b) =>
      (a.start_time ?? a.end_time ?? '99:99').localeCompare(b.start_time ?? b.end_time ?? '99:99') || a.id - b.id);
    return { date, items, people: [...new Set(items.flatMap(getAbsencePeople))] };
  });
  return { monthKey, label: `${first.getFullYear()}년 ${first.getMonth() + 1}월`, leadingDays: first.getDay(), days };
};

export const getDefaultAbsenceDate = (schedules: DashboardSchedule[], monthKey: string, referenceDate: string): string => {
  const month = buildAbsenceMonth(schedules, monthKey);
  if (!month) return '';
  const current = month.days.find((day) => day.date === referenceDate);
  if (current?.items.length) return current.date;
  const upcoming = month.days.find((day) => day.date >= referenceDate && day.items.length);
  if (upcoming) return upcoming.date;
  if (!monthKey.startsWith(referenceDate.slice(0, 7))) return month.days.find((day) => day.items.length)?.date ?? `${monthKey}-01`;
  return current?.date ?? `${monthKey}-01`;
};
