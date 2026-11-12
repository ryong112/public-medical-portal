'use client';

import { useEffect, useId, useState } from 'react';
import { Download, FileText, LoaderCircle, X } from 'lucide-react';
import { type DocumentFile, formatDocumentSize, getDocumentPreviewKind, useDocumentDialog } from './document-library';

interface DocumentPreviewModalProps {
  file: DocumentFile | null;
  onClose: () => void;
  onDownload: (file: DocumentFile) => void;
}

const MAX_PREVIEW_BYTES = 50 * 1024 * 1024;

export function getVerifiedDocumentMime(bytes: Uint8Array, extension: string): string | null {
  const ascii = (start: number, end: number) => String.fromCharCode(...bytes.slice(start, end));
  if (extension === 'pdf' && ascii(0, 5) === '%PDF-') return 'application/pdf';
  if (['jpg', 'jpeg'].includes(extension) && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (extension === 'png' && [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((byte, index) => bytes[index] === byte)) return 'image/png';
  if (extension === 'gif' && ['GIF87a', 'GIF89a'].includes(ascii(0, 6))) return 'image/gif';
  if (extension === 'webp' && ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP') return 'image/webp';
  return null;
}

function PreviewContent({ file, onDownload }: Pick<DocumentPreviewModalProps, 'onDownload'> & { file: DocumentFile }) {
  const kind = getDocumentPreviewKind(file);
  const [source, setSource] = useState<string | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!kind) return;
    const controller = new AbortController();
    let disposed = false;
    let objectUrl: string | null = null;
    const load = async () => {
      try {
        if (file.size && file.size > MAX_PREVIEW_BYTES) throw new Error('50 MB보다 큰 문서는 다운로드하여 확인해 주세요.');
        const response = await fetch(file.url, { signal: controller.signal, credentials: 'omit', referrerPolicy: 'no-referrer', redirect: 'error' });
        if (!response.ok) throw new Error(`문서를 불러오지 못했습니다. (HTTP ${response.status})`);
        const advertisedSize = Number(response.headers.get('content-length'));
        if (advertisedSize > MAX_PREVIEW_BYTES) throw new Error('50 MB보다 큰 문서는 다운로드하여 확인해 주세요.');
        const blob = await response.blob();
        if (blob.size > MAX_PREVIEW_BYTES) throw new Error('50 MB보다 큰 문서는 다운로드하여 확인해 주세요.');
        const bytes = new Uint8Array(await blob.slice(0, 16).arrayBuffer());
        const mime = getVerifiedDocumentMime(bytes, file.name.split('.').pop()?.toLowerCase() ?? '');
        if (!mime) throw new Error('문서 형식을 확인할 수 없어 미리보기를 열지 않았습니다. 다운로드하여 확인해 주세요.');
        if (disposed) return;
        // A verified, explicit MIME keeps HTML/SVG and misleading server content types out of inline views.
        objectUrl = URL.createObjectURL(new Blob([blob], { type: mime }));
        setSource(objectUrl);
      } catch (failure) {
        if (!disposed) setError(failure instanceof Error ? failure.message : '미리보기를 불러오지 못했습니다. 다운로드하여 확인해 주세요.');
      }
    };
    void load();
    return () => {
      disposed = true;
      controller.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [file.name, file.size, file.url, kind]);

  if (!kind || error) return <div className="flex min-h-72 flex-col items-center justify-center px-5 py-10 text-center"><FileText size={38} className="mb-4 text-slate-300" /><p role={error ? 'alert' : undefined} className="max-w-lg text-sm font-semibold leading-relaxed text-slate-600">{error || '이 형식은 브라우저 미리보기를 지원하지 않습니다. HWP·Office 등은 다운로드하여 확인해 주세요.'}</p><p className="mt-2 text-xs text-slate-400">문서는 외부 변환 서비스로 전송하지 않습니다.</p><button type="button" onClick={() => onDownload(file)} className="mt-5 inline-flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-3 text-xs font-bold text-white"><Download size={15} />다운로드</button></div>;
  if (!source) return <div role="status" className="flex min-h-72 flex-col items-center justify-center gap-3 text-sm font-semibold text-slate-500"><LoaderCircle className="animate-spin text-blue-500" size={30} />미리보기를 불러오는 중…</div>;
  if (kind === 'pdf') return <div className="flex min-h-0 flex-1 flex-col"><iframe src={source} title={`${file.name} PDF 미리보기`} sandbox="allow-same-origin" referrerPolicy="no-referrer" className="min-h-72 w-full flex-1 border-0 bg-slate-100" /><p className="bg-white px-4 py-2 text-center text-[11px] text-slate-500">PDF가 표시되지 않으면 상단의 다운로드 버튼으로 확인해 주세요.</p></div>;
  // next/image is unnecessary for short-lived, client-created verified raster blob URLs.
  // eslint-disable-next-line @next/next/no-img-element
  return <div className="flex min-h-0 flex-1 items-center justify-center overflow-auto bg-slate-100 p-3 sm:p-5"><img src={source} alt={file.name} onError={() => setError('이미지를 표시하지 못했습니다. 다운로드하여 확인해 주세요.')} className="max-h-full max-w-full rounded-lg object-contain shadow-sm" /></div>;
}

function PreviewDialog({ file, onClose, onDownload }: Omit<DocumentPreviewModalProps, 'file'> & { file: DocumentFile }) {
  const dialog = useDocumentDialog(onClose);
  const id = useId();
  return (
    <div className="fixed inset-0 z-[310] flex items-center justify-center bg-slate-950/70 p-2 backdrop-blur-sm sm:p-5" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section ref={dialog} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby={`${id}-title`} className="flex h-[88dvh] max-h-[1000px] w-full max-w-6xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl outline-none sm:rounded-3xl">
        <header className="flex shrink-0 items-center justify-between gap-3 border-b border-slate-100 px-4 py-4 sm:px-6">
          <div className="min-w-0"><h2 id={`${id}-title`} className="truncate text-sm font-black text-slate-900 sm:text-base" title={file.name}>{file.name}</h2><p className="mt-1 truncate text-xs text-slate-500">{file.category || '미분류'} · {formatDocumentSize(file.size)}</p></div>
          <div className="flex shrink-0 items-center gap-2"><button type="button" onClick={() => onDownload(file)} aria-label={`${file.name} 다운로드`} className="inline-flex items-center gap-2 rounded-xl bg-blue-50 p-2.5 text-xs font-bold text-blue-600 hover:bg-blue-100"><Download size={17} /><span className="hidden sm:inline">다운로드</span></button><button type="button" onClick={onClose} aria-label="미리보기 닫기" className="rounded-xl bg-slate-100 p-2.5 text-slate-600 hover:bg-slate-200"><X size={18} /></button></div>
        </header>
        <PreviewContent key={`${file.id}:${file.url}:${file.name}:${file.size}`} file={file} onDownload={onDownload} />
      </section>
    </div>
  );
}

export default function DocumentPreviewModal({ file, onClose, onDownload }: DocumentPreviewModalProps) {
  return file ? <PreviewDialog key={file.id} file={file} onClose={onClose} onDownload={onDownload} /> : null;
}
