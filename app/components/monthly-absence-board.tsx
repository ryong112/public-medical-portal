'use client';

import { useEffect, useMemo, useState } from 'react';
import { CalendarDays, ChevronRight, Clock3, DoorOpen, Palmtree, X } from 'lucide-react';

export interface MonthlyAbsenceSchedule {
  id: number | string;
  title: string;
  date: string;
  end_date?: string | null;
  schedule_type?: string | null;
  absence_type?: string | null;
  start_time?: string | null;
  end_time?: string | null;
  [key: string]: unknown;
}

interface MonthlyAbsenceBoardProps {
  open: boolean;
  onClose: () => void;
  schedules: MonthlyAbsenceSchedule[];
  currentDate?: Date | string;
  onOpenSchedule?: (schedule: MonthlyAbsenceSchedule) => void;
}

type AbsenceKind = 'annual' | 'early' | 'outing';

interface AbsenceCell {
  kind: AbsenceKind;
  schedules: MonthlyAbsenceSchedule[];
}

interface PersonRow {
  person: string;
  cells: Map<string, Map<AbsenceKind, MonthlyAbsenceSchedule[]>>;
}

const kindConfig = {
  annual: {
    label: '연차',
    shortLabel: '연',
    icon: Palmtree,
    badge: 'border-amber-200 bg-amber-50 text-amber-700',
    dot: 'bg-amber-400',
  },
  early: {
    label: '조퇴',
    shortLabel: '조',
    icon: Clock3,
    badge: 'border-sky-200 bg-sky-50 text-sky-700',
    dot: 'bg-sky-400',
  },
  outing: {
    label: '외출',
    shortLabel: '외',
    icon: DoorOpen,
    badge: 'border-emerald-200 bg-emerald-50 text-emerald-700',
    dot: 'bg-emerald-400',
  },
} satisfies Record<AbsenceKind, {
  label: string;
  shortLabel: string;
  icon: typeof CalendarDays;
  badge: string;
  dot: string;
}>;

const toLocalDateKey = (date: Date) => [
  date.getFullYear(),
  String(date.getMonth() + 1).padStart(2, '0'),
  String(date.getDate()).padStart(2, '0'),
].join('-');

const parseCurrentDate = (value?: Date | string) => {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return new Date(value);
  if (typeof value === 'string') {
    const match = value.match(/^(\d{4})-(\d{2})-(\d{2})/u);
    if (match) return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }
  return new Date();
};

const getAbsenceKind = (schedule: MonthlyAbsenceSchedule): AbsenceKind => {
  if (schedule.absence_type === 'outing' || /외출/u.test(schedule.title)) return 'outing';
  if (['early', 'early_am', 'early_pm'].includes(schedule.absence_type ?? '') || /조퇴/u.test(schedule.title)) return 'early';
  return 'annual';
};

const stripAbsencePrefix = (title: string) => {
  let value = title.trim();
  const prefix = /^(?:휴가|연차|반차|오전\s*조퇴|오후\s*조퇴|조퇴|외출)\s*[)\-:：]?\s*/u;
  for (let index = 0; index < 4; index += 1) {
    const next = value.replace(prefix, '').trim();
    if (next === value) break;
    value = next;
  }
  return value;
};

export const extractAbsencePeople = (title: string) => {
  const cleanTitle = stripAbsencePrefix(title);
  const people = cleanTitle
    .split(/[,，/·ㆍ&]+/u)
    .map((name) => name.replace(/\s*\((?:휴가|연차|반차|조퇴|외출)\)\s*$/u, '').trim())
    .filter((name) => name.length > 0 && !/^(?:휴가|연차|반차|조퇴|외출)$/u.test(name));
  return [...new Set(people.length > 0 ? people : ['이름 미상'])];
};

const getScheduleEndDate = (schedule: MonthlyAbsenceSchedule) => schedule.end_date && schedule.end_date >= schedule.date
  ? schedule.end_date
  : schedule.date;

