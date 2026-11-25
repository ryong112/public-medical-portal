'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from './supabase';

export interface ImportantSchedule {
  schedule_id: number;
  title: string;
  date: string | null;
  end_date: string | null;
  start_time: string | null;
  end_time: string | null;
  location: string | null;
  attendee_count: number;
  file_count: number;
  status: 'published' | 'changed' | 'cancelled';
  revision: number;
  read: boolean;
  source_available: boolean;
  can_withdraw: boolean;
}

const isImportantSchedule = (value: unknown): value is ImportantSchedule => {
  if (!value || typeof value !== 'object') return false;
  const row = value as Record<string, unknown>;
  return Number.isSafeInteger(row.schedule_id) && typeof row.title === 'string'
    && ['published', 'changed', 'cancelled'].includes(String(row.status))
    && Number.isSafeInteger(row.revision) && typeof row.read === 'boolean'
    && typeof row.source_available === 'boolean' && typeof row.can_withdraw === 'boolean';
};

interface State {
  scope: string;
  items: ImportantSchedule[];
  available: boolean;
  loading: boolean;
  error: string;
}

/** The server derives the viewer and applies role and recipient restrictions. */
export function useImportantSchedules(approvedUserId: string | null, active: boolean, memberId?: string | null) {
  const scope = approvedUserId ? `${approvedUserId}:${memberId ?? ''}` : '';
  const version = useRef(0);
  const [state, setState] = useState<State>({ scope: '', items: [], available: false, loading: false, error: '' });

  const refresh = useCallback(async () => {
    if (!scope) return;
    const request = ++version.current;
    setState((current) => current.scope === scope
      ? { ...current, loading: current.items.length === 0 }
      : { scope, items: [], available: false, loading: true, error: '' });
    try {
      const { data, error } = await supabase.rpc('list_important_schedules');
      if (request !== version.current) return;
      if (error && ['PGRST202', '42883', '42P01'].includes(error.code)) {
        setState({ scope, items: [], available: false, loading: false, error: '' });
        return;
      }
      if (error || !Array.isArray(data) || !data.every(isImportantSchedule)) throw new Error();
      setState({ scope, items: data, available: true, loading: false, error: '' });
    } catch {
      if (request === version.current) setState((current) => current.scope === scope
        ? { ...current, loading: false, error: '중요 일정을 불러오지 못했습니다.' }
        : current);
    }
  }, [scope]);

  useEffect(() => {
    if (!scope || !active) return;
    const whenVisible = () => { if (document.visibilityState === 'visible') void refresh(); };
    const start = window.setTimeout(() => void refresh(), 0);
    const timer = window.setInterval(whenVisible, 16_000);
    window.addEventListener('focus', whenVisible);
    document.addEventListener('visibilitychange', whenVisible);
    return () => {
      version.current += 1;
      window.clearTimeout(start);
      window.clearInterval(timer);
      window.removeEventListener('focus', whenVisible);
      document.removeEventListener('visibilitychange', whenVisible);
    };
  }, [active, refresh, scope]);

  const publish = async (scheduleId: number) => {
    if (!scope) throw new Error('승인된 팀원 또는 관리자만 중요 일정을 공유할 수 있습니다.');
    const { data, error } = await supabase.rpc('publish_important_schedule', { p_schedule_id: scheduleId });
    if (error || typeof data !== 'boolean') throw new Error(error?.code === '42501'
      ? '담당자 또는 관리자만 이 일정을 공유할 수 있습니다.' : '중요 일정을 공유하지 못했습니다. 다시 시도해 주세요.');
    await refresh();
    return data;
  };
  const withdraw = async (scheduleId: number) => {
    const { error } = await supabase.rpc('withdraw_important_schedule', { p_schedule_id: scheduleId });
    if (error) throw new Error('공유를 내리지 못했습니다. 다시 시도해 주세요.');
    await refresh();
  };
  const markRead = async (item: ImportantSchedule) => {
    if (item.read || !scope) return;
    const { data, error } = await supabase.rpc('mark_important_schedule_read', { p_schedule_id: item.schedule_id, p_revision: item.revision });
    if (error) throw new Error('확인 상태를 저장하지 못했습니다. 다시 시도해 주세요.');
    if (data === true) setState((current) => current.scope === scope ? { ...current, items: current.items.map((entry) => entry.schedule_id === item.schedule_id && entry.revision === item.revision ? { ...entry, read: true } : entry) } : current);
    await refresh();
  };
  const current = state.scope === scope && scope ? state : null;
  const items = current?.items ?? [];
  return {
    items, unreadCount: items.filter((item) => !item.read).length,
    available: current?.available ?? false, loading: current?.loading ?? Boolean(scope && active), error: current?.error ?? '',
    refresh, publish, withdraw, markRead,
  };
}

export type ImportantSchedules = ReturnType<typeof useImportantSchedules>;
