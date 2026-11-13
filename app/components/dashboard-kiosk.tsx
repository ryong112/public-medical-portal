'use client';

import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { Minimize2, MonitorUp, X } from 'lucide-react';
import KioskBoard from './kiosk-board';
import KioskController from './kiosk-controller';
import { type KioskSchedule } from '@/lib/kiosk-schedules';
import type { AbsenceMember } from '@/lib/absence-calendar';
export type { KioskSchedule } from '@/lib/kiosk-schedules';

interface DashboardKioskProps {
  schedules: KioskSchedule[];
  members?: AbsenceMember[];
  onClose: () => void;
  dedicatedWindow?: boolean;
  nativeLauncher?: boolean;
  initialNotice?: string;
}

type ExtendedScreen = Screen & { availLeft?: number; availTop?: number };
type WindowWithDocumentPictureInPicture = Window & {
  documentPictureInPicture?: {
    requestWindow: (options: { width: number; height: number; disallowReturnToOpener: boolean }) => Promise<Window>;
  };
};

const getAvailableScreenBounds = () => {
  const screen = window.screen as ExtendedScreen;
  return { left: screen.availLeft ?? window.screenX, top: screen.availTop ?? window.screenY, width: screen.availWidth, height: screen.availHeight };
};
const subscribeFullscreen = (listener: () => void) => {
  document.addEventListener('fullscreenchange', listener);
  return () => document.removeEventListener('fullscreenchange', listener);
};
const getFullscreen = () => Boolean(document.fullscreenElement);
const getServerFullscreen = () => false;
const FULLSCREEN_RETRY = '전체화면을 열지 못했습니다. 다시 열기를 누르거나 창 모드로 볼 수 있습니다.';

