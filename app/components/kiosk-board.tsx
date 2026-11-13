'use client';

import { useMemo, useState, type CSSProperties, type ReactNode } from 'react';
import { BellRing, CalendarDays, CheckCircle2, MonitorUp, Pause, Play, Siren } from 'lucide-react';
import { getScheduleCategory, scheduleCategoryStyles, type ScheduleCategory } from '@/lib/schedule-category';
import { toLocalDateKey } from '@/lib/dashboard-schedules';
import { cleanKioskTitle, formatKioskDateRange, formatKioskTime, getKioskAbsenceLabel, getKioskAbsencePeopleLabel, getKioskEventStatus, getKioskGroups, type KioskSchedule } from '@/lib/kiosk-schedules';
import KioskRotatingList from './kiosk-rotating-list';
import styles from './kiosk-board.module.css';

interface KioskBoardProps {
  schedules: KioskSchedule[];
  now: Date;
  controls: ReactNode;
}

const legend: Array<{ key: ScheduleCategory; label: string }> = [
  { key: 'general', label: '일반' }, { key: 'internal', label: '내부일정' },
  { key: 'business_trip', label: '출장' }, { key: 'meeting', label: '회의' }, { key: 'leave', label: '휴가' },
];
const itemKey = (item: KioskSchedule) => item.id;
const clockTime = (value?: string | null) => {
  const parts = value?.match(/^(\d{1,2}):(\d{1,2})/);
  return parts ? `${parts[1].padStart(2, '0')}:${parts[2].padStart(2, '0')}` : '';
};

function EventRow({ item, now, showDate = false, compact = false, agenda = false }: { item: KioskSchedule; now: Date; showDate?: boolean; compact?: boolean; agenda?: boolean }) {
  const category = getScheduleCategory(item);
  const status = getKioskEventStatus(item, now);
  const start = clockTime(item.start_time);
  const end = clockTime(item.end_time);
  const time = start || end;
  return <div className={`${styles.eventRow} ${compact ? styles.compactEvent : ''} ${agenda ? styles.agendaEvent : ''} ${status.dimmed ? styles.endedEvent : ''} border-l-4 ${scheduleCategoryStyles[category].darkAccent}`}
    data-kiosk-event-id={item.id} data-schedule-category={category} data-kiosk-event-status={status.kind} data-kiosk-event-status-label={status.label}
    title={[cleanKioskTitle(item.title), formatKioskDateRange(item), formatKioskTime(item), status.label, item.location].filter(Boolean).join(' · ')}>
    {agenda && <div className={styles.agendaDate}>{formatKioskDateRange(item)}</div>}
    {!compact && <div className={styles.eventTime} aria-label={formatKioskTime(item)}>
      <strong>{time || '미정'}</strong>
      {time && <span>{start && end ? `– ${end}` : start ? '부터' : '까지'}</span>}
    </div>}
    <div className={styles.eventContent}>
      <div className={styles.eventTitleLine}>
        {item.is_urgent && <span className={styles.urgent} aria-label="긴급"><Siren size={15} /></span>}
        <strong className={styles.eventTitle}>{cleanKioskTitle(item.title)}</strong>
      </div>
      <div className={styles.eventMeta}>
        {showDate && !agenda && <span className={styles.eventDate}>{formatKioskDateRange(item)}</span>}
        {compact && <span>{formatKioskTime(item)}</span>}
        {!compact && item.location && <span className={styles.location}>{item.location}</span>}
        {!agenda && <span className={styles.status} data-kind={status.kind}>{status.label}</span>}
      </div>
    </div>
    {agenda && <span className={styles.status} data-kind={status.kind}>{status.label}</span>}
  </div>;
}

