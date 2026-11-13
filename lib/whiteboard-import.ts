export interface WhiteboardComparableSchedule {
  title: string;
  date: string;
  end_date?: string | null;
  start_time: string | null;
  end_time: string | null;
  schedule_type: string;
  absence_type?: string;
  is_urgent?: boolean;
  attendee_member_ids?: string[];
}

const normalizeTitle = (title: string) => title
  .normalize('NFKC')
  .replace(/^(?:회의|출장|내부일정|휴가|연차|조퇴|외출)\s*\)\s*/u, '')
  .replace(/\s+/gu, ' ')
  .trim()
  .toLocaleLowerCase('ko-KR');

const normalizeTime = (time: string | null) => (time ?? '').slice(0, 5);
const attendeeKey = (ids?: string[]) => JSON.stringify([...new Set(Array.isArray(ids) ? ids : [])].sort());

export const isWhiteboardDate = (value: string): boolean => {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(value) || value.startsWith('0000-')) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
};

export const isWhiteboardTime = (value: string): boolean => value === '' || /^(?:[01]\d|2[0-3]):[0-5]\d$/u.test(value);

export const getPhotoExistingSchedules = <T extends { date: string; end_date?: string | null }>(
  existing: T[],
  photoDates: string[],
): T[] => {
  const dates = new Set(photoDates.filter(isWhiteboardDate));
  return existing.filter((schedule) => dates.has(schedule.date));
};

export const compareWhiteboardSchedule = <T extends WhiteboardComparableSchedule & { id: number }>(
  draft: WhiteboardComparableSchedule,
  existing: T[],
): { status: 'new' | 'duplicate' | 'changed'; matched: T | null; changedFields: string[] } => {
  const sameTitleAndDate = existing.filter((schedule) => schedule.date === draft.date
    && normalizeTitle(schedule.title) === normalizeTitle(draft.title));
  const differences = (schedule: T) => [
    normalizeTime(schedule.start_time) !== normalizeTime(draft.start_time) ? '시작 시간' : '',
    normalizeTime(schedule.end_time) !== normalizeTime(draft.end_time) ? '종료 시간' : '',
    // A photo without a visible end date must not shorten an existing range.
    draft.end_date && draft.end_date !== (schedule.end_date || schedule.date) ? '종료 날짜' : '',
    schedule.schedule_type !== draft.schedule_type ? '일정 유형' : '',
    draft.schedule_type === 'leave' && schedule.absence_type !== draft.absence_type ? '휴가 구분' : '',
    Boolean(schedule.is_urgent) !== Boolean(draft.is_urgent) ? '긴급 표시' : '',
    draft.attendee_member_ids !== undefined && attendeeKey(schedule.attendee_member_ids) !== attendeeKey(draft.attendee_member_ids) ? '참석 팀원' : '',
  ].filter((field): field is string => Boolean(field));
  const exactMatch = sameTitleAndDate.find((schedule) => differences(schedule).length === 0);
  if (exactMatch) return { status: 'duplicate', matched: exactMatch, changedFields: [] };
  if (sameTitleAndDate.length !== 1) return { status: 'new', matched: null, changedFields: [] };
  const matched = sameTitleAndDate[0];
  return { status: 'changed', matched, changedFields: differences(matched) };
};

export const getWhiteboardImportError = (drafts: WhiteboardComparableSchedule[]): string | null => {
  if (drafts.length === 0) return '등록할 일정을 선택해 주십시오.';
  const seen = new Set<string>();
  for (const [index, draft] of drafts.entries()) {
    const label = `${index + 1}번째 일정`;
    if (!draft.title.trim()) return `${label}의 제목을 입력해 주십시오.`;
    if (!isWhiteboardDate(draft.date)) return `${label}의 날짜를 확인해 주십시오.`;
    if (draft.end_date && !isWhiteboardDate(draft.end_date)) return `${label}의 종료 날짜를 확인해 주십시오.`;
    if (draft.end_date && draft.end_date < draft.date) return `${label}의 종료 날짜는 시작 날짜보다 빠를 수 없습니다.`;
    if (!isWhiteboardTime(draft.start_time ?? '') || !isWhiteboardTime(draft.end_time ?? '')) {
      return `${label}의 시간을 확인해 주십시오.`;
    }
    if ((!draft.end_date || draft.end_date === draft.date) && draft.start_time && draft.end_time && draft.end_time < draft.start_time) {
      return `${label}의 종료 시간은 시작 시간보다 빠를 수 없습니다.`;
    }
    const key = JSON.stringify([
      normalizeTitle(draft.title), draft.date, draft.end_date || draft.date,
      normalizeTime(draft.start_time), normalizeTime(draft.end_time), draft.schedule_type,
      draft.schedule_type === 'leave' ? draft.absence_type : '', Boolean(draft.is_urgent),
      attendeeKey(draft.attendee_member_ids),
    ]);
    if (seen.has(key)) return `${label}이 선택한 다른 일정과 중복됩니다. 한 건만 선택해 주십시오.`;
    seen.add(key);
  }
  return null;
};
