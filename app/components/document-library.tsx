'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { Download, Eye, FileImage, FileText, FolderOpen, LoaderCircle, Pencil, Trash2, X } from 'lucide-react';

export interface DocumentFile {
  id: number;
  name: string;
  url: string;
  size?: number | null;
  category?: string | null;
  created_at?: string | null;
}

interface DocumentLibraryProps {
  files: DocumentFile[];
  categories: string[];
  onDownload: (file: DocumentFile) => void;
  onDelete: (file: DocumentFile) => void;
  onUpdate: (file: DocumentFile, values: { name: string; category: string }) => Promise<void>;
  onPreview: (file: DocumentFile) => void;
}

export function getDocumentPreviewKind(file: Pick<DocumentFile, 'name' | 'url'>): 'pdf' | 'image' | null {
  try {
    const url = new URL(file.url);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return null;
  } catch {
    return null;
  }
  const extension = file.name.split('.').pop()?.toLowerCase();
  if (extension === 'pdf') return 'pdf';
  return ['png', 'jpg', 'jpeg', 'webp', 'gif'].includes(extension ?? '') ? 'image' : null;
}

export function formatDocumentSize(size?: number | null): string {
  if (size === undefined || size === null || !Number.isFinite(size) || size < 0) return '크기 정보 없음';
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(value?: string | null): string {
  if (!value) return '등록일 정보 없음';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '등록일 정보 없음' : date.toLocaleDateString('ko-KR', { year: 'numeric', month: '2-digit', day: '2-digit' });
}

/** Focus trapping and restoration shared by the two document dialogs. */
export function useDocumentDialog(onClose: () => void, busy = false) {
  const ref = useRef<HTMLElement>(null);
  const handlers = useRef({ onClose, busy });
  const restoreTarget = useRef<HTMLElement | null>(null);
  const restoreFrame = useRef<number | null>(null);
  useEffect(() => { handlers.current = { onClose, busy }; }, [onClose, busy]);
  useEffect(() => {
    if (restoreFrame.current !== null) window.cancelAnimationFrame(restoreFrame.current);
    // Keep the opener through React's development setup/cleanup/setup cycle.
    // A background dialog can be inert until the preview has finished unmounting.
    if (!restoreTarget.current) restoreTarget.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const container = ref.current;
    if (!container) return;
    const focusable = () => Array.from(container.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), select:not([disabled]), a[href], iframe, [tabindex="0"]')).filter((element) => element.getClientRects().length > 0);
    (focusable()[0] ?? container).focus();
    const keydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        if (!handlers.current.busy) handlers.current.onClose();
      }
      if (event.key !== 'Tab') return;
      const targets = focusable();
      if (targets.length === 0) { event.preventDefault(); container.focus(); return; }
      const first = targets[0];
      const last = targets[targets.length - 1];
      if (event.shiftKey && (document.activeElement === first || document.activeElement === container)) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && (document.activeElement === last || document.activeElement === container)) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', keydown, true);
    return () => {
      document.removeEventListener('keydown', keydown, true);
      restoreFrame.current = window.requestAnimationFrame(() => {
        if (restoreTarget.current?.isConnected && !restoreTarget.current.closest('[inert]')) restoreTarget.current.focus();
      });
    };
  }, []);
  return ref;
}

