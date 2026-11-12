'use client';

import { useCallback, useEffect, useRef, useState, useSyncExternalStore, type ButtonHTMLAttributes, type TransitionEvent } from 'react';
import { type DashboardSchedule, parseLocalDateKey } from '@/lib/dashboard-schedules';
import { getScheduleCategory, scheduleCategoryStyles } from '@/lib/schedule-category';
import { canRotateWeekCarousel, getWeekCarouselIndices, nextWeekCarouselIndex, normalizeWeekCarouselIndex } from '@/lib/week-carousel';
import styles from './weekly-day-tile.module.css';

const ROTATE_INTERVAL = 4800;

interface WeeklyDayTileProps {
  date: string;
  today: string;
  items: DashboardSchedule[];
  proximityLabel: string;
  holidayNames?: string[];
  triggerProps: ButtonHTMLAttributes<HTMLButtonElement>;
  autoPlay?: boolean;
  paused?: boolean;
}

const subscribeMotion = (notify: () => void) => {
  const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
  document.addEventListener('visibilitychange', notify);
  motion.addEventListener('change', notify);
  return () => { document.removeEventListener('visibilitychange', notify); motion.removeEventListener('change', notify); };
};
const motionAllowed = () => document.visibilityState === 'visible' && !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const serverMotionAllowed = () => false;
const cleanTitle = (title: string) => title.replace(/^(?:회의|출장|내부일정|휴가|연차|조퇴|외출)\s*[)）]\s*/u, '').trim();

