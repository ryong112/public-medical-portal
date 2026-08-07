'use client';

import { useMemo, useState } from 'react';
import { AlertTriangle, Check, Download, FolderArchive, LoaderCircle, RefreshCw, Trash2, X } from 'lucide-react';

export interface YearlyCleanupCategory {
  id: number | string;
  name: string;
  [key: string]: unknown;
}

export interface YearlyCleanupFile {
  id: number | string;
  name: string;
  category?: string | null;
  size?: number | null;
  [key: string]: unknown;
}

export interface YearlyDocumentCleanupTarget {
  category: YearlyCleanupCategory;
  files: YearlyCleanupFile[];
  nextCategoryName: string;
}

interface YearlyDocumentCleanupModalProps {
  open: boolean;
  onClose: () => void;
  categories: YearlyCleanupCategory[];
  files: YearlyCleanupFile[];
  currentYear: number;
  onDownloadCategoryZip: (category: YearlyCleanupCategory, files: YearlyCleanupFile[]) => Promise<void>;
  onExecuteCleanup: (targets: YearlyDocumentCleanupTarget[]) => Promise<void>;
  onRefresh?: () => void | Promise<void>;
}

type DownloadStatus = 'idle' | 'loading' | 'done' | 'error';

const meetingLabels = {
  team: '팀회의',
  minutes: '팀회의록',
  policy: '정책결정회의',
  executives: '확대간부회의',
  monthly: '월례회의',
} as const;

const extractCategoryYear = (name: string) => {
  const match = name.match(/(^|[^0-9])([0-9]{4}|[0-9]{2})(?=\s*년(?:도)?|[^0-9]|$)/u);
  if (!match) return null;
  const rawYear = match[2];
  return rawYear.length === 2 ? 2000 + Number(rawYear) : Number(rawYear);
};

const getMeetingKind = (name: string): keyof typeof meetingLabels | null => {
  if (name.includes('팀회의록')) return 'minutes';
  if (name.includes('정책결정회의')) return 'policy';
  if (name.includes('확대간부회의')) return 'executives';
  if (name.includes('월례회의')) return 'monthly';
  if (name.includes('팀회의')) return 'team';
  return null;
};

const getNextCategoryName = (name: string, currentYear: number) => {
  const yearPattern = /(^|[^0-9])([0-9]{4}|[0-9]{2})(?=\s*년(?:도)?|[^0-9]|$)/u;
  return name.replace(yearPattern, (_match, prefix: string, rawYear: string) => {
    const nextYear = currentYear + 1;
    const replacement = rawYear.length === 2 ? String(nextYear % 100).padStart(2, '0') : String(nextYear);
    return `${prefix}${replacement}`;
  });
};

const normalizeCategoryName = (name: string) => name
  .replace(/\s*\([^)]*\)\s*$/u, '')
  .replace(/\s+/gu, ' ')
  .trim()
  .toLocaleLowerCase('ko-KR');

