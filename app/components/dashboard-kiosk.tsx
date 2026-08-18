'use client';

import { useEffect, useMemo, useState } from 'react';
import { BellRing, CalendarDays, CheckCircle2, Clock3, Maximize2, MonitorUp, Siren, X } from 'lucide-react';

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
const endOfNextWeek = (date: Date) => {
  const daysUntilThisSunday = (7 - date.getDay()) % 7;
  return addDays(date, daysUntilThisSunday + 7);
};
const scheduleEnd = (schedule: KioskSchedule) => schedule.end_date && schedule.end_date >= schedule.date ? schedule.end_date : schedule.date;
const happensOn = (schedule: KioskSchedule, day: string) => schedule.date <= day && scheduleEnd(schedule) >= day;
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

export default function DashboardKiosk({ schedules, onClose, dedicatedWindow = false }: DashboardKioskProps) {
  const [now, setNow] = useState(() => new Date());
  const today = dateKey(now);
  const tomorrow = dateKey(addDays(now, 1));
  const nextWeekEnd = dateKey(endOfNextWeek(now));

  useEffect(() => {
    const clock = window.setInterval(() => setNow(new Date()), 30_000);
    let enteredFullscreen = Boolean(document.fullscreenElement);
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || dedicatedWindow) return;
      event.stopPropagation();
      onClose();
      if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
    };
    const onFullscreenChange = () => {
      if (document.fullscreenElement) enteredFullscreen = true;
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
      upcoming: active.filter((schedule) => schedule.schedule_type !== 'leave' && !happensOn(schedule, today) && scheduleEnd(schedule) >= tomorrow && schedule.date <= nextWeekEnd),
      absences: active.filter((schedule) => schedule.schedule_type === 'leave' && scheduleEnd(schedule) >= today && schedule.date <= nextWeekEnd),
      notices: active.filter((schedule) => schedule.is_notice),
      todos: active.filter((schedule) => schedule.is_todo && !schedule.is_completed),
    };
  }, [nextWeekEnd, schedules, today, tomorrow]);

  const closeKiosk = () => {
    if (document.fullscreenElement) void document.exitFullscreen().finally(onClose);
    else onClose();
  };

  return (
    <div className="fixed inset-0 z-[400] overflow-hidden bg-[#071022] text-white">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(37,99,235,0.28),transparent_34%),radial-gradient(circle_at_bottom_left,rgba(124,58,237,0.18),transparent_30%)]" />
      <div className="relative flex h-full flex-col p-3 sm:p-5 lg:p-7 2xl:p-9">
        <header className="flex shrink-0 items-start justify-between gap-4 border-b border-white/10 pb-3 lg:pb-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-blue-300"><MonitorUp size={18} /><span className="text-[10px] font-black tracking-[0.18em] lg:text-xs">공공의료지원과 공유 현황</span></div>
            <h1 className="mt-1.5 truncate text-2xl font-black tracking-tight sm:text-3xl lg:text-4xl 2xl:text-5xl">{now.toLocaleDateString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' })}</h1>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <div className="mr-1 hidden text-right sm:block"><p className="text-2xl font-black tabular-nums lg:text-4xl 2xl:text-5xl">{now.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })}</p><p className="text-[9px] font-bold text-slate-400 lg:text-[10px]">실시간 자동 반영</p></div>
            {!dedicatedWindow && <button onClick={() => void document.documentElement.requestFullscreen?.()} aria-label="전체 화면" className="rounded-xl bg-white/10 p-2.5 text-slate-200 hover:bg-white/20"><Maximize2 size={18} /></button>}
            {!dedicatedWindow && <button onClick={closeKiosk} aria-label="전광판 닫기" className="rounded-xl bg-white/10 p-2.5 text-slate-200 hover:bg-red-500"><X size={18} /></button>}
          </div>
        </header>

        <main className="grid min-h-0 flex-1 gap-2.5 overflow-y-auto pt-3 sm:gap-3 lg:grid-cols-12 lg:grid-rows-[minmax(0,1.15fr)_minmax(0,0.85fr)] lg:gap-4 lg:overflow-hidden lg:pt-4">
          <Panel title="오늘 일정" count={data.today.length} tone="blue" className="lg:col-span-7">
            <ScheduleList items={data.today} limit={6} empty="오늘 등록된 일정이 없습니다." />
          </Panel>

          <Panel title="이번 주·다음 주 일정" count={data.upcoming.length} tone="violet" className="lg:col-span-5">
            <ScheduleList items={data.upcoming} limit={7} empty="다음 주까지 등록된 일정이 없습니다." showDate />
          </Panel>

          <Panel title="진행 중인 공지" count={data.notices.length} icon={<BellRing size={17} />} tone="red" className="lg:col-span-4">
            <CompactList items={data.notices} limit={4} empty="진행 중인 공지가 없습니다." />
          </Panel>

          <Panel title="미완료 TO DO" count={data.todos.length} icon={<CheckCircle2 size={17} />} tone="emerald" className="lg:col-span-4">
            <CompactList items={data.todos} limit={4} empty="미완료 항목이 없습니다." />
          </Panel>

          <Panel title="이번 주·다음 주 휴가" count={data.absences.length} icon={<CalendarDays size={17} />} tone="amber" className="lg:col-span-4">
            <AbsenceList items={data.absences} limit={5} />
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

function ScheduleList({ items, limit, empty, showDate = false }: { items: KioskSchedule[]; limit: number; empty: string; showDate?: boolean }) {
  if (items.length === 0) return <Empty label={empty} />;
  return <div className="flex h-full min-h-0 flex-col gap-1.5 overflow-hidden lg:gap-2">{items.slice(0, limit).map((schedule) => <ScheduleRow key={schedule.id} schedule={schedule} showDate={showDate} />)}<MoreCount count={items.length - limit} /></div>;
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

function CompactList({ items, limit, empty }: { items: KioskSchedule[]; limit: number; empty: string }) {
  if (items.length === 0) return <Empty label={empty} />;
  return <div className="space-y-1.5 overflow-hidden">{items.slice(0, limit).map((schedule) => <div key={schedule.id} className="flex items-center gap-2 rounded-xl bg-slate-950/25 px-3 py-2"><span className="h-1.5 w-1.5 shrink-0 rounded-full bg-blue-400" /><span className="min-w-0 flex-1 truncate text-xs font-black lg:text-sm">{cleanTitle(schedule.title)}</span><span className="shrink-0 text-[9px] font-bold text-slate-400">{schedule.date.slice(5).replace('-', '.')}</span></div>)}<MoreCount count={items.length - limit} /></div>;
}

function AbsenceList({ items, limit }: { items: KioskSchedule[]; limit: number }) {
  if (items.length === 0) return <Empty label="예정된 휴가·조퇴·외출이 없습니다." />;
  return <div className="space-y-1.5 overflow-hidden">{items.slice(0, limit).map((schedule) => <div key={schedule.id} className="flex items-center gap-2 rounded-xl bg-amber-300/10 px-3 py-2"><span className="rounded-md bg-amber-300/15 px-2 py-1 text-[9px] font-black text-amber-300">{absenceLabel(schedule)}</span><span className="shrink-0 text-xs font-black tracking-tight text-amber-100 lg:text-sm 2xl:text-base">{schedule.end_date && schedule.end_date > schedule.date ? `${formatAbsenceDate(schedule.date)}–${formatAbsenceDate(schedule.end_date)}` : formatAbsenceDate(schedule.date)}</span><span className="min-w-0 flex-1 truncate text-xs font-black text-white lg:text-sm 2xl:text-base">{cleanTitle(schedule.title)}</span></div>)}<MoreCount count={items.length - limit} /></div>;
}

function MoreCount({ count }: { count: number }) {
  return count > 0 ? <p className="pt-0.5 text-center text-[9px] font-black text-slate-500">외 {count}건</p> : null;
}

function Empty({ label }: { label: string }) {
  return <div className="flex h-full min-h-16 items-center justify-center rounded-xl bg-white/[0.03] px-3 text-center text-[10px] font-bold text-slate-500 lg:text-xs">{label}</div>;
}
