'use client';

import { useEffect, useMemo, useState } from 'react';
import { BellRing, CalendarDays, CheckCircle2, ChevronLeft, ChevronRight, Clock3, Maximize2, MonitorUp, Siren, X } from 'lucide-react';

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
}

const dateKey = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
const addDays = (date: Date, days: number) => { const next = new Date(date); next.setDate(next.getDate() + days); return next; };
const scheduleEnd = (schedule: KioskSchedule) => schedule.end_date && schedule.end_date >= schedule.date ? schedule.end_date : schedule.date;
const happensOn = (schedule: KioskSchedule, day: string) => schedule.date <= day && scheduleEnd(schedule) >= day;
const cleanTitle = (title: string) => title.replace(/^(?:회의|출장|내부일정|휴가|조퇴|외출)\s*[)）]\s*/u, '').trim();
const formatTime = (schedule: KioskSchedule) => schedule.start_time && schedule.end_time
  ? `${schedule.start_time}–${schedule.end_time}`
  : schedule.start_time ? `${schedule.start_time}부터` : schedule.end_time ? `${schedule.end_time}까지` : '시간 미정';

const absenceLabel = (schedule: KioskSchedule) => ({ annual: '연차', early: '조퇴', outing: '외출' }[schedule.absence_type ?? ''] ?? '휴가');

export default function DashboardKiosk({ schedules, onClose }: DashboardKioskProps) {
  const [now, setNow] = useState(() => new Date());
  const [slide, setSlide] = useState(0);
  const today = dateKey(now);
  const tomorrow = dateKey(addDays(now, 1));

  useEffect(() => {
    const clock = window.setInterval(() => setNow(new Date()), 30_000);
    const rotation = window.setInterval(() => setSlide((current) => (current + 1) % 3), 12_000);
    return () => { window.clearInterval(clock); window.clearInterval(rotation); };
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
      if (event.key === 'ArrowRight') setSlide((current) => (current + 1) % 3);
      if (event.key === 'ArrowLeft') setSlide((current) => (current + 2) % 3);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  const data = useMemo(() => {
    const active = schedules
      .filter((schedule) => schedule.date && scheduleEnd(schedule) >= today)
      .sort((left, right) => `${left.date}-${left.start_time ?? '99:99'}`.localeCompare(`${right.date}-${right.start_time ?? '99:99'}`));
    return {
      today: active.filter((schedule) => happensOn(schedule, today) && schedule.schedule_type !== 'leave'),
      tomorrow: active.filter((schedule) => happensOn(schedule, tomorrow) && schedule.schedule_type !== 'leave'),
      absences: active.filter((schedule) => schedule.schedule_type === 'leave' && (happensOn(schedule, today) || happensOn(schedule, tomorrow))),
      notices: active.filter((schedule) => schedule.is_notice).slice(0, 8),
      todos: active.filter((schedule) => schedule.is_todo && !schedule.is_completed).slice(0, 8),
    };
  }, [schedules, today, tomorrow]);

  const requestFullscreen = () => void document.documentElement.requestFullscreen?.();
  const closeKiosk = () => {
    if (document.fullscreenElement) void document.exitFullscreen().finally(onClose);
    else onClose();
  };

  return (
    <div className="fixed inset-0 z-[400] overflow-hidden bg-[#071022] text-white">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(37,99,235,0.28),transparent_34%),radial-gradient(circle_at_bottom_left,rgba(124,58,237,0.18),transparent_30%)]" />
      <div className="relative flex h-full flex-col p-5 sm:p-8 lg:p-12">
        <header className="flex shrink-0 items-start justify-between gap-5 border-b border-white/10 pb-5 lg:pb-7">
          <div>
            <div className="flex items-center gap-2 text-blue-300"><MonitorUp size={20} /><span className="text-xs font-black tracking-[0.2em]">공공의료지원과 공유 현황</span></div>
            <h1 className="mt-3 text-3xl font-black tracking-tight sm:text-4xl lg:text-6xl">{now.toLocaleDateString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' })}</h1>
          </div>
          <div className="flex items-center gap-2">
            <div className="mr-2 hidden text-right sm:block"><p className="text-3xl font-black tabular-nums lg:text-5xl">{now.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })}</p><p className="mt-1 text-xs font-bold text-slate-400">실시간 자동 반영</p></div>
            <button onClick={requestFullscreen} aria-label="전체 화면" className="rounded-2xl bg-white/10 p-3 text-slate-200 hover:bg-white/20"><Maximize2 size={20} /></button>
            <button onClick={closeKiosk} aria-label="전광판 닫기" className="rounded-2xl bg-white/10 p-3 text-slate-200 hover:bg-red-500"><X size={20} /></button>
          </div>
        </header>

        <main className="min-h-0 flex-1 py-5 lg:py-8">
          {slide === 0 && (
            <div className="grid h-full min-h-0 gap-4 lg:grid-cols-2 lg:gap-7">
              {([{ title: '오늘 일정', items: data.today, tone: 'blue' }, { title: '내일 일정', items: data.tomorrow, tone: 'violet' }] as const).map((section) => (
                <section key={section.title} className="flex min-h-0 flex-col rounded-[28px] border border-white/10 bg-white/[0.06] p-5 backdrop-blur-sm lg:p-7">
                  <div className="mb-4 flex items-center justify-between"><h2 className="text-xl font-black lg:text-3xl">{section.title}</h2><span className={`rounded-xl px-3 py-1.5 text-sm font-black ${section.tone === 'blue' ? 'bg-blue-500/20 text-blue-300' : 'bg-violet-500/20 text-violet-300'}`}>{section.items.length}건</span></div>
                  <div className="min-h-0 flex-1 space-y-3 overflow-hidden">
                    {section.items.length === 0 ? <Empty label="등록된 일정이 없습니다." /> : section.items.slice(0, 7).map((schedule) => <ScheduleRow key={schedule.id} schedule={schedule} />)}
                  </div>
                </section>
              ))}
            </div>
          )}

          {slide === 1 && (
            <div className="grid h-full min-h-0 gap-4 lg:grid-cols-[1.2fr_0.8fr] lg:gap-7">
              <KioskList title="진행 중인 공지사항" icon={<BellRing />} items={data.notices} empty="진행 중인 공지사항이 없습니다." />
              <KioskList title="미완료 TO DO" icon={<CheckCircle2 />} items={data.todos} empty="미완료 항목이 없습니다." />
            </div>
          )}

          {slide === 2 && (
            <section className="flex h-full min-h-0 flex-col rounded-[28px] border border-white/10 bg-white/[0.06] p-5 backdrop-blur-sm lg:p-8">
              <div className="mb-5 flex items-center justify-between"><h2 className="text-2xl font-black lg:text-4xl">오늘·내일 연차·조퇴·외출</h2><span className="rounded-xl bg-amber-400/15 px-4 py-2 font-black text-amber-300">{data.absences.length}건</span></div>
              {data.absences.length === 0 ? <Empty label="예정된 휴가·조퇴·외출이 없습니다." /> : (
                <div className="grid min-h-0 flex-1 auto-rows-min grid-cols-1 gap-3 overflow-hidden sm:grid-cols-2 xl:grid-cols-3">
                  {data.absences.slice(0, 12).map((schedule) => (
                    <div key={schedule.id} className="rounded-2xl border border-amber-200/15 bg-amber-300/10 p-5">
                      <div className="flex items-center justify-between"><span className="rounded-lg bg-amber-300/15 px-2.5 py-1 text-xs font-black text-amber-300">{absenceLabel(schedule)}</span><span className="text-xs font-bold text-slate-400">{happensOn(schedule, today) ? '오늘' : '내일'}</span></div>
                      <p className="mt-4 truncate text-xl font-black lg:text-2xl">{cleanTitle(schedule.title)}</p>
                    </div>
                  ))}
                </div>
              )}
            </section>
          )}
        </main>

        <footer className="flex shrink-0 items-center justify-between border-t border-white/10 pt-4">
          <button onClick={() => setSlide((current) => (current + 2) % 3)} className="rounded-xl bg-white/10 p-2.5 hover:bg-white/20"><ChevronLeft size={18} /></button>
          <div className="flex gap-2">{[0, 1, 2].map((index) => <button key={index} aria-label={`${index + 1}번 화면`} onClick={() => setSlide(index)} className={`h-2.5 rounded-full transition-all ${slide === index ? 'w-9 bg-blue-400' : 'w-2.5 bg-white/25'}`} />)}</div>
          <button onClick={() => setSlide((current) => (current + 1) % 3)} className="rounded-xl bg-white/10 p-2.5 hover:bg-white/20"><ChevronRight size={18} /></button>
        </footer>
      </div>
    </div>
  );
}