const getScheduleSignature = (schedule: MonthlyAbsenceSchedule) => [
  getAbsenceKind(schedule),
  stripAbsencePrefix(schedule.title),
  schedule.date,
  getScheduleEndDate(schedule),
  schedule.start_time ?? '',
  schedule.end_time ?? '',
].join('|');

const enumerateDateKeys = (startKey: string, endKey: string) => {
  const start = new Date(`${startKey}T00:00:00`);
  const end = new Date(`${endKey}T00:00:00`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || start > end) return [];
  const keys: string[] = [];
  for (const cursor = new Date(start); cursor <= end; cursor.setDate(cursor.getDate() + 1)) keys.push(toLocalDateKey(cursor));
  return keys;
};

const formatDateRange = (startKey: string, endKey: string) => {
  const [, startMonth, startDay] = startKey.split('-').map(Number);
  const [, endMonth, endDay] = endKey.split('-').map(Number);
  if (startKey === endKey) return `${startMonth}. ${startDay}.`;
  if (startMonth === endMonth) return `${startMonth}. ${startDay}.~${endDay}.`;
  return `${startMonth}. ${startDay}.~${endMonth}. ${endDay}.`;
};

const buildMobileRanges = (row: PersonRow, visibleDateKeys: string[]) => {
  const ranges: Array<{ kind: AbsenceKind; start: string; end: string; schedules: MonthlyAbsenceSchedule[] }> = [];
  (Object.keys(kindConfig) as AbsenceKind[]).forEach((kind) => {
    let current: (typeof ranges)[number] | null = null;
    visibleDateKeys.forEach((dateKey) => {
      const schedules = row.cells.get(dateKey)?.get(kind) ?? [];
      if (schedules.length === 0) {
        current = null;
        return;
      }
      const previousKey = current?.end;
      const isConsecutive = previousKey
        ? enumerateDateKeys(previousKey, dateKey).length === 2
        : false;
      if (!current || !isConsecutive) {
        current = { kind, start: dateKey, end: dateKey, schedules: [...schedules] };
        ranges.push(current);
        return;
      }
      current.end = dateKey;
      const existingIds = new Set(current.schedules.map(getScheduleSignature));
      current.schedules.push(...schedules.filter((schedule) => !existingIds.has(getScheduleSignature(schedule))));
    });
  });
  return ranges.sort((first, second) => first.start.localeCompare(second.start) || first.kind.localeCompare(second.kind));
};

