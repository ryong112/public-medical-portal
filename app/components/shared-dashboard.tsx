import { useRef, useState } from 'react';
import { getScheduleCategory, scheduleCategoryStyles, type ScheduleCategory } from '@/lib/schedule-category';
import { type DashboardSchedule as Schedule, formatScheduleDateRange, formatScheduleTime, getAbsenceTypeLabel, getDashboardTodos, getScheduleEndDate, getTodoStatus, scheduleOccursOn, scheduleOverlaps, shiftDateKey, toLocalDateKey } from '@/lib/dashboard-schedules';
import { ArrowRight, BellRing, CalendarDays, Check, ChevronDown, ChevronUp, FolderOpen, MessageCircle, Printer, Siren, X } from 'lucide-react';

type DashboardView = 'files' | 'calendar' | 'external_calendar' | 'dashboard';
type ScheduleFilter = 'all' | ScheduleCategory;
type WeeklyScheduleFilter = Exclude<ScheduleFilter, 'leave'>;
type ScheduleFilterCounts = Record<ScheduleFilter, number>;
interface AbsenceGroup {
  key: string;
  person: string;
  typeLabel: string;
  dateLabel: string;
  schedules: Schedule[];
}
interface SharedDashboardProps {
  schedules: Schedule[];
  onChangeView: (view: DashboardView) => void;
  onOpenChat: () => void;
  onOpenSchedule: (schedule: Schedule) => void;
  onToggleScheduleComplete: (schedule: Schedule) => void;
  onOpenAbsenceBoard?: () => void;
  onPrintWeek?: () => void;
}

const dailyFilters: Array<{ value: ScheduleFilter; label: string }> = [
  { value: 'all', label: '업무 전체' }, { value: 'general', label: '일반' },
  { value: 'internal', label: '내부일정' }, { value: 'business_trip', label: '출장' },
  { value: 'meeting', label: '회의' }, { value: 'leave', label: '휴가' },
];
const weeklyFilters = dailyFilters.filter((filter) => filter.value !== 'leave') as Array<{ value: WeeklyScheduleFilter; label: string }>;
const isAbsence = (schedule: Schedule) => getScheduleCategory(schedule) === 'leave';
const sortTime = (a: Schedule, b: Schedule) => (a.start_time ?? a.end_time ?? '99:99').localeCompare(b.start_time ?? b.end_time ?? '99:99');
const cleanTitle = (title: string) => title.replace(/^(?:회의|출장|내부일정|휴가|연차|조퇴|외출)\s*[)）]\s*/u, '').trim();
const matchesFilter = (schedule: Schedule, filter: ScheduleFilter) => filter === 'all' ? !isAbsence(schedule) : getScheduleCategory(schedule) === filter;
const countCategories = (schedules: Schedule[], workOnly = false): ScheduleFilterCounts => {
  const counts: ScheduleFilterCounts = { all: 0, general: 0, internal: 0, business_trip: 0, meeting: 0, leave: 0 };
  for (const schedule of schedules) {
    const category = getScheduleCategory(schedule);
    counts[category] += 1;
    if (!workOnly || category !== 'leave') counts.all += 1;
  }
  return counts;
};
const getAbsencePeople = (schedule: Schedule) => {
  if (schedule.owner_name?.trim()) return [schedule.owner_name.trim()];
  const names = schedule.title.replace(/^(?:휴가|연차|오전\s*조퇴|오후\s*조퇴|조퇴|외출)\s*[-:：)）]?\s*/u, '').split(/[,，/·]+/u).map((name) => name.trim()).filter(Boolean);
  return [...new Set(names.length ? names : [schedule.title.trim()])];
};
const groupAbsences = (schedules: Schedule[], minimum: string, maximum: string): AbsenceGroup[] => {
  const people = new Map<string, Schedule[]>();
  for (const schedule of schedules) {
    for (const person of getAbsencePeople(schedule)) people.set(person, [...(people.get(person) ?? []), schedule]);
  }
  return [...people.entries()].map(([person, items]) => ({
    key: person, person, typeLabel: [...new Set(items.map(getAbsenceTypeLabel))].join(' · '),
    dateLabel: [...new Set(items.map((schedule) => {
      const start = schedule.date < minimum ? minimum : schedule.date;
      const end = getScheduleEndDate(schedule) > maximum ? maximum : getScheduleEndDate(schedule);
      return start === end ? start : `${start} ~ ${end}`;
    }))].join(', '),
    schedules: items,
  }));
};
const filterStyle = (filter: ScheduleFilter, selected: boolean, color: 'blue' | 'violet') => filter === 'all'
  ? selected ? color === 'blue' ? 'border-blue-600 bg-blue-600 text-white' : 'border-violet-600 bg-violet-600 text-white' : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-100'
  : selected ? scheduleCategoryStyles[filter].filterActive : scheduleCategoryStyles[filter].filter;

