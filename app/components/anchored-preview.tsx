'use client';

import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type ButtonHTMLAttributes, type ReactNode, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { Pin, X } from 'lucide-react';
import styles from './anchored-preview.module.css';

const OPEN_DELAY = 400;
const LEAVE_DELAY = 230;
const EXIT_DURATION = 170;
const POINTER_TOLERANCE = 6;

export interface AnchoredPreviewState<Key extends string> {
  key: Key;
  anchor: HTMLElement;
  pinned: boolean;
  phase: 'open' | 'closing';
}

export interface PreviewCloseOptions {
  restoreFocus?: boolean;
  immediate?: boolean;
  suppressReopen?: boolean;
  suppressFocusReopen?: boolean;
}

export interface AnchoredPreviewController<Key extends string> {
  active: AnchoredPreviewState<Key> | null;
  dialogId: string;
  panelRef: RefObject<HTMLDivElement | null>;
  getTriggerProps: (key: Key) => ButtonHTMLAttributes<HTMLButtonElement> & { 'data-anchored-preview-trigger': Key };
  close: (options?: PreviewCloseOptions) => void;
  togglePin: () => void;
  panelEvents: Pick<React.HTMLAttributes<HTMLDivElement>, 'onPointerEnter' | 'onPointerLeave' | 'onFocusCapture' | 'onBlurCapture'>;
}

