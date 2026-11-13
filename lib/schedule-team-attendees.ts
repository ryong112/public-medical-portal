interface NamedMember {
  id: string;
  display_name: string;
}

export const normalizeAttendeeMemberIds = (value?: string[]) => [...new Set(
  (Array.isArray(value) ? value : []).filter((id): id is string => typeof id === 'string' && Boolean(id.trim())),
)];

const normalizeName = (value: string) => value.trim().replace(/\s+/gu, ' ');

/** Only authoritative, previously selected IDs may identify a stored name snapshot. */
export const getLegacyAttendeeText = (text: string, baselineIds: string[], members: NamedMember[]) => {
  const baseline = new Set(baselineIds);
  const snapshotNames = new Set(members.filter((member) => baseline.has(member.id)).map((member) => normalizeName(member.display_name)));
  return text.split(/[,，;\n]/u).filter((name) => !snapshotNames.has(normalizeName(name))).join(',');
};

/** Names remain presentation-only compatibility metadata, not recipient identities. */
export const getScheduleAttendeeNames = (legacyText: string, selectedIds: string[], members: NamedMember[]) => {
  const selected = new Set(selectedIds);
  return [...new Set([
    ...legacyText.split(/[,，;\n]/u).map(normalizeName),
    ...members.filter((member) => selected.has(member.id)).map((member) => normalizeName(member.display_name)),
  ].filter(Boolean))];
};