function CategoryCounts({ counts, pending = false }: { counts: ScheduleFilterCounts; pending?: boolean }) {
  return <div className="mb-3">
    <p className="mb-2 text-xs font-medium text-slate-500">{pending ? '미완료 유형별 건수' : '유형별 건수'} · 집계</p>
    <dl className="flex flex-wrap gap-x-3 gap-y-2 text-xs">{dailyFilters.slice(1).map(({ value, label }) => (
      <div key={value} data-summary-category={value} className="flex items-center gap-1.5">
        <span aria-hidden="true" className={`h-2 w-2 rounded-full ${scheduleCategoryStyles[value as ScheduleCategory].dot}`} />
        <dt className="text-slate-600">{label}</dt><dd className="font-bold tabular-nums text-slate-900">{counts[value]}</dd>
      </div>
    ))}</dl>
  </div>;
}
function ScheduleMetadata({ schedule }: { schedule: Schedule }) {
  const fields = [schedule.owner_name?.trim() && `담당 ${schedule.owner_name.trim()}`, schedule.location?.trim() && `장소 ${schedule.location.trim()}`].filter(Boolean);
  return fields.length ? <p className="mt-1 break-words text-xs font-medium leading-relaxed text-slate-600">{fields.join(' · ')}</p> : null;
}

