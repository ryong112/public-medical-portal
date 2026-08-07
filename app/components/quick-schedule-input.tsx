'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { AlertTriangle, CalendarPlus, Clock3, Sparkles, X } from 'lucide-react';
import type { AbsenceType, NewScheduleInput, ScheduleType } from '@/app/components/schedule-form-modal';

interface QuickScheduleInputProps {
  open: boolean;
  onClose: () => void;
  defaultDate: string;
  onSubmit: (schedule: NewScheduleInput) => void | Promise<void>;
}

interface ParsedQuickSchedule {
  original: string;
  schedule: NewScheduleInput;
  warnings: string[];
}

const weekdayIndexes: Record<string, number> = {
  일: 0,
  월: 1,
  화: 2,
  수: 3,
  목: 4,
  금: 5,
  토: 6,
};

const parseDateKey = (dateKey: string) => {
  const [year, month, day] = dateKey.split('-').map(Number);
  return new Date(year, month - 1, day);
};

const formatDateKey = (date: Date) => (
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
);

const addDays = (date: Date, days: number) => {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
};

const getKstToday = () => {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
  }).formatToParts(new Date());
  const readPart = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((part) => part.type === type)?.value);
  return new Date(readPart('year'), readPart('month') - 1, readPart('day'));
};

const isValidDate = (year: number, month: number, day: number) => {
  const date = new Date(year, month - 1, day);
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day;
};

const normalizeSpaces = (value: string) => value
  .replace(/\s*[,|]\s*/g, (separator) => separator.trim() === ',' ? ',' : ' ')
  .replace(/\s+/g, ' ')
  .replace(/^[\s,·/-]+|[\s,·/-]+$/g, '')
  .trim();

