'use client';

import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { ArrowDown, AtSign, CalendarDays, Ellipsis, Grip, LoaderCircle, MessageCircle, Move, Pin, RotateCcw, Send, Trash2, X } from 'lucide-react';
import ChatNoticeCard, { type TeamChatNotice } from '@/app/components/chat-notice-card';
import ImportantScheduleFeed from '@/app/components/important-schedule-feed';
import type { ImportantSchedules } from '@/lib/use-important-schedules';
import { CHAT_WINDOW_DESKTOP_WIDTH, CHAT_WINDOW_STORAGE_KEY, clampChatWindow, defaultChatWindow, parseChatWindow, type ChatWindowGeometry } from '@/lib/team-chat-window';
import { upsertTeamChatMessages } from '@/lib/team-chat-feed';
import {
  getChatMentionQuery,
  getChatMentionRanges,
  getChatTextSegments,
  getSelectedChatMentionIds,
  type ChatMentionMember,
} from '@/lib/team-chat-mentions';

export type TeamChatMember = ChatMentionMember;
export type ShareRoomTab = 'chat' | 'important';
export type { TeamChatNotice } from '@/app/components/chat-notice-card';

export interface TeamChatMessage {
  id: number;
  content: string;
  sender_id: string | null;
  created_at: string;
  sender_member_id?: string | null;
  sender_display_name?: string | null;
  mentioned_member_ids?: string[] | null;
}

interface TeamChatPanelProps {
  messages: TeamChatMessage[];
  members: TeamChatMember[];
  currentUserId: string | null;
  currentMemberId?: string | null;
  onSend: (content: string, mentionedMemberIds: string[]) => Promise<void>;
  onDelete: (id: number) => void | Promise<void>;
  onClose: () => void;
  canMention?: boolean;
  focusedMessageId?: number | null;
  focusedMessageRequestId?: number;
  importantSchedules?: ImportantSchedules;
  tabRequest?: { tab: ShareRoomTab; requestId: number };
  onTabChange?: (tab: ShareRoomTab) => void;
  onOpenSchedule?: (id: number) => void | Promise<void>;
  isAdmin?: boolean;
  notice?: TeamChatNotice | null;
  noticeAvailable?: boolean;
  noticeLoading?: boolean;
  noticeBusy?: boolean;
  noticeError?: string;
  noticeCollapsed?: boolean;
  noticeHidden?: boolean;
  onPublishNotice?: (messageId: number) => Promise<void>;
  onNoticePreference?: (collapsed: boolean, hidden: boolean) => Promise<void>;
  onRemoveNotice?: () => Promise<void>;
  onRefreshNotice?: () => void;
}

const dateKeyFormatter = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' });
const dateLabelFormatter = new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', year: 'numeric', month: 'long', day: 'numeric', weekday: 'short' });
const timeFormatter = new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', hour: '2-digit', minute: '2-digit', hour12: false });

