'use client';

import { ChevronDown, ChevronUp, ExternalLink, Eye, LoaderCircle, Megaphone, X } from 'lucide-react';
import type { TeamChatNotice } from '@/lib/team-chat-notice';
export type { TeamChatNotice } from '@/lib/team-chat-notice';

interface ChatNoticeCardProps {
  notice: TeamChatNotice;
  collapsed: boolean;
  hidden: boolean;
  busy: boolean;
  canOpenSource: boolean;
  onPreference: (collapsed: boolean, hidden: boolean) => void;
  onOpenSource: () => void;
  onRemove?: () => void;
}

/** Fixed inside the chat window; personal visibility never changes the shared notice. */
export default function ChatNoticeCard({ notice, collapsed, hidden, busy, canOpenSource, onPreference, onOpenSource, onRemove }: ChatNoticeCardProps) {
  if (hidden) return <section aria-label="고정 공지" data-chat-notice data-chat-notice-state="hidden" className="flex shrink-0 items-center justify-between gap-2 border-b border-amber-200 bg-amber-50 px-4 py-2">
    <span className="flex min-w-0 items-center gap-1.5 text-xs font-semibold text-amber-900"><Megaphone size={14} className="shrink-0" />공지 숨김</span>
    <button type="button" disabled={busy} onClick={() => onPreference(collapsed, false)} className="inline-flex min-h-7 shrink-0 items-center gap-1 rounded-lg px-2 text-xs font-bold text-amber-900 hover:bg-amber-100 focus-visible:outline-2 focus-visible:outline-amber-600 disabled:opacity-50"><Eye size={13} />공지 다시 보기</button>
  </section>;

  return <section aria-label="고정 공지" aria-busy={busy} data-chat-notice data-chat-notice-state={collapsed ? 'collapsed' : 'expanded'} className="flex max-h-[32%] min-h-0 shrink-0 flex-col border-b border-amber-200 bg-amber-50 text-amber-950">
    <div className="flex min-h-10 shrink-0 items-center gap-2 px-4 py-1.5">
      <Megaphone size={16} className="shrink-0 text-amber-700" aria-hidden="true" />
      <span className="shrink-0 text-xs font-black">공지</span>
      {collapsed ? <p className="min-w-0 flex-1 truncate text-xs font-semibold" title={notice.content}>{notice.content}</p> : <span className="min-w-0 flex-1 truncate text-[10px] font-medium text-amber-800">{notice.author_name}</span>}
      {busy && <LoaderCircle size={13} className="shrink-0 animate-spin text-amber-700 motion-reduce:animate-none" aria-label="공지 처리 중" />}
      <button type="button" disabled={busy} onClick={() => onPreference(!collapsed, false)} aria-label={collapsed ? '공지 펼치기' : '공지 접기'} title={collapsed ? '공지 펼치기' : '내 화면에서 접기'} className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-amber-800 hover:bg-amber-100 focus-visible:outline-2 focus-visible:outline-amber-600 disabled:opacity-40">{collapsed ? <ChevronDown size={16} /> : <ChevronUp size={16} />}</button>
      <button type="button" disabled={busy} onClick={() => onPreference(collapsed, true)} aria-label="내 화면에서 공지 숨기기" title="내 화면에서만 숨기기" className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-amber-800 hover:bg-amber-100 focus-visible:outline-2 focus-visible:outline-amber-600 disabled:opacity-40"><X size={15} /></button>
    </div>
    {!collapsed && <>
      <div data-chat-notice-content className="min-h-0 overflow-y-auto overscroll-contain px-4 pb-1 text-[13px] font-semibold leading-relaxed whitespace-pre-wrap [overflow-wrap:anywhere]">{notice.content}</div>
      <div className="flex shrink-0 items-center justify-between gap-2 px-3 pb-1.5 pt-1">
        <button type="button" disabled={!canOpenSource} onClick={onOpenSource} aria-label="공지 원문 보기" className="inline-flex min-h-6 items-center gap-1 rounded-md px-1 text-[10px] font-semibold text-amber-800 hover:bg-amber-100 focus-visible:outline-2 focus-visible:outline-amber-600 disabled:cursor-not-allowed disabled:opacity-40">원문 보기<ExternalLink size={10} /></button>
        {notice.can_remove && onRemove && <button type="button" disabled={busy} onClick={onRemove} className="min-h-6 rounded-md px-1 text-[10px] font-semibold text-slate-600 hover:bg-red-50 hover:text-red-700 focus-visible:outline-2 focus-visible:outline-red-500 disabled:opacity-40">전체 공지 종료</button>}
      </div>
    </>}
  </section>;
}