export default function WeeklyDayTile({ date, today, items, proximityLabel, holidayNames = [], triggerProps, autoPlay = true, paused = false }: WeeklyDayTileProps) {
  const button = useRef<HTMLButtonElement>(null);
  const [visibleRows, setVisibleRows] = useState(3);
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const [motion, setMotion] = useState({ index: 0, moving: false });
  const motionState = useRef({ index: 0, moving: false });
  const browserAllowsMotion = useSyncExternalStore(subscribeMotion, motionAllowed, serverMotionAllowed);
  const effectiveIndex = canRotateWeekCarousel(items.length, visibleRows) ? normalizeWeekCarouselIndex(motion.index, items.length) : 0;
  const visibleCount = Math.min(items.length, visibleRows);
  const canRotate = autoPlay && !paused && !hovered && !focused && browserAllowsMotion && canRotateWeekCarousel(items.length, visibleRows);
  const signature = items.map((item) => item.id).join(':');

  const finishSlide = useCallback(() => {
    const previous = motionState.current;
    if (!previous.moving) return;
    const next = { index: nextWeekCarouselIndex(previous.index, items.length), moving: false };
    motionState.current = next;
    setMotion(next);
  }, [items.length]);

  useEffect(() => {
    const element = button.current;
    if (!element) return;
    const measure = () => {
      const rows = Number.parseInt(getComputedStyle(element).getPropertyValue('--week-tile-visible-rows'), 10);
      setVisibleRows(Number.isFinite(rows) ? Math.max(1, rows) : 3);
    };
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    window.addEventListener('resize', measure);
    measure();
    return () => { observer.disconnect(); window.removeEventListener('resize', measure); };
  }, []);

  useEffect(() => {
    // Content changes and pause conditions settle to a complete row. Nothing
    // keeps animating or waits on a missing transition event in a hidden tab.
    const frame = requestAnimationFrame(finishSlide);
    if (!canRotate) return () => cancelAnimationFrame(frame);
    let settleTimer: number | null = null;
    const timer = window.setInterval(() => {
      const previous = motionState.current;
      if (previous.moving) return;
      const next = { index: normalizeWeekCarouselIndex(previous.index, items.length), moving: true };
      motionState.current = next;
      setMotion(next);
      // A cancelled CSS transition must not strand the loop in its moving state.
      if (settleTimer !== null) window.clearTimeout(settleTimer);
      settleTimer = window.setTimeout(() => { settleTimer = null; finishSlide(); }, 460);
    }, ROTATE_INTERVAL);
    return () => { cancelAnimationFrame(frame); window.clearInterval(timer); if (settleTimer !== null) window.clearTimeout(settleTimer); };
  }, [canRotate, finishSlide, items.length, signature]);

  const transitionEnd = (event: TransitionEvent<HTMLSpanElement>) => {
    if (event.target === event.currentTarget && event.propertyName === 'transform') finishSlide();
  };
  const dateValue = parseLocalDateKey(date);
  const holidayLabel = holidayNames.join(' · ');
  const dayKind = holidayNames.length ? 'holiday' : dateValue?.getDay() === 0 ? 'sunday' : dateValue?.getDay() === 6 ? 'saturday' : 'weekday';
  const weekday = dateValue ? new Intl.DateTimeFormat('ko-KR', { weekday: 'short' }).format(dateValue) : '';
  const dateLabel = dateValue ? new Intl.DateTimeFormat('ko-KR', { month: 'long', day: 'numeric', weekday: 'long' }).format(dateValue) : date;
  const accessibleLabel = [dateLabel, holidayLabel, proximityLabel, `일정 ${items.length}건 전체 보기`].filter(Boolean).join(', ');
  const indices = getWeekCarouselIndices(items.length, effectiveIndex, visibleRows, true);

  return <button {...triggerProps} type="button" ref={button}
    className={`${styles.tile} ${date === today ? styles.today : ''} ${triggerProps.className ?? ''}`}
    aria-label={triggerProps['aria-label'] ?? accessibleLabel} title={triggerProps.title ?? accessibleLabel}
    data-dashboard-week-date={date} data-dashboard-week-trigger={date}
    data-week-day-kind={dayKind}
    data-week-carousel-index={effectiveIndex} data-week-visible-count={visibleCount} data-week-carousel-capacity={visibleRows}
    data-week-carousel-paused={String(!canRotate)} data-week-carousel-moving={String(motion.moving)}
    onPointerEnter={(event) => { finishSlide(); setHovered(true); setFocused(false); triggerProps.onPointerEnter?.(event); }}
    onPointerLeave={(event) => { setHovered(false); if (!event.currentTarget.matches(':focus-visible')) setFocused(false); triggerProps.onPointerLeave?.(event); }}
    onPointerDown={(event) => { setFocused(false); triggerProps.onPointerDown?.(event); }}
    onFocus={(event) => { finishSlide(); setFocused(event.currentTarget.matches(':focus-visible')); triggerProps.onFocus?.(event); }}
    onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setFocused(false); triggerProps.onBlur?.(event); }}
    onKeyDown={(event) => { if (event.key === 'Tab' || event.key.startsWith('Arrow') || ['Enter', ' ', 'Home', 'End', 'PageUp', 'PageDown'].includes(event.key)) { finishSlide(); setFocused(true); } triggerProps.onKeyDown?.(event); }}>
    <span className={styles.heading}>
      <time dateTime={date} data-week-day-kind={dayKind}><span className={styles.weekday}>{weekday}</span><strong>{Number(date.slice(8))}</strong></time>
      <span className={styles.count}>{items.length}<span>건</span></span>
    </span>
    <span className={`${styles.proximity} ${date === today ? styles.currentProximity : ''}`}>
      <span className={styles.proximityLabel} data-week-proximity>{proximityLabel}</span>
      {holidayLabel && <span className={styles.holidayName} data-week-holiday-name>{holidayLabel}</span>}
    </span>
    <span className={styles.viewport} data-week-carousel-viewport aria-hidden="true">
      {indices.length ? <span className={`${styles.track} ${motion.moving ? styles.moving : ''}`} onTransitionEnd={transitionEnd}>
        {indices.map((index, slot) => {
          const schedule = items[index];
          const category = getScheduleCategory(schedule);
          return <span key={slot} className={styles.row} data-week-schedule-id={schedule.id} data-week-clone={slot >= visibleCount ? 'true' : undefined}>
            <i className={`${styles.rowDot} ${scheduleCategoryStyles[category].dot}`} />
            {schedule.start_time && <span className={`${styles.rowTime} ${scheduleCategoryStyles[category].time}`}>{schedule.start_time.slice(0, 5)}</span>}
            <span className={styles.title}>{cleanTitle(schedule.title)}</span>
          </span>;
        })}
      </span> : <span className={styles.empty}><span className={styles.emptyText}>일정 없음</span><span className={styles.emptyDash}>—</span></span>}
    </span>
  </button>;
}