const messageDate = (value: string) => {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

// Keep unsent text in this open portal session only, never in local storage or
// exposed to a different approved identity when the window is reopened.
const rememberedDrafts = new Map<string, { text: string; recipients: TeamChatMember[] }>();

export default function TeamChatPanel({
  messages,
  members,
  currentUserId,
  currentMemberId,
  onSend,
  onDelete,
  onClose,
  canMention = true,
  focusedMessageId = null,
  focusedMessageRequestId = 0,
  importantSchedules,
  tabRequest,
  onTabChange,
  onOpenSchedule,
  isAdmin = false,
  notice = null,
  noticeAvailable = false,
  noticeLoading = false,
  noticeBusy = false,
  noticeError = '',
  noticeCollapsed = false,
  noticeHidden = false,
  onPublishNotice,
  onNoticePreference,
  onRemoveNotice,
  onRefreshNotice,
}: TeamChatPanelProps) {
  const draftKey = currentMemberId ? `member:${currentMemberId}` : currentUserId ? `user:${currentUserId}` : '';
  const [draftScope, setDraftScope] = useState(draftKey);
  const [draft, setDraft] = useState(() => rememberedDrafts.get(draftKey)?.text ?? '');
  const [caret, setCaret] = useState(-1);
  const [selectedMembers, setSelectedMembers] = useState<TeamChatMember[]>(() => rememberedDrafts.get(draftKey)?.recipients ?? []);
  const [activeSuggestion, setActiveSuggestion] = useState(0);
  const [dismissedQuery, setDismissedQuery] = useState<string | null>(null);
  const [isSending, setIsSending] = useState(false);
  const [deletingIds, setDeletingIds] = useState<number[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [desktopGeometry, setDesktopGeometry] = useState<ChatWindowGeometry | null>(null);
  const [isDesktop, setIsDesktop] = useState(false);
  const [manipulating, setManipulating] = useState<'move' | 'resize' | null>(null);
  const [tab, setTab] = useState<ShareRoomTab>(tabRequest?.tab ?? 'chat');
  const [tabVersion, setTabVersion] = useState(tabRequest?.requestId);
  const [menuMessageId, setMenuMessageId] = useState<number | null>(null);
  const [unseenMessages, setUnseenMessages] = useState(0);
  if (tabRequest && tabVersion !== tabRequest.requestId) {
    setTabVersion(tabRequest.requestId);
    setTab(tabRequest.tab);
  }
  if (draftScope !== draftKey) {
    setDraftScope(draftKey);
    setDraft(rememberedDrafts.get(draftKey)?.text ?? '');
    setSelectedMembers(rememberedDrafts.get(draftKey)?.recipients ?? []);
    setCaret(-1);
    setDismissedQuery(null);
    setError(null);
    setIsSending(false);
  }
  const noticeActionScope = `${currentUserId ?? ''}:${currentMemberId ?? ''}:${notice?.id ?? ''}`;
  const [noticeAction, setNoticeAction] = useState<{ scope: string; version: number; request: symbol | null; pending: boolean; error: string }>({ scope: noticeActionScope, version: 0, request: null, pending: false, error: '' });
  // Reset before painting a new identity/notice, not later in an effect. Async
  // completions below must still own this version and request token to update it.
  if (noticeAction.scope !== noticeActionScope) setNoticeAction({ scope: noticeActionScope, version: noticeAction.version + 1, request: null, pending: false, error: '' });
  const noticeActionPending = noticeAction.scope === noticeActionScope && noticeAction.pending;
  const noticeActionError = noticeAction.scope === noticeActionScope ? noticeAction.error : '';
  const [noticeSourceFocus, setNoticeSourceFocus] = useState<{ scope: string; version: number; messageId: number } | null>(null);
  const noticeSourceFocusId = noticeSourceFocus?.scope === noticeActionScope && noticeSourceFocus.version === noticeAction.version ? noticeSourceFocus.messageId : null;
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const logRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLElement>(null);
  const tabListRef = useRef<HTMLDivElement>(null);
  const lastFocusedMessageRef = useRef<string | null>(null);
  const followingRef = useRef(true);
  const previousMessages = useRef<Set<number> | null>(null);
  const sendingRef = useRef(new Set<string>());
  const liveDraftScope = useRef(draftKey);
  const deletingRef = useRef(new Set<number>());
  const noticeActionRef = useRef<{ scope: string; version: number; request: symbol } | null>(null);
  const geometryRef = useRef<ChatWindowGeometry | null>(null);
  const desktopRef = useRef(false);
  const manipulationRef = useRef<{ pointerId: number; mode: 'move' | 'resize'; startX: number; startY: number; geometry: ChatWindowGeometry } | null>(null);
  const identifier = useId();
  const titleId = `${identifier}-title`;
  const hintId = `${identifier}-hint`;
  const listId = `${identifier}-members`;
  const queryKey = `${caret}:${draft}`;
  const mentionQuery = canMention && !isSending && dismissedQuery !== queryKey ? getChatMentionQuery(draft, caret) : null;
  const noticeLocked = noticeBusy || noticeActionPending || noticeLoading;
  const railTabs = isDesktop && (desktopGeometry?.width ?? 0) >= 620;

  const availableMembers = useMemo(() => {
    const ids = new Set<string>();
    return members.filter((member) => {
      if (!member.handle || ids.has(member.id)) return false;
      ids.add(member.id);
      return true;
    });
  }, [members]);
  const memberById = useMemo(() => new Map(availableMembers.map((member) => [member.id, member])), [availableMembers]);
  const query = mentionQuery?.query.toLocaleLowerCase('ko-KR');
  const suggestions = mentionQuery ? availableMembers.filter((member) => !query
    || member.display_name.toLocaleLowerCase('ko-KR').includes(query)
    || member.handle.toLocaleLowerCase('ko-KR').includes(query)).slice(0, 6) : [];
  const suggestionIndex = Math.min(activeSuggestion, Math.max(0, suggestions.length - 1));
  const activeRecipients = selectedMembers.filter((member) => memberById.get(member.id)?.handle === member.handle
    && getChatMentionRanges(draft, member.handle).length > 0);
  const sortedMessages = useMemo(() => upsertTeamChatMessages([], messages).sort((left, right) => {
    const leftTime = messageDate(left.created_at)?.getTime();
    const rightTime = messageDate(right.created_at)?.getTime();
    return leftTime !== undefined && rightTime !== undefined ? leftTime - rightTime || left.id - right.id : left.id - right.id;
  }), [messages]);

  useEffect(() => {
    let initial = true;
    const updateViewport = () => {
      const desktop = window.innerWidth >= CHAT_WINDOW_DESKTOP_WIDTH;
      desktopRef.current = desktop;
      setIsDesktop(desktop);
      manipulationRef.current = null;
      setManipulating(null);
      if (!desktop) return;
      const viewport = { width: window.innerWidth, height: window.innerHeight };
      let saved = geometryRef.current;
      if (initial) {
        initial = false;
        try { saved = parseChatWindow(window.localStorage.getItem(CHAT_WINDOW_STORAGE_KEY)); } catch { /* Storage is optional. */ }
      }
      const next = saved ? clampChatWindow(saved, viewport) : defaultChatWindow(viewport);
      geometryRef.current = next;
      setDesktopGeometry(next);
    };
    const frame = window.requestAnimationFrame(updateViewport);
    window.addEventListener('resize', updateViewport);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener('resize', updateViewport);
      manipulationRef.current = null;
    };
  }, []);

  const persistGeometry = (geometry: ChatWindowGeometry) => {
    try { window.localStorage.setItem(CHAT_WINDOW_STORAGE_KEY, JSON.stringify({ version: 1, ...geometry })); } catch { /* Storage is optional. */ }
  };
  const updateGeometry = (geometry: ChatWindowGeometry, persist = false) => {
    const next = clampChatWindow(geometry, { width: window.innerWidth, height: window.innerHeight });
    geometryRef.current = next;
    setDesktopGeometry(next);
    if (persist) persistGeometry(next);
  };
  const resetGeometry = () => {
    if (!desktopRef.current) return;
    updateGeometry(defaultChatWindow({ width: window.innerWidth, height: window.innerHeight }));
    try { window.localStorage.removeItem(CHAT_WINDOW_STORAGE_KEY); } catch { /* Storage is optional. */ }
  };
  const startManipulation = (event: PointerEvent<HTMLElement>, mode: 'move' | 'resize') => {
    if (!desktopRef.current || event.button !== 0 || !geometryRef.current) return;
    if (mode === 'move' && event.target instanceof Element && event.target.closest('button, a, input, textarea, select')) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    manipulationRef.current = { pointerId: event.pointerId, mode, startX: event.clientX, startY: event.clientY, geometry: geometryRef.current };
    setManipulating(mode);
  };
  const moveManipulation = (event: PointerEvent<HTMLElement>) => {
    const action = manipulationRef.current;
    if (!action || action.pointerId !== event.pointerId || !desktopRef.current) return;
    event.preventDefault();
    const dx = event.clientX - action.startX;
    const dy = event.clientY - action.startY;
    updateGeometry(action.mode === 'move'
      ? { ...action.geometry, x: action.geometry.x + dx, y: action.geometry.y + dy }
      : { ...action.geometry, width: action.geometry.width + dx, height: action.geometry.height + dy });
  };
  const endManipulation = (event: PointerEvent<HTMLElement>) => {
    if (manipulationRef.current?.pointerId !== event.pointerId) return;
    manipulationRef.current = null;
    setManipulating(null);
    if (geometryRef.current) persistGeometry(geometryRef.current);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  };
  const keyboardManipulation = (event: KeyboardEvent<HTMLElement>, mode: 'move' | 'resize') => {
    if (event.currentTarget !== event.target || !desktopRef.current || !geometryRef.current) return;
    const step = event.shiftKey ? 50 : 20;
    const dx = event.key === 'ArrowLeft' ? -step : event.key === 'ArrowRight' ? step : 0;
    const dy = event.key === 'ArrowUp' ? -step : event.key === 'ArrowDown' ? step : 0;
    if (!dx && !dy) return;
    event.preventDefault();
    const current = geometryRef.current;
    updateGeometry(mode === 'move'
      ? { ...current, x: current.x + dx, y: current.y + dy }
      : { ...current, width: current.width + dx, height: current.height + dy }, true);
  };

  useEffect(() => {
    if (tab === 'chat' && focusedMessageId === null) inputRef.current?.focus();
    else if (tab === 'important') tabListRef.current?.querySelector<HTMLElement>('[aria-selected="true"]')?.focus();
  // On opening the window, focus the requested pane without stealing focus on subsequent tab clicks.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => { onTabChange?.(tab); }, [tab, onTabChange]);

  useEffect(() => {
    liveDraftScope.current = draftKey;
    return () => { liveDraftScope.current = ''; };
  }, [draftKey]);

  useEffect(() => {
    if (tab !== 'chat') return;
    const frame = requestAnimationFrame(() => {
      const log = logRef.current;
      if (!log) return;
      const ids = new Set(sortedMessages.map((message) => message.id));
      const previous = previousMessages.current;
      previousMessages.current = ids;
      const focusKey = focusedMessageId === null ? null : `${focusedMessageId}:${focusedMessageRequestId}`;
      if (focusKey !== null && lastFocusedMessageRef.current !== focusKey) {
        const message = log.querySelector<HTMLElement>(`[data-team-message-id="${focusedMessageId}"]`);
        if (message) {
          followingRef.current = false;
          const offset = message.getBoundingClientRect().top - log.getBoundingClientRect().top;
          log.scrollTop += offset - Math.max(0, (log.clientHeight - message.offsetHeight) / 2);
          message.focus({ preventScroll: true });
          lastFocusedMessageRef.current = focusKey;
          return;
        }
      }
      if (focusKey === null) lastFocusedMessageRef.current = null;
      if (followingRef.current) {
        log.scrollTop = log.scrollHeight;
        setUnseenMessages(0);
      } else if (previous) {
        const newIds = [...ids].filter((id) => !previous.has(id)).length;
        if (newIds) setUnseenMessages((count) => count + newIds);
      }
    });
    return () => cancelAnimationFrame(frame);
  }, [focusedMessageId, focusedMessageRequestId, sortedMessages, tab]);

  useEffect(() => {
    if (menuMessageId === null) return;
    const closeOutside = (event: globalThis.PointerEvent) => {
      if (event.target instanceof Element && !event.target.closest('[data-chat-message-menu]')) setMenuMessageId(null);
    };
    document.addEventListener('pointerdown', closeOutside);
    return () => document.removeEventListener('pointerdown', closeOutside);
  }, [menuMessageId]);

  const jumpToLatest = () => {
    followingRef.current = true;
    const log = logRef.current;
    if (log) log.scrollTop = log.scrollHeight;
    setUnseenMessages(0);
  };
  const storeDraft = (text: string, recipients: TeamChatMember[]) => {
    if (!draftKey) return;
    if (text) rememberedDrafts.set(draftKey, { text, recipients });
    else rememberedDrafts.delete(draftKey);
  };

  const updateDraft = (value: string, nextCaret: number) => {
    const recipients = selectedMembers.filter((member) => getChatMentionRanges(value, member.handle).length > 0);
    setDraft(value);
    setCaret(nextCaret);
    setSelectedMembers(recipients);
    storeDraft(value, recipients);
    setActiveSuggestion(0);
    setDismissedQuery(null);
    setError(null);
  };

  const chooseMember = (member: TeamChatMember) => {
    if (!mentionQuery) return;
    const suffix = draft.slice(mentionQuery.end);
    const token = `@${member.handle}${suffix.startsWith(' ') ? '' : ' '}`;
    const nextDraft = `${draft.slice(0, mentionQuery.start)}${token}${suffix}`;
    const nextCaret = mentionQuery.start + token.length;
    setDraft(nextDraft);
    setCaret(nextCaret);
    const recipients = [...selectedMembers.filter((item) => item.id !== member.id
      && getChatMentionRanges(nextDraft, item.handle).length > 0), member];
    setSelectedMembers(recipients);
    storeDraft(nextDraft, recipients);
    setActiveSuggestion(0);
    setError(null);
    requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.setSelectionRange(nextCaret, nextCaret);
    });
  };

  const sendMessage = async () => {
    if (!draft.trim() || sendingRef.current.has(draftKey)) return;
    const content = draft.trim();
    const mentionedIds = canMention ? getSelectedChatMentionIds(content, activeRecipients) : [];
    sendingRef.current.add(draftKey);
    setIsSending(true);
    setError(null);
    try {
      await onSend(content, mentionedIds);
      if (rememberedDrafts.get(draftKey)?.text === draft) storeDraft('', []);
      if (liveDraftScope.current === draftKey) {
        followingRef.current = true;
        setDraft('');
        setCaret(0);
        setSelectedMembers([]);
        setDismissedQuery(null);
      }
    } catch {
      if (liveDraftScope.current === draftKey) setError('메시지를 보내지 못했습니다. 작성한 내용은 그대로 보관되어 있습니다. 다시 시도해 주세요.');
    } finally {
      sendingRef.current.delete(draftKey);
      if (liveDraftScope.current === draftKey) {
        setIsSending(false);
        requestAnimationFrame(() => inputRef.current?.focus());
      }
    }
  };

  const deleteMessage = async (id: number) => {
    if (deletingRef.current.has(id)) return;
    deletingRef.current.add(id);
    setDeletingIds((previous) => [...previous, id]);
    setError(null);
    try {
      await onDelete(id);
    } catch {
      setError('메시지를 삭제하지 못했습니다. 잠시 후 다시 시도해 주세요.');
    } finally {
      deletingRef.current.delete(id);
      setDeletingIds((previous) => previous.filter((value) => value !== id));
    }
  };

  const runNoticeAction = async (action: () => Promise<void>) => {
    if (noticeLocked || (noticeActionRef.current?.scope === noticeActionScope && noticeActionRef.current.version === noticeAction.version)) return;
    const operation = { scope: noticeActionScope, version: noticeAction.version, request: Symbol('chat-notice-action') };
    noticeActionRef.current = operation;
    setNoticeAction({ ...operation, pending: true, error: '' });
    try { await action(); }
    catch (failure) { setNoticeAction((current) => current.scope === operation.scope && current.version === operation.version && current.request === operation.request ? { ...current, error: failure instanceof Error ? failure.message : '공지를 변경하지 못했습니다. 다시 시도해 주세요.' } : current); }
    finally {
      if (noticeActionRef.current?.request === operation.request) noticeActionRef.current = null;
      setNoticeAction((current) => current.scope === operation.scope && current.version === operation.version && current.request === operation.request ? { ...current, pending: false } : current);
    }
  };
  const publishNotice = (messageId: number) => {
    if (!onPublishNotice || notice?.message_id === messageId || noticeLocked || (noticeActionRef.current?.scope === noticeActionScope && noticeActionRef.current.version === noticeAction.version)) return;
    if (notice && !window.confirm('팀 전체에 보이는 고정 공지를 이 메시지로 바꾸시겠습니까?')) return;
    void runNoticeAction(() => onPublishNotice(messageId));
  };
  const removeNotice = () => {
    if (!onRemoveNotice || noticeLocked || (noticeActionRef.current?.scope === noticeActionScope && noticeActionRef.current.version === noticeAction.version)) return;
    if (!window.confirm('팀 전체의 고정 공지를 종료하시겠습니까? 채팅 원문은 삭제되지 않습니다.')) return;
    void runNoticeAction(onRemoveNotice);
  };
  const openNoticeSource = () => {
    if (!notice) return;
    const source = panelRef.current?.querySelector<HTMLElement>(`[data-team-message-id="${notice.message_id}"]`);
    if (!source) return;
    followingRef.current = false;
    setNoticeSourceFocus({ scope: noticeActionScope, version: noticeAction.version, messageId: notice.message_id });
    source.scrollIntoView?.({ block: 'center', behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' });
    source.focus({ preventScroll: true });
  };

  return (
    <section
      ref={panelRef}
      role="dialog"
      aria-labelledby={titleId}
      data-chat-desktop={isDesktop ? 'true' : 'false'}
      style={isDesktop && desktopGeometry ? { left: desktopGeometry.x, top: desktopGeometry.y, width: desktopGeometry.width, height: desktopGeometry.height, right: 'auto', bottom: 'auto' } : undefined}
      className={`fixed bottom-0 right-0 z-[100] flex h-[min(82dvh,720px)] w-full min-w-0 flex-col overflow-hidden rounded-t-[24px] border border-slate-300 bg-[#e9eff6] shadow-[0_18px_65px_rgba(15,23,42,0.28)] md:bottom-6 md:right-6 md:w-[420px] md:rounded-[22px] ${manipulating ? 'select-none' : ''}`}
      onKeyDown={(event) => {
        if (event.key !== 'Escape' || event.nativeEvent.isComposing) return;
        event.stopPropagation();
        if (menuMessageId !== null) {
          event.preventDefault();
          setMenuMessageId(null);
          panelRef.current?.querySelector<HTMLButtonElement>(`[data-chat-menu-trigger="${menuMessageId}"]`)?.focus();
        } else if (tab === 'chat' && mentionQuery) {
          event.preventDefault();
          setDismissedQuery(queryKey);
        } else onClose();
      }}
    >
      <header data-chat-drag-handle tabIndex={isDesktop ? 0 : undefined} aria-label={isDesktop ? '채팅창 위치 이동' : undefined} title={isDesktop ? '드래그 또는 방향키로 이동' : undefined} onPointerDown={(event) => startManipulation(event, 'move')} onPointerMove={moveManipulation} onPointerUp={endManipulation} onPointerCancel={endManipulation} onLostPointerCapture={endManipulation} onKeyDown={(event) => keyboardManipulation(event, 'move')} className={`flex shrink-0 items-center justify-between gap-3 border-b border-slate-950 bg-slate-900 px-4 py-3.5 text-white outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-400 ${isDesktop ? `touch-none ${manipulating === 'move' ? 'cursor-grabbing' : 'cursor-grab'}` : ''}`}>
        <div className="flex min-w-0 items-center gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-blue-500/20 text-blue-300 ring-1 ring-blue-400/25"><MessageCircle size={19} /></span>
          <div className="min-w-0"><h2 id={titleId} aria-label="정보공유방" className="text-[15px] font-extrabold tracking-tight text-white">공유방</h2>{isDesktop && <p className="mt-0.5 flex items-center gap-1 text-[11px] font-medium text-slate-300"><Move size={11} aria-hidden="true" />상단을 드래그해 이동</p>}</div>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          {isDesktop && <button type="button" onClick={resetGeometry} aria-label="채팅창 위치와 크기 초기화" title="기본 위치·크기로 복원" className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-300 transition hover:bg-white/10 hover:text-white focus-visible:outline-2 focus-visible:outline-blue-400"><RotateCcw size={15} /></button>}
          <button type="button" onClick={onClose} aria-label="정보공유방 닫기" className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-white/10 text-slate-200 transition hover:bg-white/20 hover:text-white focus-visible:outline-2 focus-visible:outline-blue-400"><X size={18} /></button>
        </div>
      </header>

      <div className={`flex min-h-0 flex-1 ${railTabs ? 'flex-row' : 'flex-col'}`}>
      <div ref={tabListRef} role="tablist" aria-label="공유방 메뉴" aria-orientation={railTabs ? 'vertical' : 'horizontal'} data-share-room-rail={railTabs ? 'true' : 'false'} className={`flex shrink-0 gap-1 bg-white ${railTabs ? 'w-[144px] flex-col border-r border-slate-200 px-2.5 py-3' : 'border-b border-slate-200 px-2.5 py-1.5'}`} onKeyDown={(event) => {
        const direction = railTabs ? ['ArrowUp', 'ArrowDown'] : ['ArrowLeft', 'ArrowRight'];
        if (![...direction, 'Home', 'End'].includes(event.key)) return;
        event.preventDefault();
        const nextTab: ShareRoomTab = event.key === 'Home' ? 'chat' : event.key === 'End' ? 'important' : tab === 'chat' ? 'important' : 'chat';
        setMenuMessageId(null);
        setTab(nextTab);
        document.getElementById(`${identifier}-tab-${nextTab}`)?.focus();
      }}>
        {(['chat', 'important'] as const).map((entry) => {
          const active = tab === entry;
          const count = entry === 'important' ? importantSchedules?.unreadCount ?? 0 : 0;
          return <button key={entry} id={`${identifier}-tab-${entry}`} type="button" role="tab" aria-selected={active} aria-controls={`${identifier}-panel-${entry}`} tabIndex={active ? 0 : -1} onClick={() => { setMenuMessageId(null); setTab(entry); }} className={`flex min-h-10 min-w-0 items-center gap-1.5 rounded-lg px-2.5 text-[13px] font-bold transition-colors focus-visible:outline-2 focus-visible:outline-blue-600 ${railTabs ? 'justify-start' : 'flex-1 justify-center'} ${active ? 'bg-blue-50 text-blue-800' : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'}`}>
            {entry === 'chat' ? <MessageCircle size={16} aria-hidden="true" className="shrink-0" /> : <CalendarDays size={16} aria-hidden="true" className="shrink-0" />}
            <span className="whitespace-nowrap">{entry === 'chat' ? '정보 공유' : '중요 일정'}</span>
            {count > 0 && <span aria-label={`안 읽음 ${count}건`} className="rounded-full bg-blue-800 px-1.5 py-0.5 text-[10px] font-bold tabular-nums leading-none text-white">{count}</span>}
          </button>;
        })}
      </div>
      <div role="tabpanel" id={`${identifier}-panel-chat`} aria-labelledby={`${identifier}-tab-chat`} hidden={tab !== 'chat'} className={`${tab === 'chat' ? 'flex' : 'hidden'} min-h-0 min-w-0 flex-1 flex-col`}>
      {noticeAvailable && notice && <ChatNoticeCard notice={notice} collapsed={noticeCollapsed} hidden={noticeHidden} busy={noticeLocked} canOpenSource={sortedMessages.some((message) => message.id === notice.message_id)} onPreference={(collapsed, hidden) => { if (onNoticePreference) void runNoticeAction(() => onNoticePreference(collapsed, hidden)); }} onOpenSource={openNoticeSource} onRemove={onRemoveNotice ? removeNotice : undefined} />}
      {(noticeError || noticeActionError) && <div role="alert" className="flex max-h-16 shrink-0 items-start justify-between gap-2 overflow-y-auto border-b border-amber-200 bg-amber-50 px-4 py-2 text-xs text-amber-950"><span className="min-w-0 flex-1 break-words">{noticeActionError || noticeError}</span>{onRefreshNotice && <button type="button" disabled={noticeLocked} onClick={() => { setNoticeAction((current) => current.scope === noticeActionScope ? { ...current, error: '' } : current); onRefreshNotice(); }} className="shrink-0 rounded px-1 font-bold underline underline-offset-2 focus-visible:outline-2 focus-visible:outline-amber-600 disabled:opacity-40">다시 시도</button>}</div>}

      <div className="relative flex min-h-0 flex-1 flex-col">
      <div ref={logRef} role="log" aria-label="정보공유방 메시지" aria-live="polite" aria-relevant="additions" onScroll={(event) => {
        const log = event.currentTarget;
        followingRef.current = log.scrollHeight - log.scrollTop - log.clientHeight <= 36;
        if (followingRef.current) setUnseenMessages(0);
      }} className="min-h-0 flex-1 overflow-y-auto overscroll-contain bg-[#e9eff6] px-3.5 py-4">
        {!sortedMessages.length && <div className="flex min-h-36 flex-col items-center justify-center gap-2 text-center"><MessageCircle size={26} className="text-slate-300" /><p className="text-sm font-bold text-slate-500">아직 나눈 이야기가 없어요</p><p className="text-xs text-slate-400">첫 소식을 남겨 보세요.</p></div>}
        {sortedMessages.map((message, index) => {
          const date = messageDate(message.created_at);
          const dateKey = date ? dateKeyFormatter.format(date) : 'unknown';
          const previousDate = index ? messageDate(sortedMessages[index - 1].created_at) : null;
          const previousDateKey = previousDate ? dateKeyFormatter.format(previousDate) : 'unknown';
          const showDate = index === 0 || dateKey !== previousDateKey;
          const isOwn = message.sender_member_id
            ? message.sender_member_id === currentMemberId
            : Boolean(currentUserId && message.sender_id === currentUserId);
          const author = message.sender_member_id ? memberById.get(message.sender_member_id) : null;
          const authorName = message.sender_display_name || author?.display_name || (isOwn ? '나' : message.sender_member_id ? '이전 팀원' : '이전 대화 참여자');
          const previous = sortedMessages[index - 1];
          const sameAuthor = message.sender_member_id ? previous?.sender_member_id === message.sender_member_id
            : Boolean(message.sender_id && previous?.sender_id === message.sender_id && !previous?.sender_member_id);
          const grouped = !showDate && sameAuthor && date !== null && previousDate !== null && date.getTime() - previousDate.getTime() <= 300_000;
          const showPin = Boolean(noticeAvailable && onPublishNotice);
          const showDelete = isOwn || isAdmin;
          const menuOpen = menuMessageId === message.id;
          return (
            <div key={message.id}>
              {showDate && <div className="my-3 flex items-center justify-center" aria-label={date ? dateLabelFormatter.format(date) : '날짜 정보 없음'}><span className="rounded-full border border-slate-300/60 bg-white/80 px-3 py-1 text-[11px] font-semibold text-slate-700">{date ? dateLabelFormatter.format(date) : '날짜 정보 없음'}</span></div>}
              <article data-team-message-id={message.id} data-chat-notice-source={notice?.message_id === message.id ? 'true' : undefined} tabIndex={-1} className={`group flex min-w-0 gap-2 outline-none ${grouped ? 'mb-1.5' : 'mb-3'} ${isOwn ? 'flex-row-reverse' : ''} ${focusedMessageId === message.id || noticeSourceFocusId === message.id ? 'rounded-xl bg-amber-50/70 ring-2 ring-amber-300 ring-offset-2' : ''}`} aria-label={`${authorName}의 메시지`}>
                <span aria-hidden="true" className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-xl text-xs font-black ${grouped ? 'invisible' : ''} ${isOwn ? 'bg-blue-100 text-blue-700 ring-1 ring-blue-200' : 'bg-slate-600 text-white ring-1 ring-slate-600'}`}>{authorName.slice(0, 1)}</span>
                <div className={`flex min-w-0 max-w-[calc(100%-3rem)] flex-col ${isOwn ? 'items-end' : 'items-start'}`}>
                  {(!grouped || notice?.message_id === message.id) && <div className={`mb-1 flex max-w-full items-baseline gap-2 ${isOwn ? 'flex-row-reverse' : ''}`}>{!grouped && <span className="truncate text-[12px] font-bold text-slate-800">{authorName}</span>}<time dateTime={date ? date.toISOString() : undefined} className="shrink-0 text-[11px] text-slate-600">{date ? timeFormatter.format(date) : '--:--'}</time>{notice?.message_id === message.id && <span className="inline-flex shrink-0 items-center gap-0.5 rounded bg-amber-100 px-1 py-0.5 text-[10px] font-bold text-amber-900"><Pin size={10} />공지</span>}</div>}
                  <div className={`flex min-w-0 max-w-full items-end gap-1 ${isOwn ? 'flex-row-reverse' : ''}`}>
                  <div className={`min-w-0 whitespace-pre-wrap break-words rounded-xl px-3 py-2 text-sm font-medium leading-relaxed shadow-sm [overflow-wrap:anywhere] ${isOwn ? 'rounded-tr-sm bg-blue-700 text-white shadow-blue-950/10' : 'rounded-tl-sm border border-slate-300/80 bg-white text-slate-900 shadow-slate-900/5'}`}>
                    {getChatTextSegments(message.content, availableMembers, message.mentioned_member_ids ?? []).map((segment, segmentIndex) => segment.memberId
                      ? <span key={segmentIndex} title={memberById.get(segment.memberId)?.display_name} className={`rounded px-0.5 font-bold ${isOwn ? 'bg-white/20 text-white' : 'bg-blue-50 text-blue-700'}`}>{segment.text}</span>
                      : <span key={segmentIndex}>{segment.text}</span>)}
                  </div>
                  {(showPin || showDelete) && <div className="relative shrink-0" data-chat-message-menu>
                    <button type="button" data-chat-menu-trigger={message.id} aria-label={`${authorName}의 메시지 메뉴`} aria-expanded={menuOpen} onClick={() => setMenuMessageId(menuOpen ? null : message.id)} className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-600 hover:bg-white/80 hover:text-slate-900 focus-visible:outline-2 focus-visible:outline-blue-600"><Ellipsis size={17} aria-hidden="true" /></button>
                    {menuOpen && <div className={`absolute bottom-full z-20 mb-1 min-w-[134px] rounded-lg border border-slate-200 bg-white p-1 text-slate-700 shadow-xl ${isOwn ? 'left-0' : 'right-0'}`}>
                      {showPin && <button type="button" aria-label={`${authorName}의 메시지 공지로 등록`} disabled={noticeLocked || notice?.message_id === message.id} onClick={() => { setMenuMessageId(null); publishNotice(message.id); }} className="flex min-h-9 w-full items-center gap-2 whitespace-nowrap rounded-md px-2.5 text-left text-xs font-bold hover:bg-amber-50 focus-visible:outline-2 focus-visible:outline-amber-600 disabled:opacity-50"><Pin size={13} aria-hidden="true" />{notice?.message_id === message.id ? '공지 중' : '공지로 등록'}</button>}
                      {showDelete && <button type="button" aria-label={`${authorName}의 메시지 삭제`} disabled={deletingIds.includes(message.id)} onClick={() => { setMenuMessageId(null); void deleteMessage(message.id); }} className="flex min-h-9 w-full items-center gap-2 rounded-md px-2.5 text-left text-xs font-bold text-rose-700 hover:bg-rose-50 focus-visible:outline-2 focus-visible:outline-blue-500 disabled:opacity-50"><Trash2 size={13} aria-hidden="true" />삭제</button>}
                    </div>}
                  </div>}
                  </div>
                </div>
              </article>
            </div>
          );
        })}
      </div>
      {unseenMessages > 0 && <button type="button" onClick={jumpToLatest} className="absolute bottom-2 left-1/2 z-10 inline-flex min-h-9 -translate-x-1/2 items-center justify-center gap-1.5 whitespace-nowrap rounded-full border border-blue-200 bg-white px-3 text-xs font-bold text-blue-800 shadow-lg hover:bg-blue-50 focus-visible:outline-2 focus-visible:outline-blue-700" aria-label={`새 메시지 ${unseenMessages}건으로 이동`}><ArrowDown size={14} aria-hidden="true" />새 메시지 {unseenMessages}건</button>}
      </div>

      <form onSubmit={(event) => { event.preventDefault(); void sendMessage(); }} className="relative shrink-0 border-t border-slate-300 bg-slate-50 p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] md:p-4">
        {mentionQuery && <div id={listId} role="listbox" aria-label="멘션할 팀원" className="absolute bottom-full left-3 right-3 mb-2 max-h-64 overflow-y-auto rounded-2xl border border-slate-200 bg-white p-1.5 shadow-xl">
          <div className="flex items-center gap-1.5 px-2.5 py-2 text-[10px] font-bold text-slate-400"><AtSign size={12} />알림을 받을 팀원을 선택하세요</div>
          {suggestions.length ? suggestions.map((member, index) => <button type="button" role="option" id={`${listId}-${index}`} key={member.id} aria-selected={index === suggestionIndex} onMouseDown={(event) => event.preventDefault()} onClick={() => chooseMember(member)} className={`flex w-full items-center justify-between gap-2 rounded-xl px-3 py-2.5 text-left ${index === suggestionIndex ? 'bg-blue-50 text-blue-700' : 'text-slate-700 hover:bg-slate-50'}`}><span className="truncate text-xs font-bold">{member.display_name}</span><span className="truncate text-[11px] text-slate-400">@{member.handle}</span></button>) : <p className="px-3 py-3 text-xs text-slate-500">일치하는 팀원이 없습니다.</p>}
        </div>}
        {activeRecipients.length > 0 && <div aria-label="멘션 알림 대상" className="mb-2 flex flex-wrap gap-1.5">{activeRecipients.map((member) => <span key={member.id} className="inline-flex max-w-full items-center gap-1 rounded-lg bg-blue-50 py-1 pl-2 text-[10px] font-bold text-blue-700"><AtSign size={10} className="shrink-0" /><span className="truncate">{member.display_name}</span><button type="button" aria-label={`${member.display_name} 멘션 알림 대상에서 제외`} onClick={() => setSelectedMembers((previous) => previous.filter((item) => item.id !== member.id))} disabled={isSending} className="flex h-5 w-5 shrink-0 items-center justify-center rounded hover:bg-blue-100 disabled:opacity-50"><X size={11} /></button></span>)}</div>}
        {error && <p role="alert" className="mb-2 rounded-xl bg-red-50 px-3 py-2 text-xs leading-relaxed text-red-600">{error}</p>}
        <div className="flex items-end gap-2 rounded-2xl border border-slate-300 bg-white p-2 shadow-sm focus-within:border-blue-500 focus-within:ring-2 focus-within:ring-blue-100">
          <textarea
            ref={inputRef}
            value={draft}
            readOnly={isSending}
            rows={2}
            aria-label="공유방 메시지 작성"
            aria-describedby={hintId}
            aria-autocomplete={canMention ? 'list' : undefined}
            aria-controls={mentionQuery ? listId : undefined}
            aria-activedescendant={mentionQuery && suggestions.length ? `${listId}-${suggestionIndex}` : undefined}
            placeholder={canMention ? '메시지 입력 · @로 팀원 멘션' : '메시지를 입력하세요'}
            onChange={(event) => updateDraft(event.target.value, event.target.selectionStart)}
            onSelect={(event) => { const input = event.currentTarget; setCaret(input.selectionStart === input.selectionEnd ? input.selectionStart : -1); }}
            onKeyDown={(event) => {
              if (event.nativeEvent.isComposing) return;
              if (mentionQuery && suggestions.length && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
                event.preventDefault();
                setActiveSuggestion((suggestionIndex + (event.key === 'ArrowDown' ? 1 : -1) + suggestions.length) % suggestions.length);
              } else if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault();
                if (mentionQuery && suggestions.length) chooseMember(suggestions[suggestionIndex]);
                else void sendMessage();
              }
            }}
            className="max-h-32 min-h-12 min-w-0 flex-1 resize-none bg-transparent px-1.5 py-1 text-sm leading-relaxed text-slate-900 outline-none placeholder:text-slate-400"
          />
          <button type="submit" disabled={!draft.trim() || isSending} aria-label={isSending ? '메시지 전송 중' : '메시지 전송'} className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-blue-600 text-white transition hover:bg-blue-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500 disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-400">{isSending ? <LoaderCircle size={17} className="animate-spin" /> : <Send size={17} />}</button>
        </div>
        <p id={hintId} className="mt-2 px-1 text-[10px] leading-relaxed text-slate-500 md:pr-5">{canMention ? '@ 입력 후 목록에서 선택한 팀원에게만 알림 · ' : '팀원 연결 후 @멘션 사용 가능 · '}Enter 전송 / Shift+Enter 줄바꿈</p>
      </form>
      </div>
      <div role="tabpanel" id={`${identifier}-panel-important`} aria-labelledby={`${identifier}-tab-important`} hidden={tab !== 'important'} className={`${tab === 'important' ? 'flex' : 'hidden'} min-h-0 min-w-0 flex-1 flex-col`}>
        {tab === 'important' && <ImportantScheduleFeed feed={importantSchedules} onOpenSchedule={onOpenSchedule} />}
      </div>
      </div>
      {isDesktop && <button type="button" data-chat-resize-handle aria-label="채팅창 크기 조절" title="드래그 또는 방향키로 크기 조절" onPointerDown={(event) => startManipulation(event, 'resize')} onPointerMove={moveManipulation} onPointerUp={endManipulation} onPointerCancel={endManipulation} onLostPointerCapture={endManipulation} onKeyDown={(event) => keyboardManipulation(event, 'resize')} className="absolute bottom-0 right-0 z-10 flex h-7 w-7 touch-none cursor-nwse-resize items-center justify-center rounded-tl-xl bg-slate-200/90 text-slate-500 hover:bg-blue-100 hover:text-blue-600 focus-visible:outline-2 focus-visible:outline-offset-[-3px] focus-visible:outline-blue-500"><Grip size={15} aria-hidden="true" /></button>}
    </section>
  );
}
