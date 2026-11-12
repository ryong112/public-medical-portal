'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { AlertTriangle, Bell, CalendarPlus, CalendarRange, Check, ChevronDown, Clock3, FileText, ListChecks, MapPin, Paperclip, RotateCcw, Search, Siren, Users, X } from 'lucide-react';
import DirectTimeInput from '@/app/components/direct-time-input';
import { scheduleCategoryStyles } from '@/lib/schedule-category';

export type ScheduleType = 'meeting' | 'business_trip' | 'internal' | 'leave' | 'unclassified';
export type AbsenceType = 'annual' | 'early' | 'outing';

export interface NewScheduleInput {
  title: string;
  date: string;
  end_date: string | null;
  start_time: string | null;
  end_time: string | null;
  is_notice: boolean;
  is_urgent: boolean;
  is_completed: boolean;
  is_todo: boolean;
  schedule_type: ScheduleType;
  absence_type: AbsenceType;
  owner_name?: string | null;
  attendee_names?: string[];
  location?: string | null;
  linked_file_ids?: number[];
}

export interface ScheduleRecurrenceSubmission {
  recurrence_type: Exclude<RecurrenceMode, 'none'>;
  weekday: number;
  monthly_week: MonthlyWeek | null;
  starts_on: string;
  ends_on: string;
}

interface ScheduleFormModalProps {
  date: string;
  initialSchedule?: NewScheduleInput & { id?: number | string };
  existingSchedules?: Array<NewScheduleInput & { id?: number | string }>;
  copyMode?: boolean;
  availableFiles?: Array<{ id: number; name: string; category?: string | null }>;
  people?: string[];
  metadataAvailable?: boolean;
  onClose: () => void;
  onSubmit: (schedules: NewScheduleInput[], recurrence?: ScheduleRecurrenceSubmission) => Promise<void>;
}

interface ScheduleDraft extends NewScheduleInput {
  dateMode: DateMode;
  timeMode: TimeMode;
  recurrenceMode: RecurrenceMode;
  monthlyWeek: MonthlyWeek;
}

type TimeMode = 'both' | 'start' | 'end' | 'none';
type RecurrenceMode = 'none' | 'weekly' | 'biweekly' | 'monthly';
type MonthlyWeek = 'first' | 'second' | 'third' | 'fourth' | 'last';
type DateMode = 'single' | 'range';

const weekdayNames = ['일', '월', '화', '수', '목', '금', '토'];
const monthlyWeekLabels: Record<MonthlyWeek, string> = {
  first: '첫째',
  second: '둘째',
  third: '셋째',
  fourth: '넷째',
  last: '마지막 주',
};

const parseLocalDate = (date: string) => {
  const [year, month, day] = date.split('-').map(Number);
  return new Date(year, month - 1, day);
};

const formatLocalDate = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;

const getRangeDayCount = (startDate: string, endDate: string) => {
  const [startYear, startMonth, startDay] = startDate.split('-').map(Number);
  const [endYear, endMonth, endDay] = endDate.split('-').map(Number);
  const difference = Date.UTC(endYear, endMonth - 1, endDay) - Date.UTC(startYear, startMonth - 1, startDay);
  return Math.floor(difference / 86_400_000) + 1;
};

