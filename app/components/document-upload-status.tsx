'use client';

import { CheckCircle2, CircleAlert, LoaderCircle, RotateCcw, Upload, X } from 'lucide-react';
import type { UploadItem } from '@/lib/document-upload';

interface DocumentUploadStatusProps {
  items: UploadItem[];
  onRetry: (ids: string[]) => void;
  onDismiss: () => void;
}

export default function DocumentUploadStatus({ items, onRetry, onDismiss }: DocumentUploadStatusProps) {
  if (items.length === 0) return null;
  const active = items.some((item) => ['queued', 'uploading', 'saving'].includes(item.status));
  const succeeded = items.filter((item) => item.status === 'succeeded').length;
  const failed = items.filter((item) => item.status === 'failed');
  const finished = succeeded + failed.length;

  return (
    <section aria-label="파일 업로드 현황" aria-busy={active} className="mb-6 overflow-hidden rounded-2xl border border-blue-100 bg-blue-50/50">
      <header className="flex items-start justify-between gap-3 border-b border-blue-100 px-4 py-3">
        <div>
          <h3 className="flex items-center gap-2 text-sm font-black text-slate-900"><Upload size={16} />파일 업로드</h3>
          <p role="status" aria-live="polite" className="mt-1 text-xs font-semibold text-slate-600">{finished} / {items.length}개 처리 · 성공 {succeeded}개{failed.length > 0 ? ` · 실패 ${failed.length}개` : ''}{active ? ' · 진행 중' : ''}</p>
        </div>
        {!active && <button type="button" onClick={onDismiss} aria-label="업로드 현황 닫기" className="rounded-lg p-2 text-slate-500 hover:bg-white focus-visible:ring-2 focus-visible:ring-blue-500"><X size={17} /></button>}
      </header>
      <ul className="max-h-64 divide-y divide-blue-100/70 overflow-y-auto px-4">
        {items.map((item) => (
          <li key={item.id} className="flex items-start gap-3 py-3">
            {item.status === 'succeeded' ? <CheckCircle2 size={17} className="mt-0.5 shrink-0 text-emerald-600" /> : item.status === 'failed' ? <CircleAlert size={17} className="mt-0.5 shrink-0 text-red-500" /> : <LoaderCircle size={17} className={`mt-0.5 shrink-0 text-blue-500 ${item.status !== 'queued' ? 'animate-spin' : ''}`} />}
            <div className="min-w-0 flex-1">
              <p className="break-all text-xs font-bold text-slate-800">{item.file.name}</p>
              <p className="mt-1 text-[11px] text-slate-500">{item.targetCategory || '미분류'} · {item.status === 'queued' ? '대기 중' : item.status === 'uploading' ? `파일 전송 중${item.progress === null ? '' : ` ${Math.round(item.progress)}%`}` : item.status === 'saving' ? '문서 목록에 저장 중' : item.status === 'succeeded' ? '업로드 완료' : item.storageUploaded ? '파일 전송 완료 · 문서 목록 저장 실패' : '파일 전송 실패'}</p>
              {item.status === 'uploading' && item.progress !== null && <progress aria-label={`${item.file.name} 전송 진행률`} max={100} value={item.progress} className="mt-2 h-1.5 w-full accent-blue-600" />}
              {item.status === 'failed' && <p className="mt-1 break-words text-xs text-red-600">{item.error}</p>}
            </div>
            {item.status === 'failed' && <button type="button" disabled={active} onClick={() => onRetry([item.id])} aria-label={`${item.file.name} 다시 시도`} className="flex shrink-0 items-center gap-1 rounded-lg bg-white px-2.5 py-2 text-xs font-bold text-blue-600 disabled:cursor-not-allowed disabled:opacity-40"><RotateCcw size={13} /><span className="hidden sm:inline">재시도</span></button>}
          </li>
        ))}
      </ul>
      {failed.length > 0 && !active && <footer className="flex flex-wrap items-center justify-between gap-2 border-t border-blue-100 px-4 py-3"><p className="text-[11px] text-slate-600">성공한 파일은 다시 업로드하지 않습니다.</p><button type="button" onClick={() => onRetry(failed.map((item) => item.id))} className="flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-2 text-xs font-bold text-white hover:bg-blue-700"><RotateCcw size={13} />실패한 {failed.length}개 재시도</button></footer>}
    </section>
  );
}
