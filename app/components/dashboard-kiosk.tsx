'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { BellRing, CalendarDays, CheckCircle2, Clock3, Minimize2, MonitorUp, Siren, X } from 'lucide-react';

export interface KioskSchedule {
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
  nativeLauncher?: boolean;
}

type ScheduleBreakdownItem = {
  label: string;
  count: number;
};

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
const absenceLabel = (schedule: KioskSchedule) => {
  if (['early', 'early_am', 'early_pm'].includes(schedule.absence_type ?? '') || schedule.title.includes('조퇴')) return '조퇴';
  if (schedule.absence_type === 'outing' || schedule.title.includes('외출')) return '외출';
  return '연차';
};
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

const getScheduleCategory = (schedule: KioskSchedule) => {
  if (schedule.schedule_type === 'leave') return 'leave';
  if (schedule.schedule_type === 'internal' || /^내부일정\s*[)）]/u.test(schedule.title)) return 'internal';
  if (schedule.schedule_type === 'business_trip' || /^출장\s*[)）]/u.test(schedule.title)) return 'business_trip';
  if (schedule.schedule_type === 'meeting' || /^회의\s*[)）]/u.test(schedule.title)) return 'meeting';
  return 'general';
};

const getScheduleBreakdown = (items: KioskSchedule[], includeLeave = false): ScheduleBreakdownItem[] => {
  const counts = { general: 0, internal: 0, business_trip: 0, meeting: 0, leave: 0 };
  for (const schedule of items) counts[getScheduleCategory(schedule)] += 1;
  const result: ScheduleBreakdownItem[] = [
    { label: '일반', count: counts.general },
    { label: '내부일정', count: counts.internal },
    { label: '출장', count: counts.business_trip },
    { label: '회의', count: counts.meeting },
  ];
  if (includeLeave) result.push({ label: '휴가', count: counts.leave });
  return result;
};

const getAbsenceBreakdown = (items: KioskSchedule[]): ScheduleBreakdownItem[] => [
  { label: '연차', count: items.filter((schedule) => absenceLabel(schedule) === '연차').length },
  { label: '조퇴', count: items.filter((schedule) => absenceLabel(schedule) === '조퇴').length },
  { label: '외출', count: items.filter((schedule) => absenceLabel(schedule) === '외출').length },
];

type ExtendedScreen = Screen & {
  availLeft?: number;
  availTop?: number;
};

type DocumentPictureInPictureApi = {
  requestWindow: (options?: { width?: number; height?: number }) => Promise<Window>;
};

