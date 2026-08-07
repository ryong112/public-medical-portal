export type RecurrenceType = 'weekly' | 'biweekly' | 'monthly';
export type MonthlyWeek = 'first' | 'second' | 'third' | 'fourth' | 'last';
export type RecurrenceScope = 'this' | 'future' | 'all';
export type RecurrenceStatus = 'active' | 'cancelled';

export interface RecurrenceRuleInput {
  recurrence_type: RecurrenceType;
  weekday: number;
  monthly_week: MonthlyWeek | null;
  starts_on: string;
  ends_on: string;
}

export interface RecurrenceOccurrenceFields {
  recurrence_group_id: string | null;
  recurrence_original_date: string | null;
  recurrence_index: number | null;
  recurrence_status: RecurrenceStatus;
  recurrence_is_exception: boolean;
  recurrence_cancelled_at: string | null;
}

export interface RecurrenceTarget extends RecurrenceOccurrenceFields {
  id: number;
}

export const isRecurringSchedule = (
  schedule: Partial<RecurrenceOccurrenceFields>,
): schedule is Partial<RecurrenceOccurrenceFields> & {
  recurrence_group_id: string;
  recurrence_original_date: string;
  recurrence_index: number;
} => (
  typeof schedule.recurrence_group_id === 'string'
  && typeof schedule.recurrence_original_date === 'string'
  && typeof schedule.recurrence_index === 'number'
);

export const createRecurrenceGroupId = () => crypto.randomUUID();

export const attachRecurrenceMetadata = <T extends { date: string }>(
  schedules: T[],
  recurrenceGroupId = createRecurrenceGroupId(),
) => ({
  recurrenceGroupId,
  schedules: schedules.map((schedule, recurrenceIndex) => ({
    ...schedule,
    recurrence_group_id: recurrenceGroupId,
    recurrence_original_date: schedule.date,
    recurrence_index: recurrenceIndex,
    recurrence_status: 'active' as const,
    recurrence_is_exception: false,
    recurrence_cancelled_at: null,
  })),
});

/**
 * Determines whether a candidate occurrence belongs to an edit/delete scope.
 * `recurrence_index` is used instead of the visible date so that a moved
 * exception remains in its original place in the series.
 */
export const isInRecurrenceScope = (
  candidate: RecurrenceTarget,
  target: RecurrenceTarget,
  scope: RecurrenceScope,
) => {
  if (scope === 'this' || !isRecurringSchedule(target)) return candidate.id === target.id;
  if (!isRecurringSchedule(candidate) || candidate.recurrence_group_id !== target.recurrence_group_id) return false;
  if (scope === 'all') return true;
  return candidate.recurrence_index >= target.recurrence_index;
};

export const getRecurrenceScopeLabel = (scope: RecurrenceScope) => ({
  this: '이번 일정만',
  future: '이번 일정부터 이후 일정',
  all: '전체 반복 일정',
}[scope]);
