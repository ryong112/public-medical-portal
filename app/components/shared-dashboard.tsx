'use client';

import { useEffect, useRef, useState } from 'react';
import { getScheduleCategory, scheduleCategoryStyles, type ScheduleCategory } from '@/lib/schedule-category';
import { type DashboardSchedule as Schedule, formatScheduleDateRange, formatScheduleTime, getAbsenceTypeLabel, getDashboardTodos, getScheduleEndDate, getTodoStatus, scheduleOccursOn, scheduleOverlaps, shiftDateKey, toLocalDateKey } from '@/lib/dashboard-schedules';
import { ArrowUpRight, BellRing, CalendarDays, Check, ChevronLeft, ChevronRight, FolderOpen, MessageCircle, MoreHorizontal, Printer, Siren, X } from 'lucide-react';
import styles from './shared-dashboard.module.css';

type DashboardView = 'files' | 'calendar' | 'external_calendar' | 'dashboard';
type ScheduleFilter = 'all' | ScheduleCategory;
type DetailKey = 'todo' | 'notice' | 'week' | 'absence';
interface SharedDashboardProps {
  schedules: Schedule[];
  onChangeView: (view: DashboardView) => void;
  onOpenChat: () => void;
  onOpenSchedule: (schedule: Schedule) => void;
  onToggleScheduleComplete: (schedule: Schedule) => void;
  onOpenAbsenceBoard?: () => void;
  onPrintWeek?: () => void;
}
const filters: Array<{ value: ScheduleFilter; label: string }> = [
  { value: 'all', label: '전체' }, { value: 'general', label: '일반' },
  { value: 'internal', label: '내부일정' }, { value: 'business_trip', label: '출장' },
  { value: 'meeting', label: '회의' }, { value: 'leave', label: '휴가' },
];
const sortSchedules = (a: Schedule, b: Schedule) => a.date.localeCompare(b.date)
  || (a.start_time ?? a.end_time ?? '99:99').localeCompare(b.start_time ?? b.end_time ?? '99:99') || a.id - b.id;
const cleanTitle = (title: string) => title.replace(/^(?:회의|출장|내부일정|휴가|연차|조퇴|외출)\s*[)）]\s*/u, '').trim();
const shortDate = (key: string) => `${Number(key.slice(5, 7))}.${Number(key.slice(8, 10))}`;
const absencePeople = (items: Schedule[]) => [...new Set(items.flatMap((schedule) => {
  if (schedule.owner_name?.trim()) return [schedule.owner_name.trim()];
  const names = schedule.title.replace(/^(?:휴가|연차|오전\s*조퇴|오후\s*조퇴|조퇴|외출)\s*[-:：)）]?\s*/u, '')
    .split(/[,，/·]+/u).map((name) => name.trim()).filter(Boolean);
  return names.length ? names : [schedule.title];
}))];

