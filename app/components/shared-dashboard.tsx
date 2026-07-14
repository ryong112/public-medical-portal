import {
  ArrowRight,
  BellRing,
  CalendarDays,
  Check,
  Clock3,
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
  is_urgent?: boolean;
  schedule_type?: 'meeting' | 'business_trip' | 'internal' | 'leave' | 'unclassified';
  created_at?: string;
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
  const prefix = scheduleTypeLabels[schedule.schedule_type ?? 'unclassified'];
  return prefix ? `${prefix} ${schedule.title}` : schedule.title;
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

  const todaySchedules = schedules
    .filter((schedule) => schedule.date === todayKey)
    .sort((a, b) => Number(Boolean(a.is_completed)) - Number(Boolean(b.is_completed)) || getScheduleSortTime(a).localeCompare(getScheduleSortTime(b)));
  const tomorrowSchedules = schedules.filter((schedule) => schedule.date === tomorrowKey);
  const weeklySchedules = schedules
    .filter((schedule) => schedule.date >= todayKey && schedule.date <= weekEndKey)
    .sort((a, b) => a.date.localeCompare(b.date) || getScheduleSortTime(a).localeCompare(getScheduleSortTime(b)));
  const allUpcomingNotices = schedules
    .filter((schedule) => schedule.is_notice && schedule.date >= todayKey)
    .sort((a, b) => a.date.localeCompare(b.date));
  const upcomingNotices = allUpcomingNotices.slice(0, 3);
  const recentFiles = [...files]
    .sort((a, b) => (b.created_at ?? '').localeCompare(a.created_at ?? ''))
    .slice(0, 4);
  const summaryCards = [
    { label: '오늘 일정', value: todaySchedules.length, unit: '건', color: 'text-blue-600', icon: <Clock3 size={18} />, items: todaySchedules },
    { label: '내일 일정', value: tomorrowSchedules.length, unit: '건', color: 'text-violet-600', icon: <CalendarDays size={18} />, items: tomorrowSchedules },
    { label: '진행 중인 공지사항', value: allUpcomingNotices.length, unit: '건', color: 'text-red-500', icon: <BellRing size={18} />, items: allUpcomingNotices },
    { label: '주간 일정', value: weeklySchedules.length, unit: '건', color: 'text-amber-500', icon: <CalendarDays size={18} />, items: weeklySchedules },
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
            <strong className="text-2xl font-black text-slate-900 md:text-3xl">
              {item.value}<span className="ml-1 text-xs text-slate-400">{item.unit}</span>
            </strong>
            <div className={`pointer-events-none absolute top-full z-40 w-[min(310px,calc(100vw-2rem))] pt-2 opacity-0 transition-all duration-150 group-hover:pointer-events-auto group-hover:translate-y-0 group-hover:opacity-100 group-focus-within:pointer-events-auto group-focus-within:translate-y-0 group-focus-within:opacity-100 ${index % 2 === 0 ? 'left-0' : 'right-0'}`}>
              <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white p-3 shadow-2xl">
                <div className="mb-2 flex items-center justify-between border-b border-slate-100 px-1 pb-2">
                  <span className="text-xs font-black text-slate-700">{item.label} 상세</span>
                  <span className="text-[10px] font-black text-slate-400">{item.value}{item.unit}</span>
                </div>
                {item.items.length > 0 ? (
                  <div className="max-h-64 space-y-1 overflow-y-auto custom-scrollbar">
                    {item.items.map((schedule) => (
                      <button key={`${item.label}-${schedule.id}`} onClick={() => onOpenSchedule(schedule)} className="flex w-full items-center gap-3 rounded-xl px-2.5 py-2.5 text-left transition-colors hover:bg-slate-50 focus:bg-slate-50 focus:outline-none">
                        <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${schedule.is_urgent ? 'bg-red-50 text-red-500' : schedule.is_completed ? 'bg-emerald-50 text-emerald-500' : 'bg-blue-50 text-blue-500'}`}>
                          {schedule.is_urgent ? <Siren size={16} /> : schedule.is_completed ? <Check size={16} /> : <CalendarDays size={16} />}
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className={`truncate text-xs font-black ${schedule.is_completed ? 'text-slate-400 line-through' : 'text-slate-800'}`}>{formatScheduleTitle(schedule)}</p>
                          <p className="mt-1 text-[10px] font-bold text-slate-400">{schedule.date} · {formatScheduleTime(schedule)}</p>
                        </div>
                        {schedule.is_notice && <span className="shrink-0 rounded-md bg-red-50 px-1.5 py-1 text-[8px] font-black text-red-500">공지</span>}
                      </button>
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
              <h3 className="mt-1 text-xl font-black text-slate-900">TO DO LIST</h3>
            </div>
            <button onClick={() => onChangeView('calendar')} className="flex items-center gap-1 text-xs font-black text-slate-400 hover:text-blue-600">
              전체 일정 <ArrowRight size={14} />
            </button>
          </div>

          {todaySchedules.length > 0 ? (
            <div className="space-y-2">
              {todaySchedules.map((schedule) => (
                <div
                  key={schedule.id}
                  className={`group flex w-full items-center gap-3 rounded-2xl border p-3.5 text-left transition-all ${schedule.is_completed ? 'border-slate-100 bg-slate-50/70' : schedule.is_urgent ? 'border-red-200 bg-red-50/40 hover:border-red-300' : 'border-slate-100 hover:border-blue-200 hover:bg-blue-50/50'}`}
                >
                  <button
                    onClick={() => onToggleScheduleComplete(schedule)}
                    aria-label={schedule.is_completed ? '완료 취소' : '완료 처리'}
                    className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border-2 transition-all ${schedule.is_completed ? 'border-emerald-500 bg-emerald-500 text-white' : 'border-slate-300 bg-white text-transparent hover:border-emerald-500'}`}
                  >
                    <Check size={15} strokeWidth={3} />
                  </button>
                  <button onClick={() => onOpenSchedule(schedule)} className="flex min-w-0 flex-1 items-center gap-3 text-left">
                    <div className={`w-16 shrink-0 text-xs font-black ${schedule.is_completed ? 'text-slate-400 line-through' : schedule.is_urgent ? 'text-red-600' : 'text-blue-600'}`}>{schedule.start_time ?? schedule.end_time ?? '미정'}</div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        {schedule.is_urgent && <Siren size={15} className="shrink-0 text-red-500" />}
                        <p className={`truncate text-sm font-black ${schedule.is_completed ? 'text-slate-400 line-through' : 'text-slate-800'}`}>{formatScheduleTitle(schedule)}</p>
                      </div>
                      <p className={`mt-1 text-[11px] font-bold ${schedule.is_completed ? 'text-slate-300 line-through' : 'text-slate-400'}`}>{formatScheduleTime(schedule)}</p>
                    </div>
                    {schedule.is_notice && <span className="rounded-lg bg-red-50 px-2 py-1 text-[9px] font-black text-red-500">공지</span>}
                    <ArrowRight size={15} className="text-slate-300 transition-transform group-hover:translate-x-1" />
                  </button>
                </div>
              ))}
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
              <p className="text-[10px] font-black uppercase tracking-[0.18em] text-violet-500">Notice</p>
              <h3 className="mt-1 text-xl font-black text-slate-900">다가오는 공지</h3>
            </div>
            <BellRing size={20} className="text-violet-400" />
          </div>
          <div className="space-y-3">
            {upcomingNotices.length > 0 ? upcomingNotices.map((notice) => (
              <button key={notice.id} onClick={() => onOpenSchedule(notice)} className="w-full rounded-2xl bg-slate-50 p-4 text-left transition-colors hover:bg-violet-50">
                <div className="mb-2 flex items-center justify-between gap-3">
                  <span className="flex min-w-0 items-center gap-1.5 truncate text-sm font-black text-slate-800">{notice.is_urgent && <Siren size={15} className="shrink-0 text-red-500" />}<span className="truncate">{formatScheduleTitle(notice)}</span></span>
                  <span className="shrink-0 rounded-lg bg-white px-2 py-1 text-[10px] font-black text-violet-600 shadow-sm">{notice.date}</span>
                </div>
                <p className="text-[11px] font-bold text-slate-400">{formatScheduleTime(notice)}</p>
              </button>
            )) : (
              <div className="flex min-h-48 flex-col items-center justify-center rounded-2xl bg-slate-50 text-center">
                <BellRing size={30} className="mb-3 text-slate-300" />
                <p className="text-sm font-black text-slate-500">진행 중인 공지사항이 없습니다.</p>
              </div>
            )}
          </div>
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
