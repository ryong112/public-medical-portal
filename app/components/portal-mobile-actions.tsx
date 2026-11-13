'use client';

import { useEffect, useRef } from 'react';
import { CalendarDays, FolderOpen, MoreHorizontal } from 'lucide-react';

type View = 'files' | 'calendar' | 'external_calendar' | 'dashboard';
interface Props {
  view: View;
  onView: (view: View) => void;
  onChat: () => void;
  onSearch: () => void;
  onQuickAdd: () => void;
  onKiosk: () => void;
  onHistory: () => void;
  onDevices: () => void;
  onCleanup: () => void;
  onExit: () => void;
  isAdmin: boolean;
}

export default function PortalMobileActions(props: Props) {
  const menu = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    const outside = (event: PointerEvent) => {
      if (menu.current && !menu.current.contains(event.target as Node)) menu.current.open = false;
    };
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape' && menu.current?.open) { menu.current.open = false; menu.current.querySelector('summary')?.focus(); } };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', escape);
    return () => { document.removeEventListener('pointerdown', outside); document.removeEventListener('keydown', escape); };
  }, []);
  const run = (action: () => void) => { if (menu.current) menu.current.open = false; action(); };
  const actionClass = 'min-h-11 w-full rounded-lg px-3 py-2 text-left text-sm font-bold text-slate-800 hover:bg-blue-50 focus-visible:outline-blue-500';
  return <div className="flex shrink-0 items-center gap-1 xl:hidden">
    <button aria-label={props.view === 'calendar' ? '홈' : '일정 공유'} onClick={() => props.onView(props.view === 'calendar' ? 'dashboard' : 'calendar')} className="flex min-h-11 items-center gap-1 rounded-xl bg-white px-2 text-xs font-bold text-slate-900"><CalendarDays size={16} /><span>{props.view === 'calendar' ? '홈' : '일정'}</span></button>
    <button aria-label="문서함" onClick={() => props.onView('files')} className="flex min-h-11 items-center gap-1 rounded-xl px-2 text-xs font-bold text-white hover:bg-white/10"><FolderOpen size={16} /><span>문서</span></button>
    <details ref={menu} className="relative">
      <summary aria-label="더보기 메뉴" className="flex min-h-11 cursor-pointer list-none items-center rounded-xl px-2 text-white hover:bg-white/10 [&::-webkit-details-marker]:hidden"><MoreHorizontal size={22} /><span className="sr-only">더보기</span></summary>
      <div className="absolute right-0 top-full z-[100] mt-2 max-h-[75dvh] w-60 overflow-y-auto rounded-2xl border border-slate-200 bg-white p-2 text-slate-800 shadow-2xl">
        <button className={actionClass} onClick={() => run(() => props.onView('dashboard'))}>홈</button>
        <button className={actionClass} onClick={() => run(props.onSearch)}>통합 검색</button>
        <button className={actionClass} onClick={() => run(props.onQuickAdd)}>빠른 일정 입력</button>
        <button className={actionClass} onClick={() => run(props.onChat)}>정보공유방</button>
        <button className={actionClass} onClick={() => run(props.onKiosk)}>전광판 모드</button>
        <button className={actionClass} onClick={() => run(() => props.onView('external_calendar'))}>손)일정확인</button>
        <a className={`${actionClass} flex items-center`} href="https://docs.google.com/spreadsheets/d/1yz_fMbsVe0__VJWe6F0ObbrV2jvnRotqi03-mrnnZUc/edit?usp=sharing" target="_blank" rel="noopener noreferrer">홍보물품 반출대장 ↗</a>
        <a className={`${actionClass} flex items-center`} href="https://docs.google.com/spreadsheets/d/1lDD-otVP5s7h-94deku3hLRF4buztn0lO0MBqzNN17M/edit?usp=sharing" target="_blank" rel="noopener noreferrer">실적공유 ↗</a>
        {props.isAdmin && <div className="mt-1 border-t border-slate-200 pt-1">
          <button className={actionClass} onClick={() => run(props.onHistory)}>변경 이력</button>
          <button className={actionClass} onClick={() => run(props.onDevices)}>승인 기기 관리</button>
          <button className={actionClass} onClick={() => run(props.onCleanup)}>연도 문서 정리</button>
        </div>}
        <button className={actionClass} onClick={() => run(props.onExit)}>화면 나가기 · 승인 유지</button>
      </div>
    </details>
  </div>;
}