/** One controller per dashboard intentionally permits only one open preview. */
export function useAnchoredPreview<Key extends string>(): AnchoredPreviewController<Key> {
  const [active, setActive] = useState<AnchoredPreviewState<Key> | null>(null);
  const activeRef = useRef<AnchoredPreviewState<Key> | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const candidate = useRef<{ key: Key; anchor: HTMLElement; x: number; y: number } | null>(null);
  const hoveredTrigger = useRef<HTMLElement | null>(null);
  const panelHovered = useRef(false);
  const pointerPosition = useRef<{ x: number; y: number } | null>(null);
  const suppressedAnchor = useRef<HTMLElement | null>(null);
  const suppressedFocusAnchor = useRef<HTMLElement | null>(null);
  const pendingPanelFocus = useRef(false);
  const openTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const leaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const exitTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const focusFrame = useRef<number | null>(null);
  const reactId = useId();
  const dialogId = `anchored-preview-${reactId.replace(/:/g, '')}`;

  const cancelOpen = useCallback(() => {
    if (openTimer.current !== null) clearTimeout(openTimer.current);
    openTimer.current = null;
    candidate.current = null;
  }, []);
  const cancelLeave = useCallback(() => {
    if (leaveTimer.current !== null) clearTimeout(leaveTimer.current);
    leaveTimer.current = null;
  }, []);
  const commit = useCallback((next: AnchoredPreviewState<Key> | null) => {
    activeRef.current = next;
    setActive(next);
  }, []);
  const close = useCallback((options: PreviewCloseOptions = {}) => {
    cancelOpen();
    cancelLeave();
    if (exitTimer.current !== null) clearTimeout(exitTimer.current);
    const previous = activeRef.current;
    if (!previous) return;
    // Only suppress a pointer still over the dismissed source. Auto-leave
    // happens after that source's leave event, so suppressing it here would
    // incorrectly swallow the next deliberate entry.
    suppressedAnchor.current = (options.suppressReopen ?? hoveredTrigger.current === previous.anchor) ? previous.anchor : null;
    suppressedFocusAnchor.current = options.restoreFocus || options.suppressFocusReopen ? previous.anchor : null;
    panelHovered.current = false;
    pendingPanelFocus.current = false;
    if (options.immediate) commit(null);
    else {
      commit({ ...previous, phase: 'closing' });
      exitTimer.current = setTimeout(() => { exitTimer.current = null; commit(null); }, EXIT_DURATION);
    }
    if (options.restoreFocus && previous.anchor.isConnected) {
      if (focusFrame.current !== null) cancelAnimationFrame(focusFrame.current);
      focusFrame.current = requestAnimationFrame(() => { focusFrame.current = null; previous.anchor.focus({ preventScroll: true }); });
    }
  }, [cancelLeave, cancelOpen, commit]);
  const open = useCallback((key: Key, anchor: HTMLElement, pinned: boolean, focusPanel = false) => {
    cancelOpen();
    cancelLeave();
    if (exitTimer.current !== null) clearTimeout(exitTimer.current);
    exitTimer.current = null;
    suppressedAnchor.current = null;
    suppressedFocusAnchor.current = null;
    pendingPanelFocus.current = focusPanel;
    commit({ key, anchor, pinned, phase: 'open' });
  }, [cancelLeave, cancelOpen, commit]);
  const scheduleOpen = useCallback((key: Key, anchor: HTMLElement, x: number, y: number) => {
    cancelOpen();
    candidate.current = { key, anchor, x, y };
    openTimer.current = setTimeout(() => {
      const next = candidate.current;
      if (!next || hoveredTrigger.current !== next.anchor || suppressedAnchor.current === next.anchor || activeRef.current?.pinned) return;
      open(next.key, next.anchor, false);
    }, OPEN_DELAY);
  }, [cancelOpen, open]);
  const scheduleLeave = useCallback(() => {
    cancelLeave();
    const checkLeave = () => {
      leaveTimer.current = null;
      const current = activeRef.current;
      const focused = document.activeElement;
      if (!current || current.pinned || panelHovered.current || hoveredTrigger.current
        || current.anchor.contains(focused) || panelRef.current?.contains(focused)) return;
      // Keep the tiny visual gap traversable without an invisible DOM layer
      // intercepting clicks on adjacent dates or their representative titles.
      const point = pointerPosition.current;
      if (point && panelRef.current) {
        const anchorBox = current.anchor.getBoundingClientRect();
        const panelBox = panelRef.current.getBoundingClientRect();
        const top = panelBox.top >= anchorBox.bottom ? anchorBox.bottom : panelBox.bottom;
        const bottom = panelBox.top >= anchorBox.bottom ? panelBox.top : anchorBox.top;
        const isGap = bottom >= top && bottom - top <= 24;
        if (isGap && point.y >= top && point.y <= bottom && point.x >= Math.min(anchorBox.left, panelBox.left) && point.x <= Math.max(anchorBox.right, panelBox.right)) {
          leaveTimer.current = setTimeout(checkLeave, LEAVE_DELAY);
          return;
        }
      }
      close({ suppressReopen: false });
    };
    leaveTimer.current = setTimeout(checkLeave, LEAVE_DELAY);
  }, [cancelLeave, close]);
  const togglePin = useCallback(() => {
    const current = activeRef.current;
    if (!current || current.phase === 'closing') return;
    commit({ ...current, pinned: !current.pinned });
    cancelLeave();
    if (current.pinned) scheduleLeave();
  }, [cancelLeave, commit, scheduleLeave]);

  useEffect(() => {
    const trackPointer = (event: PointerEvent) => { pointerPosition.current = { x: event.clientX, y: event.clientY }; };
    const outside = (event: PointerEvent) => {
      const target = event.target as Node | null;
      const current = activeRef.current;
      if (current && target && !current.anchor.contains(target) && !panelRef.current?.contains(target)) close();
      else if (!current && candidate.current && target && !candidate.current.anchor.contains(target)) cancelOpen();
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      const current = activeRef.current;
      if (current?.phase === 'open') {
        event.preventDefault();
        // A completed row may disappear while its checkbox owns focus. In that
        // case the browser falls back to body, but an explicitly pinned preview
        // should still return Escape to its originating control.
        const restoreFocus = current.pinned || Boolean(panelRef.current?.contains(document.activeElement));
        close({ restoreFocus });
      } else if (candidate.current) {
        suppressedAnchor.current = candidate.current.anchor;
        cancelOpen();
      }
    };
    document.addEventListener('pointerdown', outside, true);
    document.addEventListener('pointermove', trackPointer, { passive: true });
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('pointerdown', outside, true);
      document.removeEventListener('pointermove', trackPointer);
      document.removeEventListener('keydown', escape);
      cancelOpen();
      cancelLeave();
      if (exitTimer.current !== null) clearTimeout(exitTimer.current);
      if (focusFrame.current !== null) cancelAnimationFrame(focusFrame.current);
    };
  }, [cancelLeave, cancelOpen, close]);
  useLayoutEffect(() => {
    if (active?.phase !== 'open' || !pendingPanelFocus.current || !panelRef.current) return;
    pendingPanelFocus.current = false;
    panelRef.current.focus({ preventScroll: true });
  }, [active]);

  const getTriggerProps = (key: Key): ButtonHTMLAttributes<HTMLButtonElement> & { 'data-anchored-preview-trigger': Key } => ({
    'data-anchored-preview-trigger': key,
    'aria-haspopup': 'dialog',
    'aria-expanded': active?.key === key && active.phase === 'open',
    'aria-controls': dialogId,
    onPointerEnter: (event) => {
      if (event.pointerType !== 'mouse' && event.pointerType !== 'pen') return;
      const anchor = event.currentTarget;
      hoveredTrigger.current = anchor;
      if (suppressedFocusAnchor.current === anchor) suppressedFocusAnchor.current = null;
      cancelLeave();
      if (suppressedAnchor.current === anchor || activeRef.current?.pinned) return;
      if (activeRef.current?.anchor === anchor && activeRef.current.phase === 'open') return;
      scheduleOpen(key, anchor, event.clientX, event.clientY);
    },
    onPointerMove: (event) => {
      const pending = candidate.current;
      if (!pending || pending.anchor !== event.currentTarget) return;
      if (Math.hypot(event.clientX - pending.x, event.clientY - pending.y) > POINTER_TOLERANCE) scheduleOpen(key, event.currentTarget, event.clientX, event.clientY);
    },
    onPointerLeave: (event) => {
      if (hoveredTrigger.current === event.currentTarget) hoveredTrigger.current = null;
      if (candidate.current?.anchor === event.currentTarget) cancelOpen();
      if (suppressedAnchor.current === event.currentTarget) suppressedAnchor.current = null;
      scheduleLeave();
    },
    onFocus: (event) => {
      if (suppressedAnchor.current === event.currentTarget || suppressedFocusAnchor.current === event.currentTarget) return;
      const current = activeRef.current;
      if (current?.anchor === event.currentTarget && current.phase === 'open') { cancelLeave(); return; }
      // Hover must not steal focus. Actual keyboard focus may reveal the same content.
      open(key, event.currentTarget, false);
    },
    onBlur: (event) => {
      if (event.currentTarget.contains(event.relatedTarget as Node | null) || panelRef.current?.contains(event.relatedTarget as Node | null)) return;
      if (suppressedFocusAnchor.current === event.currentTarget) suppressedFocusAnchor.current = null;
      if (suppressedAnchor.current === event.currentTarget && hoveredTrigger.current !== event.currentTarget) suppressedAnchor.current = null;
      scheduleLeave();
    },
    onClick: (event) => {
      const current = activeRef.current;
      if (current?.anchor === event.currentTarget && current.key === key && current.pinned && current.phase === 'open') close();
      else open(key, event.currentTarget, true, event.detail === 0);
    },
  });
  return {
    active, dialogId, panelRef, getTriggerProps, close, togglePin,
    panelEvents: {
      onPointerEnter: () => { panelHovered.current = true; cancelLeave(); cancelOpen(); },
      onPointerLeave: () => { panelHovered.current = false; scheduleLeave(); },
      onFocusCapture: () => { cancelLeave(); cancelOpen(); },
      onBlurCapture: (event) => {
        const next = event.relatedTarget as Node | null;
        if (event.currentTarget.contains(next) || activeRef.current?.anchor.contains(next)) return;
        scheduleLeave();
      },
    },
  };
}

