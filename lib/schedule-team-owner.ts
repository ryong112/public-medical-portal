interface NamedOwnerMember {
  id: string;
  display_name: string;
}

/** A name is a compatibility label only; it never identifies a team member. */
export const normalizeOwnerMemberId = (value: unknown): string | null => typeof value === 'string' && value.trim() ? value.trim() : null;

/** Preserve a stored snapshot when its selected ID is no longer in the active roster. */
export const getScheduleOwnerName = (storedName: string, ownerMemberId: string | null, members: NamedOwnerMember[]): string | null => {
  const selected = ownerMemberId ? members.find((member) => member.id === ownerMemberId) : null;
  return (selected?.display_name ?? storedName).trim() || null;
};

/** Only an explicit picker action can change an owner's stable identity. */
export const changeScheduleOwner = (previousId: string | null, nextIds: string[], storedName: string, members: NamedOwnerMember[]) => {
  const nextId = normalizeOwnerMemberId(nextIds[0]);
  return {
    ownerMemberId: nextId,
    ownerName: nextId
      ? getScheduleOwnerName(storedName, nextId, members) ?? ''
      : previousId ? '' : storedName,
  };
};
