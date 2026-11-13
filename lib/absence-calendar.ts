import { getScheduleCategory } from './schedule-category';
import { type DashboardSchedule, getScheduleEndDate, parseLocalDateKey, scheduleOccursOn, shiftDateKey, toLocalDateKey } from './dashboard-schedules';

const splitPeople = (value: string) => value.split(/[,，/·ㆍ&]+/u).map((name) => name.trim()).filter(Boolean);

export interface AbsenceMember {
  id: string;
  display_name: string;
  handle?: string;
}

export interface AbsencePersonSchedule {
  title: string;
  owner_name?: string | null;
  owner_member_id?: string | null;
  attendee_names?: readonly string[] | null;
  attendee_member_ids?: readonly string[] | null;
}

export interface AbsencePersonEntry {
  key: string;
  label: string;
}

const legacyAbsencePeople = (schedule: Pick<AbsencePersonSchedule, 'title' | 'owner_name'>): string[] => {
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

/** Explicit participant IDs are authoritative; compatibility names never create IDs. */
export const getAbsencePersonEntries = (schedule: AbsencePersonSchedule, members: readonly AbsenceMember[] = []): AbsencePersonEntry[] => {
  const ids = [...new Set((schedule.attendee_member_ids ?? []).filter((id) => typeof id === 'string' && id.trim()).map((id) => id.trim()))];
  const snapshots = [...new Set((schedule.attendee_names ?? []).flatMap((name) => typeof name === 'string' ? splitPeople(name) : []))];
  const byId = new Map(members.map((member) => [member.id, member]));
  const memberLabel = (id: string, fallback: string) => {
    const member = byId.get(id);
    if (!member) return fallback;
    const sameName = members.filter((candidate) => candidate.display_name.trim() === member.display_name.trim()).length > 1;
    return sameName && member.handle ? `${member.display_name} (@${member.handle})` : member.display_name;
  };
  if (ids.length) {
    // A single stored label can still name an inactive selected member. Do not
    // pair several sorted IDs with name snapshots whose ordering is unrelated.
    const fallback = snapshots.length === 1 ? snapshots[0] : '기존 참석자';
    return ids.map((id) => ({ key: `member:${id}`, label: memberLabel(id, fallback) }));
  }
  if (snapshots.length) return snapshots.map((name) => ({ key: `name:${name.normalize('NFKC')}`, label: name }));
  if (schedule.owner_member_id) return [{ key: `member:${schedule.owner_member_id}`, label: memberLabel(schedule.owner_member_id, schedule.owner_name?.trim() || '기존 담당자') }];
  return legacyAbsencePeople(schedule).map((name) => ({ key: `name:${name.normalize('NFKC')}`, label: name }));
};

export const collectAbsencePersonEntries = (schedules: readonly AbsencePersonSchedule[], members: readonly AbsenceMember[] = []): AbsencePersonEntry[] => {
  const people = new Map<string, AbsencePersonEntry>();
  for (const schedule of schedules) for (const person of getAbsencePersonEntries(schedule, members)) people.set(person.key, person);
  return [...people.values()];
};

/** Preserve legacy call sites while supporting photographed titles without names. */
export const getAbsencePeople = (schedule: AbsencePersonSchedule, members: readonly AbsenceMember[] = []): string[] => getAbsencePersonEntries(schedule, members).map((person) => person.label);

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

export const buildAbsenceMonth = <T extends DashboardSchedule>(schedules: T[], monthKey: string, members: readonly AbsenceMember[] = []): AbsenceCalendarMonth<T> | null => {
  const first = parseLocalDateKey(`${monthKey}-01`);
  if (!first) return null;
  const count = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate();
  const absences = schedules.filter((schedule) => getScheduleCategory(schedule) === 'leave'
    && parseLocalDateKey(schedule.date) && parseLocalDateKey(getScheduleEndDate(schedule)));
  const days = Array.from({ length: count }, (_, index) => {
    const date = shiftDateKey(`${monthKey}-01`, index);
    const items = absences.filter((schedule) => scheduleOccursOn(schedule, date)).sort((a, b) =>
      (a.start_time ?? a.end_time ?? '99:99').localeCompare(b.start_time ?? b.end_time ?? '99:99') || a.id - b.id);
    return { date, items, people: collectAbsencePersonEntries(items, members).map((person) => person.label) };
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
