/** Advisory matching only. Never deletes, merges or blocks a confirmed schedule. */
export interface WorkflowSchedule {
  id?: number | string;
  title: string;
  date: string;
  end_date?: string | null;
  recurrence_status?: string | null;
  owner_name?: string | null;
  attendee_names?: string[] | null;
  location?: string | null;
  linked_file_ids?: number[] | null;
}

export const normalizePersonName = (name: string) => name.normalize('NFKC').trim().replace(/\s+/gu, ' ').toLocaleLowerCase('ko-KR');

export const scheduleMatchesPerson = (schedule: WorkflowSchedule, person: string) => {
  const normalized = normalizePersonName(person);
  return normalized.length > 0 && [schedule.owner_name ?? '', ...(schedule.attendee_names ?? [])]
    .some((name) => normalizePersonName(name) === normalized);
};

export const getSchedulePeople = (schedules: WorkflowSchedule[]) => {
  const names = new Map<string, string>();
  for (const schedule of schedules) {
    for (const value of [schedule.owner_name ?? '', ...(schedule.attendee_names ?? [])]) {
      const name = value.trim();
      if (name) names.set(normalizePersonName(name), name);
    }
  }
  return [...names.values()].sort((a, b) => a.localeCompare(b, 'ko'));
};

export const normalizeScheduleTitle = (title: string) => title.normalize('NFKC').trim().toLocaleLowerCase('ko-KR')
  .replace(/^(?:회의|출장|내부\s*일정|휴가|연차|조퇴|외출|일반)\s*[):\-]\s*/u, '')
  .replace(/[\p{P}\p{S}\s]/gu, '');

const editDistance = (left: string, right: string) => {
  let previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let i = 1; i <= left.length; i += 1) {
    const current = [i];
    for (let j = 1; j <= right.length; j += 1) {
      current[j] = Math.min(current[j - 1] + 1, previous[j] + 1, previous[j - 1] + Number(left[i - 1] !== right[j - 1]));
    }
    previous = current;
  }
  return previous[right.length];
};

export const compareScheduleTitles = (first: string, second: string): 'same' | 'similar' | null => {
  const left = normalizeScheduleTitle(first);
  const right = normalizeScheduleTitle(second);
  if (!left || !right) return null;
  if (left === right) return 'same';
  // Short titles and different numbered sessions are not safely fuzzy-matched.
  if (Math.min(left.length, right.length) < 5 || Math.max(left.length, right.length) > 300) return null;
  if (left.match(/\d+/gu)?.join(',') !== right.match(/\d+/gu)?.join(',')) return null;
  if (Math.abs(left.length - right.length) / Math.max(left.length, right.length) > 0.18) return null;
  return 1 - editDistance(left, right) / Math.max(left.length, right.length) >= 0.82 ? 'similar' : null;
};

export interface DuplicateScheduleMatch {
  incoming: WorkflowSchedule;
  existing: WorkflowSchedule;
  kind: 'same' | 'similar';
  inBatch: boolean;
}

export const findDuplicateSchedules = (
  entries: WorkflowSchedule[],
  saved: WorkflowSchedule[],
  excludedIds: Array<number | string> = [],
): DuplicateScheduleMatch[] => {
  const excluded = new Set(excludedIds.map(String));
  const active = saved.filter((schedule) => schedule.recurrence_status !== 'cancelled'
    && (schedule.id === undefined || !excluded.has(String(schedule.id))));
  const result: DuplicateScheduleMatch[] = [];
  for (const [index, incoming] of entries.entries()) {
    const incomingEnd = incoming.end_date && incoming.end_date >= incoming.date ? incoming.end_date : incoming.date;
    for (const [candidateIndex, existing] of [...active, ...entries.slice(0, index)].entries()) {
      const existingEnd = existing.end_date && existing.end_date >= existing.date ? existing.end_date : existing.date;
      if (incoming.date > existingEnd || existing.date > incomingEnd) continue;
      const kind = compareScheduleTitles(incoming.title, existing.title);
      if (kind) result.push({ incoming, existing, kind, inBatch: candidateIndex >= active.length });
    }
  }
  return result;
};