interface ListProps {
  items: Schedule[];
  label: string;
  listKey: 'today' | 'tomorrow' | 'detail';
  today: string;
  showDate?: boolean;
  onOpen: (schedule: Schedule) => void;
  onComplete: (schedule: Schedule) => void;
}
function SchedulePages({ items, label, listKey, today, showDate = false, onOpen, onComplete }: ListProps) {
  const viewport = useRef<HTMLDivElement>(null);
  const [pageSize, setPageSize] = useState(1);
  const [page, setPage] = useState(0);
  useEffect(() => {
    const element = viewport.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => {
      const rowHeight = Number.parseFloat(getComputedStyle(element).getPropertyValue('--dashboard-row-height')) || 64;
      setPageSize(Math.max(1, Math.floor((entry.contentRect.height + 6) / (rowHeight + 6))));
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const pages = Math.max(1, Math.ceil(items.length / pageSize));
  const visiblePage = Math.min(page, pages - 1);
  const rows = items.slice(visiblePage * pageSize, (visiblePage + 1) * pageSize);
  return <div className={styles.pagedList}>
    <div ref={viewport} data-dashboard-list={listKey} className={styles.listViewport}>
      {rows.length ? rows.map((schedule) => {
        const category = getScheduleCategory(schedule);
        const tone = scheduleCategoryStyles[category];
        const title = cleanTitle(schedule.title);
        const time = formatScheduleTime({ start_time: schedule.start_time?.slice(0, 5) ?? null, end_time: schedule.end_time?.slice(0, 5) ?? null });
        const details = [category === 'leave' ? getAbsenceTypeLabel(schedule) : '', showDate ? formatScheduleDateRange(schedule) : '', schedule.owner_name && `담당 ${schedule.owner_name}`, schedule.location].filter(Boolean).join(' · ');
        const status = getTodoStatus(schedule, today);
        return <div key={schedule.id} data-schedule-id={schedule.id} data-schedule-category={category} className={`${styles.scheduleRow} border-l-4 ${tone.accent} ${schedule.is_completed ? styles.completed : ''}`}>
          {schedule.is_todo && <button type="button" aria-label={`${schedule.title} ${schedule.is_completed ? '완료 취소' : '완료 처리'}`} aria-pressed={Boolean(schedule.is_completed)} className={`${styles.completeButton} ${schedule.is_completed ? styles.checked : ''}`} onClick={() => onComplete(schedule)}><Check size={17} /></button>}
          <button type="button" onClick={() => onOpen(schedule)} aria-label={[tone.label, schedule.title, time, details].filter(Boolean).join(' · ')} title={[schedule.title, time, details].filter(Boolean).join(' · ')} className={styles.scheduleButton}>
            <span className={styles.titleLine}>
              {schedule.is_urgent && <span className={styles.urgent} aria-label="긴급"><Siren size={13} /><span>긴급</span></span>}
              {schedule.is_notice && <span className={styles.notice} aria-label="공지"><BellRing size={13} /></span>}
              {schedule.is_todo && status === '기한 지남' && <span className={styles.overdue}>지연</span>}
              <span className={styles.eventTitle}>{title}</span>
            </span>
            <span className={styles.metadata}><span className={tone.time}>{time}</span>{details && <span className={styles.eventDetails}>{details}</span>}</span>
          </button>
        </div>;
      }) : <p className={styles.empty}>{label === '오늘 일정' ? '오늘은 일정이 없습니다.' : label === '내일 일정' ? '내일은 일정이 없습니다.' : '등록된 일정이 없습니다.'}</p>}
    </div>
    <nav className={styles.pagination} aria-label={`${label} 페이지`}>
      <span className={styles.pageCount} aria-live="polite">{items.length ? `${visiblePage + 1} / ${pages}` : '0건'}</span>
      <button type="button" aria-label={`${label} 이전 페이지`} disabled={visiblePage === 0} onClick={() => setPage(visiblePage - 1)}><ChevronLeft size={17} /></button>
      <button type="button" aria-label={`${label} 다음 페이지`} disabled={visiblePage >= pages - 1} onClick={() => setPage(visiblePage + 1)}><ChevronRight size={17} /></button>
    </nav>
  </div>;
}

interface SummaryDetailProps {
  title: string;
  items: Schedule[];
  today: string;
  onClose: () => void;
  onOpen: (schedule: Schedule) => void;
  onComplete: (schedule: Schedule) => void;
  onAbsenceBoard?: () => void;
}
function SummaryDetail({ title, items, today, onClose, onOpen, onComplete, onAbsenceBoard }: SummaryDetailProps) {
  const dialog = useRef<HTMLDialogElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  const restoreFrame = useRef<number | null>(null);
  useEffect(() => {
    if (restoreFrame.current !== null) cancelAnimationFrame(restoreFrame.current);
    const element = dialog.current;
    if (!opener.current) opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    element?.showModal();
    return () => {
      element?.close();
      restoreFrame.current = requestAnimationFrame(() => {
        if (document.querySelector('dialog[open]')) return;
        const nextDialog = Array.from(document.querySelectorAll<HTMLElement>('[role="dialog"][aria-modal="true"]'))
          .find((target) => target.getClientRects().length && !target.closest('[inert]'));
        if (nextDialog) {
          if (!nextDialog.contains(document.activeElement)) nextDialog.querySelector<HTMLElement>('button:not([disabled]), input:not([disabled]), [tabindex="0"]')?.focus();
        } else if (opener.current?.isConnected && !opener.current.closest('[inert]')) opener.current.focus();
      });
    };
  }, []);
  return <dialog ref={dialog} className={styles.detailDialog} aria-label={`${title} 상세`} onCancel={(event) => { event.preventDefault(); onClose(); }}>
    <header className={styles.dialogHeader}><h2>{title}<span>{items.length}건</span></h2><div className={styles.dialogActions}>{onAbsenceBoard && <button type="button" className={styles.boardButton} onClick={onAbsenceBoard}>휴가 현황</button>}<button type="button" aria-label="상세 닫기" onClick={onClose} autoFocus><X size={20} /></button></div></header>
    <SchedulePages items={items} label={title} listKey="detail" today={today} showDate onOpen={onOpen} onComplete={onComplete} />
  </dialog>;
}

export default function SharedDashboard({ schedules, onChangeView, onOpenChat, onOpenSchedule, onToggleScheduleComplete, onOpenAbsenceBoard, onPrintWeek }: SharedDashboardProps) {
  const [filter, setFilter] = useState<ScheduleFilter>('all');
  const [detailKey, setDetailKey] = useState<DetailKey | null>(null);
  const menu = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    const outside = (event: PointerEvent) => { if (menu.current && !menu.current.contains(event.target as Node)) menu.current.open = false; };
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape' && menu.current?.open) { menu.current.open = false; menu.current.querySelector('summary')?.focus(); } };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', escape);
    return () => { document.removeEventListener('pointerdown', outside); document.removeEventListener('keydown', escape); };
  }, []);
  const now = new Date();
  const today = toLocalDateKey(now);
  const tomorrow = shiftDateKey(today, 1);
  const weekEnd = shiftDateKey(today, 6);
  const monthStart = `${today.slice(0, 7)}-01`;
  const monthEnd = toLocalDateKey(new Date(now.getFullYear(), now.getMonth() + 1, 0));
  const filtered = schedules.filter((schedule) => filter === 'all' || getScheduleCategory(schedule) === filter);
  const todayItems = filtered.filter((schedule) => scheduleOccursOn(schedule, today)).sort(sortSchedules);
  const tomorrowItems = filtered.filter((schedule) => scheduleOccursOn(schedule, tomorrow)).sort(sortSchedules);
  const todos = getDashboardTodos(filtered, today);
  const pendingTodos = todos.filter((schedule) => !schedule.is_completed);
  const overdue = pendingTodos.filter((schedule) => getScheduleEndDate(schedule) < today).length;
  const notices = filtered.filter((schedule) => schedule.is_notice && getScheduleEndDate(schedule) >= today).sort(sortSchedules);
  const week = filtered.filter((schedule) => scheduleOverlaps(schedule, today, weekEnd)).sort(sortSchedules);
  const absences = filtered.filter((schedule) => getScheduleCategory(schedule) === 'leave' && scheduleOverlaps(schedule, monthStart, monthEnd)).sort(sortSchedules);
  const todayAbsences = absencePeople(absences.filter((schedule) => scheduleOccursOn(schedule, today)));
  const cards = [
    { key: 'todo' as const, label: '할 일', count: pendingTodos.length, unit: '건', icon: <Check size={16} />, items: todos, note: overdue ? `지연 ${overdue}건` : `완료 ${todos.length - pendingTodos.length}건`, range: '' },
    { key: 'notice' as const, label: '공지사항', count: notices.length, unit: '건', icon: <BellRing size={16} />, items: notices, note: '', range: '' },
    { key: 'week' as const, label: '주간 일정', count: week.length, unit: '건', icon: <CalendarDays size={16} />, items: week, note: '', range: `${shortDate(today)}–${shortDate(weekEnd)}` },
    { key: 'absence' as const, label: '이번 달 휴가', count: absencePeople(absences).length, unit: '명', icon: <CalendarDays size={16} />, items: absences, note: todayAbsences.length ? `오늘 ${todayAbsences.join(', ')}` : '오늘 없음', range: '' },
  ];
  const selected = cards.find((card) => card.key === detailKey);
  const openSchedule = (schedule: Schedule) => { setDetailKey(null); onOpenSchedule(schedule); };
  const runMenu = (action: () => void) => { if (menu.current) menu.current.open = false; action(); };

  return <div data-dashboard-root className={styles.dashboard}>
    <header className={styles.header}>
      <div className={styles.heading}><h2>공공의료지원과 일정</h2><time dateTime={today}>{new Intl.DateTimeFormat('ko-KR', { month: 'long', day: 'numeric', weekday: 'short' }).format(now)}</time></div>
      <div className={styles.filters} role="group" aria-label="일정 유형">
        {filters.map(({ value, label }) => <button type="button" key={value} data-dashboard-filter={value} data-schedule-category={value} aria-pressed={filter === value} onClick={() => { setFilter(value); setDetailKey(null); }} className={`${styles.filterButton} ${value === 'all' ? filter === value ? styles.allActive : styles.allInactive : filter === value ? scheduleCategoryStyles[value].filterActive : scheduleCategoryStyles[value].filter}`}>
          {value !== 'all' && <span aria-hidden="true" className={`h-2 w-2 shrink-0 rounded-full ${scheduleCategoryStyles[value].dot}`} />}{label}
        </button>)}
      </div>
      <div className={styles.headerActions}>
        {onPrintWeek && <button type="button" aria-label="주간 인쇄" title="주간 인쇄" onClick={onPrintWeek}><Printer size={18} /></button>}
        <details ref={menu} className={styles.tools}>
          <summary aria-label="대시보드 메뉴" title="더보기"><MoreHorizontal size={20} /></summary>
          <div className={styles.toolsMenu}>
            <button type="button" onClick={() => runMenu(() => onChangeView('files'))}><FolderOpen size={16} />문서함</button>
            <button type="button" onClick={() => runMenu(() => onChangeView('calendar'))}><CalendarDays size={16} />달력 보기</button>
            <button type="button" onClick={() => runMenu(onOpenChat)}><MessageCircle size={16} />공유방</button>
          </div>
        </details>
      </div>
    </header>
    <section className={styles.summaries} aria-label="일정 요약">
      {cards.map((card) => <section key={card.key} data-dashboard-summary={card.key} className={styles.summaryCard}>
        <button type="button" aria-label={`${card.label} ${card.count}${card.unit} 상세 보기`} aria-haspopup="dialog" aria-expanded={detailKey === card.key} title={card.key === 'week' ? `${today}부터 ${weekEnd}까지` : card.note || undefined} onClick={() => setDetailKey(card.key)}>
          <span className={styles.summaryHeading}>{card.icon}<h3>{card.label}</h3>{card.range && <span className={styles.range}>{card.range}</span>}<ArrowUpRight size={14} className={styles.summaryArrow} /></span>
          <span className={styles.summaryValue}><strong data-dashboard-count>{card.count}</strong><span>{card.unit}</span>{card.note && <span className={styles.summaryNote} title={card.note}>{card.note}</span>}</span>
        </button>
      </section>)}
    </section>
    <section className={styles.days} aria-label="오늘과 내일 일정">
      {[{ key: 'today' as const, label: '오늘 일정', date: today, items: todayItems }, { key: 'tomorrow' as const, label: '내일 일정', date: tomorrow, items: tomorrowItems }].map((day) => <section key={day.key} data-dashboard-day={day.key} className={styles.dayPanel}>
        <header className={styles.dayHeading}><h3>{day.label}<span data-dashboard-count>{day.items.length}</span></h3><time dateTime={day.date}>{shortDate(day.date)}</time><button type="button" aria-label={`${day.label} 달력 보기`} title="달력 보기" onClick={() => onChangeView('calendar')}><ArrowUpRight size={16} /></button></header>
        <SchedulePages key={`${day.key}:${filter}`} items={day.items} label={day.label} listKey={day.key} today={today} onOpen={onOpenSchedule} onComplete={onToggleScheduleComplete} />
      </section>)}
    </section>
    {selected && <SummaryDetail key={`${selected.key}:${filter}`} title={selected.label} items={selected.items} today={today} onClose={() => setDetailKey(null)} onOpen={openSchedule} onComplete={onToggleScheduleComplete} onAbsenceBoard={selected.key === 'absence' && onOpenAbsenceBoard ? () => { setDetailKey(null); onOpenAbsenceBoard(); } : undefined} />}
  </div>;
}
