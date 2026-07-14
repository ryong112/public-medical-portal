import {
  ArrowRight,
  BellRing,
  CalendarDays,
  Check,
  FileText,
  FolderOpen,
  MessageCircle,
  Siren,
} from 'lucide-react';

type DashboardView = 'files' | 'calendar' | 'external_calendar' | 'dashboard';

interface PortalFile {
  id: number;
  name: string;
  url: string;
  category: string;
  created_at?: string;
}

interface Schedule {
  id: number;
  title: string;
  date: string;
  start_time: string | null;
  end_time: string | null;
  is_notice?: boolean;
  is_completed?: boolean;
  is_todo?: boolean;
  is_urgent?: boolean;
  schedule_type?: 'meeting' | 'business_trip' | 'internal' | 'leave' | 'unclassified';
  absence_type?: 'annual' | 'early_am' | 'early_pm';
  created_at?: string;
}

interface AbsenceGroup {
  key: string;
  title: string;
  typeLabel: string;
  dateLabel: string;
  schedules: Schedule[];
}

interface Message {
  id: number;
  content: string;
  created_at: string;
}

interface SharedDashboardProps {
  files: PortalFile[];
  schedules: Schedule[];
  messages: Message[];
  onChangeView: (view: DashboardView) => void;
  onOpenChat: () => void;
  onOpenFile: (url: string, name: string) => void;
  onOpenSchedule: (schedule: Schedule) => void;
  onToggleScheduleComplete: (schedule: Schedule) => void;
}

interface ActivityItem {
  id: string;
  type: 'file' | 'schedule' | 'message';
  title: string;
  description: string;
  createdAt: string;
  onClick: () => void;
}

const toLocalDateKey = (date: Date) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const formatActivityTime = (value: string) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';

  const now = new Date();
  const diffMinutes = Math.max(0, Math.floor((now.getTime() - date.getTime()) / 60000));
  if (diffMinutes < 1) return '방금 전';
  if (diffMinutes < 60) return `${diffMinutes}분 전`;
  if (diffMinutes < 1440) return `${Math.floor(diffMinutes / 60)}시간 전`;

  return new Intl.DateTimeFormat('ko-KR', {
    month: 'short',
    day: 'numeric',
  }).format(date);
};

const formatScheduleTime = (schedule: Schedule) => {
  if (schedule.start_time && schedule.end_time) return `${schedule.start_time} - ${schedule.end_time}`;
  if (schedule.start_time) return `${schedule.start_time}부터`;
  if (schedule.end_time) return `${schedule.end_time}까지`;
  return '시간 미정';
};

const getScheduleSortTime = (schedule: Schedule) => schedule.start_time ?? schedule.end_time ?? '99:99';

const scheduleTypeLabels: Record<NonNullable<Schedule['schedule_type']>, string> = {
  meeting: '회의)',
  business_trip: '출장)',
  internal: '내부일정)',
  leave: '휴가)',
  unclassified: '',
};

const formatScheduleTitle = (schedule: Schedule) => {
  if (schedule.schedule_type === 'leave' && schedule.absence_type === 'early_am') return `오전 조퇴) ${schedule.title}`;
  if (schedule.schedule_type === 'leave' && schedule.absence_type === 'early_pm') return `오후 조퇴) ${schedule.title}`;
  const prefix = scheduleTypeLabels[schedule.schedule_type ?? 'unclassified'];
  return prefix ? `${prefix} ${schedule.title}` : schedule.title;
};

const getAbsenceTypeLabel = (schedule: Schedule) => {
  if (schedule.absence_type === 'early_am' || (schedule.title.includes('오전') && schedule.title.includes('조퇴'))) return '오전 조퇴';
  if (schedule.absence_type === 'early_pm' || (schedule.title.includes('오후') && schedule.title.includes('조퇴'))) return '오후 조퇴';
  return '연차';
};

