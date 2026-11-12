import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronLeft, ChevronRight, Printer, X } from 'lucide-react';
import { getScheduleCategory, scheduleCategoryStyles } from '@/lib/schedule-category';
import { type DashboardSchedule, formatScheduleDateRange, formatScheduleTime, getAbsenceTypeLabel, getSevenDayKeys, parseLocalDateKey, scheduleOccursOn, scheduleOverlaps, shiftDateKey, toLocalDateKey } from '@/lib/dashboard-schedules';

export interface WeeklySchedulePrintProps {
  schedules: DashboardSchedule[];
  onClose: () => void;
  initialStartDate?: string;
  scopeLabel?: string;
}

// The portal is a direct body child. Printing hides the application shell, then
// removes every screen-only size/overflow constraint so rows can paginate.
const printStyles = `
  .weekly-print-sheet { color: #0f172a; background: #fff; overflow-wrap: anywhere; }
  .weekly-print-sheet h1 { font-size: 24px; font-weight: 800; margin: 0 0 8px; }
  .weekly-print-sheet h2 { font-size: 18px; font-weight: 800; margin: 24px 0 12px; }
  .weekly-print-sheet h3 { font-size: 14px; font-weight: 700; margin: 12px 0 8px; }
  .weekly-print-sheet p { margin: 4px 0; line-height: 1.6; }
  .weekly-print-sheet table { width: 100%; border-collapse: collapse; table-layout: fixed; font-size: 12px; line-height: 1.6; }
  .weekly-print-sheet th, .weekly-print-sheet td { border: 1px solid #cbd5e1; padding: 8px; text-align: left; vertical-align: top; white-space: normal; overflow-wrap: anywhere; }
  .weekly-print-sheet th { background: #f1f5f9; font-weight: 700; }
  .weekly-print-sheet .event-title { font-weight: 700; }
  .weekly-print-sheet .event-note { color: #475569; font-size: 11px; }
  .weekly-print-table-wrap { overflow-x: auto; }
  @media screen { .weekly-print-sheet table { min-width: 680px; } }
  @media print {
    @page { size: A4 landscape; margin: 12mm; }
    html, body { height: auto !important; overflow: visible !important; background: white !important; }
    body > :not([data-weekly-print-root]) { display: none !important; }
    [data-weekly-print-root] { display: block !important; position: static !important; padding: 0 !important; margin: 0 !important; height: auto !important; max-height: none !important; overflow: visible !important; background: white !important; }
    .weekly-print-panel { display: block !important; width: auto !important; max-width: none !important; height: auto !important; max-height: none !important; overflow: visible !important; padding: 0 !important; border: 0 !important; border-radius: 0 !important; box-shadow: none !important; }
    .weekly-print-controls { display: none !important; }
    .weekly-print-sheet { overflow: visible !important; padding: 0 !important; }
    .weekly-print-table-wrap { overflow: visible !important; }
    .weekly-print-sheet table { min-width: 0 !important; margin-top: 12px; font-size: 10pt; line-height: 1.4; }
    .weekly-print-sheet th, .weekly-print-sheet td { padding: 5px; }
    .weekly-print-sheet thead { display: table-header-group; }
    .weekly-print-sheet tr { break-inside: avoid; page-break-inside: avoid; }
    .weekly-print-sheet th { background: #f1f5f9 !important; print-color-adjust: exact; }
    .weekly-print-sheet h1 { font-size: 18pt; }
    .weekly-print-sheet h2 { font-size: 13pt; break-after: avoid; page-break-after: avoid; }
    .weekly-print-sheet h3 { font-size: 11pt; break-after: avoid; page-break-after: avoid; }
    .weekly-print-sheet .event-note { font-size: 9pt; }
  }
`;

export function WeeklySchedulePrintSheet({ schedules, startDate, scopeLabel = '전체 일정' }: { schedules: DashboardSchedule[]; startDate: string; scopeLabel?: string }) {
  const days = getSevenDayKeys(startDate);
  const endDate = days.at(-1) ?? '';
  const scheduleCount = endDate ? schedules.filter((schedule) => scheduleOverlaps(schedule, startDate, endDate)).length : 0;
  return <article className="weekly-print-sheet p-4 sm:p-6" aria-label="주간 일정 인쇄 미리보기">
    <header><h1>주간 일정표</h1><p>{startDate} ~ {endDate} · {scopeLabel}</p><p className="event-note">총 {scheduleCount}건 (휴가 포함) · 여러 날에 걸친 일정은 해당 날짜마다 표시합니다. 미입력 정보는 —로 표시합니다.</p></header>
    <div className="weekly-print-table-wrap mt-4" tabIndex={0} role="region" aria-label="7일 업무 및 휴가 일정">
      <table>
        <colgroup><col style={{ width: '12%' }} /><col style={{ width: '11%' }} /><col style={{ width: '9%' }} /><col style={{ width: '26%' }} /><col style={{ width: '10%' }} /><col style={{ width: '18%' }} /><col style={{ width: '14%' }} /></colgroup>
        <thead><tr><th scope="col">날짜</th><th scope="col">시간</th><th scope="col">유형</th><th scope="col">일정</th><th scope="col">담당자</th><th scope="col">참석자</th><th scope="col">장소</th></tr></thead>
        <tbody>{days.flatMap((day) => {
          const items = schedules.filter((schedule) => scheduleOccursOn(schedule, day)).sort((a, b) => (a.start_time ?? a.end_time ?? '99:99').localeCompare(b.start_time ?? b.end_time ?? '99:99') || a.id - b.id);
          const dateLabel = `${day} (${new Intl.DateTimeFormat('ko-KR', { weekday: 'short' }).format(parseLocalDateKey(day)!)})`;
          if (!items.length) return [<tr key={day} className="weekly-print-day"><th scope="row">{dateLabel}</th><td colSpan={6}>등록된 일정이 없습니다.</td></tr>];
          return items.map((schedule, index) => <tr key={`${day}-${schedule.id}`} className={index === 0 ? 'weekly-print-day' : undefined}>
            <th scope="row">{dateLabel}</th><td>{formatScheduleTime(schedule)}</td>
            <td>{getScheduleCategory(schedule) === 'leave' ? getAbsenceTypeLabel(schedule) : scheduleCategoryStyles[getScheduleCategory(schedule)].label}</td>
            <td><p className="event-title">{schedule.title}</p>{schedule.end_date && schedule.end_date > schedule.date && <p className="event-note">{formatScheduleDateRange(schedule)}</p>}{(schedule.is_notice || schedule.is_urgent || schedule.is_todo) && <p className="event-note">{[schedule.is_urgent && '긴급', schedule.is_notice && '공지', schedule.is_todo && (schedule.is_completed ? 'TODO 완료' : 'TODO 미완료')].filter(Boolean).join(' · ')}</p>}</td>
            <td>{schedule.owner_name?.trim() || '—'}</td><td>{schedule.attendee_names?.filter((name) => name.trim()).join(', ') || '—'}</td><td>{schedule.location?.trim() || '—'}</td>
          </tr>);
        })}</tbody>
      </table>
    </div>
  </article>;
}

