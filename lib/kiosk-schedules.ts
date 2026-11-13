import { getAbsencePeople, type AbsenceMember, type AbsencePersonSchedule } from './absence-calendar';
import { parseLocalDateKey, shiftDateKey, toLocalDateKey } from './dashboard-schedules';
import { getScheduleCategory } from './schedule-category';
import { getDayDistance } from './schedule-proximity';

export interface KioskSchedule {
  id: number | string;
  title: string;
  date: string;
  end_date?: string | null;
  start_time?: string | null;
  end_time?: string | null;
  schedule_type?: string | null;
  absence_type?: string | null;
  is_notice?: boolean | null;
  is_urgent?: boolean | null;
  is_todo?: boolean | null;
  is_completed?: boolean | null;
  owner_name?: string | null;
  owner_member_id?: string | null;
  attendee_names?: string[] | null;
  attendee_member_ids?: string[] | null;
  location?: string | null;
  recurrence_status?: string | null;
}

export interface KioskGroups {
  today: KioskSchedule[];
  thisWeek: KioskSchedule[];
  nextWeek: KioskSchedule[];
  notices: KioskSchedule[];
  todos: KioskSchedule[];
  absencesToday: KioskSchedule[];
  absencesUpcoming: KioskSchedule[];
}

export interface KioskEventStatus {
  label: string;
  kind: 'upcoming' | 'soon' | 'ongoing' | 'ended' | 'unknown' | 'overdue';
  dimmed: boolean;
}

const endDate = (schedule: Pick<KioskSchedule, 'date' | 'end_date'>): string =>
  schedule.end_date && parseLocalDateKey(schedule.end_date) && schedule.end_date >= schedule.date ? schedule.end_date : schedule.date;

const timeParts = (value?: string | null): { hour: number; minute: number; second: number } | null => {
  const match = value?.trim().match(/^(\d{1,2}):(\d{2})(?::(\d{2})(?:\.\d{1,6})?)?$/u);
  if (!match) return null;
  const hour = Number(match[1]), minute = Number(match[2]), second = Number(match[3] ?? 0);
  return hour < 24 && minute < 60 && second < 60 ? { hour, minute, second } : null;
};

const displayTime = (value?: string | null): string => {
  const parts = timeParts(value);
  return parts ? `${String(parts.hour).padStart(2, '0')}:${String(parts.minute).padStart(2, '0')}` : '';
};

const timestamp = (date: string, time?: string | null): number | null => {
  const day = parseLocalDateKey(date), parts = timeParts(time);
  if (!day || !parts) return null;
  day.setHours(parts.hour, parts.minute, parts.second, 0);
  return day.getTime();
};

const occursOn = (schedule: KioskSchedule, date: string) => schedule.date <= date && endDate(schedule) >= date;
const overlaps = (schedule: KioskSchedule, start: string, end: string) => start <= end && schedule.date <= end && endDate(schedule) >= start;
const sortSchedules = (a: KioskSchedule, b: KioskSchedule) => a.date.localeCompare(b.date)
  || (displayTime(a.start_time) || displayTime(a.end_time) || '99:99').localeCompare(displayTime(b.start_time) || displayTime(b.end_time) || '99:99')
  || String(a.id).localeCompare(String(b.id), undefined, { numeric: true });

/** Preserve the current week boundaries and keep today's leave out of upcoming leave. */
export const getKioskGroups = (schedules: KioskSchedule[], referenceDate: string): KioskGroups => {
  const reference = parseLocalDateKey(referenceDate);
  if (!reference) return { today: [], thisWeek: [], nextWeek: [], notices: [], todos: [], absencesToday: [], absencesUpcoming: [] };
  const tomorrow = shiftDateKey(referenceDate, 1);
  const thisWeekEnd = shiftDateKey(referenceDate, (7 - reference.getDay()) % 7);
  const nextWeekStart = shiftDateKey(thisWeekEnd, 1), nextWeekEnd = shiftDateKey(thisWeekEnd, 7);
  const valid = schedules.filter((schedule) => parseLocalDateKey(schedule.date) && schedule.recurrence_status !== 'cancelled');
  const active = valid.filter((schedule) => endDate(schedule) >= referenceDate).sort(sortSchedules);
  const work = active.filter((schedule) => getScheduleCategory(schedule) !== 'leave');
  const absences = active.filter((schedule) => getScheduleCategory(schedule) === 'leave');
  return {
    today: work.filter((schedule) => occursOn(schedule, referenceDate)),
    thisWeek: work.filter((schedule) => overlaps(schedule, tomorrow, thisWeekEnd)),
    nextWeek: work.filter((schedule) => overlaps(schedule, nextWeekStart, nextWeekEnd)),
    notices: active.filter((schedule) => schedule.is_notice),
    todos: valid.filter((schedule) => schedule.is_todo && !schedule.is_completed).sort((a, b) =>
      endDate(a).localeCompare(endDate(b)) || sortSchedules(a, b)),
    absencesToday: absences.filter((schedule) => occursOn(schedule, referenceDate)),
    absencesUpcoming: absences.filter((schedule) => schedule.date > referenceDate && schedule.date <= nextWeekEnd),
  };
};