function AbsenceRow({ item, upcoming = false }: { item: KioskSchedule; upcoming?: boolean }) {
  return <div className={`${styles.absenceRow} border-l-4 ${scheduleCategoryStyles.leave.darkAccent}`} data-kiosk-event-id={item.id} data-schedule-category="leave"
    title={[getKioskAbsencePeopleLabel(item), formatKioskDateRange(item), getKioskAbsenceLabel(item), formatKioskTime(item)].join(' · ')}>
    <div className={styles.absenceTop}><strong>{getKioskAbsencePeopleLabel(item)}</strong><span className={styles.absenceType}>{getKioskAbsenceLabel(item)}</span></div>
    <div className={styles.absenceMeta}>
      {(upcoming || Boolean(item.end_date && item.end_date !== item.date)) && <span>{formatKioskDateRange(item)}</span>}
      {(item.start_time || item.end_time) ? <span>{formatKioskTime(item)}</span> : !upcoming && (!item.end_date || item.end_date === item.date) ? <span>시간 미정</span> : null}
    </div>
  </div>;
}

function Panel({ id, title, count, icon, className = '', children, style, emptyLabel }: {
  id: string; title: string; count: number; icon?: ReactNode; className?: string; children?: ReactNode; style?: CSSProperties; emptyLabel?: string;
}) {
  return <section className={`${styles.panel} ${count === 0 ? styles.emptyPanel : ''} ${className}`} style={style} data-kiosk-panel={id} data-kiosk-count={count} data-kiosk-small-section={count > 0 && count <= 2 ? 'true' : 'false'}>
    <header className={styles.panelHeader}>
      {icon && <span className={styles.panelIcon}>{icon}</span>}
      <h2>{title}</h2><span className={styles.panelCount}>{count}<span>건</span></span>
      {count === 0 && emptyLabel && <span className={styles.emptyInline}>{emptyLabel}</span>}
    </header>
    {count > 0 && <div className={styles.panelBody}>{children}</div>}
  </section>;
}

