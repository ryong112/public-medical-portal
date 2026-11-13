export interface ChatMentionMember {
  id: string;
  display_name: string;
  handle: string;
}

export interface ChatMentionQuery {
  start: number;
  end: number;
  query: string;
}

export interface ChatTextSegment {
  text: string;
  memberId?: string;
}

const handleCharacter = /[\p{L}\p{N}_.-]/u;
const tokenPrefixCharacter = /[\p{L}\p{N}_@.-]/u;
const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Only a complete handle token counts; email addresses and longer handles do not. */
export const getChatMentionRanges = (content: string, handle: string) => {
  if (!handle) return [];
  const expression = new RegExp(`@${escapeRegExp(handle)}(?![\\p{L}\\p{N}_.-])`, 'gu');
  const ranges: { start: number; end: number }[] = [];
  for (const match of content.matchAll(expression)) {
    const start = match.index;
    if (start > 0 && tokenPrefixCharacter.test(content[start - 1])) continue;
    ranges.push({ start, end: start + match[0].length });
  }
  return ranges;
};

/** Inspect only the token at the caret, without treating arbitrary typed @text as a recipient. */
export const getChatMentionQuery = (content: string, caret: number): ChatMentionQuery | null => {
  if (caret <= 0) return null;
  const cursor = Math.max(0, Math.min(caret, content.length));
  const start = content.lastIndexOf('@', cursor - 1);
  if (start < 0 || (start > 0 && !/[\s([{]/u.test(content[start - 1]))) return null;
  const query = content.slice(start + 1, cursor);
  if (query.length > 64 || !/^[\p{L}\p{N}_.-]*$/u.test(query)) return null;
  let end = cursor;
  while (end < content.length && handleCharacter.test(content[end])) end += 1;
  return { start, end, query };
};

export const getSelectedChatMentionIds = (content: string, selectedMembers: ChatMentionMember[]) => (
  [...new Set(selectedMembers
    .filter((member) => getChatMentionRanges(content, member.handle).length > 0)
    .map((member) => member.id))]
);

/** Saved metadata is authoritative: old/plain messages are never silently upgraded to mentions. */
export const getChatTextSegments = (
  content: string,
  members: ChatMentionMember[],
  mentionedMemberIds: string[] = [],
): ChatTextSegment[] => {
  const ids = new Set(mentionedMemberIds);
  const ranges = members
    .filter((member) => ids.has(member.id))
    .flatMap((member) => getChatMentionRanges(content, member.handle).map((range) => ({ ...range, memberId: member.id })))
    .sort((left, right) => left.start - right.start || right.end - left.end);
  const segments: ChatTextSegment[] = [];
  let offset = 0;
  for (const range of ranges) {
    if (range.start < offset) continue;
    if (range.start > offset) segments.push({ text: content.slice(offset, range.start) });
    segments.push({ text: content.slice(range.start, range.end), memberId: range.memberId });
    offset = range.end;
  }
  if (offset < content.length) segments.push({ text: content.slice(offset) });
  return segments.length ? segments : [{ text: content }];
};
