'use client';

import { useState } from 'react';
import { ArrowUpRight, CalendarDays, Check, ChevronDown, Clock3, FileText, LoaderCircle, MapPin, RefreshCw, Users } from 'lucide-react';
import type { ImportantSchedule, ImportantSchedules } from '@/lib/use-important-schedules';

const formatter = new Intl.DateTimeFormat('ko-KR', { month: 'long', day: 'numeric', weekday: 'short', timeZone: 'UTC' });
const todayFormatter = new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit', timeZone: 'Asia/Seoul' });
const dayLabel = (day: string | null) => {
  if (!day) return '';
  const value = new Date(`${day}T00:00:00Z`);
  return Number.isNaN(value.getTime()) ? '' : formatter.format(value);
};
const rangeLabel = (item: ImportantSchedule) => [dayLabel(item.date), item.end_date !== item.date ? dayLabel(item.end_date) : ''].filter(Boolean).join(' ~ ');
const timeLabel = (item: ImportantSchedule) => {
  const start = item.start_time?.slice(0, 5);
  const end = item.end_time?.slice(0, 5);
  return start && end ? `${start}–${end}` : start ? `${start}부터` : end ? `${end}까지` : '';
};

export default function ImportantScheduleFeed({ feed, onOpenSchedule }: {
  feed?: ImportantSchedules;
  onOpenSchedule?: (scheduleId: number) => void | Promise<void>;
}) {
  const [busy, setBusy] = useState<number[]>([]);
  const [actionError, setActionError] = useState('');
  const [pastOpen, setPastOpen] = useState(false);
  const today = todayFormatter.format(new Date());
  const currentItems = (feed?.items ?? []).filter((item) => !item.read || !item.date || (item.end_date ?? item.date) >= today);
  const pastItems = (feed?.items ?? []).filter((item) => item.read && item.date && (item.end_date ?? item.date) < today);

  const act = async (item: ImportantSchedule, action: () => void | Promise<void>) => {
    if (busy.includes(item.schedule_id)) return;
    setActionError('');
    setBusy((items) => [...items, item.schedule_id]);
    try { await action(); }
    catch (error) { setActionError(error instanceof Error ? error.message : '다시 시도해 주세요.'); }
    finally { setBusy((items) => items.filter((id) => id !== item.schedule_id)); }
  };

  const card = (item: ImportantSchedule) => {
    const pending = busy.includes(item.schedule_id);
    const status = item.status === 'cancelled' ? '취소' : item.status === 'changed' ? '일정 변경' : null;
    const badge = item.status === 'cancelled' ? 'bg-rose-100 text-rose-800' : 'bg-amber-100 text-amber-900';
    const dates = rangeLabel(item);
    const times = timeLabel(item);
    const canOpen = item.source_available && onOpenSchedule;
    return <li key={item.schedule_id} className={`min-w-0 rounded-xl border bg-white px-3.5 py-3 shadow-sm sm:px-4 ${item.read ? 'border-slate-200' : 'border-blue-200'}`} data-important-schedule-id={item.schedule_id}>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs font-bold text-blue-800">
        {!item.read && <span className="inline-flex items-center gap-1 text-[11px]"><span className="h-1.5 w-1.5 rounded-full bg-blue-600" />안 읽음</span>}
        {status && <span className={`rounded-md px-1.5 py-0.5 text-[11px] font-bold ${badge}`}>{status}</span>}
        {dates && <span className={item.read ? 'text-slate-600' : ''}>{dates}</span>}
      </div>
      <h3 className="mt-1 text-[15px] font-extrabold leading-snug text-slate-900 [overflow-wrap:anywhere]">{item.title}</h3>
      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] font-medium leading-5 text-slate-600">
        {times && <span className="inline-flex items-center gap-1"><Clock3 size={13} aria-hidden="true" />{times}</span>}
        {item.location && <span className="inline-flex min-w-0 max-w-full items-start gap-1 [overflow-wrap:anywhere]"><MapPin className="mt-[3px] shrink-0" size={13} aria-hidden="true" />{item.location}</span>}
        {item.attendee_count > 0 && <span className="inline-flex items-center gap-1"><Users size={13} aria-hidden="true" />참석 {item.attendee_count}명</span>}
        {item.file_count > 0 && <span className="inline-flex items-center gap-1"><FileText size={13} aria-hidden="true" />자료 {item.file_count}개</span>}
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        {canOpen && <button type="button" disabled={pending} onClick={() => void act(item, async () => {
          await onOpenSchedule(item.schedule_id);
          if (!item.read) await feed?.markRead(item);
        })} className="inline-flex min-h-9 items-center gap-1.5 rounded-lg bg-blue-50 px-2.5 text-xs font-bold text-blue-800 hover:bg-blue-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 disabled:opacity-55">일정 보기<ArrowUpRight size={13} aria-hidden="true" /></button>}
        {!item.read && <button type="button" disabled={pending} onClick={() => void act(item, async () => { await feed?.markRead(item); })} className="inline-flex min-h-9 items-center gap-1 rounded-lg px-2 text-xs font-semibold text-slate-600 hover:bg-slate-100 focus-visible:outline-2 focus-visible:outline-blue-600 disabled:opacity-55"><Check size={14} aria-hidden="true" />읽음</button>}
        {item.can_withdraw && <button type="button" disabled={pending} onClick={() => {
          if (window.confirm('공유방에서 이 게시물을 내리시겠습니까? 원본 일정은 그대로 남습니다.')) void act(item, async () => { await feed?.withdraw(item.schedule_id); });
        }} className="ml-auto min-h-9 rounded-lg px-2 text-xs font-semibold text-slate-600 hover:bg-slate-100 focus-visible:outline-2 focus-visible:outline-blue-600 disabled:opacity-55">공유 내리기</button>}
      </div>
    </li>;
  };

  return <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain bg-slate-50 px-3.5 py-3.5 sm:px-4" data-important-schedule-feed>
    <div className="mb-3 flex items-center justify-between gap-3">
      <p className="text-xs font-semibold leading-snug text-slate-600">일정 상세에서 공유한 항목만 표시합니다.</p>
      <button aria-label="중요 일정 새로고침" type="button" disabled={feed?.loading || !feed} onClick={() => void feed?.refresh()} className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-600 hover:bg-slate-100 focus-visible:outline-2 focus-visible:outline-blue-600 disabled:opacity-50"><RefreshCw size={14} aria-hidden="true" /></button>
    </div>
    {(actionError || feed?.error) && <p role="alert" className="mb-3 rounded-lg bg-amber-50 px-3 py-2 text-sm leading-relaxed text-amber-900">{actionError || feed?.error}</p>}
    {feed?.loading && !feed.items.length ? <p role="status" className="flex items-center gap-2 px-1 py-5 text-sm text-slate-600"><LoaderCircle size={16} className="animate-spin motion-reduce:animate-none" aria-hidden="true" />중요 일정을 불러오는 중입니다.</p>
      : !feed?.available && !feed?.error ? <p role="status" className="rounded-xl border border-dashed border-slate-300 bg-white px-4 py-6 text-sm leading-relaxed text-slate-600">중요 일정 연결을 준비 중입니다. 정보 공유는 계속 이용할 수 있습니다.</p>
        : !currentItems.length && !pastItems.length && !feed?.error && <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-slate-300 bg-white px-4 py-9 text-center"><CalendarDays size={24} aria-hidden="true" className="text-blue-500" /><p className="text-sm font-bold text-slate-700">아직 공유된 중요 일정이 없습니다.</p></div>}
    {currentItems.length > 0 && <ul aria-label="현재 중요 일정" className="space-y-2.5">{currentItems.map(card)}</ul>}
    {pastItems.length > 0 && <div className="mt-4 border-t border-slate-200 pt-2"><button type="button" onClick={() => setPastOpen(!pastOpen)} aria-expanded={pastOpen} className="flex min-h-10 w-full items-center gap-2 rounded-lg px-2 text-left text-sm font-bold text-slate-700 hover:bg-slate-100 focus-visible:outline-2 focus-visible:outline-blue-600">지난 일정 <span className="text-xs font-semibold text-slate-500">{pastItems.length}</span><ChevronDown size={15} aria-hidden="true" className={`ml-auto ${pastOpen ? 'rotate-180' : ''}`} /></button>{pastOpen && <ul aria-label="지난 중요 일정" className="mt-2 space-y-2.5">{pastItems.map(card)}</ul>}</div>}
  </div>;
}
