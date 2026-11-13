'use client';

import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { getScheduleCategory, scheduleCategoryStyles, type ScheduleCategory } from '@/lib/schedule-category';
import { type DashboardSchedule as Schedule, formatScheduleDateRange, formatScheduleTime, getAbsenceTypeLabel, getDashboardTodos, getScheduleEndDate, getSevenDayKeys, getTodoStatus, scheduleOccursOn, scheduleOverlaps, shiftDateKey, toLocalDateKey } from '@/lib/dashboard-schedules';
import { ArrowUpRight, BellRing, CalendarDays, Check, ChevronLeft, ChevronRight, FolderOpen, MessageCircle, MoreHorizontal, Pause, Play, Printer, Siren, X } from 'lucide-react';
import AnchoredPreview, { useAnchoredPreview } from './anchored-preview';
import AbsenceMiniCalendar from './absence-mini-calendar';
import WeeklyDayTile from './weekly-day-tile';
import { collectAbsencePersonEntries, getAbsencePeople, type AbsenceMember } from '@/lib/absence-calendar';
import { consumePreviewWheel, createPreviewWheelGesture, getPreviewPageWindow, normalizePreviewWheel } from '@/lib/preview-pagination';
import { getDayProximityLabel, getScheduleProximityLabel } from '@/lib/schedule-proximity';
import styles from './shared-dashboard.module.css';

type DashboardView = 'files' | 'calendar' | 'external_calendar' | 'dashboard';
type DetailKey = 'todo' | 'notice' | 'week' | 'absence' | 'today-absence' | `date:${string}`;
interface SharedDashboardProps {
  schedules: Schedule[];
  members?: AbsenceMember[];
  holidaysByDate?: Record<string, string[]>;
  onChangeView: (view: DashboardView) => void;
  onOpenChat: () => void;
  onOpenSchedule: (schedule: Schedule) => void;
  onToggleScheduleComplete: (schedule: Schedule) => void;
  onOpenAbsenceBoard?: () => void;
  onPrintWeek?: () => void;
  onOpenCalendarDate?: (date: string) => void;
}
const categoryLegend: Array<{ value: ScheduleCategory; label: string }> = [
  { value: 'general', label: '일반' },
  { value: 'internal', label: '내부일정' }, { value: 'business_trip', label: '출장' },
  { value: 'meeting', label: '회의' }, { value: 'leave', label: '휴가' },
];
const sortSchedules = (a: Schedule, b: Schedule) => a.date.localeCompare(b.date)
  || (a.start_time ?? a.end_time ?? '99:99').localeCompare(b.start_time ?? b.end_time ?? '99:99') || a.id - b.id;
const cleanTitle = (title: string) => title.replace(/^(?:회의|출장|내부일정|휴가|연차|조퇴|외출)\s*[)）]\s*/u, '').trim();
const shortDate = (key: string) => `${Number(key.slice(5, 7))}.${Number(key.slice(8, 10))}`;
const absencePeople = (items: Schedule[], members: AbsenceMember[]) => collectAbsencePersonEntries(items, members).map((person) => person.label);
const weekdayDate = (date: string, compact = false) => `${compact ? Number(date.slice(8)) : shortDate(date)}(${new Intl.DateTimeFormat('ko-KR', { weekday: 'short' }).format(new Date(`${date}T12:00:00`))})`;
const absenceDates = (schedule: Schedule) => {
  const end = getScheduleEndDate(schedule);
  return schedule.date === end ? weekdayDate(schedule.date) : `${weekdayDate(schedule.date)}–${weekdayDate(end, schedule.date.slice(0, 7) === end.slice(0, 7))}`;
};

