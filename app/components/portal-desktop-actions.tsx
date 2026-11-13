'use client';

import { useEffect, useRef, type ReactNode } from 'react';
import {
  ArrowUpRight,
  CalendarDays,
  FileBox,
  FileSpreadsheet,
  FolderSync,
  History,
  LayoutDashboard,
  MessageCircle,
  MonitorPlay,
  Search,
  ShieldCheck,
  X,
  Zap,
} from 'lucide-react';

type PortalView = 'files' | 'calendar' | 'external_calendar' | 'dashboard';

export interface PortalDesktopActionsProps {
  currentView: PortalView;
  onView: (view: PortalView) => void;
  onChat: () => void;
  onSearch: () => void;
  onQuickAdd: () => void;
  onKiosk: () => void;
  onHistory: () => void;
  onDevices: () => void;
  onCleanup: () => void;
  onExit: () => void;
  isAdmin: boolean;
  isChatOpen: boolean;
  hasUnread: boolean;
  hasNewSchedule: boolean;
  notificationControl?: ReactNode;
}

const focusClass = 'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-300';
const utilityClass = `flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-slate-400 transition-colors hover:bg-white/10 hover:text-white ${focusClass}`;
const externalClass = `flex h-9 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-xl border border-emerald-300/20 bg-emerald-400/[0.04] px-2.5 text-xs font-semibold text-emerald-100/85 transition-colors hover:border-emerald-300/40 hover:bg-emerald-400/10 hover:text-emerald-100 2xl:px-3 ${focusClass}`;
const adminActionClass = `flex min-h-10 w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-xs font-semibold text-slate-200 transition-colors hover:bg-white/10 hover:text-white ${focusClass}`;