/** Unknown times never imply completion. Only an explicit valid end time can dim an event. */
export const getKioskEventStatus = (schedule: KioskSchedule, now: Date): KioskEventStatus => {
  if (!Number.isFinite(now.getTime()) || !parseLocalDateKey(schedule.date)) return { label: '날짜 미정', kind: 'unknown', dimmed: false };
  const today = toLocalDateKey(now);
  const start = timestamp(schedule.date, schedule.start_time);
  const rawEnd = timestamp(endDate(schedule), schedule.end_time);
  // An inverted same-day range is not silently reinterpreted as an overnight event.
  const end = rawEnd !== null && (start === null || rawEnd >= start) ? rawEnd : null;
  const moment = now.getTime();
  if (schedule.is_todo && schedule.is_completed) return { label: '완료', kind: 'ended', dimmed: true };
  if (schedule.is_todo && !schedule.is_completed && (endDate(schedule) < today || (end !== null && moment >= end))) {
    return { label: '기한 지남', kind: 'overdue', dimmed: false };
  }
  if (end !== null && moment >= end) return { label: '종료', kind: 'ended', dimmed: true };
  const days = getDayDistance(schedule.date, today) ?? 0;
  if (days > 0) return { label: days === 1 ? '내일' : `D-${days}`, kind: 'upcoming', dimmed: false };
  if (endDate(schedule) < today) return { label: '지난 일정', kind: 'unknown', dimmed: false };
  if (start !== null && moment < start) {
    const minutes = Math.ceil((start - moment) / 60_000);
    return minutes <= 60
      ? { label: `${minutes}분 후`, kind: 'soon', dimmed: false }
      : { label: '오늘', kind: 'upcoming', dimmed: false };
  }
  if (start !== null && end !== null && moment >= start && moment < end) return { label: '진행 중', kind: 'ongoing', dimmed: false };
  return { label: '오늘', kind: 'unknown', dimmed: false };
};

export const formatKioskTime = (schedule: Pick<KioskSchedule, 'start_time' | 'end_time'>): string => {
  const start = displayTime(schedule.start_time), end = displayTime(schedule.end_time);
  return start && end ? `${start}–${end}` : start ? `${start}부터` : end ? `${end}까지` : '시간 미정';
};

const formatDate = (value: string): string => {
  const date = parseLocalDateKey(value);
  return date ? `${date.getMonth() + 1}.${date.getDate()}(${new Intl.DateTimeFormat('ko-KR', { weekday: 'short' }).format(date)})` : '날짜 미정';
};

export const formatKioskDateRange = (schedule: Pick<KioskSchedule, 'date' | 'end_date'>): string => {
  const end = endDate(schedule);
  return end === schedule.date ? formatDate(schedule.date) : `${formatDate(schedule.date)}–${formatDate(end)}`;
};

export const cleanKioskTitle = (title: string): string => title.replace(/^(?:회의|출장|내부일정|휴가|연차|조퇴|외출)\s*[)）]\s*/u, '').trim();

export const getKioskAbsenceLabel = (schedule: Pick<KioskSchedule, 'title' | 'absence_type'>): string => {
  if (schedule.absence_type === 'early_am') return '오전 조퇴';
  if (schedule.absence_type === 'early_pm') return '오후 조퇴';
  if (schedule.absence_type === 'early' || schedule.title.includes('조퇴')) return '조퇴';
  if (schedule.absence_type === 'outing' || schedule.title.includes('외출')) return '외출';
  return '연차';
};

export const getKioskAbsencePeopleLabel = (schedule: AbsencePersonSchedule, members: readonly AbsenceMember[] = []): string => getAbsencePeople(schedule, members).join(' · ');
