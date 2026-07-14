import {
  ArrowRight,
  BellRing,
  CalendarDays,
  Clock3,
  FileText,
  FolderOpen,
  MessageCircle,
  Sparkles,
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
  start_time: string;
  end_time: string;
  is_notice?: boolean;
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

export default function SharedDashboard({
  files,
  schedules,
  messages,
  onChangeView,
  onOpenChat,
  onOpenFile,
  onOpenSchedule,
}: SharedDashboardProps) {
  const now = new Date();
  const todayKey = toLocalDateKey(now);
  const tomorrow = new Date(now);
  tomorrow.setDate(now.getDate() + 1);
  const tomorrowKey = toLocalDateKey(tomorrow);

  const todaySchedules = schedules
    .filter((schedule) => schedule.date === todayKey)
    .sort((a, b) => a.start_time.localeCompare(b.start_time));
  const tomorrowSchedules = schedules.filter((schedule) => schedule.date === tomorrowKey);
  const allUpcomingNotices = schedules
    .filter((schedule) => schedule.is_notice && schedule.date >= todayKey)
    .sort((a, b) => a.date.localeCompare(b.date));
  const upcomingNotices = allUpcomingNotices.slice(0, 3);
  const recentFiles = [...files]
    .sort((a, b) => (b.created_at ?? '').localeCompare(a.created_at ?? ''))
    .slice(0, 4);
  const messagesToday = messages.filter(
    (message) => toLocalDateKey(new Date(message.created_at)) === todayKey,
  ).length;

  const activities: ActivityItem[] = [
    ...files
      .filter((file) => file.created_at)
      .map((file) => ({
        id: `file-${file.id}`,
        type: 'file' as const,
        title: file.name,
        description: `${file.category}에 새 문서가 올라왔어요`,
        createdAt: file.created_at as string,
        onClick: () => onOpenFile(file.url, file.name),
      })),
    ...schedules
      .filter((schedule) => schedule.created_at)
      .map((schedule) => ({
        id: `schedule-${schedule.id}`,
        type: 'schedule' as const,
        title: schedule.title,
        description: `${schedule.date} 일정이 등록됐어요`,
        createdAt: schedule.created_at as string,
        onClick: () => onOpenSchedule(schedule),
      })),
    ...messages.map((message) => ({
      id: `message-${message.id}`,
      type: 'message' as const,
      title: message.content,
      description: '공유방에 새 메시지가 도착했어요',
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
            <div className="mb-3 flex items-center gap-2 text-xs font-black text-blue-300">
              <Sparkles size={15} /> TODAY BRIEFING
            </div>
            <h2 className="text-2xl font-black tracking-tight md:text-4xl">
              오늘의 브리핑
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
        {[
          { label: '오늘 일정', value: todaySchedules.length, unit: '건', color: 'text-blue-600', icon: <Clock3 size={18} /> },
          { label: '내일 일정', value: tomorrowSchedules.length, unit: '건', color: 'text-violet-600', icon: <CalendarDays size={18} /> },
          { label: '진행 공지', value: allUpcomingNotices.length, unit: '건', color: 'text-red-500', icon: <BellRing size={18} /> },
          { label: '오늘 대화', value: messagesToday, unit: '개', color: 'text-amber-500', icon: <MessageCircle size={18} /> },
        ].map((item) => (
          <div key={item.label} className="rounded-[22px] border border-slate-100 bg-white p-4 shadow-sm md:p-5">
            <div className={`mb-4 flex items-center gap-2 text-xs font-black ${item.color}`}>
              {item.icon} {item.label}
            </div>
            <strong className="text-2xl font-black text-slate-900 md:text-3xl">
              {item.value}<span className="ml-1 text-xs text-slate-400">{item.unit}</span>
            </strong>
          </div>
        ))}
      </section>

      <section className="mt-5 grid gap-5 xl:grid-cols-[1.15fr_0.85fr]">
        <div className="rounded-[28px] border border-slate-100 bg-white p-5 shadow-sm md:p-7">
          <div className="mb-5 flex items-center justify-between">
            <div>
              <p className="text-[10px] font-black uppercase tracking-[0.18em] text-blue-500">Today</p>
              <h3 className="mt-1 text-xl font-black text-slate-900">오늘의 흐름</h3>
            </div>
            <button onClick={() => onChangeView('calendar')} className="flex items-center gap-1 text-xs font-black text-slate-400 hover:text-blue-600">
              전체 일정 <ArrowRight size={14} />
            </button>
          </div>

          {todaySchedules.length > 0 ? (
            <div className="space-y-2">
              {todaySchedules.map((schedule) => (
                <button
                  key={schedule.id}
                  onClick={() => onOpenSchedule(schedule)}
                  className="group flex w-full items-center gap-4 rounded-2xl border border-slate-100 p-4 text-left transition-all hover:border-blue-200 hover:bg-blue-50/50"
                >
                  <div className="w-14 shrink-0 text-sm font-black text-blue-600">{schedule.start_time}</div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-black text-slate-800">{schedule.title}</p>
                    <p className="mt-1 text-[11px] font-bold text-slate-400">{schedule.start_time} - {schedule.end_time}</p>
                  </div>
                  {schedule.is_notice && <span className="rounded-lg bg-red-50 px-2 py-1 text-[9px] font-black text-red-500">공지</span>}
                  <ArrowRight size={15} className="text-slate-300 transition-transform group-hover:translate-x-1" />
                </button>
              ))}
            </div>
          ) : (
            <div className="flex min-h-48 flex-col items-center justify-center rounded-2xl bg-slate-50 text-center">
              <CalendarDays size={30} className="mb-3 text-slate-300" />
              <p className="text-sm font-black text-slate-500">오늘 등록된 일정이 없어요</p>
              <button onClick={() => onChangeView('calendar')} className="mt-3 text-xs font-black text-blue-500">일정 추가하러 가기</button>
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
                  <span className="truncate text-sm font-black text-slate-800">{notice.title}</span>
                  <span className="shrink-0 rounded-lg bg-white px-2 py-1 text-[10px] font-black text-violet-600 shadow-sm">{notice.date}</span>
                </div>
                <p className="text-[11px] font-bold text-slate-400">{notice.start_time} - {notice.end_time}</p>
              </button>
            )) : (
              <div className="flex min-h-48 flex-col items-center justify-center rounded-2xl bg-slate-50 text-center">
                <BellRing size={30} className="mb-3 text-slate-300" />
                <p className="text-sm font-black text-slate-500">진행 중인 공지가 없어요</p>
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
            )) : <p className="py-12 text-center text-sm font-bold text-slate-400">아직 등록된 문서가 없어요</p>}
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
            )) : <p className="py-12 text-center text-sm font-bold text-slate-400">활동이 쌓이면 여기에 보여드릴게요</p>}
          </div>
        </div>
      </section>
    </div>
  );
}