function ScheduleRow({ schedule }: { schedule: KioskSchedule }) {
  return (
    <div className="flex items-center gap-4 rounded-2xl border border-white/10 bg-slate-950/25 px-4 py-3 lg:px-5 lg:py-4">
      <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-blue-500/15 text-blue-300">{schedule.is_urgent ? <Siren size={19} /> : <CalendarDays size={19} />}</span>
      <div className="min-w-0 flex-1"><p className="truncate text-base font-black lg:text-xl">{cleanTitle(schedule.title)}</p><p className="mt-1 flex items-center gap-1.5 text-xs font-bold text-slate-400"><Clock3 size={12} />{formatTime(schedule)}</p></div>
    </div>
  );
}

function KioskList({ title, icon, items, empty }: { title: string; icon: React.ReactNode; items: KioskSchedule[]; empty: string }) {
  return (
    <section className="flex min-h-0 flex-col rounded-[28px] border border-white/10 bg-white/[0.06] p-5 backdrop-blur-sm lg:p-7">
      <div className="mb-4 flex items-center gap-3 text-2xl font-black lg:text-3xl"><span className="text-blue-300">{icon}</span>{title}<span className="ml-auto rounded-xl bg-white/10 px-3 py-1.5 text-sm">{items.length}건</span></div>
      <div className="min-h-0 flex-1 space-y-3 overflow-hidden">{items.length === 0 ? <Empty label={empty} /> : items.map((schedule) => <ScheduleRow key={schedule.id} schedule={schedule} />)}</div>
    </section>
  );
}

function Empty({ label }: { label: string }) {
  return <div className="flex h-full min-h-32 items-center justify-center rounded-2xl bg-white/[0.03] text-sm font-bold text-slate-500 lg:text-lg">{label}</div>;
}
