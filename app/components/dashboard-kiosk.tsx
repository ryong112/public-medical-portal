'use client';

import { useEffect, useMemo, useState } from 'react';
import { BellRing, CalendarDays, CheckCircle2, Clock3, Minimize2, MonitorUp, Siren, X } from 'lucide-react';

interface KioskSchedule {
  id: number | string;
  title: string;
  date: string;
  end_date?: string | null;
  start_time?: string | null;
  end_time?: string | null;
  schedule_type?: string | null;
  absence_type?: string | null;
  is_notice?: boolean | null;
  is_urgent?: boolean | null;
  is_todo?: boolean | null;
  is_completed?: boolean | null;
}

interface DashboardKioskProps {
  schedules: KioskSchedule[];
  onClose: () => void;
  dedicatedWindow?: boolean;
}

const dateKey = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
const addDays = (date: Date, days: number) => { const next = new Date(date); next.setDate(next.getDate() + days); return next; };
const endOfThisWeek = (date: Date) => addDays(date, (7 - date.getDay()) % 7);
const startOfNextWeek = (date: Date) => addDays(endOfThisWeek(date), 1);
const endOfNextWeek = (date: Date) => {
  const daysUntilThisSunday = (7 - date.getDay()) % 7;
  return addDays(date, daysUntilThisSunday + 7);
};
const scheduleEnd = (schedule: KioskSchedule) => schedule.end_date && schedule.end_date >= schedule.date ? schedule.end_date : schedule.date;
const happensOn = (schedule: KioskSchedule, day: string) => schedule.date <= day && scheduleEnd(schedule) >= day;
const overlapsRange = (schedule: KioskSchedule, start: string, end: string) => schedule.date <= end && scheduleEnd(schedule) >= start;
const cleanTitle = (title: string) => title.replace(/^(?:회의|출장|내부일정|휴가|조퇴|외출)\s*[)）]\s*/u, '').trim();
const formatTime = (schedule: KioskSchedule) => schedule.start_time && schedule.end_time
  ? `${schedule.start_time}–${schedule.end_time}`
  : schedule.start_time ? `${schedule.start_time}부터` : schedule.end_time ? `${schedule.end_time}까지` : '시간 미정';
const absenceLabel = (schedule: KioskSchedule) => ({ annual: '연차', early: '조퇴', outing: '외출' }[schedule.absence_type ?? ''] ?? '휴가');
const formatShortDate = (value: string) => {
  const [year, month, day] = value.split('-').map(Number);
  const weekday = ['일', '월', '화', '수', '목', '금', '토'][new Date(year, month - 1, day).getDay()];
  return `${month}.${day}(${weekday})`;
};
const formatAbsenceDate = (value: string) => {
  const [year, month, day] = value.split('-').map(Number);
  const weekday = ['일', '월', '화', '수', '목', '금', '토'][new Date(year, month - 1, day).getDay()];
  return `${month}월 ${day}일(${weekday})`;
};

type ExtendedScreen = Screen & {
  availLeft?: number;
  availTop?: number;
};

const getAvailableScreenBounds = () => {
  const currentScreen = window.screen as ExtendedScreen;
  return {
    left: currentScreen.availLeft ?? 0,
    top: currentScreen.availTop ?? 0,
    width: currentScreen.availWidth,
    height: currentScreen.availHeight,
  };
};