const createRecurringDates = (startDate: string, mode: RecurrenceMode, monthlyWeek: MonthlyWeek = 'first') => {
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
    let occurrence: Date;
    if (monthlyWeek === 'last') {
      const lastDay = new Date(start.getFullYear(), month + 1, 0);
      occurrence = new Date(start.getFullYear(), month, lastDay.getDate() - ((lastDay.getDay() - weekday + 7) % 7));
    } else {
      const firstDay = new Date(start.getFullYear(), month, 1);
      const weekIndex = ['first', 'second', 'third', 'fourth'].indexOf(monthlyWeek);
      occurrence = new Date(start.getFullYear(), month, 1 + ((weekday - firstDay.getDay() + 7) % 7) + weekIndex * 7);
    }
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

const normalizeAbsenceType = (value?: string): AbsenceType => {
  if (value === 'early' || value === 'early_am' || value === 'early_pm') return 'early';
  if (value === 'outing') return 'outing';
  return 'annual';
};

const normalizeAttendees = (value: string) => [...new Set(value.split(/[,，;\n]/u).map((name) => name.trim().replace(/\s+/gu, ' ')).filter(Boolean))];
const normalizeFileIds = (value?: number[]) => [...new Set((Array.isArray(value) ? value : []).filter((id) => Number.isSafeInteger(id) && id > 0))];
const removeStoredDraft = (key: string) => {
  try {
    window.localStorage.removeItem(key);
  } catch {
    // Storage can be unavailable in private or restricted browsing sessions.
  }
};

const fieldClassName = 'w-full min-w-0 rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-base font-medium text-slate-900 outline-none transition-colors placeholder:text-slate-400 focus:border-blue-500 focus:ring-2 focus:ring-blue-100 disabled:bg-slate-100 disabled:text-slate-500 sm:text-sm';

export default function ScheduleFormModal({ date, initialSchedule, existingSchedules = [], copyMode = false, availableFiles = [], people = [], metadataAvailable = true, onClose, onSubmit }: ScheduleFormModalProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleRef = useRef<HTMLInputElement>(null);
  const formId = useId();
  const defaults = getDefaultTimes(date);
  const initialTimeMode: TimeMode = initialSchedule
    ? initialSchedule.start_time && initialSchedule.end_time ? 'both' : initialSchedule.start_time ? 'start' : initialSchedule.end_time ? 'end' : 'none'
    : 'both';
  const initialDateMode: DateMode = initialSchedule?.end_date && initialSchedule.end_date > initialSchedule.date ? 'range' : 'single';
  const [dateMode, setDateMode] = useState<DateMode>(initialDateMode);
  const [dateValue, setDateValue] = useState(initialSchedule?.date ?? date);
  const [endDateValue, setEndDateValue] = useState(initialSchedule?.end_date ?? initialSchedule?.date ?? date);
  const [title, setTitle] = useState(initialSchedule?.title ?? '');
  const [timeMode, setTimeMode] = useState<TimeMode>(initialTimeMode);
  const [startTime, setStartTime] = useState(initialSchedule?.start_time ?? defaults.start);
  const [endTime, setEndTime] = useState(initialSchedule?.end_time ?? defaults.end);
  const [isNotice, setIsNotice] = useState(initialSchedule?.is_notice ?? false);
  const [isTodo, setIsTodo] = useState(initialSchedule?.is_todo ?? false);
  const [isUrgent, setIsUrgent] = useState(initialSchedule?.is_urgent ?? false);
  const [scheduleType, setScheduleType] = useState<ScheduleType>(initialSchedule?.schedule_type ?? 'unclassified');
  const [absenceType, setAbsenceType] = useState<AbsenceType>(normalizeAbsenceType(initialSchedule?.absence_type));
  const [ownerName, setOwnerName] = useState(initialSchedule?.owner_name ?? '');
  const [attendees, setAttendees] = useState(initialSchedule?.attendee_names?.join(', ') ?? '');
  const [location, setLocation] = useState(initialSchedule?.location ?? '');
  const [linkedFileIds, setLinkedFileIds] = useState(() => normalizeFileIds(initialSchedule?.linked_file_ids));
  const [fileSearch, setFileSearch] = useState('');
  const [detailsOpen, setDetailsOpen] = useState(Boolean(initialSchedule?.owner_name || initialSchedule?.attendee_names?.length || initialSchedule?.location || initialSchedule?.linked_file_ids?.length));
  const [recurrenceMode, setRecurrenceMode] = useState<RecurrenceMode>('none');
  const [monthlyWeek, setMonthlyWeek] = useState<MonthlyWeek>('first');
  const [error, setError] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [savedDraft, setSavedDraft] = useState<ScheduleDraft | null>(null);
  const draftStorageKey = `schedule-draft:${date}`;

  useEffect(() => {
    const dialog = dialogRef.current;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dialog?.showModal();
    titleRef.current?.focus({ preventScroll: true });
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      dialog?.close();
      document.body.style.overflow = previousOverflow;
      if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true });
    };
  }, []);

  useEffect(() => {
    if (initialSchedule) return;
    let restoreTimer: number | undefined;
    try {
      const stored = window.localStorage.getItem(draftStorageKey);
      if (!stored) return;
      const parsed = JSON.parse(stored) as ScheduleDraft;
      if (parsed?.title?.trim()) restoreTimer = window.setTimeout(() => setSavedDraft(parsed), 0);
    } catch {
      removeStoredDraft(draftStorageKey);
    }
    return () => {
      if (restoreTimer !== undefined) window.clearTimeout(restoreTimer);
    };
  }, [draftStorageKey, initialSchedule]);

  useEffect(() => {
    if (initialSchedule || !title.trim()) return;
    const draft: ScheduleDraft = {
      title,
      date: dateValue,
      end_date: dateMode === 'range' ? endDateValue : null,
      start_time: timeMode === 'both' || timeMode === 'start' ? startTime : null,
      end_time: timeMode === 'both' || timeMode === 'end' ? endTime : null,
      is_notice: isNotice,
      is_urgent: isUrgent,
      is_completed: false,
      is_todo: isTodo,
      schedule_type: scheduleType,
      absence_type: absenceType,
      owner_name: ownerName.trim() || null,
      attendee_names: normalizeAttendees(attendees),
      location: location.trim() || null,
      linked_file_ids: linkedFileIds,
      dateMode,
      timeMode,
      recurrenceMode,
      monthlyWeek,
    };
    try {
      window.localStorage.setItem(draftStorageKey, JSON.stringify(draft));
    } catch {
      // Draft storage must never prevent the user from saving the schedule.
    }
  }, [absenceType, attendees, dateMode, dateValue, draftStorageKey, endDateValue, endTime, initialSchedule, isNotice, isTodo, isUrgent, linkedFileIds, location, monthlyWeek, ownerName, recurrenceMode, scheduleType, startTime, timeMode, title]);

  const conflicts = (() => {
    const currentEndDate = dateMode === 'range' ? endDateValue : dateValue;
    const currentStart = timeMode === 'both' || timeMode === 'start' ? startTime : null;
    const currentEnd = timeMode === 'both' || timeMode === 'end' ? endTime : null;
    return existingSchedules.filter((schedule) => {
      if (!copyMode && initialSchedule?.id !== undefined && schedule.id === initialSchedule.id) return false;
      const scheduleEndDate = schedule.end_date && schedule.end_date >= schedule.date ? schedule.end_date : schedule.date;
      const datesOverlap = dateValue <= scheduleEndDate && currentEndDate >= schedule.date;
      if (!datesOverlap) return false;
      if (dateMode === 'range' || scheduleEndDate > schedule.date) return true;
      if (!currentStart || !currentEnd || !schedule.start_time || !schedule.end_time) return false;
      return currentStart < schedule.end_time && currentEnd > schedule.start_time;
    });
  })();

  const restoreDraft = () => {
    if (!savedDraft) return;
    setTitle(savedDraft.title);
    setDateValue(savedDraft.date);
    setEndDateValue(savedDraft.end_date ?? savedDraft.date);
    setDateMode(savedDraft.dateMode ?? (savedDraft.end_date ? 'range' : 'single'));
    setStartTime(savedDraft.start_time ?? defaults.start);
    setEndTime(savedDraft.end_time ?? defaults.end);
    setTimeMode(savedDraft.timeMode ?? (savedDraft.start_time && savedDraft.end_time ? 'both' : savedDraft.start_time ? 'start' : savedDraft.end_time ? 'end' : 'none'));
    setIsNotice(savedDraft.is_notice);
    setIsTodo(savedDraft.is_todo);
    setIsUrgent(savedDraft.is_urgent);
    setScheduleType(savedDraft.schedule_type);
    setAbsenceType(normalizeAbsenceType(savedDraft.absence_type));
    setOwnerName(savedDraft.owner_name ?? '');
    setAttendees(savedDraft.attendee_names?.join(', ') ?? '');
    setLocation(savedDraft.location ?? '');
    setLinkedFileIds(normalizeFileIds(savedDraft.linked_file_ids));
    setDetailsOpen(Boolean(savedDraft.owner_name || savedDraft.attendee_names?.length || savedDraft.location || savedDraft.linked_file_ids?.length));
    setRecurrenceMode(savedDraft.recurrenceMode ?? 'none');
    setMonthlyWeek(savedDraft.monthlyWeek ?? 'first');
    setSavedDraft(null);
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (isSaving) return;
    if (!title.trim()) {
      setError('일정 제목을 입력해 주십시오.');
      return;
    }
    if (dateMode === 'range' && endDateValue <= dateValue) {
      setError('기간 일정의 종료일은 시작일보다 늦어야 합니다.');
      return;
    }
    if (dateMode === 'single' && timeMode === 'both' && endTime <= startTime) {
      setError('종료 시간은 시작 시간보다 늦어야 합니다.');
      return;
    }

    setIsSaving(true);
    setError('');
    try {
      const schedule: NewScheduleInput = {
        title: title.trim(),
        date: dateValue,
        end_date: dateMode === 'range' ? endDateValue : null,
        start_time: timeMode === 'both' || timeMode === 'start' ? startTime : null,
        end_time: timeMode === 'both' || timeMode === 'end' ? endTime : null,
        is_notice: isNotice,
        is_urgent: isUrgent,
        is_completed: copyMode ? false : initialSchedule?.is_completed ?? false,
        is_todo: isTodo,
        schedule_type: scheduleType,
        absence_type: absenceType,
        ...(metadataAvailable ? {
          owner_name: ownerName.trim() || null,
          attendee_names: normalizeAttendees(attendees),
          location: location.trim() || null,
          linked_file_ids: linkedFileIds,
        } : {}),
      };
      const recurringDates = initialSchedule || dateMode === 'range' ? [dateValue] : createRecurringDates(dateValue, recurrenceMode, monthlyWeek);
      const recurrence = !initialSchedule && dateMode === 'single' && recurrenceMode !== 'none'
        ? {
            recurrence_type: recurrenceMode,
            weekday: parseLocalDate(dateValue).getDay(),
            monthly_week: recurrenceMode === 'monthly' ? monthlyWeek : null,
            starts_on: dateValue,
            ends_on: `${parseLocalDate(dateValue).getFullYear()}-12-31`,
          } satisfies ScheduleRecurrenceSubmission
        : undefined;
      await onSubmit(
        recurringDates.map((recurringDate) => ({ ...schedule, date: recurringDate, end_date: dateMode === 'range' ? endDateValue : null })),
        recurrence,
      );
      if (!initialSchedule) removeStoredDraft(draftStorageKey);
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : '일정을 등록하지 못했습니다.');
      setIsSaving(false);
    }
  };

  const attendeeNames = normalizeAttendees(attendees);
  const selectedFiles = linkedFileIds.map((id) => availableFiles.find((file) => file.id === id) ?? { id, name: '문서 #' + id + ' (현재 목록에서 확인할 수 없음)' });
  const filteredFiles = availableFiles.filter((file) => [file.name, file.category].filter(Boolean).join(' ').toLocaleLowerCase().includes(fileSearch.trim().toLocaleLowerCase()));
  const personSuggestions = [...new Set(people.map((person) => person.trim()).filter(Boolean))];
  const recurrenceCount = createRecurringDates(dateValue, recurrenceMode, monthlyWeek).length;
  const scheduleTitle = copyMode ? '일정 복사' : initialSchedule ? '일정 수정' : '일정 추가';
  const toggleFile = (id: number) => setLinkedFileIds((current) => current.includes(id) ? current.filter((fileId) => fileId !== id) : [...current, id]);

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby={formId + '-heading'}
      aria-describedby={formId + '-description'}
      aria-modal="true"
      onCancel={(event) => { event.preventDefault(); if (!isSaving) onClose(); }}
      onClick={(event) => {
        if (event.target !== event.currentTarget || isSaving) return;
        const bounds = event.currentTarget.getBoundingClientRect();
        if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) onClose();
      }}
      onKeyDown={(event) => {
        if (event.key !== 'Tab') return;
        const items = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled), summary, [href], [tabindex="0"]')).filter((item) => item.getClientRects().length > 0 && !item.closest('[inert]'));
        const first = items[0];
        const last = items.at(-1);
        if (!first) { event.preventDefault(); return; }
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
        if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
      }}
      className="fixed inset-0 m-auto max-h-[calc(100dvh-1.5rem)] w-[calc(100%-1.5rem)] max-w-2xl overflow-hidden rounded-3xl bg-white p-0 text-slate-900 shadow-2xl backdrop:bg-slate-950/55 backdrop:backdrop-blur-sm"
    >
      <form onSubmit={handleSubmit} aria-busy={isSaving} className="flex max-h-[calc(100dvh-1.5rem)] flex-col">
        <header className="flex shrink-0 items-center justify-between gap-3 border-b border-slate-100 px-4 py-4 sm:px-6">
          <div className="flex min-w-0 items-center gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-blue-50 text-blue-600"><CalendarPlus size={21} /></span>
            <div>
              <h2 id={formId + '-heading'} className="text-lg font-extrabold text-slate-900">{scheduleTitle}</h2>
              <p id={formId + '-description'} className="mt-0.5 text-xs leading-relaxed text-slate-500">제목과 날짜를 입력하세요. 나머지 정보는 선택할 수 있습니다.</p>
            </div>
          </div>
          <button type="button" disabled={isSaving} onClick={onClose} aria-label="일정 창 닫기" className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-slate-500 transition-colors hover:bg-slate-100 disabled:opacity-40"><X size={20} /></button>
        </header>

        <div inert={isSaving} className="min-h-0 flex-1 space-y-5 overflow-y-auto overscroll-contain px-4 py-5 sm:px-6">
          {savedDraft && (
            <div className="flex flex-wrap items-center gap-2 rounded-xl border border-blue-100 bg-blue-50 p-3">
              <RotateCcw size={17} className="shrink-0 text-blue-600" />
              <div className="min-w-0 flex-1">
                <p className="text-xs font-semibold text-slate-700">작성 중이던 일정이 있습니다.</p>
                <p className="mt-0.5 truncate text-xs text-slate-500">{savedDraft.title}</p>
              </div>
              <button type="button" onClick={restoreDraft} className="rounded-lg bg-blue-600 px-3 py-2 text-xs font-bold text-white">복원</button>
              <button type="button" onClick={() => { removeStoredDraft(draftStorageKey); setSavedDraft(null); }} className="rounded-lg bg-white px-3 py-2 text-xs font-bold text-slate-600">삭제</button>
            </div>
          )}

          <label className="block">
            <span className="mb-2 block text-sm font-bold text-slate-700">일정 제목 <span className="text-xs font-medium text-blue-600">필수</span></span>
            <input ref={titleRef} required maxLength={500} name="title" value={title} onChange={(event) => { setTitle(event.target.value); setError(''); }} placeholder="예: 신규 사업 협의회" className={fieldClassName} />
          </label>

          <fieldset className="min-w-0">
            <legend className="mb-2 text-sm font-bold text-slate-700">날짜 <span className="text-xs font-medium text-blue-600">필수</span></legend>
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <div className="inline-flex rounded-xl bg-slate-100 p-1">
                <button type="button" aria-pressed={dateMode === 'single'} onClick={() => { setDateMode('single'); setEndDateValue(dateValue); setRecurrenceMode('none'); setError(''); }} className={'rounded-lg px-4 py-2 text-xs font-bold transition-colors ' + (dateMode === 'single' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-800')}>하루 일정</button>
                <button type="button" aria-pressed={dateMode === 'range'} onClick={() => { setDateMode('range'); if (endDateValue <= dateValue) { const nextDate = parseLocalDate(dateValue); nextDate.setDate(nextDate.getDate() + 1); setEndDateValue(formatLocalDate(nextDate)); } setRecurrenceMode('none'); setError(''); }} className={'inline-flex items-center gap-1.5 rounded-lg px-4 py-2 text-xs font-bold transition-colors ' + (dateMode === 'range' ? 'bg-white text-blue-700 shadow-sm' : 'text-slate-500 hover:text-slate-800')}><CalendarRange size={14} />기간 일정</button>
              </div>
              {dateMode === 'range' && endDateValue > dateValue && <span className="text-xs font-semibold text-blue-700">{getRangeDayCount(dateValue, endDateValue) - 1}박 {getRangeDayCount(dateValue, endDateValue)}일</span>}
            </div>
            {dateMode === 'single' ? (
              <input type="date" aria-label="일정 날짜" required value={dateValue} onChange={(event) => { setDateValue(event.target.value); setEndDateValue(event.target.value); setError(''); }} className={fieldClassName} />
            ) : (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <label className="min-w-0"><span className="mb-1.5 block text-xs font-semibold text-slate-600">시작일</span><input type="date" required value={dateValue} max={endDateValue} onChange={(event) => { const nextStart = event.target.value; setDateValue(nextStart); if (nextStart && endDateValue <= nextStart) { const nextDate = parseLocalDate(nextStart); nextDate.setDate(nextDate.getDate() + 1); setEndDateValue(formatLocalDate(nextDate)); } setError(''); }} className={fieldClassName} /></label>
                <label className="min-w-0"><span className="mb-1.5 block text-xs font-semibold text-slate-600">종료일</span><input type="date" required value={endDateValue} min={dateValue} onChange={(event) => { setEndDateValue(event.target.value); setError(''); }} className={fieldClassName} /></label>
              </div>
            )}
          </fieldset>

          <fieldset className="min-w-0">
            <legend className="mb-2 text-sm font-bold text-slate-700">일정 유형</legend>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
              {[
                { value: 'meeting' as const, label: '회의' },
                { value: 'business_trip' as const, label: '출장' },
                { value: 'internal' as const, label: '내부일정' },
                { value: 'leave' as const, label: '연차·조퇴·외출' },
                { value: 'unclassified' as const, label: '미분류' },
              ].map((type) => (
                <button key={type.value} type="button" aria-pressed={scheduleType === type.value} onClick={() => setScheduleType(type.value)} className={'inline-flex min-h-10 items-center justify-center gap-1.5 rounded-xl border px-2 py-2 text-xs font-bold transition-colors ' + (scheduleType === type.value ? scheduleCategoryStyles[type.value === 'unclassified' ? 'general' : type.value].filterActive : scheduleCategoryStyles[type.value === 'unclassified' ? 'general' : type.value].filter)}><span aria-hidden="true" className={'h-1.5 w-1.5 shrink-0 rounded-full ' + (scheduleType === type.value ? 'bg-white' : scheduleCategoryStyles[type.value === 'unclassified' ? 'general' : type.value].dot)} />{type.label}</button>
              ))}
            </div>
            {scheduleType === 'internal' && <p className="mt-2 text-xs leading-relaxed text-slate-500">내부에서 진행하는 협의회·간담회·업무협약식 등</p>}
            {scheduleType === 'leave' && (
              <fieldset className="mt-3 rounded-xl bg-orange-50 p-3">
                <legend className="sr-only">휴가 구분</legend>
                <div className="grid grid-cols-3 gap-2">
                  {[{ value: 'annual' as const, label: '연차' }, { value: 'early' as const, label: '조퇴' }, { value: 'outing' as const, label: '외출' }].map((type) => <button key={type.value} type="button" aria-pressed={absenceType === type.value} onClick={() => setAbsenceType(type.value)} className={'rounded-lg border px-2 py-2 text-xs font-bold ' + (absenceType === type.value ? scheduleCategoryStyles.leave.filterActive : scheduleCategoryStyles.leave.filter)}>{type.label}</button>)}
                </div>
              </fieldset>
            )}
          </fieldset>

          <fieldset className="min-w-0 rounded-2xl border border-slate-200 bg-slate-50 p-3 sm:p-4">
            <legend className="sr-only">일정 시간</legend>
            <p className="mb-3 flex items-center gap-2 text-sm font-bold text-slate-700"><Clock3 size={16} />일정 시간</p>
            <div className="mb-3 grid grid-cols-2 gap-1.5 sm:grid-cols-4">
              {[
                { value: 'both' as const, label: '시작·종료' },
                { value: 'start' as const, label: '시작만' },
                { value: 'end' as const, label: '종료만' },
                { value: 'none' as const, label: '시간 미정' },
              ].map((mode) => <button key={mode.value} type="button" aria-pressed={timeMode === mode.value} onClick={() => { setTimeMode(mode.value); if ((mode.value === 'both' || mode.value === 'start') && !startTime) setStartTime(defaults.start); if ((mode.value === 'both' || mode.value === 'end') && !endTime) setEndTime(defaults.end); setError(''); }} className={'rounded-lg px-2 py-2 text-xs font-bold transition-colors ' + (timeMode === mode.value ? 'bg-slate-900 text-white' : 'bg-white text-slate-600 hover:bg-slate-200')}>{mode.label}</button>)}
            </div>
            {timeMode !== 'none' ? (
              <div className="grid grid-cols-1 items-start gap-3 sm:grid-cols-2">
                <DirectTimeInput label="시작" disabled={timeMode === 'end'} value={timeMode === 'end' ? '' : startTime} onChange={(nextTime) => { setStartTime(nextTime); if (timeMode === 'both' && dateMode === 'single') setEndTime(addMinutes(nextTime, 60)); setError(''); }} />
                <DirectTimeInput label="종료" disabled={timeMode === 'start'} value={timeMode === 'start' ? '' : endTime} minimumTime={timeMode === 'both' && dateMode === 'single' ? startTime : undefined} durationFrom={timeMode === 'both' && dateMode === 'single' ? startTime : undefined} onChange={(nextTime) => { setEndTime(nextTime); setError(''); }} />
              </div>
            ) : <p className="text-xs leading-relaxed text-slate-500">시간 없이 날짜만 저장합니다.</p>}
          </fieldset>

          <fieldset>
            <legend className="mb-2 text-sm font-bold text-slate-700">표시 설정 <span className="font-normal text-slate-500">선택</span></legend>
            <div className="grid grid-cols-3 gap-2">
              {[
                { label: '공지사항', active: isNotice, onToggle: () => setIsNotice((current) => !current), Icon: Bell, activeClass: 'border-violet-300 bg-violet-50 text-violet-800', title: '이 일정을 공지사항에 추가합니다.' },
                { label: 'TO DO', active: isTodo, onToggle: () => setIsTodo((current) => !current), Icon: ListChecks, activeClass: 'border-blue-300 bg-blue-50 text-blue-800', title: '이 일정을 TO DO LIST에 추가합니다.' },
                { label: '긴급', active: isUrgent, onToggle: () => setIsUrgent((current) => !current), Icon: Siren, activeClass: 'border-rose-300 bg-rose-50 text-rose-800', title: '브리핑과 공지사항에 긴급 표시를 추가합니다.' },
              ].map(({ label, active, onToggle, Icon, activeClass, title: description }) => (
                <button key={label} type="button" aria-pressed={active} title={description} onClick={onToggle} className={'relative flex min-h-11 min-w-0 items-center justify-center gap-1.5 rounded-xl border px-1 py-2 text-xs font-bold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 ' + (active ? activeClass : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50')}><Icon size={15} className="shrink-0" /><span>{label}</span>{active && <Check aria-hidden="true" size={12} className="absolute right-1 top-1" />}</button>
              ))}
            </div>
          </fieldset>

          {!initialSchedule && dateMode === 'single' && (
            <details className="group rounded-2xl border border-slate-200">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 text-sm font-bold text-slate-700 [&::-webkit-details-marker]:hidden">
                <span>반복 일정 <span className="ml-1 text-xs font-normal text-slate-500">{recurrenceMode === 'none' ? '반복 안 함' : String(recurrenceCount) + '건 · 올해 말까지'}</span></span>
                <ChevronDown size={16} className="shrink-0 transition-transform group-open:rotate-180" />
              </summary>
              <div className="border-t border-slate-100 p-3 sm:p-4">
                <p className="mb-3 text-xs leading-relaxed text-slate-500">{dateValue ? parseLocalDate(dateValue).getFullYear() + '년 12월 31일' : '선택한 연도 말'}까지 등록합니다.</p>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  {[
                    { value: 'none' as const, label: '반복 안 함' },
                    { value: 'weekly' as const, label: '매주 ' + (weekdayNames[parseLocalDate(dateValue).getDay()] ?? '') + '요일' },
                    { value: 'biweekly' as const, label: '2주마다' },
                    { value: 'monthly' as const, label: '매월' },
                  ].map((option) => <button key={option.value} type="button" aria-pressed={recurrenceMode === option.value} onClick={() => setRecurrenceMode(option.value)} className={'rounded-lg px-2 py-2.5 text-xs font-bold ' + (recurrenceMode === option.value ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-blue-50')}>{option.label}</button>)}
                </div>
                {recurrenceMode === 'monthly' && <label className="mt-3 block"><span className="mb-1.5 block text-xs font-semibold text-slate-600">매월 반복할 주</span><select value={monthlyWeek} onChange={(event) => setMonthlyWeek(event.target.value as MonthlyWeek)} className={fieldClassName}>{(Object.keys(monthlyWeekLabels) as MonthlyWeek[]).map((week) => <option key={week} value={week}>{monthlyWeekLabels[week]} {weekdayNames[parseLocalDate(dateValue).getDay()]}요일</option>)}</select></label>}
                {recurrenceMode !== 'none' && <p className="mt-3 text-xs font-semibold text-blue-700">총 {recurrenceCount}개 일정이 함께 등록됩니다.</p>}
              </div>
            </details>
          )}

          <details open={detailsOpen} onToggle={(event) => setDetailsOpen(event.currentTarget.open)} className="group rounded-2xl border border-slate-200">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 text-sm font-bold text-slate-700 [&::-webkit-details-marker]:hidden">
              <span>추가 정보 <span className="ml-1 text-xs font-normal text-slate-500">담당자·참석자·장소·문서</span></span>
              <ChevronDown size={16} className="shrink-0 transition-transform group-open:rotate-180" />
            </summary>
            <div className="space-y-4 border-t border-slate-100 p-3 sm:p-4">
              {!metadataAvailable && <p role="status" className="rounded-xl bg-amber-50 p-3 text-xs leading-relaxed text-amber-800">추가 정보 저장 기능을 준비 중입니다. 지금은 제목·날짜·시간 등 기본 일정만 저장할 수 있습니다.</p>}
              <fieldset disabled={!metadataAvailable} className="min-w-0 space-y-4 disabled:opacity-60">
                <legend className="sr-only">선택 일정 정보</legend>
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="min-w-0"><span className="mb-1.5 flex items-center gap-1.5 text-xs font-bold text-slate-700"><Users size={14} />담당자</span><input value={ownerName} maxLength={120} onChange={(event) => setOwnerName(event.target.value)} list={formId + '-people'} placeholder="담당자 이름" autoComplete="off" className={fieldClassName} /></label>
                  <label className="min-w-0"><span className="mb-1.5 flex items-center gap-1.5 text-xs font-bold text-slate-700"><MapPin size={14} />장소</span><input value={location} maxLength={300} onChange={(event) => setLocation(event.target.value)} placeholder="예: 본관 2층 회의실" className={fieldClassName} /></label>
                </div>
                <datalist id={formId + '-people'}>{personSuggestions.map((name) => <option key={name} value={name} />)}</datalist>
                <div>
                  <label className="block"><span className="mb-1.5 block text-xs font-bold text-slate-700">참석자</span><input value={attendees} maxLength={2000} onChange={(event) => setAttendees(event.target.value)} onBlur={() => setAttendees(normalizeAttendees(attendees).join(', '))} aria-describedby={formId + '-attendees-help'} placeholder="예: 김민수, 이지영" className={fieldClassName} /></label>
                  <p id={formId + '-attendees-help'} className="mt-1.5 text-xs leading-relaxed text-slate-500">여러 명은 쉼표로 구분하세요. 중복된 이름은 한 번만 저장합니다.</p>
                  {personSuggestions.some((name) => !attendeeNames.includes(name)) && <div className="mt-2 flex flex-wrap gap-1.5" aria-label="참석자 빠른 추가">{personSuggestions.filter((name) => !attendeeNames.includes(name)).slice(0, 8).map((name) => <button key={name} type="button" onClick={() => setAttendees([...attendeeNames, name].join(', '))} className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs text-slate-600 hover:border-blue-300 hover:text-blue-700">+ {name}</button>)}</div>}
                </div>
                <div>
                  <p className="mb-1.5 flex items-center gap-1.5 text-xs font-bold text-slate-700"><Paperclip size={14} />연결 문서 <span className="font-normal text-slate-500">{linkedFileIds.length > 0 ? String(linkedFileIds.length) + '개 선택' : '선택'}</span></p>
                  <p className="mb-2 text-xs leading-relaxed text-slate-500">자료실에 이미 등록된 문서를 연결합니다. 원본 파일은 변경되지 않습니다.</p>
                  {selectedFiles.length > 0 && <ul className="mb-2 space-y-1.5">{selectedFiles.map((file) => <li key={file.id} className="flex min-w-0 items-center gap-2 rounded-lg bg-blue-50 px-3 py-2"><FileText size={14} className="shrink-0 text-blue-600" /><span className="min-w-0 flex-1 break-words text-xs font-medium text-blue-800">{file.name}</span><button type="button" onClick={() => toggleFile(file.id)} aria-label={file.name + ' 연결 해제'} className="shrink-0 rounded-md p-1 text-blue-600 hover:bg-blue-100"><X size={14} /></button></li>)}</ul>}
                  <label className="relative block">
                    <span className="sr-only">연결할 문서 검색</span><Search size={15} className="pointer-events-none absolute left-3 top-3.5 text-slate-400" />
                    <input type="search" value={fileSearch} onChange={(event) => setFileSearch(event.target.value)} placeholder="문서명 또는 분류 검색" className={fieldClassName + ' pl-9'} />
                  </label>
                  <div className="mt-2 max-h-40 overflow-y-auto rounded-xl border border-slate-200" aria-label="연결 가능한 문서">
                    {filteredFiles.length ? filteredFiles.map((file) => <label key={file.id} className="flex cursor-pointer items-start gap-2.5 border-b border-slate-100 px-3 py-2.5 last:border-b-0 hover:bg-slate-50"><input type="checkbox" checked={linkedFileIds.includes(file.id)} onChange={() => toggleFile(file.id)} className="mt-0.5 h-4 w-4 shrink-0 accent-blue-600" /><span className="min-w-0 text-xs leading-relaxed text-slate-700"><span className="block break-words font-medium">{file.name}</span>{file.category && <span className="text-slate-500">{file.category}</span>}</span></label>) : <p className="px-3 py-4 text-xs text-slate-500">{availableFiles.length ? '검색 결과가 없습니다.' : '연결할 문서가 없습니다. 자료실에 문서를 먼저 등록하세요.'}</p>}
                  </div>
                </div>
              </fieldset>
            </div>
          </details>

          {conflicts.length > 0 && <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-amber-800"><div className="flex items-center gap-2 text-xs font-bold"><AlertTriangle size={15} />시간이 겹칠 수 있는 일정 {conflicts.length}건</div><p className="mt-1.5 text-xs leading-relaxed">{conflicts.slice(0, 3).map((schedule) => schedule.title).join(' · ')}</p><p className="mt-1 text-xs">시간 겹침 안내이며, 저장은 계속할 수 있습니다.</p></div>}
        </div>

        <footer className="shrink-0 border-t border-slate-200 bg-white px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:px-6">
          {error && <p role="alert" className="mb-3 rounded-xl bg-red-50 px-3 py-2 text-xs font-semibold leading-relaxed text-red-700">{error}</p>}
          <div className="flex gap-3">
            <button type="button" disabled={isSaving} onClick={onClose} className="min-h-11 flex-1 rounded-xl border border-slate-200 bg-white px-3 py-3 text-sm font-bold text-slate-600 hover:bg-slate-50 disabled:opacity-50">취소</button>
            <button type="submit" disabled={isSaving} className="min-h-11 flex-[2] rounded-xl bg-blue-600 px-3 py-3 text-sm font-bold text-white shadow-sm hover:bg-blue-700 disabled:cursor-wait disabled:opacity-60">{isSaving ? '저장 중...' : copyMode ? '복사한 일정 추가' : initialSchedule ? '변경사항 저장' : recurrenceMode !== 'none' && dateMode === 'single' ? String(recurrenceCount) + '개 일정 추가' : '일정 추가'}</button>
          </div>
        </footer>
      </form>
    </dialog>
  );
}