export default function KioskBoard({ schedules, now, controls }: KioskBoardProps) {
  const today = toLocalDateKey(now);
  const groups = useMemo(() => getKioskGroups(schedules, today), [schedules, today]);
  const [autoPlay, setAutoPlay] = useState(true);
  const hasSupport = groups.notices.length + groups.todos.length + groups.absencesUpcoming.length > 0;
  const isSparse = groups.today.length <= 2 && groups.thisWeek.length <= 2 && groups.nextWeek.length <= 2;
  const todaySurfaceHeight = 64
    + (groups.today.length ? 36 + groups.today.length * 94 - 6 : 26)
    + (groups.absencesToday.length ? 54 + Math.min(groups.absencesToday.length, 2) * 70 - 6 + (groups.absencesToday.length > 2 ? 32 : 0) : 40);
  const agendaSurfaceHeight = 62
    + (groups.thisWeek.length ? 34 + groups.thisWeek.length * 72 - 6 : 26)
    + (groups.nextWeek.length ? 49 + groups.nextWeek.length * 72 - 6 : 41);
  const isAnyListLong = [groups.today, groups.thisWeek, groups.nextWeek, groups.notices, groups.todos, groups.absencesToday, groups.absencesUpcoming].some((items) => items.length > 1);
  const noticeRenderer = (item: KioskSchedule) => <EventRow item={item} now={now} showDate compact />;
  const absenceRenderer = (item: KioskSchedule) => <AbsenceRow item={item} upcoming />;
  return <div className={styles.board} data-kiosk-board data-kiosk-has-support={String(hasSupport)} data-kiosk-sparse={String(isSparse)} style={{ '--sparse-main-height': `${Math.max(todaySurfaceHeight, agendaSurfaceHeight)}px`, '--today-surface-height': `${todaySurfaceHeight}px`, '--agenda-surface-height': `${agendaSurfaceHeight}px` } as CSSProperties}>
    <header className={styles.header}>
      <div className={styles.identity}>
        <p><MonitorUp size={17} /><span>공공의료지원과</span><span className={styles.identityDetail}>전광판</span></p>
        <h1>{now.toLocaleDateString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' })}</h1>
      </div>
      <div className={styles.headerRight}>
        <time className={styles.clock} dateTime={now.toISOString()}>
          <span>{now.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })}</span>
          <span key={now.getSeconds()} className={`kiosk-second-tick ${styles.seconds}`}>:{String(now.getSeconds()).padStart(2, '0')}</span>
        </time>
        <div className={styles.windowControls}>{controls}</div>
      </div>
    </header>
    <div className={styles.toolbar}>
      <div className={styles.legend} aria-label="일정 유형 색상 안내" role="list">
        {legend.map(({ key, label }) => <span key={key} role="listitem" data-schedule-category={key}><i className={scheduleCategoryStyles[key].darkDot} aria-hidden="true" />{label}</span>)}
      </div>
      {isAnyListLong && <button type="button" className={styles.autoplay} data-kiosk-autoplay={String(autoPlay)} aria-label={`전광판 자동 넘김 ${autoPlay ? '일시정지' : '재생'}`} aria-pressed={!autoPlay} onClick={() => setAutoPlay((playing) => !playing)}>
        {autoPlay ? <Pause size={14} /> : <Play size={14} />}<span>{autoPlay ? '자동 넘김' : '넘김 멈춤'}</span>
      </button>}
    </div>
    <main className={styles.main}>
      <div className={styles.todayStack} data-kiosk-today-stack data-has-absence={groups.absencesToday.length > 0 ? 'true' : 'false'}>
        <Panel id="today" title="오늘 일정" count={groups.today.length} className={styles.todayPanel} emptyLabel="등록된 일정 없음">
          <KioskRotatingList items={groups.today} itemKey={itemKey} label="오늘 일정" minRowHeight={88} maxRows={5} autoPlay={autoPlay} renderItem={(item) => <EventRow item={item} now={now} />} />
        </Panel>
        <Panel id="absences-today" title="오늘 자리 비움" count={groups.absencesToday.length} className={styles.todayAbsence} icon={<CalendarDays size={18} />} emptyLabel="없음">
          <KioskRotatingList items={groups.absencesToday} itemKey={itemKey} label="오늘 자리 비움" minRowHeight={64} maxRows={2} autoPlay={autoPlay} renderItem={(item) => <AbsenceRow item={item} />} />
        </Panel>
      </div>
      <div className={styles.agenda} data-kiosk-agenda>
        <Panel id="this-week" title="이번 주 일정" count={groups.thisWeek.length} className={styles.weekPanel} style={{ '--week-rows': Math.min(groups.thisWeek.length, 8) } as CSSProperties} emptyLabel="남은 일정 없음">
          <KioskRotatingList items={groups.thisWeek} itemKey={itemKey} label="이번 주 일정" minRowHeight={66} maxRows={8} autoPlay={autoPlay} renderItem={(item) => <EventRow item={item} now={now} agenda />} />
        </Panel>
        <Panel id="next-week" title="다음 주 일정" count={groups.nextWeek.length} className={styles.weekPanel} style={{ '--week-rows': Math.min(groups.nextWeek.length, 8) } as CSSProperties} emptyLabel="등록된 일정 없음">
          <KioskRotatingList items={groups.nextWeek} itemKey={itemKey} label="다음 주 일정" minRowHeight={66} maxRows={8} autoPlay={autoPlay} renderItem={(item) => <EventRow item={item} now={now} agenda />} />
        </Panel>
      </div>
    </main>
    <aside className={styles.support} aria-label="함께 확인할 내용">
      <Panel id="notices" title="공지사항" count={groups.notices.length} className={styles.supportPanel} icon={<BellRing size={18} />} emptyLabel="진행 중인 공지 없음">
        <KioskRotatingList items={groups.notices} itemKey={itemKey} label="공지사항" minRowHeight={64} maxRows={1} autoPlay={autoPlay} renderItem={noticeRenderer} />
      </Panel>
      <Panel id="todos" title="미완료 할 일" count={groups.todos.length} className={styles.supportPanel} icon={<CheckCircle2 size={18} />} emptyLabel="모두 완료">
        <KioskRotatingList items={groups.todos} itemKey={itemKey} label="미완료 할 일" minRowHeight={64} maxRows={1} autoPlay={autoPlay} renderItem={noticeRenderer} />
      </Panel>
      <Panel id="absences-upcoming" title="예정된 휴가" count={groups.absencesUpcoming.length} className={styles.supportPanel} icon={<CalendarDays size={18} />} emptyLabel="예정 없음">
        <KioskRotatingList items={groups.absencesUpcoming} itemKey={itemKey} label="예정된 휴가" minRowHeight={64} maxRows={1} autoPlay={autoPlay} renderItem={absenceRenderer} />
      </Panel>
    </aside>
  </div>;
}