export default function DashboardKiosk({ schedules, onClose, dedicatedWindow = false }: DashboardKioskProps) {
  const [now, setNow] = useState(() => new Date());
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const today = dateKey(now);
  const tomorrow = dateKey(addDays(now, 1));
  const thisWeekEnd = dateKey(endOfThisWeek(now));
  const nextWeekStart = dateKey(startOfNextWeek(now));
  const nextWeekEnd = dateKey(endOfNextWeek(now));

  useEffect(() => {
    if (!dedicatedWindow) return;
    const previousTitle = document.title;
    document.title = '공공의료지원과 전광판';
    // `window.open(..., 'fullscreen')`을 지원하지 않는 환경에서도 사이트에
    // 자동 전체 화면 권한이 부여되어 있다면 바로 전체 화면으로 전환합니다.
    if (!document.fullscreenElement) {
      void document.documentElement.requestFullscreen?.().catch(() => undefined);
    }
    return () => { document.title = previousTitle; };
  }, [dedicatedWindow]);

  useEffect(() => {
    const clock = window.setInterval(() => setNow(new Date()), 250);
    let enteredFullscreen = Boolean(document.fullscreenElement);
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.stopPropagation();
      onClose();
      if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
    };
    const onFullscreenChange = () => {
      const nextIsFullscreen = Boolean(document.fullscreenElement);
      setIsFullscreen(nextIsFullscreen);
      if (nextIsFullscreen) enteredFullscreen = true;
      else if (enteredFullscreen && !dedicatedWindow) onClose();
    };
    document.addEventListener('keydown', onKeyDown, true);
    document.addEventListener('fullscreenchange', onFullscreenChange);
    return () => {
      window.clearInterval(clock);
      document.removeEventListener('keydown', onKeyDown, true);
      document.removeEventListener('fullscreenchange', onFullscreenChange);
    };
  }, [dedicatedWindow, onClose]);

  const data = useMemo(() => {
    const active = schedules
      .filter((schedule) => schedule.date && scheduleEnd(schedule) >= today)
      .sort((left, right) => `${left.date}-${left.start_time ?? '99:99'}`.localeCompare(`${right.date}-${right.start_time ?? '99:99'}`));
    return {
      today: active.filter((schedule) => happensOn(schedule, today) && schedule.schedule_type !== 'leave'),
      thisWeek: tomorrow <= thisWeekEnd
        ? active.filter((schedule) => schedule.schedule_type !== 'leave' && overlapsRange(schedule, tomorrow, thisWeekEnd))
        : [],
      nextWeek: active.filter((schedule) => schedule.schedule_type !== 'leave' && overlapsRange(schedule, nextWeekStart, nextWeekEnd)),
      absences: active.filter((schedule) => schedule.schedule_type === 'leave' && scheduleEnd(schedule) >= today && schedule.date <= nextWeekEnd),
      notices: active.filter((schedule) => schedule.is_notice),
      todos: active.filter((schedule) => schedule.is_todo && !schedule.is_completed),
    };
  }, [nextWeekEnd, nextWeekStart, schedules, thisWeekEnd, today, tomorrow]);

  const closeKiosk = () => {
    if (document.fullscreenElement) void document.exitFullscreen().finally(onClose);
    else onClose();
  };

  const collapseKiosk = async () => {
    if (!dedicatedWindow) return;
    setIsCollapsed(true);
    if (document.fullscreenElement) await document.exitFullscreen().catch(() => undefined);
    const bounds = getAvailableScreenBounds();
    window.resizeTo(360, 180);
    window.moveTo(bounds.left + Math.max(0, bounds.width - 360), bounds.top + Math.max(0, Math.round((bounds.height - 180) / 2)));
  };

  const expandKiosk = () => {
    const bounds = getAvailableScreenBounds();
    window.moveTo(bounds.left, bounds.top);
    window.resizeTo(bounds.width, bounds.height);
    setIsCollapsed(false);
    void document.documentElement.requestFullscreen?.().catch(() => undefined);
  };

  if (isCollapsed) {
    return (
      <div className="fixed inset-0 z-[400] flex items-center justify-center bg-[#071022] p-3 text-white">
        <button
          type="button"
          onClick={expandKiosk}
          aria-label="전광판 다시 전체 화면으로 펼치기"
          className="group flex w-full items-center justify-center gap-3 rounded-2xl border border-blue-400/40 bg-blue-600 px-5 py-4 font-black shadow-2xl transition-colors hover:bg-blue-500"
        >
          <MonitorUp size={21} className="text-blue-100" />
          <span>전광판 열기</span>
        </button>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-[400] overflow-hidden bg-[#071022] text-white">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(37,99,235,0.28),transparent_34%),radial-gradient(circle_at_bottom_left,rgba(124,58,237,0.18),transparent_30%)]" />
      <div className="relative flex h-full flex-col p-3 sm:p-5 lg:p-7 2xl:p-9">
        {dedicatedWindow && <button type="button" onClick={() => void collapseKiosk()} aria-label="전광판을 작은 창으로 접기" className="absolute right-0 top-1/2 z-20 flex -translate-y-1/2 flex-col items-center gap-1 rounded-l-xl bg-blue-600 px-2 py-3 text-[9px] font-black text-white shadow-xl transition-colors hover:bg-blue-500"><Minimize2 size={15}/><span className="[writing-mode:vertical-rl] tracking-wider">접기</span></button>}
        <header className="flex shrink-0 items-start justify-between gap-4 border-b border-white/10 pb-3 lg:pb-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-blue-300"><MonitorUp size={18} /><span className="text-[10px] font-black tracking-[0.18em] lg:text-xs">공공의료지원과 공유 현황</span></div>
            <h1 className="mt-1.5 truncate text-2xl font-black tracking-tight sm:text-3xl lg:text-4xl 2xl:text-5xl">{now.toLocaleDateString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' })}</h1>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <div className="mr-1 hidden text-right sm:block">
              <p className="flex items-baseline justify-end gap-1 font-black tabular-nums">
                <span className="text-2xl lg:text-4xl 2xl:text-5xl">{now.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })}</span>
                <span key={now.getSeconds()} className="kiosk-second-tick inline-block min-w-[1.45em] text-lg text-blue-200 lg:text-2xl 2xl:text-3xl">:{String(now.getSeconds()).padStart(2, '0')}</span>
              </p>
            </div>
            {!isFullscreen && <button onClick={() => void document.documentElement.requestFullscreen?.()} aria-label="전체 화면" title="전체 화면" className="rounded-xl bg-white/10 p-2.5 text-slate-200 hover:bg-white/20"><MonitorUp size={18} /></button>}
            <button onClick={closeKiosk} aria-label="전광판 닫기" className="rounded-xl bg-white/10 p-2.5 text-slate-200 hover:bg-red-500"><X size={18} /></button>
          </div>
        </header>

        <main className="grid min-h-0 flex-1 gap-2.5 overflow-y-auto pt-3 sm:gap-3 lg:grid-cols-12 lg:grid-rows-[minmax(0,1.25fr)_minmax(0,0.75fr)] lg:gap-3 lg:overflow-hidden lg:pt-4 2xl:gap-4">
          <Panel title="오늘 일정" count={data.today.length} tone="blue" className="lg:col-span-3">
            <ScheduleList items={data.today} empty="오늘 등록된 일정이 없습니다." />
          </Panel>

          <Panel title="이번 주 일정" count={data.thisWeek.length} tone="violet" className="lg:col-span-4">
            <ScheduleList items={data.thisWeek} empty="이번 주 남은 일정이 없습니다." showDate allowColumns />
          </Panel>

          <Panel title="다음 주 일정" count={data.nextWeek.length} tone="violet" className="lg:col-span-5">
            <ScheduleList items={data.nextWeek} empty="다음 주 등록된 일정이 없습니다." showDate allowColumns />
          </Panel>

          <Panel title="진행 중인 공지" count={data.notices.length} icon={<BellRing size={17} />} tone="red" className="lg:col-span-4">
            <CompactList items={data.notices} empty="진행 중인 공지가 없습니다." />
          </Panel>

          <Panel title="미완료 TO DO" count={data.todos.length} icon={<CheckCircle2 size={17} />} tone="emerald" className="lg:col-span-4">
            <CompactList items={data.todos} empty="미완료 항목이 없습니다." />
          </Panel>

          <Panel title="이번 주·다음 주 휴가" count={data.absences.length} icon={<CalendarDays size={17} />} tone="amber" className="lg:col-span-4">
            <AbsenceList items={data.absences} />
          </Panel>
        </main>
      </div>
    </div>
  );
}

