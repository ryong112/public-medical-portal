import { RotateCcw, Trash2, X } from 'lucide-react';

export interface UndoNotice {
  token: string;
  label: string;
}

interface UndoToastProps {
  notices: UndoNotice[];
  onUndo: (token: string) => void;
  onDismiss: (token: string) => void;
}

export default function UndoToast({ notices, onUndo, onDismiss }: UndoToastProps) {
  if (notices.length === 0) return null;

  return (
    <div className="fixed bottom-5 left-1/2 z-[300] flex w-[calc(100%-2rem)] max-w-md -translate-x-1/2 flex-col gap-2 md:bottom-8">
      {notices.map((notice) => (
        <div key={notice.token} className="relative overflow-hidden rounded-2xl bg-slate-950 p-4 text-white shadow-2xl ring-1 ring-white/10">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-red-500/15 text-red-400">
              <Trash2 size={18} />
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-black">{notice.label}</p>
              <p className="mt-0.5 text-[10px] font-bold text-slate-400">8초 후 삭제가 확정됩니다.</p>
            </div>
            <button onClick={() => onUndo(notice.token)} className="flex shrink-0 items-center gap-1.5 rounded-xl bg-white px-3 py-2 text-xs font-black text-slate-900 transition-colors hover:bg-blue-50 hover:text-blue-600">
              <RotateCcw size={14} /> 되돌리기
            </button>
            <button onClick={() => onDismiss(notice.token)} aria-label="알림 닫기" className="shrink-0 p-1 text-slate-500 transition-colors hover:text-white">
              <X size={15} />
            </button>
          </div>
          <div className="undo-countdown absolute bottom-0 left-0 h-0.5 bg-blue-500" />
        </div>
      ))}
      <style jsx>{`
        .undo-countdown {
          width: 100%;
          animation: undo-countdown 8s linear forwards;
        }
        @keyframes undo-countdown {
          from { width: 100%; }
          to { width: 0%; }
        }
      `}</style>
    </div>
  );
}