export const parseQuickSchedule = (source: string, defaultDate: string): ParsedQuickSchedule => {
  const original = source.trim();
  const warnings: string[] = [];
  const fallbackDate = parseDateKey(defaultDate);
  const fallbackYear = fallbackDate.getFullYear();
  let remainder = original;
  let parsedDate = defaultDate;

  const explicitDateMatch = remainder.match(/(?:(\d{4})\s*[./-]\s*)?(\d{1,2})\s*[./-]\s*(\d{1,2})(?:일)?|(?:(\d{4})\s*년\s*)?(\d{1,2})\s*월\s*(\d{1,2})\s*일?/);
  if (explicitDateMatch) {
    const yearText = explicitDateMatch[1] ?? explicitDateMatch[4];
    const monthText = explicitDateMatch[2] ?? explicitDateMatch[5];
    const dayText = explicitDateMatch[3] ?? explicitDateMatch[6];
    const year = yearText ? Number(yearText) : fallbackYear;
    const month = Number(monthText);
    const day = Number(dayText);
    if (isValidDate(year, month, day)) {
      parsedDate = formatDateKey(new Date(year, month - 1, day));
      if (!yearText) warnings.push(`연도가 없어 ${fallbackYear}년으로 해석했습니다.`);
    } else {
      warnings.push(`'${explicitDateMatch[0]}'은 올바른 날짜가 아니어서 기본 날짜를 사용했습니다.`);
    }
    remainder = remainder.replace(explicitDateMatch[0], ' ');
  } else {
    const relativeMatch = remainder.match(/오늘|내일|모레/);
    if (relativeMatch) {
      const offset = relativeMatch[0] === '오늘' ? 0 : relativeMatch[0] === '내일' ? 1 : 2;
      parsedDate = formatDateKey(addDays(getKstToday(), offset));
      remainder = remainder.replace(relativeMatch[0], ' ');
    } else {
      const weekdayMatch = remainder.match(/([일월화수목금토])요일/);
      if (weekdayMatch) {
        const today = getKstToday();
        const requestedWeekday = weekdayIndexes[weekdayMatch[1]];
        const offset = (requestedWeekday - today.getDay() + 7) % 7;
        parsedDate = formatDateKey(addDays(today, offset));
        if (offset === 0) warnings.push(`'${weekdayMatch[0]}'을 오늘로 해석했습니다.`);
        remainder = remainder.replace(weekdayMatch[0], ' ');
      } else {
        warnings.push(`날짜 표현을 찾지 못해 기본 날짜 ${defaultDate}을 사용했습니다.`);
      }
    }
  }

  let startTime: string | null = null;
  const timeMatch = remainder.match(/(?:(오전|오후)\s*)?(\d{1,2})(?::(\d{1,2})|\s*시(?:\s*(\d{1,2})\s*분?)?)/);
  if (timeMatch) {
    const meridiem = timeMatch[1];
    let hour = Number(timeMatch[2]);
    const minute = Number(timeMatch[3] ?? timeMatch[4] ?? 0);
    const validHour = meridiem ? hour >= 1 && hour <= 12 : hour >= 0 && hour <= 23;
    if (validHour && minute >= 0 && minute <= 59) {
      if (meridiem === '오후' && hour < 12) hour += 12;
      if (meridiem === '오전' && hour === 12) hour = 0;
      startTime = `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
      if (!meridiem && hour >= 1 && hour <= 7) warnings.push(`'${timeMatch[0]}'은 오전·오후가 없어 ${startTime}로 해석했습니다.`);
    } else {
      warnings.push(`'${timeMatch[0]}'은 올바른 시간이 아니어서 시간 미정으로 두었습니다.`);
    }
    remainder = remainder.replace(timeMatch[0], ' ');
  } else {
    warnings.push('시간 표현을 찾지 못해 시간 미정으로 두었습니다.');
  }

  let scheduleType: ScheduleType = 'unclassified';
  let absenceType: AbsenceType = 'annual';
  if (/연차|휴가|조퇴|외출/.test(original)) {
    scheduleType = 'leave';
    absenceType = /조퇴/.test(original) ? 'early' : /외출/.test(original) ? 'outing' : 'annual';
    remainder = remainder.replace(/연차|휴가|조퇴|외출/g, ' ');
  } else if (/출장/.test(original)) {
    scheduleType = 'business_trip';
    remainder = remainder.replace(/출장/g, ' ');
  } else if (/회의|간담회|협의회/.test(original)) {
    scheduleType = 'meeting';
  } else if (/내부일정/.test(original)) {
    scheduleType = 'internal';
    remainder = remainder.replace(/내부일정/g, ' ');
  } else {
    warnings.push('일정 유형을 확정하지 못해 일반으로 분류했습니다.');
  }

  const title = normalizeSpaces(remainder) || original;
  if (title === original && !original) warnings.push('일정 제목을 입력해 주십시오.');

  return {
    original,
    warnings,
    schedule: {
      title,
      date: parsedDate,
      end_date: null,
      start_time: startTime,
      end_time: null,
      is_notice: false,
      is_urgent: false,
      is_completed: false,
      is_todo: false,
      schedule_type: scheduleType,
      absence_type: absenceType,
    },
  };
};

const scheduleTypes: Array<{ value: ScheduleType; label: string }> = [
  { value: 'unclassified', label: '일반' },
  { value: 'internal', label: '내부일정' },
  { value: 'business_trip', label: '출장' },
  { value: 'meeting', label: '회의' },
  { value: 'leave', label: '연차·조퇴·외출' },
];

export default function QuickScheduleInput({ open, onClose, defaultDate, onSubmit }: QuickScheduleInputProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [source, setSource] = useState('');
  const [parsed, setParsed] = useState<ParsedQuickSchedule | null>(null);
  const [error, setError] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  const close = useCallback(() => {
    setSource('');
    setParsed(null);
    setError('');
    setIsSaving(false);
    onClose();
  }, [onClose]);

  useEffect(() => {
    if (!open) return;
    const focusTimer = window.setTimeout(() => inputRef.current?.focus(), 50);
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.clearTimeout(focusTimer);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [close, open]);

  if (!open) return null;

  const analyze = () => {
    if (!source.trim()) {
      setError('한 줄 일정을 입력해 주십시오.');
      return;
    }
    setError('');
    setParsed(parseQuickSchedule(source, defaultDate));
  };

  const updateSchedule = <K extends keyof NewScheduleInput>(key: K, value: NewScheduleInput[K]) => {
    setParsed((current) => current ? { ...current, schedule: { ...current.schedule, [key]: value } } : current);
    setError('');
  };

  const submit = async () => {
    if (!parsed) {
      analyze();
      return;
    }
    if (!parsed.schedule.title.trim()) {
      setError('일정 제목을 입력해 주십시오.');
      return;
    }
    setIsSaving(true);
    setError('');
    try {
      await onSubmit({ ...parsed.schedule, title: parsed.schedule.title.trim() });
      close();
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : '일정을 등록하지 못했습니다.');
      setIsSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[260] flex items-end justify-center bg-slate-950/55 p-0 backdrop-blur-sm sm:items-center sm:p-4" onMouseDown={(event) => event.target === event.currentTarget && close()}>
      <section role="dialog" aria-modal="true" aria-labelledby="quick-schedule-title" className="max-h-[92dvh] w-full overflow-y-auto rounded-t-[28px] bg-white p-5 shadow-2xl sm:max-w-xl sm:rounded-[30px] sm:p-7">
        <header className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-3">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-blue-50 text-blue-600"><Sparkles size={21} /></span>
            <div>
              <h2 id="quick-schedule-title" className="text-lg font-black text-slate-900 sm:text-xl">빠른 일정 입력</h2>
              <p className="mt-1 text-[11px] font-bold text-slate-400">날짜와 시간을 한 줄로 입력하고 확인한 뒤 등록합니다.</p>
            </div>
          </div>
          <button type="button" onClick={close} aria-label="닫기" className="rounded-xl bg-slate-100 p-2 text-slate-500 hover:bg-slate-200"><X size={18} /></button>
        </header>

        <div className="mt-6">
          <label htmlFor="quick-schedule-source" className="mb-2 block text-xs font-black text-slate-600">한 줄 일정</label>
          <div className="flex flex-col gap-2 sm:flex-row">
            <input
              ref={inputRef}
              id="quick-schedule-source"
              value={source}
              onChange={(event) => { setSource(event.target.value); setParsed(null); setError(''); }}
              onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); analyze(); } }}
              placeholder="예: 8/12 오후 2시 보건소 출장 룡"
              className="min-w-0 flex-1 rounded-2xl border-2 border-slate-100 bg-slate-50 px-4 py-3 text-sm font-bold text-slate-900 outline-none focus:border-blue-500 focus:bg-white"
            />
            <button type="button" onClick={analyze} className="shrink-0 rounded-2xl bg-slate-900 px-5 py-3 text-xs font-black text-white hover:bg-black">일정 해석</button>
          </div>
          <div className="mt-2 flex flex-wrap gap-1.5 text-[10px] font-bold text-slate-400">
            <span className="rounded-lg bg-slate-100 px-2 py-1">내일 10시 정책결정회의</span>
            <span className="rounded-lg bg-slate-100 px-2 py-1">금요일 연차 희</span>
          </div>
        </div>

        {parsed && (
          <div className="mt-5 rounded-2xl border border-blue-100 bg-blue-50/30 p-4">
            <div className="mb-4 flex items-center gap-2 text-xs font-black text-blue-700"><CalendarPlus size={16} /> 해석 결과 확인</div>
            <div className="grid gap-3 sm:grid-cols-2">
              <label>
                <span className="mb-1.5 block text-[10px] font-black text-slate-500">날짜</span>
                <input type="date" value={parsed.schedule.date} onChange={(event) => updateSchedule('date', event.target.value)} className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm font-black text-slate-800 outline-none focus:border-blue-500" />
              </label>
              <label>
                <span className="mb-1.5 flex items-center gap-1 text-[10px] font-black text-slate-500"><Clock3 size={12} /> 시작 시간</span>
                <input type="time" value={parsed.schedule.start_time ?? ''} onChange={(event) => updateSchedule('start_time', event.target.value || null)} className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm font-black text-slate-800 outline-none focus:border-blue-500" />
              </label>
              <label className="sm:col-span-2">
                <span className="mb-1.5 block text-[10px] font-black text-slate-500">일정 제목</span>
                <input value={parsed.schedule.title} onChange={(event) => updateSchedule('title', event.target.value)} className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm font-black text-slate-800 outline-none focus:border-blue-500" />
              </label>
              <label className="sm:col-span-2">
                <span className="mb-1.5 block text-[10px] font-black text-slate-500">일정 유형</span>
                <select value={parsed.schedule.schedule_type} onChange={(event) => updateSchedule('schedule_type', event.target.value as ScheduleType)} className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm font-black text-slate-800 outline-none focus:border-blue-500">
                  {scheduleTypes.map((type) => <option key={type.value} value={type.value}>{type.label}</option>)}
                </select>
              </label>
              {parsed.schedule.schedule_type === 'leave' && (
                <div className="sm:col-span-2">
                  <span className="mb-1.5 block text-[10px] font-black text-slate-500">휴가 구분</span>
                  <div className="grid grid-cols-3 gap-2">
                    {([{ value: 'annual', label: '연차' }, { value: 'early', label: '조퇴' }, { value: 'outing', label: '외출' }] as const).map((type) => (
                      <button key={type.value} type="button" onClick={() => updateSchedule('absence_type', type.value)} className={`rounded-xl py-2.5 text-[11px] font-black ${parsed.schedule.absence_type === type.value ? 'bg-amber-500 text-white' : 'bg-white text-amber-700'}`}>{type.label}</button>
                    ))}
                  </div>
                </div>
              )}
            </div>

            <div className="mt-4 rounded-xl bg-white px-3 py-2.5">
              <p className="text-[9px] font-black uppercase tracking-wider text-slate-400">입력 원문</p>
              <p className="mt-1 break-words text-xs font-bold text-slate-600">{parsed.original}</p>
            </div>

            {parsed.warnings.length > 0 && (
              <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-amber-800">
                <p className="flex items-center gap-1.5 text-[10px] font-black"><AlertTriangle size={13} /> 확인이 필요한 부분</p>
                <ul className="mt-1.5 space-y-1 pl-4 text-[10px] font-bold leading-relaxed">
                  {parsed.warnings.map((warning) => <li key={warning} className="list-disc">{warning}</li>)}
                </ul>
              </div>
            )}
          </div>
        )}

        {error && <p className="mt-4 rounded-xl bg-red-50 px-4 py-3 text-xs font-bold text-red-600">{error}</p>}

        <div className="mt-6 flex gap-3">
          <button type="button" onClick={close} className="flex-1 rounded-2xl bg-slate-100 py-3.5 text-sm font-black text-slate-600 hover:bg-slate-200">취소</button>
          <button type="button" disabled={isSaving} onClick={() => void submit()} className="flex-1 rounded-2xl bg-blue-600 py-3.5 text-sm font-black text-white shadow-lg hover:bg-blue-700 disabled:cursor-wait disabled:opacity-60">{isSaving ? '등록 중...' : parsed ? '확인 후 등록' : '일정 해석'}</button>
        </div>
      </section>
    </div>
  );
}