type WindowWithDocumentPictureInPicture = Window & {
  documentPictureInPicture?: DocumentPictureInPictureApi;
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

export default function DashboardKiosk({ schedules, onClose, dedicatedWindow = false, nativeLauncher = false }: DashboardKioskProps) {
  const [now, setNow] = useState(() => new Date());
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isPictureInPictureOpen, setIsPictureInPictureOpen] = useState(false);
  const collapseRequestedRef = useRef(false);
  const pictureInPictureWindowRef = useRef<Window | null>(null);
  const today = dateKey(now);
  const tomorrow = dateKey(addDays(now, 1));
  const thisWeekEnd = dateKey(endOfThisWeek(now));
  const nextWeekStart = dateKey(startOfNextWeek(now));
  const nextWeekEnd = dateKey(endOfNextWeek(now));

  const setDedicatedWindowTitle = (collapsed: boolean) => {
    if (!dedicatedWindow) return;
    document.title = collapsed ? '전광판 제어' : '공공의료지원과 전광판';
  };

  const signalNativeLauncher = (action: 'open' | 'collapse') => {
    if (!nativeLauncher) return;
    const link = document.createElement('a');
    link.href = `dphskiosk://${action}`;
    link.hidden = true;
    document.body.append(link);
    link.click();
    link.remove();
  };

  useEffect(() => {
    if (!dedicatedWindow) return;
    const previousTitle = document.title;
    document.title = '공공의료지원과 전광판';
    // `window.open(..., 'fullscreen')`을 지원하지 않는 환경에서도 사이트에
    // 자동 전체 화면 권한이 부여되어 있다면 바로 전체 화면으로 전환합니다.
    if (!document.fullscreenElement) {
      void document.documentElement.requestFullscreen?.({ navigationUI: 'hide' }).catch(() => undefined);
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
      else if (enteredFullscreen && !dedicatedWindow && !collapseRequestedRef.current) onClose();
    };
    document.addEventListener('keydown', onKeyDown, true);
    document.addEventListener('fullscreenchange', onFullscreenChange);
    return () => {
      window.clearInterval(clock);
      document.removeEventListener('keydown', onKeyDown, true);
      document.removeEventListener('fullscreenchange', onFullscreenChange);
    };
  }, [dedicatedWindow, onClose]);

  useEffect(() => () => {
    pictureInPictureWindowRef.current?.close();
    pictureInPictureWindowRef.current = null;
  }, []);

  const data = useMemo(() => {
    const active = schedules
      .filter((schedule) => schedule.date && scheduleEnd(schedule) >= today)
      .sort((left, right) => `${left.date}-${left.start_time ?? '99:99'}`.localeCompare(`${right.date}-${right.start_time ?? '99:99'}`));
    return {
      today: active.filter((schedule) => happensOn(schedule, today) && getScheduleCategory(schedule) !== 'leave'),
      thisWeek: tomorrow <= thisWeekEnd
        ? active.filter((schedule) => getScheduleCategory(schedule) !== 'leave' && overlapsRange(schedule, tomorrow, thisWeekEnd))
        : [],
      nextWeek: active.filter((schedule) => getScheduleCategory(schedule) !== 'leave' && overlapsRange(schedule, nextWeekStart, nextWeekEnd)),
      absences: active.filter((schedule) => getScheduleCategory(schedule) === 'leave' && scheduleEnd(schedule) >= today && schedule.date <= nextWeekEnd),
      notices: active.filter((schedule) => schedule.is_notice),
      todos: active.filter((schedule) => schedule.is_todo && !schedule.is_completed),
    };
  }, [nextWeekEnd, nextWeekStart, schedules, thisWeekEnd, today, tomorrow]);

  const closeKiosk = () => {
    pictureInPictureWindowRef.current?.close();
    pictureInPictureWindowRef.current = null;
    setIsPictureInPictureOpen(false);
    collapseRequestedRef.current = false;
    if (document.fullscreenElement) void document.exitFullscreen().finally(onClose);
    else onClose();
  };

  const mountPictureInPictureController = (controllerWindow: Window) => {
    const controllerDocument = controllerWindow.document;
    controllerDocument.documentElement.lang = 'ko';
    controllerDocument.title = '전광판 제어';
    controllerDocument.head.replaceChildren();
    controllerDocument.body.replaceChildren();

    const style = controllerDocument.createElement('style');
    style.textContent = `
      * { box-sizing: border-box; }
      html, body { width: 100%; height: 100%; margin: 0; }
      body {
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 12px;
        overflow: hidden;
        background: #071022;
        color: #fff;
        font-family: Arial, "Noto Sans KR", sans-serif;
      }
      .controller { width: 100%; }
      .eyebrow { margin: 0 0 7px; color: #93c5fd; font-size: 10px; font-weight: 800; letter-spacing: .08em; }
      .actions { display: grid; grid-template-columns: minmax(0, 1fr) 42px; gap: 8px; }
      button {
        min-height: 48px;
        border: 0;
        border-radius: 13px;
        cursor: pointer;
        font-size: 14px;
        font-weight: 900;
      }
      #reopen-kiosk { background: #2563eb; color: #fff; box-shadow: 0 10px 24px rgba(37, 99, 235, .35); }
      #reopen-kiosk:hover { background: #1d4ed8; }
      #close-kiosk { background: rgba(255, 255, 255, .1); color: #cbd5e1; }
      #close-kiosk:hover { background: #ef4444; color: #fff; }
      button:focus-visible { outline: 3px solid #93c5fd; outline-offset: 2px; }
    `;
    controllerDocument.head.append(style);

    const controller = controllerDocument.createElement('main');
    controller.className = 'controller';
    const eyebrow = controllerDocument.createElement('p');
    eyebrow.className = 'eyebrow';
    eyebrow.textContent = '공공의료지원과 공유 현황';
    const actions = controllerDocument.createElement('div');
    actions.className = 'actions';
    const reopenButton = controllerDocument.createElement('button');
    reopenButton.id = 'reopen-kiosk';
    reopenButton.type = 'button';
    reopenButton.textContent = '전광판 다시 열기 · F8';
    const closeButton = controllerDocument.createElement('button');
    closeButton.id = 'close-kiosk';
    closeButton.type = 'button';
    closeButton.setAttribute('aria-label', '전광판 완전히 종료');
    closeButton.title = '전광판 완전히 종료';
    closeButton.textContent = '×';

    actions.append(reopenButton, closeButton);
    controller.append(eyebrow, actions);
    controllerDocument.body.append(controller);

    reopenButton.addEventListener('click', () => void expandKiosk());
    closeButton.addEventListener('click', closeKiosk);
    controllerWindow.addEventListener('keydown', (event) => {
      if (event.key !== 'F8' || event.repeat) return;
      event.preventDefault();
      void expandKiosk();
    });
    controllerWindow.addEventListener('pagehide', () => {
      if (pictureInPictureWindowRef.current !== controllerWindow) return;
      pictureInPictureWindowRef.current = null;
      setIsPictureInPictureOpen(false);
    }, { once: true });
  };

  const collapseKiosk = async () => {
    collapseRequestedRef.current = true;
    setDedicatedWindowTitle(true);
    setIsCollapsed(true);

    if (dedicatedWindow) {
      if (document.fullscreenElement) await document.exitFullscreen().catch(() => undefined);
      if (nativeLauncher) {
        signalNativeLauncher('collapse');
        return;
      }
      const bounds = getAvailableScreenBounds();
      window.resizeTo(360, 180);
      window.moveTo(bounds.left + Math.max(0, bounds.width - 360), bounds.top + Math.max(0, Math.round((bounds.height - 180) / 2)));
      return;
    }

    const pictureInPictureApi = (window as WindowWithDocumentPictureInPicture).documentPictureInPicture;
    const pictureInPictureRequest = pictureInPictureApi?.requestWindow({ width: 360, height: 145 });
    if (document.fullscreenElement) await document.exitFullscreen().catch(() => undefined);

    if (!pictureInPictureRequest) return;
    try {
      const controllerWindow = await pictureInPictureRequest;
      pictureInPictureWindowRef.current = controllerWindow;
      setIsPictureInPictureOpen(true);
      mountPictureInPictureController(controllerWindow);
    } catch {
      setIsPictureInPictureOpen(false);
    }
  };

  const expandKiosk = async () => {
    collapseRequestedRef.current = false;
    if (dedicatedWindow) {
      setDedicatedWindowTitle(false);
      setIsCollapsed(false);
      window.focus();

      // 설치형 전광판은 실행기가 창 프레임과 모니터 크기를 직접 관리합니다.
      // F11/웹 전체화면 API와 섞지 않아 최초 실행과 이후 복귀가 같은 상태가 됩니다.
      if (nativeLauncher) {
        signalNativeLauncher('open');
        return;
      }

      // 접힌 전용 창 안에서 누른 버튼/F8의 사용자 동작을 바로 사용해야
      // 브라우저가 전체 화면 요청을 허용할 가능성이 가장 높습니다.
      try {
        await document.documentElement.requestFullscreen?.({ navigationUI: 'hide' });
        if (document.fullscreenElement) return;
      } catch {
        // 아래의 설치형 실행기/창 크기 복원 경로로 계속 진행합니다.
      }

      const bounds = getAvailableScreenBounds();
      window.moveTo(bounds.left, bounds.top);
      window.resizeTo(bounds.width, bounds.height);
      window.focus();
      return;
    }
    setIsCollapsed(false);
    window.focus();
    // PIP 창을 먼저 닫으면 그 창에서 발생한 클릭 권한까지 함께 사라져
    // 전체 화면 요청이 거절될 수 있습니다. 클릭 권한이 살아 있을 때 요청을
    // 먼저 시작하고, 그 다음 작은 제어창을 정리합니다.
    const fullscreenRequest = document.documentElement.requestFullscreen?.({ navigationUI: 'hide' });
    await fullscreenRequest?.catch(() => undefined);
    pictureInPictureWindowRef.current?.close();
    pictureInPictureWindowRef.current = null;
    setIsPictureInPictureOpen(false);
  };

  const shortcutActionRef = useRef<() => void>(() => undefined);

  useEffect(() => {
    shortcutActionRef.current = () => {
      if (isCollapsed) void expandKiosk();
      else void collapseKiosk();
    };
  });

  useEffect(() => {
    const onShortcut = (event: KeyboardEvent) => {
      if (event.key !== 'F8' || event.repeat) return;
      event.preventDefault();
      shortcutActionRef.current();
    };
    window.addEventListener('keydown', onShortcut);
    return () => window.removeEventListener('keydown', onShortcut);
  }, []);

  if (isCollapsed) {
    if (!dedicatedWindow && isPictureInPictureOpen) return null;

    if (!dedicatedWindow) {
      return (
        <aside className="fixed bottom-5 right-5 z-[400] w-[min(22rem,calc(100vw-2rem))] rounded-2xl border border-blue-200 bg-white p-3 text-slate-900 shadow-2xl ring-1 ring-slate-900/5">
          <p className="mb-2 px-1 text-[10px] font-black tracking-[0.12em] text-blue-600">공공의료지원과 전광판</p>
          <div className="grid grid-cols-[1fr_44px] gap-2">
            <button type="button" onClick={() => void expandKiosk()} className="flex min-h-12 items-center justify-center gap-2 rounded-xl bg-blue-600 px-4 text-sm font-black text-white shadow-lg transition-colors hover:bg-blue-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2">
              <MonitorUp size={18} /> 전광판 다시 열기 <span className="rounded-md bg-white/15 px-1.5 py-0.5 text-[10px]">F8</span>
            </button>
            <button type="button" onClick={closeKiosk} aria-label="전광판 완전히 종료" title="전광판 완전히 종료" className="flex min-h-12 items-center justify-center rounded-xl bg-slate-100 text-slate-500 transition-colors hover:bg-red-500 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500 focus-visible:ring-offset-2">
              <X size={18} />
            </button>
          </div>
        </aside>
      );
    }

    return (
      <div className="fixed inset-0 z-[400] flex items-center justify-center bg-[#071022] p-3 text-white">
        <button
          type="button"
          onClick={() => void expandKiosk()}
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
    <div className="fixed inset-0 z-[400] overflow-hidden bg-[#050b18] text-white">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(37,99,235,0.24),transparent_32%),radial-gradient(circle_at_bottom_left,rgba(124,58,237,0.16),transparent_28%)]" />
      <div className="relative flex h-full flex-col p-3 sm:p-5 lg:p-6 2xl:p-7">
        <header className="flex shrink-0 items-start justify-between gap-4 border-b border-white/20 pb-3 lg:pb-4">
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
            {!isFullscreen && !nativeLauncher && <button onClick={() => void document.documentElement.requestFullscreen?.({ navigationUI: 'hide' })} aria-label="전체 화면" title="전체 화면" className="rounded-xl border border-blue-300/30 bg-blue-500/20 p-2.5 text-blue-100 hover:bg-blue-500/35"><MonitorUp size={18} /></button>}
            <button onClick={() => void collapseKiosk()} aria-label="전광판 접기" title="전광판 접기 (F8)" className="flex items-center gap-1.5 rounded-xl bg-blue-500/15 p-2.5 text-blue-200 transition-colors hover:bg-blue-600 hover:text-white"><Minimize2 size={18} /><span className="hidden text-[10px] font-black lg:inline">F8</span></button>
            <button onClick={closeKiosk} aria-label="전광판 닫기" className="rounded-xl bg-white/10 p-2.5 text-slate-200 hover:bg-red-500"><X size={18} /></button>
          </div>
        </header>

        <main className="grid min-h-0 flex-1 gap-3 overflow-y-auto pt-3 lg:grid-cols-12 lg:grid-rows-[minmax(0,1.25fr)_minmax(0,0.75fr)] lg:gap-4 lg:overflow-hidden lg:pt-4">
          <Panel title="오늘 일정" count={data.today.length} breakdown={getScheduleBreakdown(data.today)} tone="blue" className="lg:col-span-3">
            <ScheduleList items={data.today} empty="오늘 등록된 일정이 없습니다." />
          </Panel>

          <Panel title="이번 주 일정" count={data.thisWeek.length} breakdown={getScheduleBreakdown(data.thisWeek)} tone="violet" className="lg:col-span-4">
            <ScheduleList items={data.thisWeek} empty="이번 주 남은 일정이 없습니다." showDate allowColumns />
          </Panel>

          <Panel title="다음 주 일정" count={data.nextWeek.length} breakdown={getScheduleBreakdown(data.nextWeek)} tone="violet" className="lg:col-span-5">
            <ScheduleList items={data.nextWeek} empty="다음 주 등록된 일정이 없습니다." showDate allowColumns />
          </Panel>

          <Panel title="진행 중인 공지" count={data.notices.length} breakdown={getScheduleBreakdown(data.notices, true)} icon={<BellRing size={17} />} tone="red" className="lg:col-span-4">
            <CompactList items={data.notices} empty="진행 중인 공지가 없습니다." />
          </Panel>

          <Panel title="미완료 TO DO" count={data.todos.length} breakdown={getScheduleBreakdown(data.todos, true)} icon={<CheckCircle2 size={17} />} tone="emerald" className="lg:col-span-4">
            <CompactList items={data.todos} empty="미완료 항목이 없습니다." />
          </Panel>

          <Panel title="이번 주·다음 주 휴가" count={data.absences.length} breakdown={getAbsenceBreakdown(data.absences)} icon={<CalendarDays size={17} />} tone="amber" className="lg:col-span-4">
            <AbsenceList items={data.absences} />
          </Panel>
        </main>
      </div>
    </div>
  );
}

