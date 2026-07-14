'use client';

import { useState } from 'react';
import { BellRing, CalendarPlus, CheckSquare2, Clock3, Siren, X } from 'lucide-react';

export type ScheduleType = 'meeting' | 'business_trip' | 'internal' | 'leave' | 'unclassified';
export type AbsenceType = 'annual' | 'early_am' | 'early_pm';

export interface NewScheduleInput {
  title: string;
  date: string;
  start_time: string | null;
  end_time: string | null;
  is_notice: boolean;
  is_urgent: boolean;
  is_completed: boolean;
  is_todo: boolean;
  schedule_type: ScheduleType;
  absence_type: AbsenceType;
}

interface ScheduleFormModalProps {
  date: string;
  initialSchedule?: NewScheduleInput;
  onClose: () => void;
  onSubmit: (schedules: NewScheduleInput[]) => Promise<void>;
}

type TimeMode = 'both' | 'start' | 'end' | 'none';
type RecurrenceMode = 'none' | 'weekly' | 'biweekly' | 'monthly_first';

const weekdayNames = ['일', '월', '화', '수', '목', '금', '토'];

const parseLocalDate = (date: string) => {
  const [year, month, day] = date.split('-').map(Number);
  return new Date(year, month - 1, day);
};

const formatLocalDate = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;

const createRecurringDates = (startDate: string, mode: RecurrenceMode) => {
  if (mode === 'none') return [startDate];

  const start = parseLocalDate(startDate);
  const yearEnd = new Date(start.getFullYear(), 11, 31);
  const dates: string[] = [];

  if (mode === 'weekly' || mode === 'biweekly') {
    const cursor = new Date(start);
    const interval = mode === 'weekly' ? 7 : 14;
    while (cursor <= yearEnd) {
      dates.push(formatLocalDate(cursor));
      cursor.setDate(cursor.getDate() + interval);
    }
    return dates;
  }

  const weekday = start.getDay();
  for (let month = start.getMonth(); month <= 11; month += 1) {
    const firstDay = new Date(start.getFullYear(), month, 1);
    const occurrence = new Date(start.getFullYear(), month, 1 + ((weekday - firstDay.getDay() + 7) % 7));
    if (occurrence >= start && occurrence <= yearEnd) dates.push(formatLocalDate(occurrence));
  }
  return dates;
};

const addMinutes = (time: string, minutes: number) => {
  const [hour, minute] = time.split(':').map(Number);
  const total = Math.min(hour * 60 + minute + minutes, 23 * 60 + 59);
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
};

const getDefaultTimes = (date: string) => {
  const now = new Date();
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  if (date !== today) return { start: '10:00', end: '11:00' };

  const roundedTotal = Math.min(Math.ceil((now.getHours() * 60 + now.getMinutes() + 1) / 30) * 30, 23 * 60);
  const start = `${String(Math.floor(roundedTotal / 60)).padStart(2, '0')}:${String(roundedTotal % 60).padStart(2, '0')}`;
  return { start, end: addMinutes(start, 60) };
};

