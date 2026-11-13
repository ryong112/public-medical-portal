'use client';

import { useEffect, useRef, useState, useSyncExternalStore, type CSSProperties, type ReactNode } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { getKioskPageSize } from '@/lib/kiosk-pagination';
import { getPreviewPageWindow } from '@/lib/preview-pagination';
import styles from './kiosk-rotating-list.module.css';

const subscribeMotion = (notify: () => void) => {
  const query = window.matchMedia('(prefers-reduced-motion: reduce)');
  document.addEventListener('visibilitychange', notify);
  query.addEventListener('change', notify);
  return () => { document.removeEventListener('visibilitychange', notify); query.removeEventListener('change', notify); };
};
const canMove = () => !document.hidden && !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const serverMotion = () => false;

interface Props<T> {
  items: T[];
  renderItem: (item: T) => ReactNode;
  itemKey: (item: T) => string | number;
  label: string;
  minRowHeight?: number;
  maxRows?: number;
  autoPlay?: boolean;
}

export default function KioskRotatingList<T>({ items, renderItem, itemKey, label, minRowHeight = 76, maxRows = 6, autoPlay = true }: Props<T>) {
  const root = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState(0);
  const [page, setPage] = useState(0);
  const [hovered, setHovered] = useState(false);
  const [keyboardFocus, setKeyboardFocus] = useState(false);
  const [manualTurn, setManualTurn] = useState(0);
  const motionAllowed = useSyncExternalStore(subscribeMotion, canMove, serverMotion);
  const pageSize = getKioskPageSize(height, minRowHeight, items.length, maxRows);
  const pages = Math.max(1, Math.ceil(items.length / pageSize));
  const current = Math.min(page, pages - 1);
  const playing = autoPlay && motionAllowed && !hovered && !keyboardFocus && pages > 1;
  const signature = items.map(itemKey).join('|');

  useEffect(() => {
    const element = root.current;
    if (!element) return;
    const measure = () => setHeight(element.clientHeight);
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    const frame = requestAnimationFrame(measure);
    return () => { observer.disconnect(); cancelAnimationFrame(frame); };
  }, []);

  useEffect(() => {
    if (!playing) return;
    const timer = window.setInterval(() => setPage((value) => (Math.min(value, pages - 1) + 1) % pages), 8000);
    return () => window.clearInterval(timer);
  }, [playing, pages, signature, manualTurn]);

  const goTo = (target: number) => {
    setPage((target + pages) % pages);
    setManualTurn((value) => value + 1);
  };

  return <div ref={root} className={styles.root} style={{ '--kiosk-row-height': `${minRowHeight}px` } as CSSProperties}
    data-kiosk-rotation={label} data-kiosk-page={current + 1} data-kiosk-pages={pages} data-kiosk-page-size={pageSize} data-kiosk-playing={String(playing)}
    role="group" aria-label={`${label} 목록`} tabIndex={pages > 1 ? 0 : undefined}
    onPointerEnter={(event) => { if (event.pointerType !== 'touch') setHovered(true); }}
    onPointerLeave={() => { setHovered(false); if (!document.activeElement?.matches(':focus-visible')) setKeyboardFocus(false); }}
    onPointerDown={() => setKeyboardFocus(false)}
    onFocus={(event) => setKeyboardFocus(event.target.matches(':focus-visible'))}
    onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setKeyboardFocus(false); }}
    onKeyDown={(event) => {
      if (event.ctrlKey || event.altKey || event.metaKey || pages <= 1) return;
      const delta = ['ArrowDown', 'ArrowRight', 'PageDown'].includes(event.key) ? 1 : ['ArrowUp', 'ArrowLeft', 'PageUp'].includes(event.key) ? -1 : 0;
      if (delta || event.key === 'Home' || event.key === 'End') {
        event.preventDefault(); setKeyboardFocus(true);
        goTo(delta ? current + delta : event.key === 'Home' ? 0 : pages - 1);
      }
    }}>
    <div className={styles.viewport}>
      <ul key={`${current}:${pageSize}`} className={styles.page}>
        {items.slice(current * pageSize, (current + 1) * pageSize).map((item) => <li key={itemKey(item)} className={styles.row}>{renderItem(item)}</li>)}
      </ul>
    </div>
    {pages > 1 && <nav className={styles.navigation} aria-label={`${label} 페이지`}>
      <span className={styles.pageNumber}>{current + 1} / {pages}</span>
      <button type="button" aria-label={`${label} 이전 페이지`} onClick={() => goTo(current - 1)}><ChevronLeft size={16} /></button>
      <div className={styles.dots}>{getPreviewPageWindow(current, pages).map((index) => <button key={index} type="button" aria-label={`${label} ${index + 1}페이지`} aria-current={index === current ? 'page' : undefined} onClick={() => goTo(index)}><span /></button>)}</div>
      <button type="button" aria-label={`${label} 다음 페이지`} onClick={() => goTo(current + 1)}><ChevronRight size={16} /></button>
    </nav>}
  </div>;
}
