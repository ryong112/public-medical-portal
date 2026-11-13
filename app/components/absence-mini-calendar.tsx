'use client';

import { useState } from 'react';
import { ArrowUpRight, ChevronLeft, ChevronRight } from 'lucide-react';
import { type DashboardSchedule, formatScheduleTime, getAbsenceTypeLabel, getScheduleEndDate, parseLocalDateKey } from '@/lib/dashboard-schedules';
import { buildAbsenceMonth, formatAbsenceDayLabel, formatAbsenceRangeLabel, getAbsencePeople, getDefaultAbsenceDate, shiftAbsenceMonth, type AbsenceMember } from '@/lib/absence-calendar';
import styles from './absence-mini-calendar.module.css';

interface AbsenceMiniCalendarProps {
  schedules: DashboardSchedule[];
  members?: AbsenceMember[];
  referenceDate: string;
  onOpenSchedule: (schedule: DashboardSchedule) => void;
  onOpenAbsenceBoard?: () => void;
}

const weekdayLabels = ['일', '월', '화', '수', '목', '금', '토'];
const fullDate = (key: string) => {
  const date = parseLocalDateKey(key);
  return date ? new Intl.DateTimeFormat('ko-KR', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' }).format(date) : '';
};

export default function AbsenceMiniCalendar({ schedules, members = [], referenceDate, onOpenSchedule, onOpenAbsenceBoard }: AbsenceMiniCalendarProps) {
  const referenceMonth = referenceDate.slice(0, 7);
  const [monthKey, setMonthKey] = useState(referenceMonth);
  const [selectedDate, setSelectedDate] = useState(() => getDefaultAbsenceDate(schedules, referenceMonth, referenceDate));
  const month = buildAbsenceMonth(schedules, monthKey, members);
  if (!month) return null;
  const selected = month.days.find((day) => day.date === selectedDate) ?? month.days[0];
  const changeMonth = (offset: number) => {
    const next = shiftAbsenceMonth(monthKey, offset);
    if (!next) return;
    setMonthKey(next);
    setSelectedDate(getDefaultAbsenceDate(schedules, next, referenceDate));
  };
  const resetMonth = () => {
    setMonthKey(referenceMonth);
    setSelectedDate(getDefaultAbsenceDate(schedules, referenceMonth, referenceDate));
  };

  return <section className={styles.calendar} data-absence-calendar aria-label="월별 휴가 달력">
    <header className={styles.navigation}>
      <button type="button" onClick={() => changeMonth(-1)} aria-label="이전 달 휴가"><ChevronLeft size={18} /></button>
      <button type="button" className={styles.monthTitle} onClick={resetMonth} title="이번 달로 이동" aria-label={`${month.label}, 이번 달로 이동`}>{month.label}</button>
      <button type="button" onClick={() => changeMonth(1)} aria-label="다음 달 휴가"><ChevronRight size={18} /></button>
    </header>
    <div className={styles.month}>
      <div className={styles.weekdays} aria-hidden="true">{weekdayLabels.map((label) => <span key={label}>{label}</span>)}</div>
      <div className={styles.dates} role="group" aria-label={`${month.label} 휴가 날짜`}>
        {Array.from({ length: month.leadingDays }, (_, index) => <span key={`blank:${index}`} aria-hidden="true" />)}
        {month.days.map((day) => <button type="button" key={day.date} data-absence-date={day.date} data-absence-count={day.people.length} aria-label={`${fullDate(day.date)} 휴가 ${day.people.length}명`} aria-pressed={selected.date === day.date} aria-current={day.date === referenceDate ? 'date' : undefined} onClick={() => setSelectedDate(day.date)} className={`${styles.day} ${day.items.length ? styles.withAbsence : ''} ${day.date < referenceDate ? styles.past : ''} ${day.date === referenceDate ? styles.today : ''} ${day.date === selected.date ? styles.selected : ''}`}>
          <span>{Number(day.date.slice(8))}</span>
          <span className={styles.marker} aria-hidden="true">{day.people.length ? day.people.length : ''}</span>
        </button>)}
      </div>
    </div>
    <div className={styles.selection}>
      <h3 aria-live="polite">{formatAbsenceDayLabel(selected.date)}<span>{selected.people.length}명</span></h3>
      <div className={styles.list} data-absence-selected-list>
        {selected.items.length ? selected.items.map((schedule) => {
          const time = schedule.start_time || schedule.end_time ? formatScheduleTime({ start_time: schedule.start_time?.slice(0, 5) ?? null, end_time: schedule.end_time?.slice(0, 5) ?? null }) : '';
          const metadata = [getAbsenceTypeLabel(schedule), time, getScheduleEndDate(schedule) !== schedule.date ? formatAbsenceRangeLabel(schedule) : ''].filter(Boolean).join(' · ');
          const names = getAbsencePeople(schedule, members).join(', ');
          return <button type="button" key={schedule.id} className={styles.person} data-absence-schedule-id={schedule.id} onClick={() => onOpenSchedule(schedule)} aria-label={`${names}, ${fullDate(selected.date)}, ${metadata} 상세 보기`}>
            <strong>{names}</strong><span>{metadata}</span>
          </button>;
        }) : <p className={styles.empty}>등록된 휴가가 없습니다.</p>}
      </div>
    </div>
    {onOpenAbsenceBoard && <button type="button" className={styles.fullBoard} onClick={onOpenAbsenceBoard}>월간 현황표 <ArrowUpRight size={14} /></button>}
  </section>;
}