const formatBytes = (bytes: number) => {
  if (bytes <= 0) return '0KB';
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024)).toLocaleString('ko-KR')}KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)}GB`;
};

export default function YearlyDocumentCleanupModal({
  open,
  onClose,
  categories,
  files,
  currentYear,
  onDownloadCategoryZip,
  onExecuteCleanup,
  onRefresh,
}: YearlyDocumentCleanupModalProps) {
  const [downloadStatuses, setDownloadStatuses] = useState<Record<string, DownloadStatus>>({});
  const [confirmation, setConfirmation] = useState('');
  const [isExecuting, setIsExecuting] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState('');

  const targets = useMemo<YearlyDocumentCleanupTarget[]>(() => categories
    .filter((category) => extractCategoryYear(category.name) === currentYear && getMeetingKind(category.name) !== null)
    .map((category) => {
      const normalizedCategory = normalizeCategoryName(category.name);
      const categoryFiles = files.filter((file) => typeof file.category === 'string' && normalizeCategoryName(file.category) === normalizedCategory);
      return {
        category,
        files: categoryFiles,
        nextCategoryName: getNextCategoryName(category.name, currentYear),
      };
    })
    .sort((left, right) => {
      const order: Record<keyof typeof meetingLabels, number> = { team: 0, minutes: 1, policy: 2, executives: 3, monthly: 4 };
      const leftKind = getMeetingKind(left.category.name) ?? 'team';
      const rightKind = getMeetingKind(right.category.name) ?? 'team';
      return order[leftKind] - order[rightKind] || left.category.name.localeCompare(right.category.name, 'ko-KR');
    }), [categories, currentYear, files]);

  const totalFiles = targets.reduce((sum, target) => sum + target.files.length, 0);
  const totalBytes = targets.reduce((sum, target) => sum + target.files.reduce((fileSum, file) => fileSum + Math.max(0, Number(file.size) || 0), 0), 0);
  const requiredConfirmation = `${currentYear}년 문서 정리`;
  const allDownloadsComplete = targets.length > 0 && targets.every((target) => target.files.length === 0 || downloadStatuses[String(target.category.id)] === 'done');
  const canExecute = allDownloadsComplete && confirmation.trim() === requiredConfirmation && !isExecuting;

  const closeModal = () => {
    setDownloadStatuses({});
    setConfirmation('');
    setIsExecuting(false);
    setIsRefreshing(false);
    setError('');
    onClose();
  };

  const downloadTarget = async (target: YearlyDocumentCleanupTarget) => {
    const key = String(target.category.id);
    setDownloadStatuses((current) => ({ ...current, [key]: 'loading' }));
    setError('');
    try {
      await onDownloadCategoryZip(target.category, target.files);
      setDownloadStatuses((current) => ({ ...current, [key]: 'done' }));
    } catch (downloadError) {
      setDownloadStatuses((current) => ({ ...current, [key]: 'error' }));
      setError(downloadError instanceof Error ? downloadError.message : `${target.category.name} ZIP 파일을 만들지 못했습니다.`);
    }
  };

  const refresh = async () => {
    if (!onRefresh) return;
    setIsRefreshing(true);
    setError('');
    try {
      await onRefresh();
    } catch (refreshError) {
      setError(refreshError instanceof Error ? refreshError.message : '문서 목록을 새로고침하지 못했습니다.');
    } finally {
      setIsRefreshing(false);
    }
  };

  const executeCleanup = async () => {
    if (!canExecute) return;
    setIsExecuting(true);
    setError('');
    try {
      await onExecuteCleanup(targets);
      closeModal();
    } catch (executeError) {
      setError(executeError instanceof Error ? executeError.message : '연도 문서 정리를 완료하지 못했습니다.');
      setIsExecuting(false);
    }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[320] flex items-center justify-center bg-slate-950/65 p-3 backdrop-blur-sm md:p-6" onMouseDown={(event) => event.target === event.currentTarget && !isExecuting && closeModal()}>
      <section className="flex max-h-[94vh] w-full max-w-5xl flex-col overflow-hidden rounded-[30px] bg-white shadow-2xl">
        <header className="flex shrink-0 items-center justify-between border-b border-slate-100 px-5 py-4 md:px-7 md:py-5">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-amber-50 text-amber-600"><FolderArchive size={21} /></div>
            <div className="min-w-0"><h2 className="truncate text-lg font-black text-slate-900 md:text-xl">{currentYear}년 회의 문서 정리</h2><p className="mt-0.5 truncate text-[10px] font-bold text-slate-400">회의 문서를 백업하고 분류를 다음 연도로 전환합니다.</p></div>
          </div>
          <div className="flex gap-2">{onRefresh && <button disabled={isRefreshing || isExecuting} onClick={() => void refresh()} aria-label="새로고침" className="rounded-xl bg-slate-100 p-2 text-slate-500 hover:bg-slate-200 disabled:opacity-50"><RefreshCw size={17} className={isRefreshing ? 'animate-spin' : ''} /></button>}<button disabled={isExecuting} onClick={closeModal} aria-label="닫기" className="rounded-xl bg-slate-100 p-2 text-slate-500 hover:bg-slate-200 disabled:opacity-50"><X size={17} /></button></div>
        </header>

        <div className="flex-1 overflow-y-auto p-5 custom-scrollbar md:p-7">
          <div className="grid grid-cols-3 gap-2">
            <div className="rounded-2xl bg-slate-50 p-3 md:p-4"><p className="text-[9px] font-black text-slate-400">대상 분류</p><p className="mt-1 text-xl font-black text-slate-900 md:text-2xl">{targets.length}<span className="ml-1 text-[10px] text-slate-400">개</span></p></div>
            <div className="rounded-2xl bg-slate-50 p-3 md:p-4"><p className="text-[9px] font-black text-slate-400">전체 문서</p><p className="mt-1 text-xl font-black text-slate-900 md:text-2xl">{totalFiles}<span className="ml-1 text-[10px] text-slate-400">건</span></p></div>
            <div className="rounded-2xl bg-slate-50 p-3 md:p-4"><p className="text-[9px] font-black text-slate-400">전체 용량</p><p className="mt-1 truncate text-xl font-black text-slate-900 md:text-2xl">{formatBytes(totalBytes)}</p></div>
          </div>

          <div className="mt-4 rounded-2xl border border-blue-100 bg-blue-50/60 p-4 text-[11px] font-bold leading-relaxed text-blue-800">
            정리를 실행하면 각 분류의 <strong>고유 ID와 위치는 그대로 유지</strong>되고 이름만 {currentYear + 1}년으로 바뀝니다. 백업한 문서 파일과 DB 문서 기록만 삭제되며 분류 자체는 삭제되지 않습니다.
          </div>

          <div className="mt-4 space-y-3">
            {targets.length === 0 && <div className="rounded-2xl bg-slate-50 py-14 text-center text-sm font-bold text-slate-400">{currentYear}년 정리 대상 회의 분류가 없습니다.</div>}
            {targets.map((target) => {
              const key = String(target.category.id);
              const status = downloadStatuses[key] ?? 'idle';
              const kind = getMeetingKind(target.category.name);
              const categoryBytes = target.files.reduce((sum, file) => sum + Math.max(0, Number(file.size) || 0), 0);
              return (
                <article key={key} className="rounded-2xl border border-slate-100 p-4 md:p-5">
                  <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2"><span className="rounded-lg bg-slate-100 px-2 py-1 text-[9px] font-black text-slate-500">{kind ? meetingLabels[kind] : '회의'}</span><h3 className="truncate text-sm font-black text-slate-800">{target.category.name}</h3></div>
                      <p className="mt-2 text-[10px] font-bold text-slate-400">문서 {target.files.length}건 · {formatBytes(categoryBytes)}</p>
                      <p className="mt-1 truncate text-[10px] font-bold text-blue-600">정리 후: {target.nextCategoryName}</p>
                    </div>
                    {target.files.length === 0 ? (
                      <span className="inline-flex shrink-0 items-center justify-center gap-1.5 rounded-xl bg-slate-100 px-4 py-2.5 text-[10px] font-black text-slate-500"><Check size={14} /> 백업할 문서 없음</span>
                    ) : (
                      <button disabled={status === 'loading' || isExecuting} onClick={() => void downloadTarget(target)} className={`inline-flex shrink-0 items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-[10px] font-black transition-colors disabled:cursor-wait disabled:opacity-60 ${status === 'done' ? 'bg-emerald-50 text-emerald-700' : status === 'error' ? 'bg-red-50 text-red-600' : 'bg-slate-900 text-white hover:bg-black'}`}>
                        {status === 'loading' ? <LoaderCircle size={15} className="animate-spin" /> : status === 'done' ? <Check size={15} /> : <Download size={15} />}
                        {status === 'loading' ? 'ZIP 생성 중' : status === 'done' ? '다운로드 완료' : status === 'error' ? '다시 다운로드' : 'ZIP 다운로드'}
                      </button>
                    )}
                  </div>
                </article>
              );
            })}
          </div>

          <div className="mt-5 rounded-2xl border border-red-100 bg-red-50/60 p-4 md:p-5">
            <div className="flex items-start gap-3"><AlertTriangle size={18} className="mt-0.5 shrink-0 text-red-500" /><div><h3 className="text-xs font-black text-red-700">실행 전 확인</h3><p className="mt-1 text-[10px] font-bold leading-relaxed text-red-500">모든 분류의 ZIP 다운로드가 끝난 후 아래 문구를 정확히 입력해야 정리할 수 있습니다. 삭제된 문서는 이 화면에서 복원할 수 없습니다.</p></div></div>
            <label className="mt-4 block"><span className="mb-2 block text-[10px] font-black text-slate-600">확인 문구: {requiredConfirmation}</span><input value={confirmation} onChange={(event) => setConfirmation(event.target.value)} disabled={!allDownloadsComplete || isExecuting} placeholder={allDownloadsComplete ? requiredConfirmation : '먼저 모든 ZIP 파일을 다운로드해 주십시오.'} className="w-full rounded-xl border border-red-100 bg-white px-4 py-3 text-sm font-black text-slate-800 outline-none placeholder:text-xs placeholder:font-bold placeholder:text-slate-300 focus:border-red-400 disabled:cursor-not-allowed disabled:bg-slate-100" /></label>
          </div>

          {error && <p className="mt-4 rounded-xl bg-red-50 px-4 py-3 text-xs font-bold text-red-600">{error}</p>}
        </div>

        <footer className="flex shrink-0 gap-3 border-t border-slate-100 p-4 md:px-7">
          <button disabled={isExecuting} onClick={closeModal} className="flex-1 rounded-2xl bg-slate-100 py-3.5 text-sm font-black text-slate-600 hover:bg-slate-200 disabled:opacity-50">취소</button>
          <button disabled={!canExecute} onClick={() => void executeCleanup()} className="flex flex-1 items-center justify-center gap-2 rounded-2xl bg-red-500 py-3.5 text-sm font-black text-white shadow-lg transition-colors hover:bg-red-600 disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-400 disabled:shadow-none">{isExecuting ? <LoaderCircle size={17} className="animate-spin" /> : <Trash2 size={17} />}{isExecuting ? '정리 중...' : `${currentYear}년 문서 정리 실행`}</button>
        </footer>
      </section>
    </div>
  );
}