const toneStyles = {
  blue: { panel: 'border-blue-400/35 bg-[#101c34]', text: 'text-blue-300', badge: 'border-blue-400/30 bg-blue-500/25 text-blue-100', chip: 'border-blue-400/20 bg-blue-500/15 text-blue-100' },
  violet: { panel: 'border-violet-400/35 bg-[#171a38]', text: 'text-violet-300', badge: 'border-violet-400/30 bg-violet-500/25 text-violet-100', chip: 'border-violet-400/20 bg-violet-500/15 text-violet-100' },
  red: { panel: 'border-rose-400/35 bg-[#24172a]', text: 'text-rose-300', badge: 'border-rose-400/30 bg-rose-500/25 text-rose-100', chip: 'border-rose-400/20 bg-rose-500/15 text-rose-100' },
  emerald: { panel: 'border-emerald-400/35 bg-[#10252b]', text: 'text-emerald-300', badge: 'border-emerald-400/30 bg-emerald-500/25 text-emerald-100', chip: 'border-emerald-400/20 bg-emerald-500/15 text-emerald-100' },
  amber: { panel: 'border-amber-300/35 bg-[#29251c]', text: 'text-amber-300', badge: 'border-amber-300/30 bg-amber-400/25 text-amber-100', chip: 'border-amber-300/20 bg-amber-400/15 text-amber-100' },
};