export default function PortalDesktopActions(props: PortalDesktopActionsProps) {
  const adminMenu = useRef<HTMLDetailsElement>(null);

  useEffect(() => {
    const closeOutside = (event: PointerEvent) => {
      if (adminMenu.current && !adminMenu.current.contains(event.target as Node)) {
        adminMenu.current.open = false;
      }
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && adminMenu.current?.open) {
        adminMenu.current.open = false;
        adminMenu.current.querySelector('summary')?.focus();
      }
    };
    document.addEventListener('pointerdown', closeOutside);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('pointerdown', closeOutside);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, []);

  const runAdminAction = (action: () => void) => {
    if (adminMenu.current) adminMenu.current.open = false;
    action();
  };
  const navigationClass = (selected: boolean) =>
    `relative flex h-9 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-xl border px-2.5 text-xs font-semibold transition-colors 2xl:px-3 ${focusClass} ${selected
      ? 'border-sky-300/35 bg-sky-300/15 text-sky-100'
      : 'border-white/10 bg-white/[0.025] text-slate-300 hover:border-white/20 hover:bg-white/[0.07] hover:text-white'}`;
  const calendarSelected = props.currentView === 'calendar';
  const externalCalendarSelected = props.currentView === 'external_calendar';

  return (
    <div className="hidden shrink-0 items-center gap-2 xl:flex 2xl:gap-3" aria-label="포털 바로가기">
      <nav className="flex items-center gap-1.5" aria-label="외부 업무 링크">
        <a
          href="https://docs.google.com/spreadsheets/d/1yz_fMbsVe0__VJWe6F0ObbrV2jvnRotqi03-mrnnZUc/edit?usp=sharing"
          target="_blank"
          rel="noopener noreferrer"
          aria-label="홍보물품 반출대장 (새 탭)"
          title="홍보물품 반출대장 · 새 탭에서 열기"
          className={externalClass}
        >
          <FileBox size={14} aria-hidden="true" />
          <span>홍보물품 반출대장</span>
          <ArrowUpRight size={12} className="text-emerald-200/60" aria-hidden="true" />
        </a>
        <a
          href="https://docs.google.com/spreadsheets/d/1lDD-otVP5s7h-94deku3hLRF4buztn0lO0MBqzNN17M/edit?usp=sharing"
          target="_blank"
          rel="noopener noreferrer"
          aria-label="실적공유 (새 탭)"
          title="실적공유 · 새 탭에서 열기"
          className={externalClass}
        >
          <FileSpreadsheet size={14} aria-hidden="true" />
          <span>실적공유</span>
          <ArrowUpRight size={12} className="text-emerald-200/60" aria-hidden="true" />
        </a>
      </nav>

      <nav className="flex items-center gap-1.5" aria-label="포털 기능">
        <button
          type="button"
          aria-label={externalCalendarSelected ? '홈' : '손)일정확인'}
          aria-pressed={externalCalendarSelected && !props.isChatOpen}
          onClick={() => props.onView(externalCalendarSelected ? 'dashboard' : 'external_calendar')}
          className={navigationClass(externalCalendarSelected && !props.isChatOpen)}
        >
          {externalCalendarSelected ? <LayoutDashboard size={14} aria-hidden="true" /> : <CalendarDays size={14} aria-hidden="true" />}
          <span>{externalCalendarSelected ? '홈' : '손)일정확인'}</span>
        </button>
        <button
          type="button"
          aria-label={calendarSelected ? '홈' : '일정 공유'}
          aria-pressed={calendarSelected && !props.isChatOpen}
          onClick={() => props.onView(calendarSelected ? 'dashboard' : 'calendar')}
          className={navigationClass(calendarSelected && !props.isChatOpen)}
        >
          {calendarSelected ? <LayoutDashboard size={14} aria-hidden="true" /> : <CalendarDays size={14} aria-hidden="true" />}
          <span>{calendarSelected ? '홈' : '일정 공유'}</span>
          {props.hasNewSchedule && !calendarSelected && (
            <span className="absolute right-1.5 top-1.5 h-1.5 w-1.5 rounded-full bg-amber-300 ring-2 ring-[#1A1C1E]">
              <span className="sr-only">새 일정 있음</span>
            </span>
          )}
        </button>
        <button
          type="button"
          aria-label="정보공유방"
          aria-pressed={props.isChatOpen}
          onClick={props.onChat}
          className={navigationClass(props.isChatOpen)}
        >
          <MessageCircle size={14} aria-hidden="true" />
          <span>정보공유방</span>
          {props.hasUnread && !props.isChatOpen && (
            <span className="absolute right-1.5 top-1.5 h-1.5 w-1.5 rounded-full bg-amber-300 ring-2 ring-[#1A1C1E]">
              <span className="sr-only">읽지 않은 메시지 있음</span>
            </span>
          )}
        </button>
      </nav>

      <div className="flex items-center gap-0.5 rounded-xl border border-white/[0.08] bg-black/10 p-0.5" role="group" aria-label="포털 도구">
        {props.notificationControl}
        <button type="button" onClick={props.onSearch} aria-label="통합 검색" title="통합 검색 · Ctrl+K" className={utilityClass}>
          <Search size={16} aria-hidden="true" />
        </button>
        <button type="button" onClick={props.onQuickAdd} aria-label="빠른 일정 입력" title="빠른 일정 입력" className={utilityClass}>
          <Zap size={16} aria-hidden="true" />
        </button>
        <button type="button" onClick={props.onKiosk} aria-label="전광판 모드" title="전광판 모드 · 전광판 창에서 F8로 접기/복귀" className={utilityClass}>
          <MonitorPlay size={16} aria-hidden="true" />
        </button>
        {props.isAdmin && (
          <details ref={adminMenu} className="relative">
            <summary aria-label="관리 메뉴" title="관리 메뉴" className={`${utilityClass} cursor-pointer list-none [&::-webkit-details-marker]:hidden`}>
              <ShieldCheck size={16} aria-hidden="true" />
              <span className="sr-only">관리 메뉴</span>
            </summary>
            <div className="absolute right-0 top-full z-[110] mt-2 w-44 rounded-xl border border-white/15 bg-[#25282A] p-1.5 shadow-xl">
              <button type="button" className={adminActionClass} onClick={() => runAdminAction(props.onHistory)}><History size={15} aria-hidden="true" />변경 이력</button>
              <button type="button" className={adminActionClass} onClick={() => runAdminAction(props.onDevices)}><ShieldCheck size={15} aria-hidden="true" />승인 기기 관리</button>
              <button type="button" className={adminActionClass} onClick={() => runAdminAction(props.onCleanup)}><FolderSync size={15} aria-hidden="true" />연도 문서 정리</button>
            </div>
          </details>
        )}
        <span className="mx-0.5 h-3.5 w-px bg-white/10" aria-hidden="true" />
        <button type="button" onClick={props.onExit} aria-label="화면 나가기 (기기 승인 유지)" title="화면 나가기 · 기기 승인은 유지됩니다" className={utilityClass}>
          <X size={16} aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}
