export type ScheduleCategory = 'general' | 'internal' | 'business_trip' | 'meeting' | 'leave';

interface ScheduleCategorySource {
  title: string;
  schedule_type?: string | null;
  absence_type?: string | null;
}

// Respect the saved category. Title prefixes only support older uncategorized records.
export const getScheduleCategory = (schedule: ScheduleCategorySource): ScheduleCategory => {
  if (schedule.schedule_type === 'internal' || schedule.schedule_type === 'business_trip'
    || schedule.schedule_type === 'meeting' || schedule.schedule_type === 'leave') return schedule.schedule_type;
  const title = schedule.title.normalize('NFKC').trim();
  if (/^내부일정\s*[):：-]/u.test(title)) return 'internal';
  if (/^출장\s*[):：-]/u.test(title)) return 'business_trip';
  if (/^회의\s*[):：-]/u.test(title)) return 'meeting';
  if (/^(?:휴가|연차|반차|(?:오전|오후)\s*조퇴|조퇴|외출)\s*(?:[):：-]|$)/u.test(title)) return 'leave';
  return 'general';
};

// Literal Tailwind classes let every calendar, filter and input use one palette.
// These UI colors are independent of photographed marker colors (red ink = meeting).
export const scheduleCategoryStyles = {
  general: {
    label: '일반',
    accent: 'border-l-slate-400',
    badge: 'bg-slate-100 text-slate-700 ring-slate-200',
    icon: 'bg-slate-100 text-slate-600',
    dot: 'bg-slate-500',
    chip: 'border-slate-200 bg-slate-50 text-slate-800 hover:border-slate-400 hover:bg-slate-100',
    time: 'text-slate-600',
    filter: 'border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100',
    filterActive: 'border-slate-700 bg-slate-700 text-white',
    darkBadge: 'bg-slate-400/15 text-slate-200 ring-slate-300/20',
    darkIcon: 'bg-slate-500/20 text-slate-200',
    darkAccent: 'border-l-slate-400',
    darkDot: 'bg-slate-300',
  },
  internal: {
    label: '내부일정',
    accent: 'border-l-blue-500',
    badge: 'bg-blue-50 text-blue-700 ring-blue-200',
    icon: 'bg-blue-50 text-blue-600',
    dot: 'bg-blue-500',
    chip: 'border-blue-200 bg-blue-50 text-blue-900 hover:border-blue-400 hover:bg-blue-100',
    time: 'text-blue-700',
    filter: 'border-blue-200 bg-blue-50 text-blue-700 hover:bg-blue-100',
    filterActive: 'border-blue-600 bg-blue-600 text-white',
    darkBadge: 'bg-blue-400/15 text-blue-200 ring-blue-300/20',
    darkIcon: 'bg-blue-500/20 text-blue-200',
    darkAccent: 'border-l-blue-400',
    darkDot: 'bg-blue-300',
  },
  business_trip: {
    label: '출장',
    accent: 'border-l-emerald-500',
    badge: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
    icon: 'bg-emerald-50 text-emerald-700',
    dot: 'bg-emerald-500',
    chip: 'border-emerald-200 bg-emerald-50 text-emerald-900 hover:border-emerald-400 hover:bg-emerald-100',
    time: 'text-emerald-700',
    filter: 'border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100',
    filterActive: 'border-emerald-700 bg-emerald-700 text-white',
    darkBadge: 'bg-emerald-400/15 text-emerald-200 ring-emerald-300/20',
    darkIcon: 'bg-emerald-500/20 text-emerald-200',
    darkAccent: 'border-l-emerald-400',
    darkDot: 'bg-emerald-300',
  },
  meeting: {
    label: '회의',
    accent: 'border-l-violet-500',
    badge: 'bg-violet-50 text-violet-700 ring-violet-200',
    icon: 'bg-violet-50 text-violet-600',
    dot: 'bg-violet-500',
    chip: 'border-violet-200 bg-violet-50 text-violet-900 hover:border-violet-400 hover:bg-violet-100',
    time: 'text-violet-700',
    filter: 'border-violet-200 bg-violet-50 text-violet-700 hover:bg-violet-100',
    filterActive: 'border-violet-600 bg-violet-600 text-white',
    darkBadge: 'bg-violet-400/15 text-violet-200 ring-violet-300/20',
    darkIcon: 'bg-violet-500/20 text-violet-200',
    darkAccent: 'border-l-violet-400',
    darkDot: 'bg-violet-300',
  },
  leave: {
    label: '휴가·조퇴·외출',
    accent: 'border-l-orange-500',
    badge: 'bg-orange-50 text-orange-700 ring-orange-200',
    icon: 'bg-orange-50 text-orange-700',
    dot: 'bg-orange-500',
    chip: 'border-orange-200 bg-orange-50 text-orange-900 hover:border-orange-400 hover:bg-orange-100',
    time: 'text-orange-700',
    filter: 'border-orange-200 bg-orange-50 text-orange-700 hover:bg-orange-100',
    filterActive: 'border-orange-700 bg-orange-700 text-white',
    darkBadge: 'bg-orange-400/15 text-orange-200 ring-orange-300/20',
    darkIcon: 'bg-orange-500/20 text-orange-200',
    darkAccent: 'border-l-orange-400',
    darkDot: 'bg-orange-300',
  },
} satisfies Record<ScheduleCategory, {
  label: string; accent: string; badge: string; icon: string; dot: string;
  chip: string; time: string; filter: string; filterActive: string;
  darkBadge: string; darkIcon: string; darkAccent: string; darkDot: string;
}>;

export const scheduleCategoryOrder: ScheduleCategory[] = ['internal', 'business_trip', 'meeting', 'leave', 'general'];
