type Attendee = { id: string; display_name: string; active?: boolean };

type ScheduleNotificationFields = {
  title: string;
  date: string;
  end_date: string | null;
  start_time: string | null;
  end_time: string | null;
  location?: string | null;
  attendee_member_ids?: string[];
};

const normalizeTime = (time: string | null) => time?.replace(/^(\d{2}:\d{2}):00(?:\.0+)?$/u, '$1') ?? null;

/** Mirrors the schedule-attendee trigger for a single occurrence. Names never determine recipients. */
export function previewScheduleAttendeeNotifications<T extends Attendee>({ current, original, members, actorMemberId, supportsNotifications, published = false }: {
  current: ScheduleNotificationFields;
  original?: ScheduleNotificationFields;
  members: T[];
  actorMemberId: string | null | undefined;
  supportsNotifications: boolean;
  published?: boolean;
}): T[] | null {
  if (!supportsNotifications || actorMemberId === undefined) return null;
  const timingChanged = Boolean(original && (
    current.date !== original.date
    || current.end_date !== original.end_date
    || normalizeTime(current.start_time) !== normalizeTime(original.start_time)
    || normalizeTime(current.end_time) !== normalizeTime(original.end_time)
    || (current.location?.trim() || null) !== (original.location?.trim() || null)
  ));
  const changed = timingChanged || Boolean(original && current.title.trim() !== original.title);
  const selected = new Set(current.attendee_member_ids ?? []);
  const previouslySelected = new Set(original?.attendee_member_ids ?? []);
  return members.filter((member) => {
    if (member.id === actorMemberId || member.active === false) return false;
    const isSelected = selected.has(member.id);
    const wasSelected = previouslySelected.has(member.id);
    return published && original ? (timingChanged && isSelected) || isSelected !== wasSelected
      : isSelected && (changed || !wasSelected);
  });
}
