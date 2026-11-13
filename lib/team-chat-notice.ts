export interface TeamChatNotice {
  id: string;
  message_id: number;
  content: string;
  author_name: string;
  created_at: string;
  can_remove: boolean;
}

export interface TeamChatNoticeState {
  notice: TeamChatNotice | null;
  collapsed: boolean;
  hidden: boolean;
}

/** Unknown/older RPC responses must never turn arbitrary data into a notice. */
export function parseTeamChatNoticeState(value: unknown): TeamChatNoticeState | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const state = value as Record<string, unknown>;
  if (typeof state.collapsed !== 'boolean' || typeof state.hidden !== 'boolean') return null;
  if (state.notice === null) return { notice: null, collapsed: false, hidden: false };
  if (!state.notice || typeof state.notice !== 'object' || Array.isArray(state.notice)) return null;
  const row = state.notice as Record<string, unknown>;
  if (typeof row.id !== 'string' || !row.id.trim()
    || typeof row.message_id !== 'number' || !Number.isSafeInteger(row.message_id) || row.message_id <= 0
    || typeof row.content !== 'string' || typeof row.author_name !== 'string'
    || typeof row.created_at !== 'string' || !Number.isFinite(Date.parse(row.created_at))
    || typeof row.can_remove !== 'boolean') return null;
  return { notice: row as unknown as TeamChatNotice, collapsed: state.collapsed, hidden: state.hidden };
}
