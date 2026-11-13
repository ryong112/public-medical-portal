'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { parseTeamChatNoticeState, type TeamChatNoticeState } from '@/lib/team-chat-notice';

interface NoticeView extends TeamChatNoticeState {
  key: string;
  available: boolean;
  loading: boolean;
  busy: boolean;
  error: string;
}

const emptyView = (key: string, loading = false): NoticeView => ({ key, notice: null, collapsed: false, hidden: false, available: false, loading, busy: false, error: '' });
const unavailable = (error: { code?: string } | null) => Boolean(error && ['PGRST202', '42883', '42P01'].includes(error.code ?? ''));

/** Shared notice content, with server-derived, member-scoped presentation preferences. */
export default function useTeamChatNotice(enabled: boolean, identityKey: string) {
  const [view, setView] = useState<NoticeView>(() => emptyView(''));
  const generation = useRef(0);
  const revision = useRef(0);
  const readSequence = useRef(0);
  const readRequest = useRef<Promise<void> | null>(null);
  const mutationBusy = useRef(false);

  const read = useCallback(async (force = false) => {
    if (!enabled || !identityKey || (!force && mutationBusy.current)) return;
    if (!force && readRequest.current) return readRequest.current;
    const version = generation.current;
    const edit = revision.current;
    const sequence = ++readSequence.current;
    const current = () => generation.current === version && revision.current === edit && readSequence.current === sequence;
    setView((previous) => previous.key !== identityKey ? emptyView(identityKey, true) : { ...previous, loading: !previous.available, busy: mutationBusy.current });
    const request = (async () => {
      try {
        const result = await supabase.rpc('get_team_chat_notice_state');
        if (!current()) return;
        if (unavailable(result.error)) { setView(emptyView(identityKey)); return; }
        if (result.error) throw new Error('공지를 불러오지 못했습니다. 다시 시도해 주세요.');
        const data = parseTeamChatNoticeState(result.data);
        // Some older environments return [] for every unknown read RPC.
        if (!data) { setView(emptyView(identityKey)); return; }
        setView({ ...data, key: identityKey, available: true, loading: false, busy: mutationBusy.current, error: '' });
      } catch (failure) {
        if (current()) setView((previous) => ({ ...(previous.key === identityKey ? previous : emptyView(identityKey)), loading: false, error: failure instanceof Error ? failure.message : '공지를 불러오지 못했습니다.' }));
      }
    })();
    readRequest.current = request;
    try { await request; } finally { if (readRequest.current === request) readRequest.current = null; }
  }, [enabled, identityKey]);

  useEffect(() => {
    generation.current += 1;
    revision.current += 1;
    readRequest.current = null;
    mutationBusy.current = false;
    if (!enabled || !identityKey) return;
    const start = window.setTimeout(() => void read(), 0);
    const refreshVisible = () => { if (document.visibilityState === 'visible') void read(); };
    const interval = window.setInterval(refreshVisible, 8000);
    window.addEventListener('focus', refreshVisible);
    document.addEventListener('visibilitychange', refreshVisible);
    return () => {
      generation.current += 1;
      revision.current += 1;
      readRequest.current = null;
      mutationBusy.current = false;
      window.clearTimeout(start);
      window.clearInterval(interval);
      window.removeEventListener('focus', refreshVisible);
      document.removeEventListener('visibilitychange', refreshVisible);
    };
  }, [enabled, identityKey, read]);

  const mutate = useCallback(async (rpc: string, args: Record<string, unknown>, optimistic?: (previous: NoticeView) => NoticeView) => {
    if (!enabled || !identityKey || view.key !== identityKey || !view.available) throw new Error('공지 연결을 확인해 주세요.');
    if (mutationBusy.current) return;
    const version = generation.current;
    mutationBusy.current = true;
    revision.current += 1;
    readRequest.current = null;
    setView((previous) => ({ ...previous, busy: true, loading: false, error: '' }));
    try {
      const result = await supabase.rpc(rpc, args);
      if (generation.current !== version) return;
      if (result.error) throw new Error('공지 변경을 저장하지 못했습니다. 다시 시도해 주세요.');
      revision.current += 1;
      readRequest.current = null;
      if (optimistic) setView((previous) => previous.key === identityKey ? optimistic(previous) : previous);
      await read(true);
    } catch (failure) {
      if (generation.current !== version) return;
      const message = failure instanceof Error ? failure.message : '공지 변경을 저장하지 못했습니다.';
      setView((previous) => ({ ...previous, error: message }));
      throw new Error(message);
    } finally {
      if (generation.current === version) {
        mutationBusy.current = false;
        setView((previous) => previous.key === identityKey ? { ...previous, busy: false } : previous);
      }
    }
  }, [enabled, identityKey, read, view.available, view.key]);

  const active = enabled && view.key === identityKey ? view : emptyView(identityKey, enabled);
  return {
    ...active,
    refresh: () => { void read(); },
    publish: (messageId: number) => mutate('publish_team_chat_notice', { p_message_id: messageId }),
    setPreference: (collapsed: boolean, hidden: boolean) => {
      const noticeId = active.notice?.id;
      if (!noticeId) return Promise.resolve();
      return mutate('set_team_chat_notice_preference', { p_notice_id: noticeId, p_collapsed: collapsed, p_hidden: hidden }, (previous) => previous.notice?.id === noticeId ? { ...previous, collapsed, hidden } : previous);
    },
    remove: () => {
      const noticeId = active.notice?.id;
      if (!noticeId) return Promise.resolve();
      return mutate('remove_team_chat_notice', { p_notice_id: noticeId }, (previous) => previous.notice?.id === noticeId ? { ...previous, notice: null, hidden: false, collapsed: false } : previous);
    },
  };
}