export default function SharedDashboard({ schedules, onChangeView, onOpenChat, onOpenSchedule, onToggleScheduleComplete, onOpenAbsenceBoard, onPrintWeek }: SharedDashboardProps) {
  const [todayFilter, setTodayFilter] = useState<ScheduleFilter>('all');
  const [tomorrowFilter, setTomorrowFilter] = useState<ScheduleFilter>('all');
  const [weeklyFilter, setWeeklyFilter] = useState<WeeklyScheduleFilter>('all');
  const [expandedCard, setExpandedCard] = useState<string | null>(null);
  const [selectedPerson, setSelectedPerson] = useState<string | null>(null);
  const detailButtons = useRef<Record<string, HTMLButtonElement | null>>({});
  const now = new Date();
  const today = toLocalDateKey(now);
  const tomorrow = shiftDateKey(today, 1);
  const weekEnd = shiftDateKey(today, 6);
  const monthEnd = toLocalDateKey(new Date(now.getFullYear(), now.getMonth() + 1, 0));
  const todaySchedules = schedules.filter((schedule) => scheduleOccursOn(schedule, today)).sort(sortTime);
  const tomorrowSchedules = schedules.filter((schedule) => scheduleOccursOn(schedule, tomorrow)).sort(sortTime);
  const todos = getDashboardTodos(schedules, today);
  const pendingTodos = todos.filter((schedule) => !schedule.is_completed);
  const overdueCount = pendingTodos.filter((schedule) => getTodoStatus(schedule, today) === '기한 지남').length;
  const notices = schedules.filter((schedule) => schedule.is_notice && getScheduleEndDate(schedule) >= today).sort((a, b) => a.date.localeCompare(b.date) || sortTime(a, b));
  const weekSchedules = schedules.filter((schedule) => scheduleOverlaps(schedule, today, weekEnd) && !isAbsence(schedule)).sort((a, b) => a.date.localeCompare(b.date) || sortTime(a, b));
  const weekCounts = countCategories(weekSchedules, true);
  const monthAbsences = schedules.filter((schedule) => isAbsence(schedule) && scheduleOverlaps(schedule, today, monthEnd)).sort((a, b) => a.date.localeCompare(b.date));
  const absenceGroups = groupAbsences(monthAbsences, today, monthEnd);
  const todayAbsences = groupAbsences(todaySchedules.filter(isAbsence), today, today);
  const selectedAbsence = absenceGroups.find((absence) => absence.key === selectedPerson);
  const absenceTypeCounts = {
    annual: absenceGroups.filter((group) => group.schedules.some((schedule) => getAbsenceTypeLabel(schedule) === '연차')).length,
    early: absenceGroups.filter((group) => group.schedules.some((schedule) => getAbsenceTypeLabel(schedule).includes('조퇴'))).length,
    outing: absenceGroups.filter((group) => group.schedules.some((schedule) => getAbsenceTypeLabel(schedule) === '외출')).length,
  };
  const cards = [
    { key: 'todo', label: 'TO DO LIST', icon: <Check size={18} />, color: 'text-blue-600', border: 'border-blue-100', value: pendingTodos.length, unit: '개', items: todos, counts: countCategories(pendingTodos) },
    { key: 'notice', label: '진행 중인 공지사항', icon: <BellRing size={18} />, color: 'text-red-600', border: 'border-red-100', value: notices.length, unit: '건', items: notices, counts: countCategories(notices) },
    { key: 'week', label: '앞으로 7일', icon: <CalendarDays size={18} />, color: 'text-violet-600', border: 'border-violet-100', value: weekSchedules.length, unit: '건', items: weekSchedules.filter((schedule) => matchesFilter(schedule, weeklyFilter)), counts: weekCounts },
    { key: 'absence', label: '이달 남은 휴가', icon: <CalendarDays size={18} />, color: 'text-orange-700', border: 'border-orange-100', value: absenceGroups.length, unit: '명', items: [] as Schedule[], counts: countCategories(monthAbsences) },
  ];
  const closeDetails = (key: string) => {
    setExpandedCard(null);
    setSelectedPerson(null);
    detailButtons.current[key]?.focus();
  };
  const renderFilters = (selected: ScheduleFilter, select: (filter: ScheduleFilter) => void, color: 'blue' | 'violet', counts: ScheduleFilterCounts, weekly = false) => (
    <div className="flex flex-wrap gap-2" role="group" aria-label={weekly ? '앞으로 7일 일정 유형 필터' : `${color === 'blue' ? '오늘' : '내일'} 일정 유형 필터`}>
      {(weekly ? weeklyFilters : dailyFilters).map(({ value, label }) => (
        <button key={value} type="button" onClick={() => select(value)} aria-pressed={selected === value} aria-label={`${label} ${counts[value]}건`} data-schedule-category={value} className={`inline-flex min-h-10 shrink-0 items-center gap-1.5 rounded-lg border px-2.5 py-2 text-xs font-bold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 ${filterStyle(value, selected === value, color)}`}>
          {value !== 'all' && <span aria-hidden="true" className={`h-2 w-2 shrink-0 rounded-full ${selected === value ? 'bg-white' : scheduleCategoryStyles[value].dot}`} />}
          <span>{label}</span><span className={`rounded px-1.5 tabular-nums ${selected === value ? 'bg-white/20' : 'bg-white/80 text-slate-800'}`}>{counts[value]}</span>
        </button>
      ))}
    </div>
  );
  const renderSchedule = (schedule: Schedule, showDate = false, showTodoStatus = false) => {
    const category = getScheduleCategory(schedule);
    const style = scheduleCategoryStyles[category];
    const status = getTodoStatus(schedule, today);
    return <div key={schedule.id} data-schedule-category={category} className={`flex w-full items-start gap-2 rounded-xl border border-l-4 p-3 ${style.accent} ${schedule.is_completed ? 'border-slate-200 bg-slate-50' : schedule.is_urgent ? 'border-red-200 bg-red-50/50' : 'border-slate-200 bg-white'}`}>
      {schedule.is_todo && <button type="button" onClick={() => onToggleScheduleComplete(schedule)} aria-label={`${schedule.title} ${schedule.is_completed ? '완료 취소' : '완료 처리'}`} aria-pressed={Boolean(schedule.is_completed)} className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-600 ${schedule.is_completed ? 'border-emerald-600 bg-emerald-600 text-white' : 'border-slate-300 bg-white text-slate-400 hover:border-emerald-600'}`}><Check size={18} strokeWidth={3} /></button>}
      <button type="button" onClick={() => onOpenSchedule(schedule)} className="min-w-0 flex-1 rounded text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600">
        <div className="flex flex-wrap items-center gap-1.5 text-xs font-bold">
          <span className={`rounded-md px-2 py-1 ring-1 ring-inset ${style.badge}`}>{category === 'leave' ? getAbsenceTypeLabel(schedule) : style.label}</span>
          {schedule.is_urgent && <span className="inline-flex items-center gap-1 rounded-md bg-red-100 px-2 py-1 text-red-700"><Siren size={13} />긴급</span>}
          {schedule.is_notice && <span className="rounded-md bg-red-50 px-2 py-1 text-red-600">공지</span>}
          {schedule.is_todo && <span className="rounded-md bg-blue-50 px-2 py-1 text-blue-700">TO DO</span>}
          {schedule.is_todo && showTodoStatus && <span className={`rounded-md px-2 py-1 ${status === '기한 지남' ? 'bg-red-100 text-red-700' : status === '완료' ? 'bg-emerald-100 text-emerald-700' : 'bg-blue-100 text-blue-700'}`}>{status}</span>}
        </div>
        <p className={`mt-2 break-words text-sm font-bold leading-relaxed ${schedule.is_completed ? 'text-slate-500 line-through' : 'text-slate-900'}`}>{cleanTitle(schedule.title)}</p>
        <p className={`mt-1 text-xs font-medium leading-relaxed ${style.time}`}>{showDate || getScheduleEndDate(schedule) !== schedule.date ? `${formatScheduleDateRange(schedule)} · ` : ''}{formatScheduleTime(schedule)}</p>
        <ScheduleMetadata schedule={schedule} />
      </button>
    </div>;
  };

  return <div className="h-full min-h-0 overflow-y-auto pb-5 custom-scrollbar">
    <section className="relative overflow-hidden rounded-2xl border border-slate-800 bg-slate-950 px-5 py-5 text-white shadow-xl sm:rounded-[28px] sm:p-6 lg:px-8">
      <div aria-hidden="true" className="absolute -right-20 -top-24 h-64 w-64 rounded-full bg-blue-500/20 blur-3xl" />
      <div className="relative flex flex-col justify-between gap-5 lg:flex-row lg:items-end">
        <div><h2 className="text-[clamp(1.55rem,3vw,2.5rem)] font-black tracking-tight">공공의료지원과 일정</h2><p className="mt-2 text-sm text-slate-300">{new Intl.DateTimeFormat('ko-KR', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' }).format(now)}</p></div>
        <div className="flex flex-wrap gap-2 text-xs font-bold">
          <button type="button" onClick={() => onChangeView('files')} className="flex min-h-11 items-center gap-2 rounded-xl bg-white/10 px-3 py-2.5 hover:bg-white/20"><FolderOpen size={16} />문서함</button>
          <button type="button" onClick={() => onChangeView('calendar')} className="flex min-h-11 items-center gap-2 rounded-xl bg-white/10 px-3 py-2.5 hover:bg-white/20"><CalendarDays size={16} />일정 보기</button>
          {onPrintWeek && <button type="button" onClick={onPrintWeek} className="flex min-h-11 items-center gap-2 rounded-xl bg-white/10 px-3 py-2.5 hover:bg-white/20"><Printer size={16} />주간 인쇄</button>}
          <button type="button" onClick={onOpenChat} className="flex min-h-11 items-center gap-2 rounded-xl bg-blue-500 px-3 py-2.5 hover:bg-blue-400"><MessageCircle size={16} />공유방</button>
        </div>
      </div>
    </section>
    <section className="mt-4 grid items-start gap-3 sm:grid-cols-2 xl:grid-cols-4" aria-label="일정 요약">
      {cards.map((card) => <section key={card.key} onKeyDown={(event) => { if (event.key === 'Escape' && expandedCard === card.key) { event.stopPropagation(); closeDetails(card.key); } }} className={`min-w-0 rounded-2xl border-2 bg-white p-4 shadow-sm ${card.border}`}>
        <div className={`mb-3 flex flex-wrap items-center gap-2 text-sm font-bold ${card.color}`}>{card.icon}<h3>{card.label}</h3>{card.key === 'absence' && onOpenAbsenceBoard && <button type="button" onClick={onOpenAbsenceBoard} className="ml-auto min-h-10 rounded-lg bg-orange-50 px-2.5 text-xs hover:bg-orange-100">현황판</button>}</div>
        {card.key === 'week' && <><p className="mb-2 text-xs leading-relaxed text-slate-500">{today} ~ {weekEnd}<br />휴가 제외 · 업무 전체 {card.value}건</p><p className="mb-2 text-xs font-medium text-slate-500">유형 선택 · 목록 필터</p>{renderFilters(weeklyFilter, (value) => setWeeklyFilter(value as WeeklyScheduleFilter), 'violet', weekCounts, true)}</>}
        {(card.key === 'todo' || card.key === 'notice') && <CategoryCounts counts={card.counts} pending={card.key === 'todo'} />}
        {card.key === 'absence' && <p className="mb-3 text-xs leading-relaxed text-slate-500">{today} ~ {monthEnd}<br />기간 내 휴가·조퇴·외출 인원 (중복 제외)</p>}
        <div className="mt-3 flex flex-wrap items-baseline gap-2">{card.key === 'todo' && <span className="text-sm font-bold text-slate-700">미완료</span>}<strong className="text-3xl font-black tabular-nums text-slate-900">{card.key === 'week' ? card.items.length : card.value}<span className="ml-1 text-sm font-medium text-slate-500">{card.unit}</span></strong>{card.key === 'week' && <span className="text-xs text-slate-500">{weeklyFilters.find((filter) => filter.value === weeklyFilter)?.label}</span>}{card.key === 'todo' && <span className="text-xs font-bold text-emerald-700">완료 {todos.length - pendingTodos.length}개</span>}</div>
        {card.key === 'todo' && <p className="mt-2 text-xs font-medium leading-relaxed text-slate-600"><span className={overdueCount ? 'font-bold text-red-600' : ''}>기한 지남 {overdueCount}개</span> · 오늘 {pendingTodos.length - overdueCount}개<br />지난 미완료 + 오늘 일정</p>}
        {card.key === 'absence' && <>
          <p className="mt-2 text-xs leading-relaxed text-orange-800">연차 {absenceTypeCounts.annual}명 · 조퇴 {absenceTypeCounts.early}명 · 외출 {absenceTypeCounts.outing}명<br /><span className="text-slate-500">유형 간 인원 중복 가능</span></p>
          <div className="mt-3 flex flex-wrap gap-2">{absenceGroups.map((absence) => <button key={absence.key} type="button" onClick={() => { setSelectedPerson(absence.key); setExpandedCard('absence'); }} aria-expanded={expandedCard === 'absence' && selectedPerson === absence.key} aria-controls="dashboard-details-absence" className="min-h-10 rounded-lg bg-orange-50 px-2.5 py-2 text-xs font-bold text-orange-800 hover:bg-orange-100">{absence.person}</button>)}</div>
          <div className="mt-3 border-t border-orange-100 pt-3"><h4 className="text-xs font-bold text-orange-700">오늘 휴가·조퇴·외출</h4>{todayAbsences.length ? <div className="mt-2 flex flex-wrap gap-2">{todayAbsences.map((absence) => <button key={absence.key} type="button" onClick={() => onOpenSchedule(absence.schedules[0])} className="min-h-10 rounded-lg border border-orange-100 bg-orange-50 px-2.5 py-2 text-left text-xs text-orange-800"><strong>{absence.person}</strong> · {absence.typeLabel}</button>)}</div> : <p className="mt-2 text-xs text-slate-500">등록된 일정이 없습니다.</p>}</div>
        </>}
        <button ref={(element) => { detailButtons.current[card.key] = element; }} type="button" onClick={() => { setSelectedPerson(null); setExpandedCard(expandedCard === card.key ? null : card.key); }} aria-expanded={expandedCard === card.key} aria-controls={`dashboard-details-${card.key}`} className={`mt-4 flex min-h-11 w-full items-center justify-between rounded-lg border border-slate-200 bg-slate-50 px-3 text-sm font-bold hover:bg-slate-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 ${card.color}`}>
          {expandedCard === card.key ? '상세 접기' : '상세 보기'}{expandedCard === card.key ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
        </button>
        {expandedCard === card.key && <div id={`dashboard-details-${card.key}`} role="region" aria-label={`${card.label} 상세`} onKeyDown={(event) => { if (event.key === 'Escape') { event.stopPropagation(); closeDetails(card.key); } }} className="mt-3 border-t border-slate-200 pt-3">
          <div className="mb-3 flex items-center justify-between gap-2"><h4 className="text-xs font-bold text-slate-700">{selectedAbsence && card.key === 'absence' ? `${selectedAbsence.person} 상세` : `${card.label} 상세`}</h4><button type="button" onClick={() => closeDetails(card.key)} aria-label={`${card.label} 상세 닫기`} className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg hover:bg-slate-100"><X size={18} /></button></div>
          {card.key === 'absence' ? <div className="space-y-3">{selectedAbsence && <button type="button" onClick={() => setSelectedPerson(null)} className="min-h-10 text-xs font-bold text-orange-700">전체 인원 보기</button>}{(selectedAbsence ? [selectedAbsence] : absenceGroups).map((absence) => <section key={absence.key} className="space-y-2"><h5 className="break-words text-sm font-bold text-slate-800">{absence.person} · {absence.typeLabel}</h5><p className="break-words text-xs text-slate-500">{absence.dateLabel}</p>{absence.schedules.map((schedule) => renderSchedule(schedule, true))}</section>)}{!absenceGroups.length && <p className="py-3 text-sm text-slate-500">등록된 항목이 없습니다.</p>}</div> : <div className="space-y-2">{card.items.length ? card.items.map((schedule) => renderSchedule(schedule, true, card.key === 'todo')) : <p className="py-3 text-sm text-slate-500">등록된 항목이 없습니다.</p>}</div>}
        </div>}
      </section>)}
    </section>
    <section className="mt-4 grid items-start gap-4 lg:grid-cols-2" aria-label="오늘과 내일 일정">
      {[
        { label: '오늘', key: today, schedules: todaySchedules, filter: todayFilter, select: setTodayFilter, color: 'blue' as const },
        { label: '내일', key: tomorrow, schedules: tomorrowSchedules, filter: tomorrowFilter, select: setTomorrowFilter, color: 'violet' as const },
      ].map((day) => {
        const visible = day.schedules.filter((schedule) => matchesFilter(schedule, day.filter));
        return <section key={day.label} className={`min-w-0 rounded-2xl border-2 bg-white p-4 shadow-sm sm:p-5 ${day.color === 'blue' ? 'border-blue-100' : 'border-violet-100'}`}>
          <div className="mb-4 flex flex-wrap items-start justify-between gap-2"><div><p className="text-xs font-medium text-slate-500">{day.key}</p><h3 className="mt-1 text-xl font-black text-slate-900">{day.label} 일정</h3></div><button type="button" onClick={() => onChangeView('calendar')} className="flex min-h-10 items-center gap-1 text-xs font-bold text-blue-700">전체 일정 보기<ArrowRight size={14} /></button></div>
          {renderFilters(day.filter, day.select, day.color, countCategories(day.schedules, true))}<p className="mt-2 text-xs text-slate-500">업무 전체는 휴가·조퇴·외출을 제외합니다.</p>
          <div className="mt-4 space-y-2">{visible.length ? visible.map((schedule) => renderSchedule(schedule, false, true)) : <div className="rounded-xl bg-slate-50 px-4 py-8 text-center"><CalendarDays size={28} className="mx-auto mb-3 text-slate-400" /><p className="text-sm text-slate-600">{day.label} {dailyFilters.find((filter) => filter.value === day.filter)?.label} 일정이 없습니다.</p><button type="button" onClick={() => onChangeView('calendar')} className="mt-3 min-h-10 text-sm font-bold text-blue-700">일정 추가</button></div>}</div>
        </section>;
      })}
    </section>
  </div>;
}