const formatAbsenceDateRanges = (dateKeys: string[]) => {
  const dates = [...new Set(dateKeys)].sort().map((key) => {
    const [year, month, day] = key.split('-').map(Number);
    return new Date(year, month - 1, day);
  });
  const ranges: Array<{ start: Date; end: Date }> = [];

  for (const date of dates) {
    const lastRange = ranges.at(-1);
    if (!lastRange) {
      ranges.push({ start: date, end: date });
      continue;
    }
    const nextDay = new Date(lastRange.end);
    nextDay.setDate(nextDay.getDate() + 1);
    if (toLocalDateKey(nextDay) === toLocalDateKey(date)) lastRange.end = date;
    else ranges.push({ start: date, end: date });
  }

  return ranges.map(({ start, end }) => {
    const startLabel = `${start.getMonth() + 1}. ${start.getDate()}`;
    if (toLocalDateKey(start) === toLocalDateKey(end)) return `${startLabel}.`;
    if (start.getMonth() === end.getMonth()) return `${startLabel}~${end.getDate()}.`;
    return `${startLabel}~${end.getMonth() + 1}. ${end.getDate()}.`;
  }).join(', ');
};

export default function SharedDashboard({
  files,
  schedules,
  messages,
  onChangeView,
  onOpenChat,
  onOpenFile,
  onOpenSchedule,
  onToggleScheduleComplete,
}: SharedDashboardProps) {
  const now = new Date();
  const todayKey = toLocalDateKey(now);
  const tomorrow = new Date(now);
  tomorrow.setDate(now.getDate() + 1);
  const tomorrowKey = toLocalDateKey(tomorrow);
  const weekEnd = new Date(now);
  weekEnd.setDate(now.getDate() + 6);
  const weekEndKey = toLocalDateKey(weekEnd);
  const monthEndKey = toLocalDateKey(new Date(now.getFullYear(), now.getMonth() + 1, 0));

  const todaySchedules = schedules
    .filter((schedule) => schedule.date === todayKey)
    .sort((a, b) => getScheduleSortTime(a).localeCompare(getScheduleSortTime(b)));
  const todayTodoSchedules = todaySchedules
    .filter((schedule) => schedule.is_todo)
    .sort((a, b) => Number(Boolean(a.is_completed)) - Number(Boolean(b.is_completed)) || getScheduleSortTime(a).localeCompare(getScheduleSortTime(b)));
  const pendingTodoCount = todayTodoSchedules.filter((schedule) => !schedule.is_completed).length;
  const completedTodoCount = todayTodoSchedules.filter((schedule) => schedule.is_completed).length;
  const tomorrowSchedules = schedules
    .filter((schedule) => schedule.date === tomorrowKey)
    .sort((a, b) => getScheduleSortTime(a).localeCompare(getScheduleSortTime(b)));
  const weeklySchedules = schedules
    .filter((schedule) => schedule.date >= todayKey && schedule.date <= weekEndKey)
    .sort((a, b) => a.date.localeCompare(b.date) || getScheduleSortTime(a).localeCompare(getScheduleSortTime(b)));
  const allUpcomingNotices = schedules
    .filter((schedule) => schedule.is_notice && schedule.date >= todayKey)
    .sort((a, b) => a.date.localeCompare(b.date));
  const monthlyAbsenceSchedules = schedules
    .filter((schedule) => schedule.date >= todayKey && schedule.date <= monthEndKey)
    .filter((schedule) => schedule.schedule_type === 'leave' || /휴가|조퇴/.test(schedule.title))
    .sort((a, b) => a.date.localeCompare(b.date));
  const absenceGroupMap = new Map<string, Schedule[]>();
  for (const schedule of monthlyAbsenceSchedules) {
    const key = `${schedule.title.trim()}::${getAbsenceTypeLabel(schedule)}`;
    absenceGroupMap.set(key, [...(absenceGroupMap.get(key) ?? []), schedule]);
  }
  const monthlyAbsenceGroups: AbsenceGroup[] = [...absenceGroupMap.entries()].map(([key, groupedSchedules]) => ({
    key,
    title: groupedSchedules[0].title,
    typeLabel: getAbsenceTypeLabel(groupedSchedules[0]),
    dateLabel: formatAbsenceDateRanges(groupedSchedules.map((schedule) => schedule.date)),
    schedules: groupedSchedules,
  }));
  const recentFiles = [...files]
    .sort((a, b) => (b.created_at ?? '').localeCompare(a.created_at ?? ''))
    .slice(0, 4);
  const summaryCards = [
    { label: 'TO DO LIST', value: pendingTodoCount, unit: '개', color: 'text-blue-600', icon: <Check size={18} />, items: todayTodoSchedules, isTodoCard: true, completedValue: completedTodoCount, isAbsenceCard: false, absenceItems: [] as AbsenceGroup[] },
    { label: '진행 중인 공지사항', value: allUpcomingNotices.length, unit: '건', color: 'text-red-500', icon: <BellRing size={18} />, items: allUpcomingNotices, isTodoCard: false, completedValue: 0, isAbsenceCard: false, absenceItems: [] as AbsenceGroup[] },
    { label: '주간 일정', value: weeklySchedules.length, unit: '건', color: 'text-violet-600', icon: <CalendarDays size={18} />, items: weeklySchedules, isTodoCard: false, completedValue: 0, isAbsenceCard: false, absenceItems: [] as AbsenceGroup[] },
    { label: '이번 달 휴가', value: monthlyAbsenceGroups.length, unit: '건', color: 'text-amber-500', icon: <CalendarDays size={18} />, items: [] as Schedule[], isTodoCard: false, completedValue: 0, isAbsenceCard: true, absenceItems: monthlyAbsenceGroups },
  ];

  const activities: ActivityItem[] = [
    ...files
      .filter((file) => file.created_at)
      .map((file) => ({
        id: `file-${file.id}`,
        type: 'file' as const,
        title: file.name,
        description: `${file.category}에 새 문서가 등록되었습니다.`,
        createdAt: file.created_at as string,
        onClick: () => onOpenFile(file.url, file.name),
      })),
    ...schedules
      .filter((schedule) => schedule.created_at)
      .map((schedule) => ({
        id: `schedule-${schedule.id}`,
        type: 'schedule' as const,
        title: formatScheduleTitle(schedule),
        description: `${schedule.date} 일정이 등록되었습니다.`,
        createdAt: schedule.created_at as string,
        onClick: () => onOpenSchedule(schedule),
      })),
    ...messages.map((message) => ({
      id: `message-${message.id}`,
      type: 'message' as const,
      title: message.content,
      description: '공유방에 새 메시지가 등록되었습니다.',
      createdAt: message.created_at,
      onClick: onOpenChat,
    })),
  ]
    .filter((activity) => !Number.isNaN(new Date(activity.createdAt).getTime()))
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .slice(0, 10);

  const activityIcon = {
    file: <FileText size={16} />,
    schedule: <CalendarDays size={16} />,
    message: <MessageCircle size={16} />,
  };
  const activityColor = {
    file: 'bg-blue-50 text-blue-600',
    schedule: 'bg-violet-50 text-violet-600',
    message: 'bg-amber-50 text-amber-600',
  };

  const renderDailySchedule = (schedule: Schedule, isTomorrow = false) => (
    <div
      key={schedule.id}
      className={`group flex w-full items-center gap-3 rounded-2xl border p-3.5 text-left transition-all ${schedule.is_completed ? 'border-slate-100 bg-slate-50/70' : schedule.is_urgent ? 'border-red-200 bg-red-50/40 hover:border-red-300' : isTomorrow ? 'border-slate-100 hover:border-violet-200 hover:bg-violet-50/40' : 'border-slate-100 hover:border-blue-200 hover:bg-blue-50/50'}`}
    >
      {schedule.is_todo ? (
        <button
          onClick={() => onToggleScheduleComplete(schedule)}
          aria-label={schedule.is_completed ? '완료 취소' : '완료 처리'}
          className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border-2 transition-all ${schedule.is_completed ? 'border-emerald-500 bg-emerald-500 text-white' : 'border-slate-300 bg-white text-transparent hover:border-emerald-500'}`}
        >
          <Check size={15} strokeWidth={3} />
        </button>
      ) : (
        <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg ${isTomorrow ? 'bg-violet-50 text-violet-500' : 'bg-blue-50 text-blue-500'}`}><CalendarDays size={15} /></span>
      )}
      <button onClick={() => onOpenSchedule(schedule)} className="flex min-w-0 flex-1 items-center gap-3 text-left">
        <div className={`w-16 shrink-0 text-xs font-black ${schedule.is_completed ? 'text-slate-400 line-through' : schedule.is_urgent ? 'text-red-600' : isTomorrow ? 'text-violet-600' : 'text-blue-600'}`}>{schedule.start_time ?? schedule.end_time ?? '미정'}</div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            {schedule.is_urgent && <Siren size={15} className="shrink-0 text-red-500" />}
            <p className={`truncate text-sm font-black ${schedule.is_completed ? 'text-slate-400 line-through' : 'text-slate-800'}`}>{formatScheduleTitle(schedule)}</p>
          </div>
          <p className={`mt-1 text-[11px] font-bold ${schedule.is_completed ? 'text-slate-300 line-through' : 'text-slate-400'}`}>{formatScheduleTime(schedule)}</p>
        </div>
        {schedule.is_todo && <span className="rounded-lg bg-blue-50 px-2 py-1 text-[9px] font-black text-blue-600">TO DO</span>}
        {schedule.is_notice && <span className="rounded-lg bg-red-50 px-2 py-1 text-[9px] font-black text-red-500">공지</span>}
        <ArrowRight size={15} className="text-slate-300 transition-transform group-hover:translate-x-1" />
      </button>
    </div>
  );

  return (
    <div className="h-full overflow-y-auto custom-scrollbar pb-8">
      <section className="relative overflow-hidden rounded-[28px] bg-slate-950 px-6 py-7 text-white shadow-xl md:px-9 md:py-8">
        <div className="absolute -right-20 -top-24 h-64 w-64 rounded-full bg-blue-500/20 blur-3xl" />
        <div className="absolute -bottom-24 left-1/3 h-56 w-56 rounded-full bg-violet-500/20 blur-3xl" />
        <div className="relative flex flex-col justify-between gap-6 lg:flex-row lg:items-end">
          <div>
            <h2 className="text-2xl font-black tracking-tight md:text-4xl">
              공공의료지원과 일정
            </h2>
            <p className="mt-2 text-sm font-medium text-slate-400">
              {new Intl.DateTimeFormat('ko-KR', {
                year: 'numeric',
                month: 'long',
                day: 'numeric',
                weekday: 'long',
              }).format(now)}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => onChangeView('files')}
              className="flex items-center gap-2 rounded-2xl bg-white/10 px-4 py-3 text-xs font-black transition-colors hover:bg-white/20"
            >
              <FolderOpen size={16} /> 문서함
            </button>
            <button
              onClick={() => onChangeView('calendar')}
              className="flex items-center gap-2 rounded-2xl bg-white/10 px-4 py-3 text-xs font-black transition-colors hover:bg-white/20"
            >
              <CalendarDays size={16} /> 일정 보기
            </button>
            <button
              onClick={onOpenChat}
              className="flex items-center gap-2 rounded-2xl bg-blue-500 px-4 py-3 text-xs font-black transition-colors hover:bg-blue-400"
            >
              <MessageCircle size={16} /> 공유방
            </button>
          </div>
        </div>
      </section>

      <section className="mt-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {summaryCards.map((item, index) => (
          <div key={item.label} tabIndex={0} className="group relative rounded-[22px] border border-slate-100 bg-white p-4 shadow-sm outline-none transition-all hover:z-30 hover:-translate-y-0.5 hover:border-slate-200 hover:shadow-lg focus:z-30 focus:border-blue-200 focus:ring-4 focus:ring-blue-50 md:p-5">
            <div className={`mb-4 flex items-center gap-2 text-xs font-black ${item.color}`}>
              {item.icon} {item.label}
            </div>
            {item.isTodoCard ? (
              <div className="flex flex-wrap items-end gap-x-3 gap-y-1">
                <strong className="text-xl font-black text-slate-900 md:text-2xl">미시행 {item.value}<span className="ml-0.5 text-xs text-slate-400">개</span></strong>
                <span className="pb-0.5 text-xs font-black text-emerald-600">완료 {item.completedValue}개</span>
              </div>
            ) : (
              <strong className="text-2xl font-black text-slate-900 md:text-3xl">
                {item.value}<span className="ml-1 text-xs text-slate-400">{item.unit}</span>
              </strong>
            )}
            <div className={`pointer-events-none absolute top-full z-40 w-[min(310px,calc(100vw-2rem))] pt-2 opacity-0 transition-all duration-150 group-hover:pointer-events-auto group-hover:translate-y-0 group-hover:opacity-100 group-focus-within:pointer-events-auto group-focus-within:translate-y-0 group-focus-within:opacity-100 ${index % 2 === 0 ? 'left-0' : 'right-0'}`}>
              <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white p-3 shadow-2xl">
                <div className="mb-2 flex items-center justify-between border-b border-slate-100 px-1 pb-2">
                  <span className="text-xs font-black text-slate-700">{item.label} 상세</span>
                  <span className="text-[10px] font-black text-slate-400">{item.value}{item.unit}</span>
                </div>
                {item.isAbsenceCard && item.absenceItems.length > 0 ? (
                  <div className="max-h-64 space-y-1 overflow-y-auto custom-scrollbar">
                    {item.absenceItems.map((absence) => (
                      <button key={absence.key} onClick={() => onOpenSchedule(absence.schedules[0])} className="flex w-full items-center gap-3 rounded-xl px-2.5 py-2.5 text-left transition-colors hover:bg-amber-50 focus:bg-amber-50 focus:outline-none">
                        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-amber-50 text-amber-500"><CalendarDays size={16} /></div>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-xs font-black text-slate-800">{absence.title} <span className="text-amber-600">({absence.dateLabel})</span></p>
                          <p className="mt-1 text-[10px] font-bold text-slate-400">{absence.typeLabel}</p>
                        </div>
                      </button>
                    ))}
                  </div>
                ) : item.items.length > 0 ? (
                  <div className="max-h-64 space-y-1 overflow-y-auto custom-scrollbar">
                    {item.items.map((schedule) => (
                      <div key={`${item.label}-${schedule.id}`} className="flex w-full items-center gap-2 rounded-xl px-2.5 py-2 transition-colors hover:bg-slate-50">
                        {item.isTodoCard && (
                          <button
                            onClick={() => onToggleScheduleComplete(schedule)}
                            aria-label={schedule.is_completed ? '완료 취소' : '완료 처리'}
                            className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border-2 transition-all ${schedule.is_completed ? 'border-emerald-500 bg-emerald-500 text-white' : 'border-slate-300 bg-white text-transparent hover:border-emerald-500'}`}
                          >
                            <Check size={14} strokeWidth={3} />
                          </button>
                        )}
                        <button onClick={() => onOpenSchedule(schedule)} className="flex min-w-0 flex-1 items-center gap-3 py-0.5 text-left focus:outline-none">
                        <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${schedule.is_urgent ? 'bg-red-50 text-red-500' : schedule.is_completed ? 'bg-emerald-50 text-emerald-500' : 'bg-blue-50 text-blue-500'}`}>
                          {schedule.is_urgent ? <Siren size={16} /> : schedule.is_completed ? <Check size={16} /> : <CalendarDays size={16} />}
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className={`truncate text-xs font-black ${schedule.is_completed ? 'text-slate-400 line-through' : 'text-slate-800'}`}>{formatScheduleTitle(schedule)}</p>
                          <p className="mt-1 text-[10px] font-bold text-slate-400">{schedule.date} · {formatScheduleTime(schedule)}</p>
                        </div>
                        {schedule.is_notice && <span className="shrink-0 rounded-md bg-red-50 px-1.5 py-1 text-[8px] font-black text-red-500">공지</span>}
                        </button>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="py-8 text-center text-xs font-bold text-slate-400">등록된 항목이 없습니다.</div>
                )}
              </div>
            </div>
          </div>
        ))}
      </section>

      <section className="mt-5 grid gap-5 xl:grid-cols-[1.15fr_0.85fr]">
        <div className="rounded-[28px] border border-slate-100 bg-white p-5 shadow-sm md:p-7">
          <div className="mb-5 flex items-center justify-between">
            <div>
              <p className="text-[10px] font-black uppercase tracking-[0.18em] text-blue-500">Today</p>
              <h3 className="mt-1 text-xl font-black text-slate-900">오늘 일정</h3>
            </div>
            <button onClick={() => onChangeView('calendar')} className="flex items-center gap-1 text-xs font-black text-slate-400 hover:text-blue-600">
              전체 일정 <ArrowRight size={14} />
            </button>
          </div>

          {todaySchedules.length > 0 ? (
            <div className="max-h-80 space-y-2 overflow-y-auto pr-1 custom-scrollbar">
              {todaySchedules.map((schedule) => renderDailySchedule(schedule))}
            </div>
          ) : (
            <div className="flex min-h-48 flex-col items-center justify-center rounded-2xl bg-slate-50 text-center">
              <CalendarDays size={30} className="mb-3 text-slate-300" />
              <p className="text-sm font-black text-slate-500">오늘 등록된 일정이 없습니다.</p>
              <button onClick={() => onChangeView('calendar')} className="mt-3 text-xs font-black text-blue-500">일정 추가</button>
            </div>
          )}
        </div>

        <div className="rounded-[28px] border border-slate-100 bg-white p-5 shadow-sm md:p-7">
          <div className="mb-5 flex items-center justify-between">
            <div>
              <p className="text-[10px] font-black uppercase tracking-[0.18em] text-violet-500">Tomorrow</p>
              <h3 className="mt-1 text-xl font-black text-slate-900">내일 일정</h3>
            </div>
            <CalendarDays size={20} className="text-violet-400" />
          </div>
          {tomorrowSchedules.length > 0 ? (
            <div className="max-h-80 space-y-2 overflow-y-auto pr-1 custom-scrollbar">
              {tomorrowSchedules.map((schedule) => renderDailySchedule(schedule, true))}
            </div>
          ) : (
            <div className="flex min-h-48 flex-col items-center justify-center rounded-2xl bg-slate-50 text-center">
              <CalendarDays size={30} className="mb-3 text-slate-300" />
              <p className="text-sm font-black text-slate-500">내일 등록된 일정이 없습니다.</p>
              <button onClick={() => onChangeView('calendar')} className="mt-3 text-xs font-black text-violet-500">일정 추가</button>
            </div>
          )}
        </div>
      </section>

      <section className="mt-5 grid gap-5 xl:grid-cols-[0.85fr_1.15fr]">
        <div className="rounded-[28px] border border-slate-100 bg-white p-5 shadow-sm md:p-7">
          <div className="mb-5 flex items-center justify-between">
            <div>
              <p className="text-[10px] font-black uppercase tracking-[0.18em] text-emerald-500">Documents</p>
              <h3 className="mt-1 text-xl font-black text-slate-900">최근 문서</h3>
            </div>
            <button onClick={() => onChangeView('files')} className="flex items-center gap-1 text-xs font-black text-slate-400 hover:text-blue-600">
              문서함 <ArrowRight size={14} />
            </button>
          </div>
          <div className="space-y-2">
            {recentFiles.length > 0 ? recentFiles.map((file) => (
              <button key={file.id} onClick={() => onOpenFile(file.url, file.name)} className="group flex w-full items-center gap-3 rounded-2xl p-3 text-left transition-colors hover:bg-slate-50">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-emerald-50 text-emerald-600"><FileText size={17} /></div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-black text-slate-800">{file.name}</p>
                  <p className="mt-1 text-[10px] font-bold text-slate-400">{file.category}</p>
                </div>
                <ArrowRight size={14} className="text-slate-300 transition-transform group-hover:translate-x-1" />
              </button>
            )) : <p className="py-12 text-center text-sm font-bold text-slate-400">등록된 문서가 없습니다.</p>}
          </div>
        </div>

        <div className="rounded-[28px] border border-slate-100 bg-white p-5 shadow-sm md:p-7">
          <div className="mb-5">
            <p className="text-[10px] font-black uppercase tracking-[0.18em] text-amber-500">Live</p>
            <h3 className="mt-1 text-xl font-black text-slate-900">최근 활동</h3>
          </div>
          <div className="space-y-1">
            {activities.length > 0 ? activities.map((activity) => (
              <button key={activity.id} onClick={activity.onClick} className="group flex w-full items-center gap-3 rounded-2xl p-3 text-left transition-colors hover:bg-slate-50">
                <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${activityColor[activity.type]}`}>
                  {activityIcon[activity.type]}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-black text-slate-800">{activity.title}</p>
                  <p className="mt-1 truncate text-[10px] font-bold text-slate-400">{activity.description}</p>
                </div>
                <time className="shrink-0 text-[10px] font-black text-slate-300">{formatActivityTime(activity.createdAt)}</time>
              </button>
            )) : <p className="py-12 text-center text-sm font-bold text-slate-400">최근 활동이 없습니다.</p>}
          </div>
        </div>
      </section>
    </div>
  );
}
