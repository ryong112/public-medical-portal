'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Bell, CalendarDays, Check, CheckCheck, LoaderCircle, MessageCircle, RefreshCw, X } from 'lucide-react';

export interface PortalNotification {
  id: string;
  kind: 'schedule_attendee' | 'chat_mention';
  source_id: string;
  title: string;
  body?: string | null;
  created_at: string;
  updated_at?: string;
  read_at?: string | null;
}

export interface PortalNotificationsProps {
  items: PortalNotification[];
  unreadCount?: number;
  loading?: boolean;
  error?: string | null;
  unavailable?: boolean;
  disabled?: boolean;
  busyIds?: string[];
  onOpenChange?: (open: boolean) => void;
  onMarkRead: (notificationId: string) => void | Promise<void>;
  onMarkAllRead?: () => void | Promise<void>;
  onSelect: (notification: PortalNotification) => void;
  onRetry?: () => void;
  className?: string;
}

const focusClass = 'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500';
const formatTimestamp = (value: string) => {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : new Intl.DateTimeFormat('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Seoul' }).format(date);
};

/** Header popover for recipient-filtered notifications supplied by the caller. */
export default function PortalNotifications({
  items,
  unreadCount,
  loading = false,
  error = null,
  unavailable = false,
  disabled = false,
  busyIds = [],
  onOpenChange,
  onMarkRead,
  onMarkAllRead,
  onSelect,
  onRetry,
  className = '',
}: PortalNotificationsProps) {
  const id = useId();
  const button = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState<string[]>([]);
  const [actionError, setActionError] = useState('');
  const [position, setPosition] = useState({ top: 0, left: 8, width: 304, maxHeight: 480 });
  const count = Math.max(0, unreadCount ?? items.filter((item) => !item.read_at).length);
  const visible = open && !disabled;
  const busy = (notificationId: string) => pending.includes(notificationId) || pending.includes('*') || busyIds.includes(notificationId);

  const changeOpen = (next: boolean, restoreFocus = false) => {
    setOpen(next);
    onOpenChange?.(next);
    if (!next && restoreFocus) button.current?.focus();
  };
  const updatePosition = () => {
    const rect = button.current?.getBoundingClientRect();
    if (!rect) return;
    const viewport = window.visualViewport;
    const viewportWidth = viewport?.width ?? window.innerWidth;
    const viewportHeight = viewport?.height ?? window.innerHeight;
    const offsetTop = viewport?.offsetTop ?? 0;
    const offsetLeft = viewport?.offsetLeft ?? 0;
    const width = Math.min(360, viewportWidth - 16);
    const below = viewportHeight + offsetTop - rect.bottom - 16;
    const above = rect.top - offsetTop - 16;
    const placeAbove = below < 200 && above > below;
    const maxHeight = Math.max(80, Math.min(480, placeAbove ? above : below));
    setPosition({
      width,
      left: Math.max(offsetLeft + 8, Math.min(rect.right - width, offsetLeft + viewportWidth - width - 8)),
      top: placeAbove ? Math.max(offsetTop + 8, rect.top - maxHeight - 8) : rect.bottom + 8,
      maxHeight,
    });
  };

  useEffect(() => {
    if (!visible) return;
    const outside = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!panel.current?.contains(target) && !button.current?.contains(target)) {
        setOpen(false);
        onOpenChange?.(false);
      }
    };
    const escape = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        setOpen(false);
        onOpenChange?.(false);
        button.current?.focus();
      }
    };
    const focusOutside = (event: FocusEvent) => {
      const target = event.target as Node;
      if (!panel.current?.contains(target) && !button.current?.contains(target)) {
        setOpen(false);
        onOpenChange?.(false);
      }
    };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('focusin', focusOutside);
    document.addEventListener('keydown', escape);
    window.addEventListener('resize', updatePosition);
    window.addEventListener('scroll', updatePosition, true);
    window.visualViewport?.addEventListener('resize', updatePosition);
    window.visualViewport?.addEventListener('scroll', updatePosition);
    return () => {
      document.removeEventListener('pointerdown', outside);
      document.removeEventListener('focusin', focusOutside);
      document.removeEventListener('keydown', escape);
      window.removeEventListener('resize', updatePosition);
      window.removeEventListener('scroll', updatePosition, true);
      window.visualViewport?.removeEventListener('resize', updatePosition);
      window.visualViewport?.removeEventListener('scroll', updatePosition);
    };
  }, [visible, onOpenChange]);

  const markRead = async (notificationId: string) => {
    if (busy(notificationId)) return;
    setActionError('');
    setPending((current) => [...current, notificationId]);
    try { await onMarkRead(notificationId); }
    catch { setActionError('읽음 처리에 실패했습니다. 다시 시도해 주세요.'); }
    finally { setPending((current) => current.filter((value) => value !== notificationId)); }
  };
  const markAllRead = async () => {
    if (!onMarkAllRead || pending.length || busyIds.length) return;
    setActionError('');
    setPending(['*']);
    try { await onMarkAllRead(); }
    catch { setActionError('읽음 처리에 실패했습니다. 다시 시도해 주세요.'); }
    finally { setPending([]); }
  };

  return <div className={`relative shrink-0 ${className}`}>
    <button ref={button} type="button" disabled={disabled} aria-label={`개인 알림${count > 0 ? `, 읽지 않은 알림 ${count}개` : ''}`} title="개인 알림" aria-expanded={visible} aria-controls={visible ? `${id}-panel` : undefined} onClick={() => {
      if (!visible) updatePosition();
      changeOpen(!visible);
      if (!visible) requestAnimationFrame(() => panel.current?.querySelector<HTMLButtonElement>('button')?.focus());
    }} onKeyDown={(event) => {
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        updatePosition();
        changeOpen(true);
        requestAnimationFrame(() => panel.current?.querySelector<HTMLButtonElement>('button')?.focus());
      }
    }} className="relative flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-slate-300 transition-colors hover:bg-white/10 hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-300 disabled:cursor-not-allowed disabled:opacity-40">
      <Bell size={18} aria-hidden="true" />
      {count > 0 && <span aria-hidden="true" className="absolute right-0 top-0 min-w-4 rounded-full bg-amber-300 px-1 text-center text-[10px] font-bold leading-4 text-slate-900 ring-2 ring-[#1A1C1E]">{count > 99 ? '99+' : count}</span>}
    </button>
    {visible && createPortal(<div ref={panel} id={`${id}-panel`} role="region" aria-label="개인 알림" style={position} className="fixed z-[180] flex flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white text-slate-800 shadow-2xl">
      <div className="flex shrink-0 items-center gap-2 border-b border-slate-100 px-4 py-3">
        <h2 className="min-w-0 flex-1 text-sm font-bold">개인 알림 <span className="ml-1 text-xs font-medium text-slate-500">{unavailable ? '준비 중' : count > 0 ? `${count}개 안 읽음` : loading ? '확인 중' : '모두 확인함'}</span></h2>
        <button type="button" aria-label="알림 닫기" onClick={() => changeOpen(false, true)} className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-700 ${focusClass}`}><X size={16} aria-hidden="true" /></button>
      </div>
      <div className="min-h-0 overflow-y-auto overscroll-contain">
        {unavailable ? <p role="status" className="px-4 py-6 text-sm leading-relaxed text-slate-500">개인 알림 기능 준비 중입니다.<br />기존 일정과 대화는 계속 이용할 수 있습니다.</p> : <>
          {(error || actionError) && <div role="alert" className="border-b border-amber-100 bg-amber-50 px-4 py-3 text-xs leading-relaxed text-amber-800"><p>{actionError || error}</p>{error && onRetry && <button type="button" onClick={onRetry} disabled={loading} className={`mt-1 inline-flex min-h-9 items-center gap-1 rounded font-semibold underline underline-offset-2 disabled:opacity-50 ${focusClass}`}><RefreshCw size={12} aria-hidden="true" />다시 시도</button>}</div>}
          {loading && <p role="status" className="flex items-center justify-center gap-2 px-4 py-4 text-xs text-slate-500"><LoaderCircle size={14} aria-hidden="true" className="animate-spin motion-reduce:animate-none" />알림을 불러오는 중입니다.</p>}
          {items.length > 0 ? <ul aria-label="받은 개인 알림" aria-busy={loading} className="divide-y divide-slate-100">{items.map((item) => {
            const unread = !item.read_at;
            const isSchedule = item.kind === 'schedule_attendee';
            return <li key={item.id} className={`flex items-start gap-1 px-2 py-1 ${unread ? 'bg-blue-50/60' : ''}`}>
              <button type="button" onClick={() => { changeOpen(false); onSelect(item); }} className={`flex min-h-16 min-w-0 flex-1 items-start gap-2 rounded-xl px-2 py-3 text-left hover:bg-slate-100/80 ${focusClass}`}>
                <span className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg ${unread ? 'bg-blue-100 text-blue-600' : 'bg-slate-100 text-slate-400'}`}>{isSchedule ? <CalendarDays size={14} aria-hidden="true" /> : <MessageCircle size={14} aria-hidden="true" />}</span>
                <span className="min-w-0 flex-1"><span className="mb-1 block text-[10px] font-semibold text-slate-500">{isSchedule ? '일정 참석' : '대화에서 나를 언급'}{unread && <span className="ml-1.5 text-blue-600">· 안 읽음</span>}</span><span className="block break-words text-xs font-bold leading-relaxed text-slate-800 [overflow-wrap:anywhere]">{item.title || (isSchedule ? '참석 일정' : '새로운 언급')}</span>{item.body && <span className="mt-0.5 line-clamp-2 block break-words text-xs leading-relaxed text-slate-500 [overflow-wrap:anywhere]">{item.body}</span>}<time dateTime={item.updated_at ?? item.created_at} className="mt-1 block text-[10px] text-slate-400">{formatTimestamp(item.updated_at ?? item.created_at)}</time></span>
              </button>
              {unread && <button type="button" disabled={busy(item.id)} aria-label={`${item.title || '알림'} 읽음으로 표시`} title="읽음으로 표시" onClick={() => void markRead(item.id)} className={`mt-3 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-slate-400 hover:bg-blue-100 hover:text-blue-700 disabled:cursor-wait disabled:opacity-40 ${focusClass}`}>{busy(item.id) ? <LoaderCircle size={14} aria-hidden="true" className="animate-spin motion-reduce:animate-none" /> : <Check size={15} aria-hidden="true" />}</button>}
            </li>;
          })}</ul> : !loading && !error && <p role="status" className="px-4 py-8 text-center text-sm leading-relaxed text-slate-500">아직 받은 알림이 없습니다.<span className="mt-1 block text-xs text-slate-400">참석 일정과 나를 언급한 대화를 알려드려요.</span></p>}
        </>}
      </div>
      {!unavailable && count > 0 && onMarkAllRead && <div className="shrink-0 border-t border-slate-100 px-3 py-2"><button type="button" disabled={loading || pending.length > 0 || busyIds.length > 0} onClick={() => void markAllRead()} className={`flex min-h-9 w-full items-center justify-center gap-1.5 rounded-lg text-xs font-semibold text-slate-600 hover:bg-slate-100 disabled:cursor-wait disabled:opacity-40 ${focusClass}`}><CheckCheck size={14} aria-hidden="true" />모두 읽음으로 표시</button></div>}
    </div>, document.body)}
  </div>;
}