interface AnchorBounds { left: number; top: number; right: number; bottom: number; width: number; height: number }
export function getAnchoredPreviewPlacement(anchor: AnchorBounds, width: number, height: number, viewportWidth: number, viewportHeight: number) {
  const margin = 12;
  const gap = 7;
  const clamp = (value: number, minimum: number, maximum: number) => Math.min(Math.max(value, minimum), Math.max(minimum, maximum));
  const below = viewportHeight - anchor.bottom - margin - gap;
  const above = anchor.top - margin - gap;
  const placement = below >= height || below >= above ? 'bottom' : 'top';
  const left = clamp(anchor.left, margin, viewportWidth - width - margin);
  const top = clamp(placement === 'bottom' ? anchor.bottom + gap : anchor.top - height - gap, margin, viewportHeight - height - margin);
  return { left, top, placement, originX: clamp(anchor.left + anchor.width / 2 - left, 8, width - 8), originY: clamp(anchor.top + anchor.height / 2 - top, 0, height) };
}

interface AnchoredPreviewProps<Key extends string> {
  controller: AnchoredPreviewController<Key>;
  title: ReactNode;
  preferredHeight?: number;
  children: ReactNode;
  bodyClassName?: string;
}

export default function AnchoredPreview<Key extends string>({ controller, title, preferredHeight = 400, children, bodyClassName = '' }: AnchoredPreviewProps<Key>) {
  const { active, dialogId, panelRef, close } = controller;
  useLayoutEffect(() => {
    const panel = panelRef.current;
    if (!active || !panel) return;
    let frame: number | null = null;
    const place = () => {
      if (!active.anchor.isConnected) { close({ immediate: true }); return; }
      const height = Math.min(preferredHeight, window.innerHeight - 24);
      panel.style.height = `${height}px`;
      panel.style.setProperty('--anchored-preview-content-max', `${Math.max(0, height - 57)}px`);
      // offset dimensions are untransformed; measuring the opening scale would
      // otherwise position an edge-aligned panel outside the viewport at rest.
      const next = getAnchoredPreviewPlacement(active.anchor.getBoundingClientRect(), panel.offsetWidth, panel.offsetHeight, window.innerWidth, window.innerHeight);
      panel.style.left = `${next.left}px`;
      panel.style.top = `${next.top}px`;
      panel.style.transformOrigin = `${next.originX}px ${next.originY}px`;
      panel.style.setProperty('--preview-lift', next.placement === 'bottom' ? '-5px' : '5px');
      panel.style.visibility = 'visible';
      panel.dataset.placement = next.placement;
    };
    const queuePlace = () => {
      if (frame !== null) cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => { frame = null; place(); });
    };
    place();
    const observer = new ResizeObserver(queuePlace);
    observer.observe(active.anchor);
    observer.observe(panel);
    window.addEventListener('resize', queuePlace);
    window.addEventListener('scroll', queuePlace, true);
    return () => {
      observer.disconnect();
      if (frame !== null) cancelAnimationFrame(frame);
      window.removeEventListener('resize', queuePlace);
      window.removeEventListener('scroll', queuePlace, true);
    };
  }, [active, close, panelRef, preferredHeight]);
  if (!active || typeof document === 'undefined') return null;
  return createPortal(<div ref={panelRef} id={dialogId} role="dialog" aria-modal={false} aria-labelledby={`${dialogId}-title`} tabIndex={-1} inert={active.phase === 'closing'} data-anchored-preview data-preview-key={active.key} data-preview-pinned={String(active.pinned)} data-state={active.phase} className={styles.panel} style={{ height: preferredHeight }} {...controller.panelEvents}>
    <header className={styles.header}><h2 id={`${dialogId}-title`}>{title}</h2><button type="button" aria-label="미리보기 고정" aria-pressed={active.pinned} title={active.pinned ? '고정 해제' : '미리보기 고정'} onClick={controller.togglePin} className={active.pinned ? styles.pinned : ''}><Pin size={15} /></button><button type="button" aria-label="미리보기 닫기" onClick={() => close({ restoreFocus: true })}><X size={18} /></button></header>
    <div className={`${styles.body} ${bodyClassName}`} data-anchored-preview-body>{children}</div>
  </div>, document.body);
}
