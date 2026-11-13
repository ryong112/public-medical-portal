'use client';

import { MonitorUp, X } from 'lucide-react';

interface KioskControllerProps {
  busy: boolean;
  message: string;
  companion?: boolean;
  onExpand: () => void;
  onWindowMode: () => void;
  onClose: () => void;
}

// The same compact controller is rendered in the dedicated window and in a
// Document PiP portal. Its styles must not depend on the opener's stylesheet.
export default function KioskController({ busy, message, companion = false, onExpand, onWindowMode, onClose }: KioskControllerProps) {
  return <main className="kiosk-controller" data-kiosk-controller>
    <style>{`
      .kiosk-controller { box-sizing: border-box; width: 100%; max-width: 420px; margin: auto; padding: 16px; color: #f8fafc; font-family: Arial, "Noto Sans KR", sans-serif; }
      .kiosk-controller * { box-sizing: border-box; }
      .kiosk-controller-label { margin: 0 0 10px; color: #93c5fd; font-size: 11px; font-weight: 700; }
      .kiosk-controller-actions { display: grid; grid-template-columns: minmax(0, 1fr) 40px; gap: 8px; }
      .kiosk-controller button { display: flex; align-items: center; justify-content: center; gap: 8px; min-height: 48px; padding: 8px 12px; border: 0; border-radius: 10px; font: inherit; font-size: 14px; font-weight: 700; cursor: pointer; }
      .kiosk-controller button:focus-visible { outline: 3px solid #93c5fd; outline-offset: 2px; }
      .kiosk-controller button:disabled { opacity: .6; cursor: wait; }
      .kiosk-controller-open { background: #2563eb; color: white; }
      .kiosk-controller-open:hover { background: #1d4ed8; }
      .kiosk-controller-open[data-companion=true] { background: #1e293b; }
      .kiosk-controller-close { background: #1e293b; color: #cbd5e1; }
      .kiosk-controller-close:hover { background: #dc2626; color: white; }
      .kiosk-controller kbd { border: 1px solid #ffffff40; border-radius: 4px; padding: 2px 4px; font-size: 10px; }
      .kiosk-controller-message { margin: 10px 0 0; color: #bfdbfe; font-size: 12px; line-height: 1.5; }
      .kiosk-controller .kiosk-controller-window { min-height: 32px; width: 100%; margin-top: 6px; background: transparent; color: #cbd5e1; font-size: 12px; text-decoration: underline; }
    `}</style>
    <p className="kiosk-controller-label">{companion ? 'PiP 제어 창이 열려 있습니다' : '공공의료지원과 전광판'}</p>
    <div className="kiosk-controller-actions">
      <button id="reopen-kiosk" type="button" aria-label="전광판 다시 전체 화면으로 펼치기" className="kiosk-controller-open" data-companion={companion} disabled={busy} onClick={onExpand}>
        <MonitorUp size={18} /><span>{busy ? '전환 중…' : companion ? '여기서 다시 열기' : '전광판 다시 열기'}</span><kbd>F8</kbd>
      </button>
      <button id="close-kiosk" type="button" className="kiosk-controller-close" aria-label="전광판 완전히 종료" title="전광판 완전히 종료" onClick={onClose}><X size={18} /></button>
    </div>
    {message && <>
      <p role="status" className="kiosk-controller-message">{message}</p>
      <button type="button" className="kiosk-controller-window" disabled={busy} onClick={onWindowMode}>창 모드로 보기</button>
    </>}
  </main>;
}