export default function MonthlyAbsenceBoard({
  open,
  onClose,
  schedules,
  currentDate,
  onOpenSchedule,
}: MonthlyAbsenceBoardProps) {
  const [showWholeMonth, setShowWholeMonth] = useState(false);
  const referenceDate = useMemo(() => parseCurrentDate(currentDate), [currentDate]);
  const todayKey = toLocalDateKey(referenceDate);
  const year = referenceDate.getFullYear();
  const month = referenceDate.getMonth();
  const monthStartKey = toLocalDateKey(new Date(year, month, 1));
  const monthEndKey = toLocalDateKey(new Date(year, month + 1, 0));
  const visibleStartKey = showWholeMonth ? monthStartKey : todayKey;
  const visibleDateKeys = useMemo(
    () => enumerateDateKeys(visibleStartKey, monthEndKey),
    [monthEndKey, visibleStartKey],
  );

  const peopleRows = useMemo<PersonRow[]>(() => {
    const rows = new Map<string, PersonRow>();
    const duplicateKeys = new Set<string>();
    schedules
      .filter((schedule) => schedule.schedule_type === 'leave')
      .filter((schedule) => schedule.date <= monthEndKey && getScheduleEndDate(schedule) >= monthStartKey)
      .forEach((schedule) => {
        const kind = getAbsenceKind(schedule);
        const overlapStart = schedule.date < monthStartKey ? monthStartKey : schedule.date;
        const scheduleEnd = getScheduleEndDate(schedule);
        const overlapEnd = scheduleEnd > monthEndKey ? monthEndKey : scheduleEnd;
        extractAbsencePeople(schedule.title).forEach((person) => {
          const row = rows.get(person) ?? { person, cells: new Map() };
          rows.set(person, row);
          enumerateDateKeys(overlapStart, overlapEnd).forEach((dateKey) => {
            const duplicateKey = `${person}|${dateKey}|${getScheduleSignature(schedule)}`;
            if (duplicateKeys.has(duplicateKey)) return;
            duplicateKeys.add(duplicateKey);
            const kindMap = row.cells.get(dateKey) ?? new Map<AbsenceKind, MonthlyAbsenceSchedule[]>();
            const kindSchedules = kindMap.get(kind) ?? [];
            kindMap.set(kind, [...kindSchedules, schedule]);
            row.cells.set(dateKey, kindMap);
          });
        });
      });

    return [...rows.values()]
      .filter((row) => visibleDateKeys.some((dateKey) => row.cells.has(dateKey)))
      .sort((first, second) => first.person.localeCompare(second.person, 'ko-KR'));
  }, [monthEndKey, monthStartKey, schedules, visibleDateKeys]);

  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose, open]);

  if (!open) return null;

  const openSchedule = (cell: AbsenceCell) => {
    if (cell.schedules[0] && onOpenSchedule) onOpenSchedule(cell.schedules[0]);
  };

  return (
    <div
      className="fixed inset-0 z-[340] flex items-center justify-center bg-slate-950/55 p-2 backdrop-blur-sm sm:p-5"
      onMouseDown={(event) => event.target === event.currentTarget && onClose()}
      role="presentation"
    >
      <section role="dialog" aria-modal="true" aria-label="월간 휴가 현황" className="flex max-h-[94vh] w-full max-w-7xl flex-col overflow-hidden rounded-[26px] bg-white shadow-2xl sm:rounded-[34px]">
        <header className="flex flex-col gap-4 border-b border-slate-100 px-5 py-5 sm:flex-row sm:items-center sm:justify-between sm:px-7">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-amber-50 text-amber-600"><CalendarDays size={21} /></div>
            <div className="min-w-0">
              <p className="text-[10px] font-black uppercase tracking-[0.15em] text-amber-600">Monthly absence</p>
              <h2 className="truncate text-xl font-black tracking-tight text-slate-900 sm:text-2xl">{year}년 {month + 1}월 휴가 현황</h2>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <div className="grid flex-1 grid-cols-2 rounded-xl bg-slate-100 p-1 sm:flex-none">
              <button onClick={() => setShowWholeMonth(false)} className={`rounded-lg px-3 py-2 text-[10px] font-black transition-colors ${!showWholeMonth ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500'}`}>오늘부터</button>
              <button onClick={() => setShowWholeMonth(true)} className={`rounded-lg px-3 py-2 text-[10px] font-black transition-colors ${showWholeMonth ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500'}`}>전체 달</button>
            </div>
            <button onClick={onClose} aria-label="닫기" className="rounded-xl bg-slate-100 p-2.5 text-slate-500 transition-colors hover:bg-slate-200"><X size={18} /></button>
          </div>
        </header>

        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-5 py-3 sm:px-7">
          <div className="flex flex-wrap gap-2">
            {(Object.keys(kindConfig) as AbsenceKind[]).map((kind) => {
              const config = kindConfig[kind];
              return <span key={kind} className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[10px] font-black ${config.badge}`}><span className={`h-2 w-2 rounded-full ${config.dot}`} />{config.label}</span>;
            })}
          </div>
          <p className="text-[10px] font-bold text-slate-400">{peopleRows.length}명 · {showWholeMonth ? '이번 달 전체' : `${referenceDate.getDate()}일부터 월말까지`}</p>
        </div>

        <div className="custom-scrollbar flex-1 overflow-auto">
          {peopleRows.length === 0 ? (
            <div className="flex min-h-[360px] flex-col items-center justify-center px-6 text-center">
              <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-3xl bg-slate-100 text-slate-300"><CalendarDays size={27} /></div>
              <p className="text-sm font-black text-slate-700">표시할 휴가·조퇴·외출 일정이 없습니다.</p>
              {!showWholeMonth && <button onClick={() => setShowWholeMonth(true)} className="mt-3 text-xs font-black text-amber-600">이번 달 전체 보기</button>}
            </div>
          ) : (
            <>
              <div className="hidden min-w-max md:block">
                <table className="border-separate border-spacing-0 text-center">
                  <thead className="sticky top-0 z-20 bg-slate-50">
                    <tr>
                      <th className="sticky left-0 z-30 min-w-32 border-b border-r border-slate-200 bg-slate-50 px-4 py-3 text-left text-[10px] font-black text-slate-500">성함</th>
                      {visibleDateKeys.map((dateKey) => {
                        const date = new Date(`${dateKey}T00:00:00`);
                        const weekday = date.getDay();
                        return (
                          <th key={dateKey} className={`min-w-12 border-b border-r border-slate-100 px-2 py-2 text-[10px] font-black ${weekday === 0 ? 'text-red-500' : weekday === 6 ? 'text-blue-500' : 'text-slate-600'}`}>
                            <span className="block text-xs">{date.getDate()}</span>
                            <span className="mt-0.5 block text-[8px] text-slate-400">{['일', '월', '화', '수', '목', '금', '토'][weekday]}</span>
                          </th>
                        );
                      })}
                    </tr>
                  </thead>
                  <tbody>
                    {peopleRows.map((row) => (
                      <tr key={row.person} className="group">
                        <th className="sticky left-0 z-10 border-b border-r border-slate-200 bg-white px-4 py-3 text-left text-sm font-black text-slate-800 group-hover:bg-slate-50">{row.person}</th>
                        {visibleDateKeys.map((dateKey) => {
                          const cells = row.cells.get(dateKey);
                          return (
                            <td key={dateKey} className="h-14 border-b border-r border-slate-100 px-1 py-1 group-hover:bg-slate-50/60">
                              <div className="flex flex-wrap items-center justify-center gap-1">
                                {cells && [...cells.entries()].map(([kind, cellSchedules]) => {
                                  const cell = { kind, schedules: cellSchedules } satisfies AbsenceCell;
                                  const config = kindConfig[kind];
                                  return (
                                    <button key={kind} onClick={() => openSchedule(cell)} disabled={!onOpenSchedule} title={`${row.person} · ${config.label}`} className={`flex h-7 w-7 items-center justify-center rounded-lg border text-[10px] font-black ${config.badge} ${onOpenSchedule ? 'transition-transform hover:scale-105' : 'cursor-default'}`}>
                                      {config.shortLabel}
                                    </button>
                                  );
                                })}
                              </div>
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="space-y-3 p-4 md:hidden">
                {peopleRows.map((row) => (
                  <article key={row.person} className="rounded-2xl border border-slate-100 bg-white p-4 shadow-sm">
                    <div className="mb-3 flex items-center justify-between">
                      <h3 className="text-base font-black text-slate-900">{row.person}</h3>
                      <span className="text-[9px] font-bold text-slate-400">{buildMobileRanges(row, visibleDateKeys).length}개 구간</span>
                    </div>
                    <div className="space-y-2">
                      {buildMobileRanges(row, visibleDateKeys).map((range) => {
                        const config = kindConfig[range.kind];
                        const Icon = config.icon;
                        return (
                          <button key={`${range.kind}-${range.start}-${range.end}`} onClick={() => range.schedules[0] && onOpenSchedule?.(range.schedules[0])} disabled={!onOpenSchedule} className={`flex w-full items-center gap-3 rounded-xl border px-3 py-3 text-left ${config.badge} ${onOpenSchedule ? 'active:scale-[0.99]' : 'cursor-default'}`}>
                            <Icon size={16} className="shrink-0" />
                            <span className="min-w-0 flex-1"><span className="block text-xs font-black">{config.label}</span><span className="mt-0.5 block text-[10px] font-bold opacity-75">{formatDateRange(range.start, range.end)}</span></span>
                            {onOpenSchedule && <ChevronRight size={15} className="shrink-0 opacity-50" />}
                          </button>
                        );
                      })}
                    </div>
                  </article>
                ))}
              </div>
            </>
          )}
        </div>
      </section>
    </div>
  );
}