const toneClasses = {
  blue: 'bg-blue-500/20 text-blue-300',
  violet: 'bg-violet-500/20 text-violet-300',
  red: 'bg-red-500/15 text-red-300',
  emerald: 'bg-emerald-500/15 text-emerald-300',
  amber: 'bg-amber-400/15 text-amber-300',
};

function Panel({ title, count, tone, icon, className = '', children }: { title: string; count: number; tone: keyof typeof toneClasses; icon?: React.ReactNode; className?: string; children: React.ReactNode }) {
  return (
    <section className={`flex min-h-0 flex-col rounded-[20px] border border-white/10 bg-white/[0.06] p-3 backdrop-blur-sm sm:p-4 lg:rounded-[24px] lg:p-5 ${className}`}>
      <div className="mb-2.5 flex shrink-0 items-center gap-2 lg:mb-3">{icon && <span className={toneClasses[tone].split(' ').at(-1)}>{icon}</span>}<h2 className="text-base font-black sm:text-lg lg:text-xl 2xl:text-2xl">{title}</h2><span className={`ml-auto rounded-lg px-2.5 py-1 text-[10px] font-black lg:text-xs ${toneClasses[tone]}`}>{count}건</span></div>
      <div className="min-h-0 flex-1">{children}</div>
    </section>
  );
}