function Panel({ title, count, breakdown, tone, icon, className = '', children }: { title: string; count: number; breakdown?: ScheduleBreakdownItem[]; tone: keyof typeof toneStyles; icon?: React.ReactNode; className?: string; children: React.ReactNode }) {
  const style = toneStyles[tone];
  return (
    <section className={`flex min-h-0 flex-col rounded-[20px] border-2 p-3 shadow-[0_18px_45px_rgba(0,0,0,0.2)] sm:p-4 lg:rounded-[24px] lg:p-5 ${style.panel} ${className}`}>
      <div className="mb-2.5 flex shrink-0 items-center gap-2 border-b border-white/10 pb-2.5">{icon ? <span className={style.text}>{icon}</span> : <span className={`h-5 w-1 rounded-full ${style.badge.split(' ')[1]}`} />}<h2 className="text-base font-black tracking-tight sm:text-lg lg:text-xl 2xl:text-2xl">{title}</h2><span className={`ml-auto rounded-lg border px-2.5 py-1 text-[10px] font-black lg:text-xs ${style.badge}`}>전체 {count}건</span></div>
      {breakdown && (
        <div className="mb-2.5 grid shrink-0 grid-flow-col auto-cols-fr gap-1.5 lg:mb-3">
          {breakdown.map((item) => (
            <div key={`${title}-${item.label}`} className={`flex min-w-0 items-center justify-center gap-1 rounded-lg border px-1.5 py-1 text-[8px] font-black lg:text-[9px] ${item.count === 0 ? 'border-white/5 bg-black/10 text-slate-600' : style.chip}`}>
              <span className="truncate">{item.label}</span><strong className={item.count === 0 ? 'text-slate-600' : 'text-white'}>{item.count}</strong>
            </div>
          ))}
        </div>
      )}
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
  const category = getScheduleCategory(schedule);
  const categoryStyle = {
    general: { label: '일반', badge: 'bg-blue-400/15 text-blue-200 ring-blue-300/20', icon: 'bg-blue-500/20 text-blue-200' },
    internal: { label: '내부일정', badge: 'bg-cyan-400/15 text-cyan-200 ring-cyan-300/20', icon: 'bg-cyan-500/20 text-cyan-200' },
    business_trip: { label: '출장', badge: 'bg-orange-400/15 text-orange-200 ring-orange-300/20', icon: 'bg-orange-500/20 text-orange-200' },
    meeting: { label: '회의', badge: 'bg-violet-400/15 text-violet-200 ring-violet-300/20', icon: 'bg-violet-500/20 text-violet-200' },
    leave: { label: '휴가', badge: 'bg-amber-400/15 text-amber-200 ring-amber-300/20', icon: 'bg-amber-500/20 text-amber-200' },
  }[category];
  return (
    <div className="flex min-h-0 flex-1 items-center gap-3 rounded-xl border border-white/15 bg-[#071126]/75 px-3 py-2 shadow-sm lg:rounded-2xl lg:px-4">
      <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${schedule.is_urgent ? 'bg-rose-500/25 text-rose-200' : categoryStyle.icon} lg:h-9 lg:w-9`}>{schedule.is_urgent ? <Siren size={16} /> : <CalendarDays size={16} />}</span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <p className="min-w-0 flex-1 truncate text-xs font-black sm:text-sm lg:text-base 2xl:text-lg">{cleanTitle(schedule.title)}</p>
          <span className={`shrink-0 rounded-md px-1.5 py-1 text-[8px] font-black ring-1 ring-inset lg:text-[9px] ${categoryStyle.badge}`}>{categoryStyle.label}</span>
        </div>
        <div className="mt-0.5 flex items-center gap-2">
          {showDate && <span className="shrink-0 text-xs font-black tracking-tight text-white lg:text-sm 2xl:text-base">{formatShortDate(schedule.date)}</span>}
          <span className="flex min-w-0 items-center gap-1 truncate text-[9px] font-bold text-slate-300 lg:text-[10px]"><Clock3 size={10} className="shrink-0" />{formatTime(schedule)}</span>
        </div>
      </div>
    </div>
  );
}

function CompactList({ items, empty }: { items: KioskSchedule[]; empty: string }) {
  if (items.length === 0) return <Empty label={empty} />;
  return <div className="grid h-full min-h-0 gap-1 overflow-hidden lg:gap-1.5" style={{ gridTemplateRows: `repeat(${items.length}, minmax(0, 1fr))` }}>{items.map((schedule) => {
    const categoryLabel = ({ general: '일반', internal: '내부', business_trip: '출장', meeting: '회의', leave: '휴가' })[getScheduleCategory(schedule)];
    return <div key={schedule.id} className="flex min-h-0 items-center gap-2 rounded-xl border border-white/10 bg-[#071126]/70 px-3 py-1.5"><span className="rounded-md bg-white/10 px-1.5 py-1 text-[8px] font-black text-slate-200">{categoryLabel}</span><span className="min-w-0 flex-1 truncate text-xs font-black text-white lg:text-sm">{cleanTitle(schedule.title)}</span><span className="shrink-0 text-[9px] font-bold text-slate-300">{schedule.date.slice(5).replace('-', '.')}</span></div>;
  })}</div>;
}

function AbsenceList({ items }: { items: KioskSchedule[] }) {
  if (items.length === 0) return <Empty label="예정된 휴가·조퇴·외출이 없습니다." />;
  return <div className="grid h-full min-h-0 gap-1 overflow-hidden lg:gap-1.5" style={{ gridTemplateRows: `repeat(${items.length}, minmax(0, 1fr))` }}>{items.map((schedule) => <div key={schedule.id} className="flex min-h-0 items-center gap-2 rounded-xl border border-amber-200/15 bg-amber-950/35 px-3 py-1.5"><span className="rounded-md bg-amber-300/20 px-2 py-1 text-[9px] font-black text-amber-200 ring-1 ring-inset ring-amber-200/20">{absenceLabel(schedule)}</span><span className="shrink-0 text-xs font-black tracking-tight text-amber-50 lg:text-sm 2xl:text-base">{schedule.end_date && schedule.end_date > schedule.date ? `${formatAbsenceDate(schedule.date)}–${formatAbsenceDate(schedule.end_date)}` : formatAbsenceDate(schedule.date)}</span><span className="min-w-0 flex-1 truncate text-xs font-black text-white lg:text-sm 2xl:text-base">{cleanTitle(schedule.title)}</span></div>)}</div>;
}

function Empty({ label }: { label: string }) {
  return <div className="flex h-full min-h-16 items-center justify-center rounded-xl border border-white/10 bg-black/15 px-3 text-center text-[10px] font-bold text-slate-400 lg:text-xs">{label}</div>;
}