export default function ScheduleFormModal({ date, initialSchedule, onClose, onSubmit }: ScheduleFormModalProps) {
  const defaults = getDefaultTimes(date);
  const initialTimeMode: TimeMode = initialSchedule
    ? initialSchedule.start_time && initialSchedule.end_time ? 'both' : initialSchedule.start_time ? 'start' : initialSchedule.end_time ? 'end' : 'none'
    : 'both';
  const [dateValue, setDateValue] = useState(initialSchedule?.date ?? date);
  const [title, setTitle] = useState(initialSchedule?.title ?? '');
  const [timeMode, setTimeMode] = useState<TimeMode>(initialTimeMode);
  const [startTime, setStartTime] = useState(initialSchedule?.start_time ?? defaults.start);
  const [endTime, setEndTime] = useState(initialSchedule?.end_time ?? defaults.end);
  const [isNotice, setIsNotice] = useState(initialSchedule?.is_notice ?? false);
  const [isTodo, setIsTodo] = useState(initialSchedule?.is_todo ?? false);
  const [isUrgent, setIsUrgent] = useState(initialSchedule?.is_urgent ?? false);
  const [scheduleType, setScheduleType] = useState<ScheduleType>(initialSchedule?.schedule_type ?? 'unclassified');
  const [absenceType, setAbsenceType] = useState<AbsenceType>(initialSchedule?.absence_type ?? 'annual');
  const [recurrenceMode, setRecurrenceMode] = useState<RecurrenceMode>('none');
  const [error, setError] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  const applyDuration = (minutes: number) => {
    setEndTime(addMinutes(startTime, minutes));
    setError('');
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!title.trim()) {
      setError('일정 제목을 입력해 주십시오.');
      return;
    }
    if (timeMode === 'both' && endTime <= startTime) {
      setError('종료 시간은 시작 시간보다 늦어야 합니다.');
      return;
    }

    setIsSaving(true);
    setError('');
    try {
      const schedule: NewScheduleInput = {
        title: title.trim(),
        date: dateValue,
        start_time: timeMode === 'both' || timeMode === 'start' ? startTime : null,
        end_time: timeMode === 'both' || timeMode === 'end' ? endTime : null,
        is_notice: isNotice,
        is_urgent: isUrgent,
        is_completed: initialSchedule?.is_completed ?? false,
        is_todo: isTodo,
        schedule_type: scheduleType,
        absence_type: absenceType,
      };
      const recurringDates = initialSchedule ? [dateValue] : createRecurringDates(dateValue, recurrenceMode);
      await onSubmit(recurringDates.map((recurringDate) => ({ ...schedule, date: recurringDate })));
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : '일정을 등록하지 못했습니다.');
      setIsSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[240] flex items-center justify-center bg-slate-950/55 p-4 backdrop-blur-sm" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <form onSubmit={handleSubmit} className="max-h-[92vh] w-full max-w-lg overflow-y-auto rounded-[30px] bg-white p-6 shadow-2xl md:p-8">
        <div className="mb-7 flex items-start justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-blue-50 text-blue-600">
              <CalendarPlus size={23} />
            </div>
            <div>
              <h2 className="text-xl font-black text-slate-900">{initialSchedule ? '일정 수정' : '일정 추가'}</h2>
              <p className="mt-1 text-xs font-bold text-slate-400">날짜와 내용을 입력해 주십시오.</p>
            </div>
          </div>
          <button type="button" onClick={onClose} aria-label="닫기" className="rounded-xl bg-slate-100 p-2 text-slate-500 transition-colors hover:bg-slate-200">
            <X size={18} />
          </button>
        </div>

        <label className="mb-5 block">
          <span className="mb-2 block text-xs font-black text-slate-600">날짜</span>
          <input type="date" value={dateValue} onChange={(event) => setDateValue(event.target.value)} className="w-full rounded-2xl border-2 border-slate-100 bg-slate-50 px-4 py-3.5 text-sm font-bold text-slate-900 outline-none transition-all focus:border-blue-500 focus:bg-white" />
        </label>

        <label className="block">
          <span className="mb-2 block text-xs font-black text-slate-600">일정 제목</span>
          <input autoFocus value={title} onChange={(event) => setTitle(event.target.value)} placeholder="일정 제목을 입력해 주십시오." className="w-full rounded-2xl border-2 border-slate-100 bg-slate-50 px-4 py-3.5 text-sm font-bold text-slate-900 outline-none transition-all focus:border-blue-500 focus:bg-white" />
        </label>

        <div className="mt-5">
          <span className="mb-2 block text-xs font-black text-slate-600">일정 유형</span>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
            {[
              { value: 'meeting' as const, label: '회의)' },
              { value: 'business_trip' as const, label: '출장)' },
              { value: 'internal' as const, label: '내부일정)' },
              { value: 'leave' as const, label: '휴가)' },
              { value: 'unclassified' as const, label: '미분류)' },
            ].map((type) => (
              <button key={type.value} type="button" onClick={() => setScheduleType(type.value)} className={`rounded-xl px-2 py-2.5 text-[10px] font-black transition-colors ${scheduleType === type.value ? 'bg-blue-600 text-white shadow-md' : 'bg-slate-100 text-slate-500 hover:bg-slate-200'}`}>{type.label}</button>
            ))}
          </div>
          {scheduleType === 'leave' && (
            <div className="mt-3 rounded-2xl bg-amber-50 p-3">
              <span className="mb-2 block text-[10px] font-black text-amber-700">휴가 구분</span>
              <div className="grid grid-cols-3 gap-2">
                {[
                  { value: 'annual' as const, label: '연차' },
                  { value: 'early_am' as const, label: '오전 조퇴' },
                  { value: 'early_pm' as const, label: '오후 조퇴' },
                ].map((type) => (
                  <button key={type.value} type="button" onClick={() => setAbsenceType(type.value)} className={`rounded-xl px-2 py-2.5 text-[10px] font-black transition-colors ${absenceType === type.value ? 'bg-amber-500 text-white shadow-md' : 'bg-white text-amber-700 hover:bg-amber-100'}`}>{type.label}</button>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="mt-5 rounded-2xl border border-slate-100 bg-slate-50 p-4">
          <div className="mb-3 flex items-center gap-2 text-xs font-black text-slate-600"><Clock3 size={15} /> 일정 시간</div>
          <div className="mb-3 grid grid-cols-2 gap-1.5 sm:grid-cols-4">
            {[
              { value: 'both' as const, label: '시작·종료' },
              { value: 'start' as const, label: '시작만' },
              { value: 'end' as const, label: '종료만' },
              { value: 'none' as const, label: '시간 미정' },
            ].map((mode) => (
              <button key={mode.value} type="button" onClick={() => { setTimeMode(mode.value); if ((mode.value === 'both' || mode.value === 'start') && !startTime) setStartTime(defaults.start); if ((mode.value === 'both' || mode.value === 'end') && !endTime) setEndTime(defaults.end); setError(''); }} className={`rounded-lg px-2 py-2 text-[10px] font-black transition-colors ${timeMode === mode.value ? 'bg-slate-900 text-white' : 'bg-white text-slate-400 hover:text-slate-700'}`}>{mode.label}</button>
            ))}
          </div>
          <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3">
            <label>
              <span className="mb-1.5 block text-[10px] font-bold text-slate-400">시작</span>
              <input type="time" disabled={timeMode === 'end' || timeMode === 'none'} value={timeMode === 'end' || timeMode === 'none' ? '' : startTime} onChange={(event) => { setStartTime(event.target.value); if (timeMode === 'both') setEndTime(addMinutes(event.target.value, 60)); setError(''); }} className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm font-black text-slate-800 outline-none focus:border-blue-500 disabled:cursor-not-allowed disabled:bg-slate-100" />
            </label>
            <span className="mt-5 text-slate-300">→</span>
            <label>
              <span className="mb-1.5 block text-[10px] font-bold text-slate-400">종료</span>
              <input type="time" disabled={timeMode === 'start' || timeMode === 'none'} value={timeMode === 'start' || timeMode === 'none' ? '' : endTime} onChange={(event) => { setEndTime(event.target.value); setError(''); }} className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm font-black text-slate-800 outline-none focus:border-blue-500 disabled:cursor-not-allowed disabled:bg-slate-100" />
            </label>
          </div>
          {timeMode === 'both' && <div className="mt-3 flex flex-wrap gap-2">
            {[{ label: '30분', minutes: 30 }, { label: '1시간', minutes: 60 }, { label: '2시간', minutes: 120 }, { label: '업무시간', minutes: 480 }].map((duration) => (
              <button key={duration.label} type="button" onClick={() => applyDuration(duration.minutes)} className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-[10px] font-black text-slate-500 transition-colors hover:border-blue-300 hover:text-blue-600">{duration.label}</button>
            ))}
          </div>}
        </div>

        {!initialSchedule && (
          <div className="mt-5 rounded-2xl border border-blue-100 bg-blue-50/40 p-4">
            <div className="mb-3 flex items-center justify-between gap-3">
              <div>
                <p className="text-xs font-black text-slate-700">정기 일정</p>
                <p className="mt-1 text-[10px] font-bold text-slate-400">선택한 날짜부터 {parseLocalDate(dateValue).getFullYear()}년 12월 31일까지만 등록합니다.</p>
              </div>
              {recurrenceMode !== 'none' && <span className="shrink-0 rounded-lg bg-blue-600 px-2.5 py-1 text-[10px] font-black text-white">{createRecurringDates(dateValue, recurrenceMode).length}건</span>}
            </div>
            <div className="grid grid-cols-2 gap-2">
              {[
                { value: 'none' as const, label: '반복 안 함' },
                { value: 'weekly' as const, label: `매주 ${weekdayNames[parseLocalDate(dateValue).getDay()]}요일` },
                { value: 'biweekly' as const, label: `2주마다 ${weekdayNames[parseLocalDate(dateValue).getDay()]}요일` },
                { value: 'monthly_first' as const, label: `매월 첫째 ${weekdayNames[parseLocalDate(dateValue).getDay()]}요일` },
              ].map((option) => (
                <button key={option.value} type="button" onClick={() => setRecurrenceMode(option.value)} className={`rounded-xl px-3 py-2.5 text-[10px] font-black transition-all ${recurrenceMode === option.value ? 'bg-blue-600 text-white shadow-md' : 'bg-white text-slate-500 hover:bg-blue-100'}`}>{option.label}</button>
              ))}
            </div>
          </div>
        )}

        <div className="mt-5 rounded-2xl border border-slate-100 p-4">
          <div className="mb-3 flex items-center gap-2 text-xs font-black text-slate-700"><BellRing size={15} className="text-violet-500" /> 이 일정을 공지사항에 추가하시겠습니까?</div>
          <div className="grid grid-cols-2 gap-2">
            <button type="button" onClick={() => setIsNotice(true)} className={`rounded-xl py-2.5 text-xs font-black transition-all ${isNotice ? 'bg-violet-600 text-white shadow-md' : 'bg-slate-100 text-slate-500 hover:bg-slate-200'}`}>네</button>
            <button type="button" onClick={() => setIsNotice(false)} className={`rounded-xl py-2.5 text-xs font-black transition-all ${!isNotice ? 'bg-slate-800 text-white shadow-md' : 'bg-slate-100 text-slate-500 hover:bg-slate-200'}`}>아니오</button>
          </div>
        </div>

        <div className="mt-3 rounded-2xl border border-slate-100 p-4">
          <div className="mb-3 flex items-center gap-2 text-xs font-black text-slate-700"><CheckSquare2 size={15} className="text-blue-500" /> 이 일정을 TO DO LIST에 추가하시겠습니까?</div>
          <div className="grid grid-cols-2 gap-2">
            <button type="button" onClick={() => setIsTodo(true)} className={`rounded-xl py-2.5 text-xs font-black transition-all ${isTodo ? 'bg-blue-600 text-white shadow-md' : 'bg-slate-100 text-slate-500 hover:bg-slate-200'}`}>네</button>
            <button type="button" onClick={() => setIsTodo(false)} className={`rounded-xl py-2.5 text-xs font-black transition-all ${!isTodo ? 'bg-slate-800 text-white shadow-md' : 'bg-slate-100 text-slate-500 hover:bg-slate-200'}`}>아니오</button>
          </div>
        </div>

        <button type="button" onClick={() => setIsUrgent((current) => !current)} className={`mt-3 flex w-full items-center gap-3 rounded-2xl border p-4 text-left transition-all ${isUrgent ? 'border-red-300 bg-red-50 text-red-700' : 'border-slate-100 bg-white text-slate-600 hover:bg-slate-50'}`}>
          <span className={`flex h-10 w-10 items-center justify-center rounded-xl ${isUrgent ? 'bg-red-500 text-white' : 'bg-slate-100 text-slate-400'}`}><Siren size={19} /></span>
          <span className="flex-1">
            <span className="block text-xs font-black">긴급 일정으로 표시</span>
            <span className="mt-1 block text-[10px] font-bold opacity-60">브리핑과 공지사항에 사이렌 아이콘을 표시합니다.</span>
          </span>
          <span className={`h-5 w-9 rounded-full p-0.5 transition-colors ${isUrgent ? 'bg-red-500' : 'bg-slate-900'}`}><span className={`block h-4 w-4 rounded-full bg-white shadow transition-transform ${isUrgent ? 'translate-x-4' : ''}`} /></span>
        </button>

        {error && <p className="mt-4 rounded-xl bg-red-50 px-4 py-3 text-xs font-bold text-red-600">{error}</p>}

        <div className="mt-7 flex gap-3">
          <button type="button" onClick={onClose} className="flex-1 rounded-2xl bg-slate-100 py-3.5 text-sm font-black text-slate-600 transition-colors hover:bg-slate-200">취소</button>
          <button disabled={isSaving} className="flex-1 rounded-2xl bg-blue-600 py-3.5 text-sm font-black text-white shadow-lg transition-all hover:bg-blue-700 disabled:cursor-wait disabled:opacity-60">{isSaving ? '저장 중...' : initialSchedule ? '변경사항 저장' : recurrenceMode === 'none' ? '일정 추가' : `${createRecurringDates(dateValue, recurrenceMode).length}개 일정 추가`}</button>
        </div>
      </form>
    </div>
  );
}