function DocumentEditor({ file, categories, onUpdate, onClose }: {
  file: DocumentFile;
  categories: string[];
  onUpdate: DocumentLibraryProps['onUpdate'];
  onClose: () => void;
}) {
  const lastDot = file.name.lastIndexOf('.');
  const extension = lastDot > 0 ? file.name.slice(lastDot) : '';
  const [name, setName] = useState(extension ? file.name.slice(0, lastDot) : file.name);
  const [category, setCategory] = useState(file.category ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const dialog = useDocumentDialog(onClose, busy);
  const id = useId();
  const options = Array.from(new Set([file.category ?? '', ...categories]));
  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy) return;
    const baseName = name.trim();
    if (!baseName || /^[.]+$/.test(baseName) || /[\\/\x00-\x1f]/.test(baseName)) {
      setError('파일 이름을 입력해 주세요. 경로 구분자나 제어 문자는 사용할 수 없습니다.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      await onUpdate(file, { name: `${baseName}${extension}`, category });
      onClose();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : '변경 내용을 저장하지 못했습니다. 다시 시도해 주세요.');
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[310] flex items-center justify-center bg-slate-950/60 p-4 backdrop-blur-sm" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) onClose(); }}>
      <section ref={dialog} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby={`${id}-title`} aria-describedby={`${id}-description`} aria-busy={busy} className="w-full max-w-lg rounded-3xl bg-white p-5 shadow-2xl outline-none sm:p-7">
        <header className="mb-5 flex items-center justify-between gap-3"><h2 id={`${id}-title`} className="text-lg font-black text-slate-900">문서 이름·분류 변경</h2><button type="button" disabled={busy} onClick={onClose} aria-label="문서 변경 창 닫기" className="rounded-xl bg-slate-100 p-2 text-slate-500 disabled:opacity-40"><X size={18} /></button></header>
        <p id={`${id}-description`} className="mb-5 text-xs leading-relaxed text-slate-500">파일 내용과 다운로드 주소는 유지됩니다. 확장자는 변경되지 않습니다.</p>
        <form onSubmit={(event) => void submit(event)} className="space-y-5">
          <div><label htmlFor={`${id}-name`} className="mb-2 block text-xs font-bold text-slate-700">파일 이름</label><div className="flex items-center gap-2"><input id={`${id}-name`} disabled={busy} maxLength={240} value={name} onChange={(event) => setName(event.target.value)} className="min-w-0 flex-1 rounded-xl border border-slate-200 px-3 py-3 text-sm text-slate-900 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100" />{extension && <span className="max-w-28 truncate rounded-lg bg-slate-100 px-2 py-2 text-xs font-bold text-slate-500" title={extension}>{extension}</span>}</div></div>
          <div><label htmlFor={`${id}-category`} className="mb-2 block text-xs font-bold text-slate-700">이동할 분류</label><select id={`${id}-category`} disabled={busy} value={category} onChange={(event) => setCategory(event.target.value)} className="w-full rounded-xl border border-slate-200 bg-white px-3 py-3 text-sm text-slate-900 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100">{options.map((option) => <option key={option} value={option}>{option || '미분류'}</option>)}</select></div>
          {error && <p role="alert" className="rounded-xl bg-red-50 px-3 py-3 text-xs font-semibold text-red-600">{error}</p>}
          <footer className="flex justify-end gap-2"><button type="button" disabled={busy} onClick={onClose} className="rounded-xl bg-slate-100 px-4 py-3 text-xs font-bold text-slate-600 disabled:opacity-40">취소</button><button type="submit" disabled={busy} className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-5 py-3 text-xs font-bold text-white hover:bg-blue-700 disabled:opacity-50">{busy && <LoaderCircle size={14} className="animate-spin" />}{busy ? '저장 중…' : '변경 저장'}</button></footer>
        </form>
      </section>
    </div>
  );
}

