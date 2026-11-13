'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from './supabase';
import type { TeamMember } from '@/app/components/team-member-picker';
import type { PortalNotification } from '@/app/components/portal-notifications';

const isMember = (value: unknown): value is TeamMember => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const row = value as Record<string, unknown>;
  return typeof row.id === 'string' && typeof row.display_name === 'string' && typeof row.handle === 'string';
};
const isNotification = (value: unknown): value is PortalNotification => {
  if (!value || typeof value !== 'object') return false;
  const row = value as Record<string, unknown>;
  return typeof row.id === 'string' && typeof row.source_id === 'string' && typeof row.title === 'string'
    && typeof row.created_at === 'string' && ['schedule_attendee', 'chat_mention'].includes(String(row.kind));
};
const isUnavailable = (error: { code?: string } | null) => Boolean(error && ['PGRST202', '42883', '42P01'].includes(error.code ?? ''));

/** The database derives the current identity and filters notifications by auth.uid(). */
export default function useTeamIdentity(enabled: boolean) {
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [member, setMember] = useState<TeamMember | null>(null);
  const [notifications, setNotifications] = useState<PortalNotification[]>([]);
  const [available, setAvailable] = useState(false);
  const [loading, setLoading] = useState(false);
  const [notificationLoading, setNotificationLoading] = useState(false);
  const [error, setError] = useState('');
  const [notificationError, setNotificationError] = useState('');
  const generation = useRef(0);
  const notificationRevision = useRef(0);
  const recipientId = useRef<string | null | undefined>(undefined);
  const capability = useRef(false);
  const rosterRequest = useRef<Promise<void> | null>(null);
  const notificationRequest = useRef<Promise<void> | null>(null);

  const refreshNotifications = useCallback(async () => {
    if (!enabled || !capability.current) return;
    if (notificationRequest.current) return notificationRequest.current;
    const version = generation.current;
    const revision = ++notificationRevision.current;
    const request = (async () => {
      setNotificationLoading(true);
      try {
        const result = await supabase.rpc('list_my_team_notifications', { p_limit: 100 });
        if (generation.current !== version || notificationRevision.current !== revision) return;
        if (result.error) throw new Error('알림을 불러오지 못했습니다. 다시 시도해 주세요.');
        if (!Array.isArray(result.data) || !result.data.every(isNotification)) throw new Error('알림 정보를 확인하지 못했습니다.');
        setNotifications(result.data);
        setNotificationError('');
      } catch (failure) {
        if (generation.current === version && notificationRevision.current === revision) setNotificationError(failure instanceof Error ? failure.message : '알림을 불러오지 못했습니다.');
      } finally {
        if (generation.current === version && notificationRevision.current === revision) setNotificationLoading(false);
      }
    })();
    notificationRequest.current = request;
    try { await request; } finally { if (notificationRequest.current === request) notificationRequest.current = null; }
  }, [enabled]);

  const refresh = useCallback(async () => {
    if (!enabled) return;
    if (rosterRequest.current) return rosterRequest.current;
    const version = generation.current;
    const request = (async () => {
      setLoading(true);
      try {
        const [roster, current] = await Promise.all([supabase.rpc('list_team_members'), supabase.rpc('get_my_team_member')]);
        if (generation.current !== version) return;
        if (isUnavailable(roster.error) || isUnavailable(current.error)) {
          capability.current = false;
          setAvailable(false);
          setMembers([]);
          setMember(null);
          return;
        }
        if (roster.error || current.error) throw new Error('팀원 정보를 불러오지 못했습니다. 다시 시도해 주세요.');
        // Reject older test/back-end fallbacks returning [] for every unknown RPC.
        if (!Array.isArray(roster.data) || !roster.data.every(isMember) || (current.data !== null && !isMember(current.data))) {
          capability.current = false;
          setAvailable(false);
          return;
        }
        capability.current = true;
        const nextRecipientId = current.data?.id ?? null;
        if (recipientId.current !== nextRecipientId) {
          notificationRevision.current += 1;
          notificationRequest.current = null;
          setNotifications([]);
          setNotificationError('');
        }
        recipientId.current = nextRecipientId;
        setAvailable(true);
        setMembers(roster.data);
        setMember(current.data);
        setError('');
        await refreshNotifications();
      } catch (failure) {
        if (generation.current === version) setError(failure instanceof Error ? failure.message : '팀원 정보를 불러오지 못했습니다.');
      } finally {
        if (generation.current === version) setLoading(false);
      }
    })();
    rosterRequest.current = request;
    try { await request; } finally { if (rosterRequest.current === request) rosterRequest.current = null; }
  }, [enabled, refreshNotifications]);

  useEffect(() => {
    generation.current += 1;
    if (!enabled) {
      capability.current = false;
      recipientId.current = undefined;
      const reset = window.setTimeout(() => { setMembers([]); setMember(null); setNotifications([]); setAvailable(false); }, 0);
      return () => window.clearTimeout(reset);
    }
    const start = window.setTimeout(() => void refresh(), 0);
    const rosterTimer = window.setInterval(() => { if (document.visibilityState === 'visible') void refresh(); }, 30_000);
    const notificationTimer = window.setInterval(() => { if (document.visibilityState === 'visible') void refreshNotifications(); }, 10_000);
    const onFocus = () => { if (document.visibilityState === 'visible') void refresh(); };
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onFocus);
    return () => {
      generation.current += 1;
      rosterRequest.current = null;
      notificationRequest.current = null;
      capability.current = false;
      window.clearTimeout(start);
      window.clearInterval(rosterTimer);
      window.clearInterval(notificationTimer);
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onFocus);
    };
  }, [enabled, refresh, refreshNotifications]);

  const markRead = useCallback(async (ids: string[] | null) => {
    if (!enabled || !capability.current) throw new Error('팀원 알림 연결을 확인해 주세요.');
    const version = generation.current;
    const recipient = recipientId.current;
    const result = await supabase.rpc('mark_my_notifications_read', { p_notification_ids: ids });
    if (generation.current !== version || recipientId.current !== recipient || !capability.current) return;
    if (result.error) throw new Error('읽음 상태를 저장하지 못했습니다. 다시 시도해 주세요.');
    notificationRevision.current += 1;
    notificationRequest.current = null;
    const timestamp = new Date().toISOString();
    setNotifications((current) => current.map((item) => !item.read_at && (ids === null || ids.includes(item.id)) ? { ...item, read_at: timestamp } : item));
    await refreshNotifications();
  }, [enabled, refreshNotifications]);

  return { members, member, available, loading, error, notifications, notificationLoading, notificationError, refresh, refreshNotifications, markRead };
}