export default function WeeklySchedulePrint({ schedules, onClose, initialStartDate, scopeLabel }: WeeklySchedulePrintProps) {
  const [startDate, setStartDate] = useState(() => initialStartDate && parseLocalDateKey(initialStartDate) ? initialStartDate : toLocalDateKey(new Date()));
  const rootRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const dateInputRef = useRef<HTMLInputElement>(null);
  const days = getSevenDayKeys(startDate);

  useEffect(() => {
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    const siblings = [...document.body.children].filter((element): element is HTMLElement => element instanceof HTMLElement && element !== rootRef.current);
    const inertStates = siblings.map((element) => ({ element, inert: element.inert }));
    siblings.forEach((element) => { element.inert = true; });
    document.body.style.overflow = 'hidden';
    dateInputRef.current?.focus();
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); onClose(); return; }
      if (event.key !== 'Tab') return;
      const focusable = [...(panelRef.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), [tabindex="0"]') ?? [])];
      const first = focusable[0];
      const last = focusable.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    };
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('keydown', handleKey);
      document.body.style.overflow = previousOverflow;
      inertStates.forEach(({ element, inert }) => { element.inert = inert; });
      previousFocus?.focus();
    };
  }, [onClose]);

  if (typeof document === 'undefined') return null;
  return createPortal(<div ref={rootRef} data-weekly-print-root className="fixed inset-0 z-[10000] overflow-y-auto bg-slate-950/60 p-3 sm:p-6" onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <style>{printStyles}</style>
    <div ref={panelRef} role="dialog" aria-modal="true" aria-labelledby="weekly-print-title" className="weekly-print-panel mx-auto max-w-6xl rounded-2xl bg-white shadow-2xl">
      <div className="weekly-print-controls sticky top-0 z-10 rounded-t-2xl border-b border-slate-200 bg-white p-4 sm:p-6">
        <div className="flex items-start justify-between gap-3"><div><h2 id="weekly-print-title" className="text-lg font-bold text-slate-900">주간 일정 인쇄 / PDF 저장</h2><p className="mt-1 text-sm text-slate-600">시작일부터 7일을 인쇄합니다. 인쇄 창에서 ‘PDF로 저장’을 선택할 수 있습니다.</p><p className="mt-1 text-xs text-slate-500">내용에 따라 여러 페이지로 나뉩니다. A4 가로 방향을 권장합니다.</p></div><button type="button" onClick={onClose} aria-label="주간 인쇄 닫기" className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl hover:bg-slate-100"><X size={22} /></button></div>
        <div className="mt-4 flex flex-wrap items-end gap-3">
          <label className="text-sm font-bold text-slate-700">시작일<input ref={dateInputRef} type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} aria-describedby="weekly-print-range" className="mt-1 block min-h-11 rounded-lg border border-slate-300 px-3 py-2 font-medium" /></label>
          <p id="weekly-print-range" className="pb-3 text-sm text-slate-600" aria-live="polite">{days.length ? `종료일 ${days[6]} (7일)` : '올바른 시작일을 선택해 주세요.'}</p>
          <div className="flex gap-2"><button type="button" disabled={!days.length} onClick={() => setStartDate(shiftDateKey(startDate, -7))} className="flex min-h-11 items-center gap-1 rounded-lg border border-slate-300 px-3 text-sm disabled:opacity-40"><ChevronLeft size={16} />이전 7일</button><button type="button" disabled={!days.length} onClick={() => setStartDate(shiftDateKey(startDate, 7))} className="flex min-h-11 items-center gap-1 rounded-lg border border-slate-300 px-3 text-sm disabled:opacity-40">다음 7일<ChevronRight size={16} /></button></div>
          <button type="button" disabled={!days.length} onClick={() => window.print()} className="flex min-h-11 items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-bold text-white hover:bg-blue-700 disabled:opacity-40"><Printer size={17} />인쇄 / PDF 저장</button>
        </div>
      </div>
      {days.length > 0 && <WeeklySchedulePrintSheet schedules={schedules} startDate={startDate} scopeLabel={scopeLabel} />}
    </div>
  </div>, document.body);
}