export default function DocumentLibrary({ files, categories, onDownload, onDelete, onUpdate, onPreview }: DocumentLibraryProps) {
  const [editing, setEditing] = useState<DocumentFile | null>(null);
  const actions = (file: DocumentFile) => <div className="flex items-center justify-end gap-1">
    {getDocumentPreviewKind(file) && <button type="button" onClick={() => onPreview(file)} title="미리보기" aria-label={`${file.name} 미리보기`} className="rounded-xl p-2.5 text-slate-500 transition-colors hover:bg-blue-50 hover:text-blue-600 focus-visible:ring-2 focus-visible:ring-blue-500"><Eye size={17} /></button>}
    <button type="button" onClick={() => onDownload(file)} title="다운로드" aria-label={`${file.name} 다운로드`} className="rounded-xl p-2.5 text-blue-500 transition-colors hover:bg-blue-50 hover:text-blue-700 focus-visible:ring-2 focus-visible:ring-blue-500"><Download size={17} /></button>
    <button type="button" onClick={() => setEditing(file)} title="이름·분류 변경" aria-label={`${file.name} 이름 및 분류 변경`} className="rounded-xl p-2.5 text-slate-500 transition-colors hover:bg-slate-100 hover:text-blue-600 focus-visible:ring-2 focus-visible:ring-blue-500"><Pencil size={16} /></button>
    <button type="button" onClick={() => onDelete(file)} title="삭제" aria-label={`${file.name} 삭제`} className="rounded-xl p-2.5 text-red-400 transition-colors hover:bg-red-50 hover:text-red-600 focus-visible:ring-2 focus-visible:ring-red-500"><Trash2 size={17} /></button>
  </div>;
  const title = (file: DocumentFile) => {
    const kind = getDocumentPreviewKind(file);
    const extension = file.name.includes('.') ? file.name.split('.').pop()?.toUpperCase() : 'FILE';
    return <button type="button" onClick={() => kind ? onPreview(file) : onDownload(file)} className="flex min-w-0 items-center gap-3 text-left focus-visible:rounded-xl focus-visible:ring-2 focus-visible:ring-blue-500" title={kind ? '미리보기' : '다운로드'}>
      <span className={`flex h-11 w-11 shrink-0 flex-col items-center justify-center rounded-xl ${kind === 'image' ? 'bg-emerald-50 text-emerald-600' : kind === 'pdf' ? 'bg-red-50 text-red-500' : 'bg-blue-50 text-blue-500'}`}>{kind === 'image' ? <FileImage size={19} /> : <FileText size={19} />}<span className="mt-0.5 max-w-9 truncate text-[8px] font-black">{extension}</span></span>
      <span className="break-all text-sm font-bold text-slate-900 transition-colors hover:text-blue-600">{file.name}</span>
    </button>;
  };

  return (
    <>
      {files.length === 0 ? <div className="rounded-2xl border border-dashed border-slate-200 px-5 py-16 text-center"><FolderOpen className="mx-auto mb-3 text-slate-300" size={32} /><p className="text-sm font-bold text-slate-500">표시할 문서가 없습니다.</p><p className="mt-2 text-xs text-slate-400">검색어나 분류를 확인하거나 문서를 업로드해 주세요.</p></div> : <>
        <div className="space-y-3 md:hidden">{files.map((file) => <article key={file.id} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">{title(file)}<div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2 text-[11px] text-slate-500"><span className="max-w-full break-words rounded-md bg-blue-50 px-2 py-1 font-bold text-blue-600">{file.category || '미분류'}</span><span>{formatDate(file.created_at)}</span><span>{formatDocumentSize(file.size)}</span></div><div className="mt-3 border-t border-slate-100 pt-2">{actions(file)}</div></article>)}</div>
        <table className="hidden w-full table-fixed text-left md:table"><thead className="border-b border-slate-100"><tr className="text-[11px] font-black text-slate-400"><th className="w-[44%] px-3 pb-4">문서 이름</th><th className="w-[16%] px-2 pb-4">분류</th><th className="w-[19%] px-2 pb-4">등록일 · 크기</th><th className="w-[21%] px-3 pb-4 text-right">관리</th></tr></thead><tbody className="divide-y divide-slate-100">{files.map((file) => <tr key={file.id} className="transition-colors hover:bg-slate-50/60"><td className="px-3 py-5">{title(file)}</td><td className="px-2 py-5"><span className="inline-block max-w-full break-words rounded-lg bg-blue-50 px-2.5 py-1.5 text-[10px] font-bold text-blue-600">{file.category || '미분류'}</span></td><td className="px-2 py-5 text-[11px] text-slate-500"><p>{formatDate(file.created_at)}</p><p className="mt-1 text-slate-400">{formatDocumentSize(file.size)}</p></td><td className="px-1 py-5">{actions(file)}</td></tr>)}</tbody></table>
      </>}
      {editing && <DocumentEditor key={editing.id} file={editing} categories={categories} onUpdate={onUpdate} onClose={() => setEditing(null)} />}
    </>
  );
}