function ScheduleList({ items, empty, showDate = false, allowColumns = false }: { items: KioskSchedule[]; empty: string; showDate?: boolean; allowColumns?: boolean }) {
  if (items.length === 0) return <Empty label={empty} />;
  const columnCount = allowColumns ? Math.max(1, Math.ceil(items.length / 6)) : 1;
  const rowCount = Math.ceil(items.length / columnCount);
  return (
    <div
      className="grid h-full min-h-0 gap-1 overflow-hidden lg:gap-1.5"
      style={{
        gridTemplateColumns: `repeat(${columnCount}, minmax(0, 1fr))`,
        gridTemplateRows: `repeat(${rowCount}, minmax(0, 1fr))`,
        gridAutoFlow: 'column',
      }}
    >
      {items.map((schedule) => <ScheduleRow key={schedule.id} schedule={schedule} showDate={showDate} />)}
    </div>
  );
}

function ScheduleRow({ schedule, showDate = false }: { schedule: KioskSchedule; showDate?: boolean }) {
  return (
    <div className="flex min-h-0 flex-1 items-center gap-3 rounded-xl border border-white/10 bg-slate-950/25 px-3 py-2 lg:rounded-2xl lg:px-4">
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-blue-500/15 text-blue-300 lg:h-9 lg:w-9">{schedule.is_urgent ? <Siren size={16} /> : <CalendarDays size={16} />}</span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-xs font-black sm:text-sm lg:text-base 2xl:text-lg">{cleanTitle(schedule.title)}</p>
        <div className="mt-0.5 flex items-center gap-2">
          {showDate && <span className="shrink-0 text-xs font-black tracking-tight text-violet-200 lg:text-sm 2xl:text-base">{formatShortDate(schedule.date)}</span>}
          <span className="flex min-w-0 items-center gap-1 truncate text-[9px] font-bold text-slate-400 lg:text-[10px]"><Clock3 size={10} className="shrink-0" />{formatTime(schedule)}</span>
        </div>
      </div>
    </div>
  );
}

function CompactList({ items, empty }: { items: KioskSchedule[]; empty: string }) {
  if (items.length === 0) return <Empty label={empty} />;
  return <div className="grid h-full min-h-0 gap-1 overflow-hidden lg:gap-1.5" style={{ gridTemplateRows: `repeat(${items.length}, minmax(0, 1fr))` }}>{items.map((schedule) => <div key={schedule.id} className="flex min-h-0 items-center gap-2 rounded-xl bg-slate-950/25 px-3 py-1.5"><span className="h-1.5 w-1.5 shrink-0 rounded-full bg-blue-400" /><span className="min-w-0 flex-1 truncate text-xs font-black lg:text-sm">{cleanTitle(schedule.title)}</span><span className="shrink-0 text-[9px] font-bold text-slate-400">{schedule.date.slice(5).replace('-', '.')}</span></div>)}</div>;
}

function AbsenceList({ items }: { items: KioskSchedule[] }) {
  if (items.length === 0) return <Empty label="예정된 휴가·조퇴·외출이 없습니다." />;
  return <div className="grid h-full min-h-0 gap-1 overflow-hidden lg:gap-1.5" style={{ gridTemplateRows: `repeat(${items.length}, minmax(0, 1fr))` }}>{items.map((schedule) => <div key={schedule.id} className="flex min-h-0 items-center gap-2 rounded-xl bg-amber-300/10 px-3 py-1.5"><span className="rounded-md bg-amber-300/15 px-2 py-1 text-[9px] font-black text-amber-300">{absenceLabel(schedule)}</span><span className="shrink-0 text-xs font-black tracking-tight text-amber-100 lg:text-sm 2xl:text-base">{schedule.end_date && schedule.end_date > schedule.date ? `${formatAbsenceDate(schedule.date)}–${formatAbsenceDate(schedule.end_date)}` : formatAbsenceDate(schedule.date)}</span><span className="min-w-0 flex-1 truncate text-xs font-black text-white lg:text-sm 2xl:text-base">{cleanTitle(schedule.title)}</span></div>)}</div>;
}

function Empty({ label }: { label: string }) {
  return <div className="flex h-full min-h-16 items-center justify-center rounded-xl bg-white/[0.03] px-3 text-center text-[10px] font-bold text-slate-500 lg:text-xs">{label}</div>;
}