interface ListProps {
  items: Schedule[];
  label: string;
  listKey: 'today' | 'tomorrow' | 'detail';
  today: string;
  showDate?: boolean;
  showProximity?: boolean;
  proximityDate?: string;
  onOpen: (schedule: Schedule) => void;
  onComplete: (schedule: Schedule) => void;
  navigation?: 'arrows' | 'dots';
}
function SchedulePages({ items, label, listKey, today, showDate = false, showProximity = false, proximityDate, onOpen, onComplete, navigation = 'arrows' }: ListProps) {
  const list = useRef<HTMLDivElement>(null);
  const viewport = useRef<HTMLDivElement>(null);
  const [pageSize, setPageSize] = useState(1);
  const [page, setPage] = useState(0);
  const [dotLimit, setDotLimit] = useState(7);
  const wheelGesture = useRef(createPreviewWheelGesture());
  useEffect(() => {
    const element = list.current;
    if (!element) return;
    const measure = (height: number) => {
      const css = getComputedStyle(element);
      const rowHeight = Number.parseFloat(css.getPropertyValue('--dashboard-row-height')) || 64;
      const navigationHeight = Number.parseFloat(css.getPropertyValue('--dashboard-nav-height')) || 32;
      const withoutNavigation = Math.max(1, Math.floor((height + 6.5) / (rowHeight + 6)));
      // Measure the fixed outer list allocation, not the viewport after navigation
      // renders. This keeps pagination stable when its controls appear/disappear.
      const usableHeight = height - (navigation === 'arrows' && items.length > withoutNavigation ? navigationHeight : 0);
      setPageSize(Math.max(1, Math.floor((usableHeight + 6.5) / (rowHeight + 6))));
      setDotLimit(Math.min(7, Math.max(3, Math.floor((height - 22) / 24))));
    };
    const observer = new ResizeObserver(([entry]) => measure(entry.contentRect.height));
    let resizeFrame: number | null = null;
    const resized = () => {
      if (resizeFrame !== null) cancelAnimationFrame(resizeFrame);
      // Media queries can change row density without changing the list's box.
      resizeFrame = requestAnimationFrame(() => { resizeFrame = null; measure(element.clientHeight); });
    };
    observer.observe(element);
    window.addEventListener('resize', resized);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', resized);
      if (resizeFrame !== null) cancelAnimationFrame(resizeFrame);
    };
  }, [items.length, navigation]);
  const pages = Math.max(1, Math.ceil(items.length / pageSize));
  const visiblePage = Math.min(page, pages - 1);
  const rows = items.slice(visiblePage * pageSize, (visiblePage + 1) * pageSize);
  useEffect(() => {
    const element = list.current;
    if (!element || navigation !== 'dots' || pages < 2) return;
    const wheel = (event: WheelEvent) => {
      if (event.ctrlKey || Math.abs(event.deltaX) > Math.abs(event.deltaY) || event.deltaY === 0) return;
      event.preventDefault();
      event.stopPropagation();
      const result = consumePreviewWheel(wheelGesture.current, normalizePreviewWheel(event.deltaY, event.deltaMode, element.clientHeight), performance.now());
      wheelGesture.current = result.state;
      if (result.direction) setPage(Math.max(0, Math.min(pages - 1, visiblePage + result.direction)));
    };
    element.addEventListener('wheel', wheel, { passive: false });
    return () => element.removeEventListener('wheel', wheel);
  }, [navigation, pages, visiblePage]);
  const changePage = (next: number) => {
    wheelGesture.current = createPreviewWheelGesture();
    setPage(Math.max(0, Math.min(pages - 1, next)));
  };
  return <div ref={list} className={`${styles.pagedList} ${listKey !== 'detail' ? styles.dayPagedList : ''} ${navigation === 'dots' ? styles.dotPagedList : ''}`} style={{ '--dashboard-item-count': Math.max(1, items.length) } as CSSProperties}
    data-preview-wheel-pages={navigation === 'dots' ? '' : undefined} data-preview-page-current={navigation === 'dots' ? visiblePage + 1 : undefined} data-preview-page-total={navigation === 'dots' ? pages : undefined}
    tabIndex={navigation === 'dots' && pages > 1 ? 0 : undefined} role={navigation === 'dots' ? 'group' : undefined} aria-label={navigation === 'dots' ? `${label} 목록` : undefined}
    onKeyDown={navigation === 'dots' ? (event) => {
      const target = event.target as HTMLElement;
      if (event.altKey || event.ctrlKey || event.metaKey || (target !== event.currentTarget && !target.closest('[data-preview-page-index]'))) return;
      const destination = ['ArrowDown', 'ArrowRight', 'PageDown'].includes(event.key) ? visiblePage + 1 : ['ArrowUp', 'ArrowLeft', 'PageUp'].includes(event.key) ? visiblePage - 1 : event.key === 'Home' ? 0 : event.key === 'End' ? pages - 1 : null;
      if (destination === null || pages < 2) return;
      event.preventDefault(); event.stopPropagation();
      list.current?.focus({ preventScroll: true });
      changePage(destination);
    } : undefined}>
    <div ref={viewport} data-dashboard-list={listKey} className={styles.listViewport}>
      {rows.length ? rows.map((schedule) => {
        const category = getScheduleCategory(schedule);
        const tone = scheduleCategoryStyles[category];
        const title = cleanTitle(schedule.title);
        const time = formatScheduleTime({ start_time: schedule.start_time?.slice(0, 5) ?? null, end_time: schedule.end_time?.slice(0, 5) ?? null });
        const details = [category === 'leave' ? getAbsenceTypeLabel(schedule) : '', showDate ? formatScheduleDateRange(schedule) : '', schedule.owner_name && `담당 ${schedule.owner_name}`, schedule.location].filter(Boolean).join(' · ');
        const status = getTodoStatus(schedule, today);
        const proximity = showProximity ? proximityDate ? getDayProximityLabel(proximityDate, today) : getScheduleProximityLabel(schedule, today) : '';
        return <div key={schedule.id} data-schedule-id={schedule.id} data-schedule-category={category} className={`${styles.scheduleRow} border-l-4 ${tone.accent} ${schedule.is_completed ? styles.completed : ''}`}>
          {schedule.is_todo && <button type="button" aria-label={`${schedule.title} ${schedule.is_completed ? '완료 취소' : '완료 처리'}`} aria-pressed={Boolean(schedule.is_completed)} className={`${styles.completeButton} ${schedule.is_completed ? styles.checked : ''}`} onClick={() => onComplete(schedule)}><Check size={17} /></button>}
          <button type="button" onClick={() => onOpen(schedule)} aria-label={[proximity, tone.label, schedule.title, time, details].filter(Boolean).join(' · ')} title={[proximity, schedule.title, time, details].filter(Boolean).join(' · ')} className={styles.scheduleButton}>
            <span className={styles.titleLine}>
              {proximity && <span className={styles.proximityBadge} data-schedule-proximity={proximity}>{proximity}</span>}
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
    {pages > 1 && navigation === 'dots' && <nav className={`${styles.dotPagination} ${pages > dotLimit ? styles.compressedDots : ''}`} data-preview-pagination data-preview-compressed={pages > dotLimit ? 'true' : undefined} aria-label={`${label} 페이지, 전체 ${pages}페이지`}>
      <span className={styles.srOnly} aria-live="polite">{visiblePage + 1} / {pages}페이지</span>
      {getPreviewPageWindow(visiblePage, pages, dotLimit).map((index) => <button type="button" key={index} data-preview-page-index={index} aria-label={`${label} ${index + 1}페이지 / ${pages}페이지`} aria-current={index === visiblePage ? 'page' : undefined} title={`${index + 1} / ${pages}페이지`} onClick={() => changePage(index)}><span data-page-dot aria-hidden="true" /></button>)}
      {pages > dotLimit && <span className={styles.dotTotal} aria-hidden="true" title={`${visiblePage + 1} / ${pages}페이지`}>{visiblePage + 1}/{pages}</span>}
    </nav>}
    {pages > 1 && navigation === 'arrows' && <nav className={styles.pagination} aria-label={`${label} 페이지`}>
      <span className={styles.pageCount} aria-live="polite">{items.length ? `${visiblePage + 1} / ${pages}` : '0건'}</span>
      <button type="button" aria-label={`${label} 이전 페이지`} disabled={visiblePage === 0} onClick={() => setPage(visiblePage - 1)}><ChevronLeft size={17} /></button>
      <button type="button" aria-label={`${label} 다음 페이지`} disabled={visiblePage >= pages - 1} onClick={() => setPage(visiblePage + 1)}><ChevronRight size={17} /></button>
    </nav>}
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
  openerElement?: HTMLElement | null;
  showProximity?: boolean;
  proximityDate?: string;
}
function SummaryDetail({ title, items, today, onClose, onOpen, onComplete, onAbsenceBoard, openerElement, showProximity, proximityDate }: SummaryDetailProps) {
  const dialog = useRef<HTMLDialogElement>(null);
  const opener = useRef<HTMLElement | null>(openerElement ?? null);
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
    <SchedulePages items={items} label={title} listKey="detail" today={today} showDate showProximity={showProximity} proximityDate={proximityDate} onOpen={onOpen} onComplete={onComplete} />
  </dialog>;
}

function PreviewRows({ items, today, onOpen, onComplete }: { items: Schedule[]; today: string; onOpen: (schedule: Schedule) => void; onComplete: (schedule: Schedule) => void }) {
  return <div className={styles.previewRows}>{items.length ? items.slice(0, 2).map((schedule) => {
    const category = getScheduleCategory(schedule);
    return <div key={schedule.id} className={styles.previewRow} data-schedule-category={category}>
      {schedule.is_todo && <button type="button" aria-label={`${schedule.title} ${schedule.is_completed ? '완료 취소' : '완료 처리'}`} aria-pressed={Boolean(schedule.is_completed)} className={`${styles.completeButton} ${schedule.is_completed ? styles.checked : ''}`} onClick={() => onComplete(schedule)}><Check size={16} /></button>}
      <button type="button" data-preview-schedule-id={schedule.id} className={styles.previewButton} title={schedule.title} onClick={() => onOpen(schedule)}>
        <span className={styles.previewTitle}>{schedule.is_urgent && <Siren size={13} className={styles.urgent} />}{schedule.is_todo && getTodoStatus(schedule, today) === '기한 지남' && <span className={styles.overdue}>지연</span>}<span>{cleanTitle(schedule.title)}</span></span>
        <span className={styles.previewMetadata}>{category === 'leave' ? getAbsenceTypeLabel(schedule) : `${shortDate(schedule.date)} · ${formatScheduleTime({ start_time: schedule.start_time?.slice(0, 5) ?? null, end_time: schedule.end_time?.slice(0, 5) ?? null })}`}{category !== 'leave' && schedule.owner_name && ` · ${schedule.owner_name}`}</span>
      </button>
    </div>;
  }) : <p className={styles.previewEmpty}>등록된 항목이 없습니다.</p>}</div>;
}

function UpcomingAbsences({ items, today, members, onOpen }: { items: Schedule[]; today: string; members: AbsenceMember[]; onOpen: (schedule: Schedule) => void }) {
  return <div className={styles.previewRows} data-dashboard-upcoming-absences>{items.length ? items.slice(0, 2).map((schedule) => {
    const dates = absenceDates(schedule);
    const person = getAbsencePeople(schedule, members).join(', ');
    const type = getAbsenceTypeLabel(schedule);
    const time = schedule.start_time ? ` · ${schedule.start_time.slice(0, 5)}` : '';
    return <div key={schedule.id} className={styles.previewRow} data-schedule-category="leave">
      <button type="button" data-preview-schedule-id={schedule.id} className={styles.previewButton} onClick={() => onOpen(schedule)} title={`${dates} · ${person} · ${type}${time}`}>
        <span className={styles.previewTitle}><span>{person}</span></span>
        <span className={styles.previewMetadata}>{scheduleOccursOn(schedule, today) ? '오늘 · ' : ''}{dates} · {type}{time}</span>
      </button>
    </div>;
  }) : <p className={styles.previewEmpty}>예정된 휴가가 없습니다.</p>}</div>;
}

export default function SharedDashboard({ schedules, members = [], holidaysByDate = {}, onChangeView, onOpenChat, onOpenSchedule, onToggleScheduleComplete, onOpenAbsenceBoard, onPrintWeek, onOpenCalendarDate }: SharedDashboardProps) {
  const [detailKey, setDetailKey] = useState<DetailKey | null>(null);
  const [detailOpener, setDetailOpener] = useState<HTMLElement | null>(null);
  const [previewRowHeight, setPreviewRowHeight] = useState(64);
  const [weekAutoPlay, setWeekAutoPlay] = useState(true);
  const [now, setNow] = useState(() => new Date());
  const peek = useAnchoredPreview<DetailKey>();
  const menu = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    const refresh = () => setNow(new Date());
    const visible = () => { if (!document.hidden) refresh(); };
    const timer = window.setInterval(visible, 60_000);
    document.addEventListener('visibilitychange', visible);
    window.addEventListener('focus', refresh);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', visible);
      window.removeEventListener('focus', refresh);
    };
  }, []);
  useEffect(() => {
    // The preview is portaled outside the dashboard's container queries. Its
    // row density follows viewport media queries, not the home card density.
    const observer = new ResizeObserver(() => setPreviewRowHeight(window.innerHeight <= 720 ? window.innerWidth <= 600 ? 48 : 56 : 64));
    observer.observe(document.documentElement);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    const outside = (event: PointerEvent) => { if (menu.current && !menu.current.contains(event.target as Node)) menu.current.open = false; };
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape' && menu.current?.open) { menu.current.open = false; menu.current.querySelector('summary')?.focus(); } };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', escape);
    return () => { document.removeEventListener('pointerdown', outside); document.removeEventListener('keydown', escape); };
  }, []);
  const today = toLocalDateKey(now);
  const tomorrow = shiftDateKey(today, 1);
  const weekEnd = shiftDateKey(today, 6);
  const monthStart = `${today.slice(0, 7)}-01`;
  const monthEnd = toLocalDateKey(new Date(now.getFullYear(), now.getMonth() + 1, 0));
  const todayItems = schedules.filter((schedule) => scheduleOccursOn(schedule, today)).sort(sortSchedules);
  const tomorrowItems = schedules.filter((schedule) => scheduleOccursOn(schedule, tomorrow)).sort(sortSchedules);
  const todos = getDashboardTodos(schedules, today);
  const pendingTodos = todos.filter((schedule) => !schedule.is_completed);
  const overdue = pendingTodos.filter((schedule) => getScheduleEndDate(schedule) < today).length;
  const notices = schedules.filter((schedule) => schedule.is_notice && getScheduleEndDate(schedule) >= today).sort((a, b) => Number(Boolean(b.is_urgent)) - Number(Boolean(a.is_urgent)) || sortSchedules(a, b));
  const week = schedules.filter((schedule) => scheduleOverlaps(schedule, today, weekEnd)).sort(sortSchedules);
  const absences = schedules.filter((schedule) => getScheduleCategory(schedule) === 'leave' && scheduleOverlaps(schedule, monthStart, monthEnd)).sort(sortSchedules);
  const upcomingAbsences = schedules.filter((schedule) => getScheduleCategory(schedule) === 'leave' && getScheduleEndDate(schedule) >= today).sort((a, b) => (a.date < today ? today : a.date).localeCompare(b.date < today ? today : b.date) || sortSchedules(a, b));
  const todayAbsences = absencePeople(absences.filter((schedule) => scheduleOccursOn(schedule, today)), members);
  const todayAbsenceItems = absences.filter((schedule) => scheduleOccursOn(schedule, today));
  const cards = [
    { key: 'todo' as const, label: '할 일', count: pendingTodos.length, unit: '건', icon: <Check size={16} />, items: todos, note: overdue ? `지연 ${overdue}건` : `완료 ${todos.length - pendingTodos.length}건`, range: '' },
    { key: 'notice' as const, label: '공지사항', count: notices.length, unit: '건', icon: <BellRing size={16} />, items: notices, note: '', range: '' },
    { key: 'week' as const, label: '주간 일정', count: week.length, unit: '건', icon: <CalendarDays size={16} />, items: week, note: '', range: `${shortDate(today)}–${shortDate(weekEnd)}` },
    { key: 'absence' as const, label: '이번 달 휴가', count: absencePeople(absences, members).length, unit: '명', icon: <CalendarDays size={16} />, items: absences, note: todayAbsences.length ? `오늘 ${todayAbsences.join(', ')}` : '오늘 없음', range: '' },
  ];
  const detailFor = (key: DetailKey | null) => {
    const date = key?.startsWith('date:') ? key.slice(5) : null;
    return date ? { key, label: `${date === today ? '오늘 · ' : date === tomorrow ? '내일 · ' : ''}${weekdayDate(date)}${holidaysByDate[date]?.length ? ` · ${holidaysByDate[date].join(' · ')}` : ''} 일정`, items: schedules.filter((schedule) => scheduleOccursOn(schedule, date)).sort(sortSchedules) } : key === 'today-absence' ? { key, label: '오늘 휴가·조퇴·외출', items: todayAbsenceItems } : cards.find((card) => card.key === key);
  };
  const selected = detailFor(detailKey);
  const preview = detailFor(peek.active?.key ?? null);
  const openSchedule = (schedule: Schedule) => { peek.close({ immediate: true }); setDetailKey(null); onOpenSchedule(schedule); };
  const openAll = (key: DetailKey) => {
    setDetailOpener(peek.active?.anchor ?? (document.activeElement instanceof HTMLElement ? document.activeElement : null));
    peek.close({ immediate: true, suppressFocusReopen: true });
    setDetailKey(key);
  };
  const runMenu = (action: () => void) => { if (menu.current) menu.current.open = false; action(); };
  const openCalendar = (date: string) => onOpenCalendarDate ? onOpenCalendarDate(date) : onChangeView('calendar');

  return <div data-dashboard-root className={styles.dashboard}>
    <header className={styles.header}>
      <div className={styles.heading}><h2>공공의료지원과 일정</h2><time dateTime={today}>{new Intl.DateTimeFormat('ko-KR', { month: 'long', day: 'numeric', weekday: 'short' }).format(now)}</time></div>
      <div className={styles.legend} data-dashboard-legend aria-label="일정 유형 색상 안내" role="list">
        {categoryLegend.map(({ value, label }) => <span key={value} data-dashboard-legend-category={value} className={styles.legendItem} role="listitem">
          <span data-legend-dot aria-hidden="true" className={`h-2 w-2 shrink-0 rounded-full ${scheduleCategoryStyles[value].dot}`} />{label}
        </span>)}
      </div>
      <div className={styles.headerActions}>
        <button type="button" className={styles.documentAction} aria-label="문서함" onClick={() => onChangeView('files')}><FolderOpen size={17} /><span>문서함</span></button>
        <button type="button" className={styles.calendarAction} aria-label="달력 보기" onClick={() => openCalendar(today)}><CalendarDays size={17} /><span>달력 보기</span></button>
        {onPrintWeek && <button type="button" className={styles.printAction} aria-label="주간 인쇄" title="주간 인쇄" onClick={onPrintWeek}><Printer size={18} /></button>}
        <details ref={menu} className={styles.tools}>
          <summary aria-label="대시보드 메뉴" title="더보기"><MoreHorizontal size={20} /></summary>
          <div className={styles.toolsMenu}>
            <button type="button" onClick={() => runMenu(() => onChangeView('files'))}><FolderOpen size={16} />문서함</button>
            <button type="button" onClick={() => runMenu(() => openCalendar(today))}><CalendarDays size={16} />달력 보기</button>
            {onPrintWeek && <button type="button" onClick={() => runMenu(onPrintWeek)}><Printer size={16} />주간 인쇄</button>}
            <button type="button" onClick={() => runMenu(onOpenChat)}><MessageCircle size={16} />공유방</button>
          </div>
        </details>
      </div>
    </header>
    <section className={styles.summaries} aria-label="일정 요약">
      {cards.map((card) => {
        const preview = card.key === 'todo' ? pendingTodos[0] : card.key === 'notice' ? notices[0] : card.key === 'absence' ? todayAbsenceItems[0] ?? absences[0] : week[0];
        return <section key={card.key} data-dashboard-summary={card.key} className={styles.summaryCard}>
          <button type="button" className={styles.summaryMain} {...peek.getTriggerProps(card.key)} aria-label={`${card.label} ${card.count}${card.unit} 미리보기`}>
            <span className={styles.summaryHeading}>{card.icon}<h3>{card.label}</h3></span>
            <span className={styles.summaryValue}><strong data-dashboard-count>{card.count}</strong><span>{card.unit}</span></span><ArrowUpRight size={14} className={styles.summaryArrow} />
          </button>
          {preview ? <button type="button" className={styles.summaryPreview} data-preview-schedule-id={preview.id} onClick={() => openSchedule(preview)} title={card.key === 'absence' ? `${absenceDates(preview)} · ${getAbsencePeople(preview, members).join(', ')} · ${getAbsenceTypeLabel(preview)}` : preview.title}>{preview.is_urgent && <span className={styles.previewStatus}><Siren size={12} />긴급</span>}{card.key === 'todo' && getTodoStatus(preview, today) === '기한 지남' && <span className={styles.previewStatus}>지연</span>}<span className={styles.summaryPreviewTitle}>{card.key === 'absence' ? `${weekdayDate(preview.date)} ${getAbsencePeople(preview, members).join(', ')} · ${getAbsenceTypeLabel(preview)}` : cleanTitle(preview.title)}</span></button> : <span className={styles.summaryPreview}>{card.key === 'todo' ? `완료 ${todos.length - pendingTodos.length}건` : card.key === 'absence' ? '오늘 휴가 없음' : '등록 없음'}</span>}
        </section>;
      })}
    </section>
    <section className={styles.week} data-dashboard-week aria-label="주간 일정 날짜별 보기">
      <header className={styles.weekHeading}><h3>주간 일정</h3><span>{shortDate(today)}–{shortDate(weekEnd)}</span><div className={styles.weekControls}>
        <button type="button" data-week-autoplay-control data-week-autoplay={String(weekAutoPlay)} className={styles.weekAutoControl} aria-pressed={!weekAutoPlay} aria-label={`주간 일정 자동 넘김 ${weekAutoPlay ? '일시정지' : '재생'}`} onClick={() => setWeekAutoPlay((playing) => !playing)}>{weekAutoPlay ? <Pause size={13} /> : <Play size={13} />}<span>{weekAutoPlay ? '일시정지' : '재생'}</span></button>
        <button type="button" onClick={() => openAll('week')}>전체 보기 <ArrowUpRight size={13} /></button>
      </div></header>
      <div className={styles.weekGrid}>{getSevenDayKeys(today).map((date) => {
        const items = schedules.filter((schedule) => scheduleOccursOn(schedule, date)).sort(sortSchedules);
        return <WeeklyDayTile key={date} date={date} today={today} items={items} dayLabel={date === today ? '오늘' : date === tomorrow ? '내일' : undefined} holidayNames={holidaysByDate[date]} triggerProps={peek.getTriggerProps(`date:${date}`)} autoPlay={weekAutoPlay} paused={Boolean(peek.active) || Boolean(detailKey)} />;
      })}</div>
    </section>
    <div className={styles.workspace}>
      <section className={styles.days} aria-label="오늘과 내일 일정">
      {[{ key: 'today' as const, label: '오늘 일정', date: today, items: todayItems }, { key: 'tomorrow' as const, label: '내일 일정', date: tomorrow, items: tomorrowItems }].map((day) => <section key={day.key} data-dashboard-day={day.key} className={styles.dayPanel}>
        <header className={styles.dayHeading}><h3>{day.label}<span data-dashboard-count>{day.items.length}</span></h3><time dateTime={day.date}>{shortDate(day.date)}</time><button type="button" aria-label={`${day.label} 달력 보기`} title="달력 보기" onClick={() => openCalendar(day.date)}><ArrowUpRight size={16} /></button></header>
        <SchedulePages key={day.key} items={day.items} label={day.label} listKey={day.key} today={today} onOpen={openSchedule} onComplete={onToggleScheduleComplete} />
      </section>)}
      </section>
      <aside className={styles.context} aria-label="확인할 내용">
        {[{ key: 'notice' as const, title: '공지사항', icon: <BellRing size={15} />, items: notices }, { key: 'todo' as const, title: '할 일', icon: <Check size={15} />, items: pendingTodos }, { key: 'absence' as const, title: '휴가·조퇴·외출', icon: <CalendarDays size={15} />, items: upcomingAbsences }].map((section) => <section key={section.key} className={styles.contextPanel} data-dashboard-context={section.key}>
          <header className={styles.contextHeading}><h3>{section.icon}{section.title}<span>{section.items.length}</span></h3><button type="button" {...peek.getTriggerProps(section.key)} aria-label={`${section.title} 미리보기`}>{section.key === 'absence' ? '월간' : '전체'} <ArrowUpRight size={13} /></button></header>
          {section.key === 'absence' ? <UpcomingAbsences items={section.items} today={today} members={members} onOpen={openSchedule} /> : <PreviewRows items={section.items} today={today} onOpen={openSchedule} onComplete={onToggleScheduleComplete} />}
        </section>)}
      </aside>
    </div>
    <AnchoredPreview controller={peek} title={preview?.label ?? ''} preferredHeight={peek.active?.key === 'absence' ? 480 : Math.min(620, Math.max(155, Math.max(1, preview?.items.length ?? 0) * (previewRowHeight + 6) + 98))}>
      {peek.active?.key === 'absence' ? <AbsenceMiniCalendar schedules={schedules} members={members} referenceDate={today} onOpenSchedule={openSchedule} onOpenAbsenceBoard={onOpenAbsenceBoard ? () => { peek.close({ immediate: true }); onOpenAbsenceBoard(); } : undefined} /> : preview && <div className={styles.peekList}>
        <SchedulePages key={`peek:${preview.key}`} items={preview.items} label={preview.label} listKey="detail" today={today} showDate showProximity={peek.active?.key === 'week' || Boolean(peek.active?.key.startsWith('date:'))} proximityDate={peek.active?.key.startsWith('date:') ? peek.active.key.slice(5) : undefined} onOpen={openSchedule} onComplete={onToggleScheduleComplete} navigation="dots" />
        <button type="button" className={styles.peekAll} onClick={() => openAll(peek.active!.key)}>전체 목록 보기 <ArrowUpRight size={14} /></button>
      </div>}
    </AnchoredPreview>
    {selected && <SummaryDetail key={selected.key} title={selected.label} items={selected.items} today={today} onClose={() => setDetailKey(null)} onOpen={openSchedule} onComplete={onToggleScheduleComplete} openerElement={detailOpener} showProximity={detailKey === 'week' || Boolean(detailKey?.startsWith('date:'))} proximityDate={detailKey?.startsWith('date:') ? detailKey.slice(5) : undefined} onAbsenceBoard={selected.key === 'absence' && onOpenAbsenceBoard ? () => { setDetailKey(null); onOpenAbsenceBoard(); } : undefined} />}
  </div>;
}