export default function DashboardKiosk({ schedules, members = [], onClose, dedicatedWindow = false, nativeLauncher = false, initialNotice = '' }: DashboardKioskProps) {
  const [now, setNow] = useState(() => new Date());
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [controllerWindow, setControllerWindow] = useState<Window | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(initialNotice);
  const isFullscreen = useSyncExternalStore(subscribeFullscreen, getFullscreen, getServerFullscreen);
  const collapsedRef = useRef(false);
  const busyRef = useRef(false);
  const operationRef = useRef(0);
  const activeRef = useRef(true);
  const closingRef = useRef(false);
  const pictureInPictureWindowRef = useRef<Window | null>(null);
  const lastScreenRef = useRef<ReturnType<typeof getAvailableScreenBounds> | null>(null);
  const nativeCommandResetTimerRef = useRef<number | null>(null);
  const initialFullscreenRequestRef = useRef<Promise<void> | null>(null);
  const actionsRef = useRef({ expand: () => {}, collapse: () => {}, close: () => {} });

  const setDedicatedWindowTitle = (collapsed: boolean) => {
    if (dedicatedWindow) document.title = collapsed ? '전광판 제어' : '공공의료지원과 전광판';
  };
  const setNativeCommandTitle = (command: 'collapse' | 'exit' | null) => {
    if (dedicatedWindow && nativeLauncher) document.title = command ? `DPHS_KIOSK_COMMAND_${command.toUpperCase()}_${Date.now()}` : '공공의료지원과 전광판';
  };
  const isCurrent = (operation: number) => activeRef.current && !closingRef.current && operationRef.current === operation;
  const setTransition = (value: boolean) => { busyRef.current = value; setBusy(value); };
  const closePictureInPicture = () => {
    const pipWindow = pictureInPictureWindowRef.current;
    pictureInPictureWindowRef.current = null;
    setControllerWindow(null);
    pipWindow?.close();
  };

  useEffect(() => {
    activeRef.current = true;
    return () => {
      activeRef.current = false;
      operationRef.current += 1;
      const pipWindow = pictureInPictureWindowRef.current;
      pictureInPictureWindowRef.current = null;
      pipWindow?.close();
      if (nativeCommandResetTimerRef.current !== null) window.clearTimeout(nativeCommandResetTimerRef.current);
    };
  }, []);

  useEffect(() => {
    if (!dedicatedWindow) return;
    const previousTitle = document.title;
    document.title = '공공의료지원과 전광판';
    let cancelled = false;
    // A newly loaded window may not inherit the initiating click's activation.
    // Try fullscreen, but keep an explicit user-gesture entry point if denied.
    if (!nativeLauncher && !document.fullscreenElement) {
      const operation = operationRef.current;
      const request = async () => {
        try {
          // Reuse the in-flight request across Strict Mode effect replay.
          if (!initialFullscreenRequestRef.current) {
            initialFullscreenRequestRef.current = document.documentElement.requestFullscreen
              ? document.documentElement.requestFullscreen({ navigationUI: 'hide' })
              : Promise.reject(new Error('Fullscreen unavailable'));
          }
          await initialFullscreenRequestRef.current;
          // A slow initial request must not fullscreen a controller after the
          // user has already collapsed or closed the board.
          if ((!activeRef.current || closingRef.current || collapsedRef.current) && document.fullscreenElement) {
            await document.exitFullscreen().catch(() => undefined);
          }
          if (!cancelled && isCurrent(operation) && !collapsedRef.current) setMessage('');
        } catch {
          if (!cancelled && activeRef.current && !closingRef.current && operationRef.current === operation) setMessage('전체화면 시작을 누르면 전광판이 화면을 가득 채웁니다.');
        }
      };
      void request();
    }
    return () => { cancelled = true; document.title = previousTitle; };
  }, [dedicatedWindow, nativeLauncher]);

  useEffect(() => {
    const clock = window.setInterval(() => setNow(new Date()), 250);
    let enteredFullscreen = Boolean(document.fullscreenElement);
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.repeat || event.isComposing || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
      if (event.key === 'F8') {
        event.preventDefault();
        if (collapsedRef.current) actionsRef.current.expand();
        else actionsRef.current.collapse();
      } else if (event.key === 'Escape') {
        event.stopPropagation();
        actionsRef.current.close();
      }
    };
    const onFullscreenChange = () => {
      if (document.fullscreenElement) enteredFullscreen = true;
      else if (enteredFullscreen && !dedicatedWindow && !collapsedRef.current && !closingRef.current) actionsRef.current.close();
    };
    window.addEventListener('keydown', onKeyDown, true);
    document.addEventListener('fullscreenchange', onFullscreenChange);
    return () => {
      window.clearInterval(clock);
      window.removeEventListener('keydown', onKeyDown, true);
      document.removeEventListener('fullscreenchange', onFullscreenChange);
    };
  }, [dedicatedWindow]);

  const closeKiosk = () => {
    if (closingRef.current) return;
    closingRef.current = true;
    operationRef.current += 1;
    if (dedicatedWindow && nativeLauncher) { setNativeCommandTitle('exit'); return; }
    closePictureInPicture();
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined).then(onClose);
    else onClose();
  };

  const preparePictureInPicture = (pipWindow: Window) => {
    const doc = pipWindow.document;
    doc.documentElement.lang = 'ko';
    doc.title = '전광판 제어';
    doc.body.replaceChildren();
    doc.documentElement.style.cssText = 'height:100%;background:#071022;color-scheme:dark';
    doc.body.style.cssText = 'margin:0;min-height:100%;display:flex;align-items:center;background:#071022';
    pictureInPictureWindowRef.current = pipWindow;
    setControllerWindow(pipWindow);
    pipWindow.addEventListener('keydown', (event) => {
      if (event.key !== 'F8' || event.repeat || event.isComposing || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
      event.preventDefault();
      actionsRef.current.expand();
    });
    pipWindow.addEventListener('pagehide', () => {
      if (pictureInPictureWindowRef.current !== pipWindow) return;
      pictureInPictureWindowRef.current = null;
      if (activeRef.current && !closingRef.current) {
        setControllerWindow(null);
        setMessage('PiP를 닫았습니다. 이 창에서 전광판을 다시 열 수 있습니다.');
      }
    }, { once: true });
  };

  const collapseKiosk = async () => {
    if (busyRef.current || closingRef.current || collapsedRef.current) return;
    if (dedicatedWindow && nativeLauncher) {
      setNativeCommandTitle('collapse');
      if (nativeCommandResetTimerRef.current !== null) window.clearTimeout(nativeCommandResetTimerRef.current);
      nativeCommandResetTimerRef.current = window.setTimeout(() => { setNativeCommandTitle(null); nativeCommandResetTimerRef.current = null; }, 800);
      return;
    }
    const operation = ++operationRef.current;
    setTransition(true);
    collapsedRef.current = true;
    lastScreenRef.current = getAvailableScreenBounds();
    setMessage('');

    // Request PiP during the click/F8, BEFORE awaiting fullscreen exit. Catch
    // immediately so an early rejection cannot become unhandled.
    let pipRequest: Promise<Window | null> = Promise.resolve(null);
    try {
      const api = (window as WindowWithDocumentPictureInPicture).documentPictureInPicture;
      if (api) pipRequest = api.requestWindow({ width: 360, height: 210, disallowReturnToOpener: true }).catch(() => null);
    } catch { /* Small dedicated window remains available when PiP is denied. */ }
    const pipResult = pipRequest.then((pipWindow) => {
      if (!isCurrent(operation)) { pipWindow?.close(); return null; }
      return pipWindow;
    });
    if (document.fullscreenElement) await document.exitFullscreen().catch(() => undefined);
    if (!isCurrent(operation)) { void pipResult.then((pipWindow) => pipWindow?.close()); return; }
    if (document.fullscreenElement) {
      collapsedRef.current = false;
      setMessage('접기를 완료하지 못했습니다. 다시 시도해 주세요.');
      setTransition(false);
      operationRef.current += 1;
      void pipResult.then((pipWindow) => pipWindow?.close());
      return;
    }
    setIsCollapsed(true);
    setDedicatedWindowTitle(true);
    if (dedicatedWindow) {
      const bounds = lastScreenRef.current;
      try {
        window.resizeTo(380, 260);
        window.moveTo(bounds.left + Math.max(0, bounds.width - 380), bounds.top + Math.max(0, Math.round((bounds.height - 260) / 2)));
      } catch { /* Browsers may refuse resize on a user-created tab. */ }
    }
    const pipWindow = await pipResult;
    if (!isCurrent(operation)) { pipWindow?.close(); return; }
    if (pipWindow && !pipWindow.closed) {
      try { preparePictureInPicture(pipWindow); }
      catch { closePictureInPicture(); pipWindow.close(); setMessage('PiP를 사용할 수 없어 이 창으로 접었습니다.'); }
    } else {
      setMessage(dedicatedWindow ? 'PiP를 사용할 수 없어 이 창으로 접었습니다.' : 'PiP를 사용할 수 없어 현재 페이지에 복귀 버튼을 표시합니다.');
    }
    setTransition(false);
  };

  const expandKiosk = async () => {
    if (busyRef.current || closingRef.current) return;
    if (dedicatedWindow && nativeLauncher) { setNativeCommandTitle(null); return; }
    const operation = ++operationRef.current;
    setTransition(true);
    setMessage('');
    try {
      // PiP clicks share activation with the opener. Focusing the opener consumes
      // it, so neither focus(), closing PiP, nor an await may precede this call.
      if (!document.fullscreenElement) {
        if (!document.documentElement.requestFullscreen) throw new Error('Fullscreen unavailable');
        await document.documentElement.requestFullscreen({ navigationUI: 'hide' });
      }
      if (!isCurrent(operation)) {
        if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
        return;
      }
      if (!document.fullscreenElement) throw new Error('Fullscreen not entered');
      collapsedRef.current = false;
      setIsCollapsed(false);
      setDedicatedWindowTitle(false);
      // Fullscreen is confirmed; the return control can now safely disappear.
      // Do not call window.focus() here: fullscreen already activates its window,
      // and an extra focus transition can make Chromium leave fullscreen again.
      closePictureInPicture();
    } catch {
      if (isCurrent(operation)) setMessage(FULLSCREEN_RETRY);
    } finally {
      if (isCurrent(operation)) setTransition(false);
    }
  };

  const showWindowMode = () => {
    if (busyRef.current || closingRef.current) return;
    operationRef.current += 1;
    collapsedRef.current = false;
    setIsCollapsed(false);
    setMessage('');
    setDedicatedWindowTitle(false);
    closePictureInPicture();
    if (dedicatedWindow) {
      const bounds = lastScreenRef.current ?? getAvailableScreenBounds();
      try { window.moveTo(bounds.left, bounds.top); window.resizeTo(bounds.width, bounds.height); } catch { /* User can resize manually. */ }
    }
    window.focus();
  };

  useEffect(() => {
    actionsRef.current = { expand: () => void expandKiosk(), collapse: () => void collapseKiosk(), close: closeKiosk };
  });

  if (isCollapsed) {
    const controllerProps = { busy, message, onExpand: () => void expandKiosk(), onWindowMode: showWindowMode, onClose: closeKiosk };
    return <>
      {(dedicatedWindow || !controllerWindow) && <aside className={dedicatedWindow ? 'fixed inset-0 z-[400] flex items-center justify-center overflow-auto bg-[#071022]' : 'fixed bottom-5 right-5 z-[400] w-[min(24rem,calc(100vw-2rem))] rounded-2xl bg-[#071022] shadow-2xl'}>
        <KioskController {...controllerProps} companion={Boolean(controllerWindow)} />
      </aside>}
      {controllerWindow && createPortal(<KioskController {...controllerProps} />, controllerWindow.document.body)}
    </>;
  }

  return <>
    <KioskBoard schedules={schedules} members={members} now={now} controls={<>
      {!isFullscreen && !nativeLauncher && <button disabled={busy} onClick={() => void expandKiosk()} aria-label="전체 화면" title="전체화면 시작" className="flex items-center gap-2 rounded-xl border border-blue-300/30 bg-blue-500/20 p-2.5 text-blue-100 hover:bg-blue-500/35 sm:px-3"><MonitorUp size={18} /><span className="hidden text-sm font-semibold sm:inline">전체화면 시작</span></button>}
      <button disabled={busy} onClick={() => void collapseKiosk()} aria-label="전광판 접기" title="전광판 또는 제어창을 선택한 상태에서 F8" className="flex items-center gap-2 rounded-lg border border-white/15 bg-white/5 px-3 py-2.5 text-slate-100 transition-colors hover:bg-white/15 disabled:opacity-50"><Minimize2 size={18} /><span className="hidden text-sm font-semibold sm:inline">접기</span><kbd className="hidden rounded border border-white/15 px-1 text-[11px] text-slate-400 lg:inline">F8</kbd></button>
      <button onClick={closeKiosk} aria-label="전광판 닫기" className="rounded-xl bg-white/10 p-2.5 text-slate-200 hover:bg-red-500"><X size={18} /></button>
    </>} />
    {message && <aside role="status" className="fixed bottom-5 left-1/2 z-[410] flex w-[min(32rem,calc(100vw-2rem))] -translate-x-1/2 items-center gap-3 rounded-xl border border-blue-300/30 bg-slate-900 p-3 text-sm text-blue-100 shadow-2xl">
      <span className="flex-1">{message}</span><button type="button" onClick={() => setMessage('')} aria-label="안내 닫기" className="p-2"><X size={16} /></button>
    </aside>}
  </>;
}
