'use client';

import { photoScheduleNeedsReview } from '@/lib/whiteboard-review';

import { useEffect, useRef, useState } from 'react';
import NextImage from 'next/image';
import { AlertTriangle, Camera, Check, ImagePlus, LoaderCircle, Plus, ScanText, Trash2, X } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { compareWhiteboardSchedule, getPhotoExistingSchedules, getWhiteboardImportError, isWhiteboardDate, isWhiteboardTime } from '@/lib/whiteboard-import';
import { scheduleCategoryStyles } from '@/lib/schedule-category';
import type { AbsenceType, NewScheduleInput } from '@/app/components/schedule-form-modal';

type ScheduleType = 'meeting' | 'business_trip' | 'internal' | 'leave' | 'unclassified';

interface AnalyzedSchedule {
  id: string;
  selected: boolean;
  title: string;
  date: string;
  end_date: string | null;
  start_time: string;
  end_time: string;
  schedule_type: ScheduleType;
  is_urgent: boolean;
  is_todo: boolean;
  absence_type: AbsenceType;
  confidence: number;
  source_text: string;
  warnings: string[];
  original_title: string;
  original_schedule_type: ScheduleType;
  is_manual: boolean;
  ink_color: string;
  color_confidence: number;
  outside_photo_month: boolean;
}

export interface ExistingWhiteboardSchedule extends NewScheduleInput {
  id: number;
}

export interface WhiteboardScheduleUpdate {
  id: number;
  values: Pick<NewScheduleInput, 'title' | 'date' | 'end_date' | 'start_time' | 'end_time' | 'schedule_type' | 'absence_type' | 'is_urgent'>;
}

export interface WhiteboardCorrectionInput {
  source_text: string;
  ai_title: string;
  corrected_title: string;
  ai_schedule_type: ScheduleType;
  corrected_schedule_type: ScheduleType;
}

interface WhiteboardImportModalProps {
  onClose: () => void;
  initialMonth?: string;
  existingSchedules: ExistingWhiteboardSchedule[];
  onImport: (schedules: NewScheduleInput[], updates: WhiteboardScheduleUpdate[], corrections: WhiteboardCorrectionInput[]) => Promise<void>;
}

const scheduleTypes: Array<{ value: ScheduleType; label: string }> = [
  { value: 'meeting', label: '회의)' },
  { value: 'business_trip', label: '출장)' },
  { value: 'internal', label: '내부일정)' },
  { value: 'leave', label: '휴가·조퇴)' },
  { value: 'unclassified', label: '미분류)' },
];

// These are photographed pen colors, separate from the calendar display palette.
const inkColors: Record<string, { label: string; style: string }> = {
  red: { label: '빨강 · 회의', style: 'bg-red-50 text-red-700 ring-red-200' },
  green: { label: '초록 · 출장', style: 'bg-green-50 text-green-700 ring-green-200' },
  blue: { label: '파랑 · 내부일정', style: 'bg-blue-50 text-blue-700 ring-blue-200' },
  cyan: { label: '하늘·파랑 · 내부일정', style: 'bg-blue-50 text-blue-700 ring-blue-200' },
  teal: { label: '청록 · 색상 확인 필요', style: 'bg-slate-100 text-slate-700 ring-slate-200' },
  orange: { label: '주황 · 휴가', style: 'bg-orange-50 text-orange-700 ring-orange-200' },
  unknown: { label: '필기 색상 확인 필요', style: 'bg-slate-100 text-slate-600 ring-slate-200' },
};

const currentMonthKey = () => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit' }).format(new Date());

const formatBytes = (bytes: number) => {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))}KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
};

const loadImage = (file: File) => new Promise<HTMLImageElement>((resolve, reject) => {
  const url = URL.createObjectURL(file);
  const image = new Image();
  image.onload = () => { URL.revokeObjectURL(url); resolve(image); };
  image.onerror = () => { URL.revokeObjectURL(url); reject(new Error('브라우저에서 이미지를 변환할 수 없습니다.')); };
  image.src = url;
});

const compressImage = async (file: File) => {
  if (file.size > 25 * 1024 * 1024) throw new Error('25MB 이하의 사진을 선택해 주십시오.');
  if (['image/jpeg', 'image/png', 'image/webp'].includes(file.type) && file.size <= 12 * 1024 * 1024) return file;

  try {
    const image = await loadImage(file);
    const maxDimension = 3600;
    const scale = Math.min(1, maxDimension / Math.max(image.naturalWidth, image.naturalHeight));
    const width = Math.max(1, Math.round(image.naturalWidth * scale));
    const height = Math.max(1, Math.round(image.naturalHeight * scale));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('사진을 변환하지 못했습니다.');
    context.imageSmoothingQuality = 'high';
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, width, height);
    context.drawImage(image, 0, 0, width, height);

    const blob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((result) => result ? resolve(result) : reject(new Error('사진을 압축하지 못했습니다.')), 'image/jpeg', 0.95);
    });
    if (blob.size > 12 * 1024 * 1024) throw new Error('분석용 사진이 너무 큽니다. 화이트보드 영역만 촬영해 주십시오.');
    return new File([blob], `${file.name.replace(/\.[^.]+$/, '') || 'whiteboard'}-compressed.jpg`, { type: 'image/jpeg' });
  } catch (error) {
    const supportedOriginal = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'].includes(file.type);
    if (supportedOriginal && file.size <= 12 * 1024 * 1024) return file;
    throw error;
  }
};

const fileToBase64 = (file: File) => new Promise<string>((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => {
    const result = typeof reader.result === 'string' ? reader.result : '';
    resolve(result.includes(',') ? result.split(',')[1] : result);
  };
  reader.onerror = () => reject(new Error('사진을 읽지 못했습니다.'));
  reader.readAsDataURL(file);
});

export default function WhiteboardImportModal({ onClose, initialMonth, existingSchedules, onImport }: WhiteboardImportModalProps) {
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const addedTitleRef = useRef<HTMLInputElement>(null);
  const [originalFile, setOriginalFile] = useState<File | null>(null);
  const [analysisFile, setAnalysisFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState('');
  const [drafts, setDrafts] = useState<AnalyzedSchedule[]>([]);
  const [hasAnalyzed, setHasAnalyzed] = useState(false);
  const [reviewFilter, setReviewFilter] = useState<'all' | 'needs-review'>('all');
  const [targetMonth, setTargetMonth] = useState(initialMonth || currentMonthKey());
  const [photoMonths, setPhotoMonths] = useState<string[]>([]);
  const [analysisWarnings, setAnalysisWarnings] = useState<string[]>([]);
  const [addedDraftId, setAddedDraftId] = useState('');
  const [isPreparing, setIsPreparing] = useState(false);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => () => { if (previewUrl) URL.revokeObjectURL(previewUrl); }, [previewUrl]);

  useEffect(() => {
    if (!addedDraftId) return;
    addedTitleRef.current?.focus({ preventScroll: true });
    addedTitleRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, [addedDraftId]);

  const photoExistingSchedules = getPhotoExistingSchedules(existingSchedules, drafts.map((draft) => draft.date));
  const compareSchedule = (draft: AnalyzedSchedule, schedules = photoExistingSchedules) => compareWhiteboardSchedule(draft, schedules);
  const busy = isPreparing || isAnalyzing || isSaving;
  const actionableCount = drafts.filter((draft) => draft.selected && compareSchedule(draft).status !== 'duplicate').length;
  const needsReview = (draft: AnalyzedSchedule) => photoScheduleNeedsReview(draft, compareSchedule(draft).status);
  const reviewCount = drafts.filter(needsReview).length;
  const visibleDrafts = reviewFilter === 'needs-review' ? drafts.filter(needsReview) : drafts;

  const selectFile = async (file?: File) => {
    if (!file || busy) return;
    if (!file.type.startsWith('image/')) {
      setError('이미지 파일만 선택할 수 있습니다.');
      return;
    }

    setIsPreparing(true);
    setError('');
    setDrafts([]);
    setHasAnalyzed(false);
    setReviewFilter('all');
    setPhotoMonths([]);
    setAnalysisWarnings([]);
    setAddedDraftId('');
    try {
      const compressed = await compressImage(file);
      if (previewUrl) URL.revokeObjectURL(previewUrl);
      setOriginalFile(file);
      setAnalysisFile(compressed);
      setPreviewUrl(URL.createObjectURL(compressed));
    } catch (prepareError) {
      setError(prepareError instanceof Error ? prepareError.message : '사진을 준비하지 못했습니다.');
    } finally {
      setIsPreparing(false);
    }
  };

  const analyze = async () => {
    if (!analysisFile) return;
    setIsAnalyzing(true);
    setError('');
    try {
      const imageBase64 = await fileToBase64(analysisFile);
      const currentDate = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Seoul' }).format(new Date());
      const { data, error: functionError } = await supabase.functions.invoke('analyze-whiteboard', {
        body: { imageBase64, mimeType: analysisFile.type, currentDate, targetMonth },
      });
      if (functionError) {
        let serverMessage = '';
        const context = (functionError as { context?: Response }).context;

        if (context) {
          const responseBody = await context.clone().json().catch(() => null) as { error?: string } | null;
          serverMessage = responseBody?.error ?? '';
        }

        throw new Error(serverMessage || functionError.message || '사진을 분석하지 못했습니다.');
      }
      if (data?.error) throw new Error(data.error);

      const schedules = Array.isArray(data?.schedules) ? data.schedules : [];
      const visibleMonths: string[] = Array.isArray(data?.visible_months)
        ? data.visible_months.filter((month: unknown) => typeof month === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(month)) : [];
      const scopeMonths = visibleMonths.length > 0 ? visibleMonths : [targetMonth];
      setPhotoMonths(scopeMonths);
      setAnalysisWarnings(Array.isArray(data?.analysis_warnings) ? data.analysis_warnings.filter((warning: unknown) => typeof warning === 'string') : []);
      setDrafts(schedules.map((schedule: Partial<AnalyzedSchedule>, index: number) => {
        const date = typeof schedule.date === 'string' && isWhiteboardDate(schedule.date) ? schedule.date : '';
        const outsideMonth = Boolean(date && !scopeMonths.includes(date.slice(0, 7)));
        const draft: AnalyzedSchedule = {
          id: `${Date.now()}-${index}`,
          selected: Boolean(schedule.title && date && !outsideMonth),
          title: schedule.title ?? '',
          date,
          end_date: typeof schedule.end_date === 'string' && isWhiteboardDate(schedule.end_date) ? schedule.end_date : null,
          start_time: typeof schedule.start_time === 'string' && isWhiteboardTime(schedule.start_time.slice(0, 5)) ? schedule.start_time.slice(0, 5) : '',
          end_time: typeof schedule.end_time === 'string' && isWhiteboardTime(schedule.end_time.slice(0, 5)) ? schedule.end_time.slice(0, 5) : '',
          schedule_type: scheduleTypes.some((type) => type.value === schedule.schedule_type) ? schedule.schedule_type as ScheduleType : 'unclassified',
          is_urgent: Boolean(schedule.is_urgent),
          is_todo: false,
          absence_type: schedule.absence_type === 'early' || schedule.absence_type === 'outing' ? schedule.absence_type : 'annual',
          confidence: typeof schedule.confidence === 'number' ? schedule.confidence : 0,
          source_text: schedule.source_text ?? '',
          warnings: Array.isArray(schedule.warnings) ? schedule.warnings : [],
          original_title: schedule.title ?? '',
          original_schedule_type: scheduleTypes.some((type) => type.value === schedule.schedule_type) ? schedule.schedule_type as ScheduleType : 'unclassified',
          is_manual: false,
          ink_color: typeof schedule.ink_color === 'string' ? schedule.ink_color : 'unknown',
          color_confidence: typeof schedule.color_confidence === 'number' ? schedule.color_confidence : 0,
          outside_photo_month: outsideMonth,
        };
        return { ...draft, selected: draft.selected && compareSchedule(draft, getPhotoExistingSchedules(existingSchedules, [draft.date])).status !== 'duplicate' };
      }));
      setHasAnalyzed(true);
    } catch (analysisError) {
      setError(analysisError instanceof Error ? analysisError.message : '사진을 분석하지 못했습니다.');
    } finally {
      setIsAnalyzing(false);
    }
  };

  const updateDraft = <K extends keyof AnalyzedSchedule>(id: string, key: K, value: AnalyzedSchedule[K]) => {
    setDrafts((current) => current.map((draft) => {
      if (draft.id !== id) return draft;
      const updated = { ...draft, [key]: value };
      if (key === 'date') updated.outside_photo_month = !updated.is_manual && Boolean(updated.date && !photoMonths.includes(updated.date.slice(0, 7)));
      if (compareSchedule(updated).status === 'duplicate') updated.selected = false;
      return updated;
    }));
  };

  const addManualDraft = () => {
    setReviewFilter('all');
    const id = `manual-${crypto.randomUUID()}`;
    const lastDate = [...drafts].reverse().find((draft) => isWhiteboardDate(draft.date) && !draft.outside_photo_month)?.date;
    setDrafts((current) => [...current, {
      id,
      selected: true,
      title: '',
      date: lastDate || `${photoMonths[0] || targetMonth}-01`,
      end_date: null,
      start_time: '',
      end_time: '',
      schedule_type: 'unclassified',
      is_urgent: false,
      is_todo: false,
      absence_type: 'annual',
      confidence: 1,
      source_text: '',
      warnings: [],
      original_title: '',
      original_schedule_type: 'unclassified',
      is_manual: true,
      ink_color: 'unknown',
      color_confidence: 0,
      outside_photo_month: false,
    }]);
    setAddedDraftId(id);
    setHasAnalyzed(true);
    setError('');
  };

  const importSelected = async () => {
    const selected = drafts.filter((draft) => draft.selected);
    const actionable = selected.filter((draft) => compareSchedule(draft).status !== 'duplicate');
    if (actionable.length === 0) {
      setError('등록할 일정을 선택해 주십시오.');
      return;
    }
    const validationError = getWhiteboardImportError(actionable.map((draft) => ({
      ...draft,
      end_date: draft.end_date ?? compareSchedule(draft).matched?.end_date ?? null,
    })));
    if (validationError) {
      setError(validationError);
      return;
    }

    setIsSaving(true);
    setError('');
    try {
      const corrections = selected
        .filter((draft) => !draft.is_manual && (
          draft.title.trim() !== draft.original_title.trim()
          || draft.schedule_type !== draft.original_schedule_type
        ))
        .map((draft) => ({
          source_text: draft.source_text,
          ai_title: draft.original_title.trim(),
          corrected_title: draft.title.trim(),
          ai_schedule_type: draft.original_schedule_type,
          corrected_schedule_type: draft.schedule_type,
        }));

      const toScheduleInput = (draft: AnalyzedSchedule): NewScheduleInput => ({
        title: draft.title.trim(),
        date: draft.date,
        end_date: draft.end_date,
        start_time: draft.start_time || null,
        end_time: draft.end_time || null,
        schedule_type: draft.schedule_type,
        is_notice: false,
        is_urgent: draft.is_urgent,
        is_completed: false,
        is_todo: draft.is_todo,
        absence_type: draft.absence_type,
      });
      const inserts = selected
        .filter((draft) => compareSchedule(draft).status === 'new')
        .map(toScheduleInput);
      const updates = selected.flatMap((draft) => {
        const comparison = compareSchedule(draft);
        if (comparison.status !== 'changed' || !comparison.matched) return [];
        const values = toScheduleInput(draft);
        return [{
          id: comparison.matched.id,
          values: {
            title: values.title,
            date: values.date,
            end_date: values.end_date ?? comparison.matched.end_date,
            start_time: values.start_time,
            end_time: values.end_time,
            schedule_type: values.schedule_type,
            absence_type: values.absence_type,
            is_urgent: values.is_urgent,
          },
        }];
      });

      await onImport(inserts, updates, corrections);
      onClose();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : '일정을 등록하지 못했습니다.');
      setIsSaving(false);
    }
  };

  const removePhoto = () => {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setOriginalFile(null);
    setAnalysisFile(null);
    setPreviewUrl('');
    setDrafts([]);
    setHasAnalyzed(false);
    setPhotoMonths([]);
    setAnalysisWarnings([]);
    setAddedDraftId('');
    setError('');
  };

  return (
    <div className="fixed inset-0 z-[250] flex items-center justify-center bg-slate-950/60 p-3 backdrop-blur-sm md:p-6">
      <div role="dialog" aria-modal="true" aria-labelledby="whiteboard-import-heading" className={`flex max-h-[94dvh] w-full flex-col overflow-hidden rounded-[26px] bg-white shadow-2xl [&_input]:min-w-0 [&_select]:min-w-0 [&_input]:w-full [&_select]:w-full [&_input]:text-base [&_select]:text-base sm:rounded-[30px] sm:[&_input]:text-xs sm:[&_select]:text-xs ${hasAnalyzed ? 'max-w-6xl' : 'max-w-4xl'}`}>
        <div className="flex shrink-0 items-center justify-between border-b border-slate-100 px-5 py-4 md:px-7">
          <div>
            <h2 id="whiteboard-import-heading" className="text-lg font-black text-slate-900 md:text-xl">화이트보드 일정 가져오기</h2>
            <p className="mt-1 text-[11px] font-bold text-slate-400">사진을 분석한 뒤 확인한 일정만 등록합니다.</p>
          </div>
          <button onClick={onClose} disabled={busy} aria-label="닫기" className="rounded-xl bg-slate-100 p-2 text-slate-500 hover:bg-slate-200 disabled:opacity-40"><X size={18} /></button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-4 custom-scrollbar sm:p-5 md:p-7">
          {!hasAnalyzed ? (
            <>
              {!analysisFile ? (
                <div
                  onDragOver={(event) => { event.preventDefault(); setIsDragging(true); }}
                  onDragLeave={() => setIsDragging(false)}
                  onDrop={(event) => { event.preventDefault(); setIsDragging(false); void selectFile(event.dataTransfer.files[0]); }}
                  className={`rounded-[26px] border-2 border-dashed p-7 text-center transition-colors md:p-12 ${isDragging ? 'border-blue-500 bg-blue-50' : 'border-slate-200 bg-slate-50'}`}
                >
                  <ImagePlus size={38} className="mx-auto mb-4 text-slate-300" />
                  <p className="text-sm font-black text-slate-700">화이트보드 사진을 준비해 주십시오.</p>
                  <p className="mt-2 text-xs font-bold text-slate-400">아이폰 촬영, 사진 보관함, PC 파일과 드래그 업로드를 지원합니다.</p>
                  <div className="mt-6 flex flex-col justify-center gap-2 sm:flex-row">
                    <button disabled={busy} onClick={() => cameraInputRef.current?.click()} className="flex items-center justify-center gap-2 rounded-2xl bg-blue-600 px-5 py-3 text-xs font-black text-white shadow-lg hover:bg-blue-700 disabled:opacity-40"><Camera size={16} /> 카메라로 촬영</button>
                    <button disabled={busy} onClick={() => fileInputRef.current?.click()} className="flex items-center justify-center gap-2 rounded-2xl bg-slate-900 px-5 py-3 text-xs font-black text-white hover:bg-black disabled:opacity-40"><ImagePlus size={16} /> 사진 또는 파일 선택</button>
                  </div>
                  <input ref={cameraInputRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={(event) => void selectFile(event.target.files?.[0])} />
                  <input ref={fileInputRef} type="file" accept="image/*,.heic,.heif" className="hidden" onChange={(event) => void selectFile(event.target.files?.[0])} />
                </div>
              ) : (
                <div className="grid gap-5 md:grid-cols-[0.9fr_1.1fr]">
                  <div className="overflow-hidden rounded-2xl bg-slate-100"><NextImage unoptimized src={previewUrl} alt="분석할 화이트보드" width={1200} height={900} className="h-full max-h-96 w-full object-contain" /></div>
                  <div className="flex flex-col justify-center rounded-2xl border border-slate-100 p-5">
                    <div className="flex items-start justify-between gap-4">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-black text-slate-800">{originalFile?.name}</p>
                        <p className="mt-2 text-xs font-bold text-slate-400">원본 {originalFile ? formatBytes(originalFile.size) : '-'} → 분석용 {formatBytes(analysisFile.size)}</p>
                      </div>
                      <button disabled={busy} onClick={removePhoto} aria-label="사진 삭제" className="rounded-xl bg-red-50 p-2 text-red-500 hover:bg-red-100 disabled:opacity-40"><Trash2 size={16} /></button>
                    </div>
                    <div className="mt-5 rounded-xl bg-blue-50 p-3 text-[11px] font-bold leading-relaxed text-blue-700">사진은 일정 추출에만 사용되며 Supabase Storage에는 저장하지 않습니다.</div>
                    <label className="mt-4 text-xs font-black text-slate-700">사진 기준 월
                      <input type="month" value={targetMonth} disabled={busy} onChange={(event) => setTargetMonth(event.target.value)} className="mt-1.5 block w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm font-bold text-slate-900" />
                      <span className="mt-1.5 block text-[10px] font-medium text-slate-500">사진에 월이 적혀 있으면 사진을 우선합니다. 월이 없을 때만 이 값을 사용합니다.</span>
                    </label>
                    <div className="mt-3 flex flex-wrap gap-1.5" aria-label="화이트보드 필기 색상 기준">
                      {['red', 'green', 'blue', 'orange'].map((key) => <span key={key} className={`rounded-lg px-2 py-1 text-[10px] font-bold ring-1 ring-inset ${inkColors[key].style}`}>{inkColors[key].label}</span>)}
                    </div>
                    <button disabled={isAnalyzing} onClick={analyze} className="mt-5 flex items-center justify-center gap-2 rounded-2xl bg-blue-600 py-3.5 text-sm font-black text-white shadow-lg hover:bg-blue-700 disabled:cursor-wait disabled:opacity-60">
                      {isAnalyzing ? <LoaderCircle size={18} className="animate-spin" /> : <ScanText size={18} />}{isAnalyzing ? '글씨·색상·누락 일정 확인 중...' : '일정 분석 시작'}
                    </button>
                  </div>
                </div>
              )}
              {isPreparing && <div className="mt-4 flex items-center justify-center gap-2 text-xs font-black text-blue-600"><LoaderCircle size={16} className="animate-spin" /> 사진을 준비하고 있습니다.</div>}
            </>
          ) : (
            <div className="grid items-start gap-5 lg:grid-cols-[minmax(220px,0.7fr)_minmax(0,1.5fr)]">
              <aside className="min-w-0 space-y-3 lg:sticky lg:top-0">
                {previewUrl && <details open className="overflow-hidden rounded-2xl border border-slate-200 bg-slate-50">
                  <summary className="cursor-pointer px-4 py-3 text-xs font-black text-slate-700">사진 원본 확인 <span className="font-medium text-slate-500">· 누르면 펼치기/접기</span></summary>
                  <a href={previewUrl} target="_blank" rel="noopener noreferrer" aria-label="사진 크게 보기 (새 창)"><NextImage unoptimized src={previewUrl} alt="일정 대조용 화이트보드 사진" width={1200} height={900} className="max-h-44 w-full object-contain lg:max-h-[48vh]" /></a>
                  <p className="px-4 py-2 text-[10px] font-medium text-slate-500">사진을 누르면 크게 볼 수 있습니다.</p>
                </details>}
                <div className="rounded-2xl bg-blue-50 p-3 text-xs leading-relaxed text-blue-900">
                  <p className="font-black">사진 일정 {drafts.filter((draft) => !draft.is_manual).length}건 · 직접 추가 {drafts.filter((draft) => draft.is_manual).length}건</p>
                  <p className="mt-1 font-medium">대상 월: {photoMonths.join(', ') || targetMonth}</p>
                  <p className="mt-1 text-[11px] font-medium text-blue-700">사진에서 읽은 항목과 직접 추가한 항목만 반영합니다.</p>
                </div>
                {analysisWarnings.length > 0 && <div role="status" className="space-y-1 rounded-xl bg-amber-50 p-3 text-[11px] font-bold leading-relaxed text-amber-800">{analysisWarnings.map((warning, index) => <p key={index}>{warning}</p>)}</div>}
              </aside>
              <div className="min-w-0">
              <div className="mb-4 grid grid-cols-3 gap-2">
                {([
                  { label: '신규', status: 'new', style: 'bg-blue-50 text-blue-700' },
                  { label: '변경', status: 'changed', style: 'bg-amber-50 text-amber-700' },
                  { label: '중복', status: 'duplicate', style: 'bg-slate-100 text-slate-500' },
                ] as const).map((summary) => <div key={summary.status} className={`rounded-xl px-3 py-2.5 text-center ${summary.style}`}><span className="text-[10px] font-black">{summary.label}</span><strong className="ml-2 text-base">{drafts.filter((draft) => compareSchedule(draft).status === summary.status).length}</strong></div>)}
              </div>
              <div className="mb-4 flex flex-col justify-between gap-3 sm:flex-row sm:items-end">
                <div>
                  <h3 className="text-lg font-black text-slate-900">추출된 일정 확인</h3>
                  <p className="mt-1 text-xs font-medium leading-relaxed text-slate-500">내용을 고치거나 누락된 일정을 추가한 뒤 반영할 항목을 선택해 주세요.</p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <button disabled={busy} onClick={removePhoto} className="px-2 py-2 text-left text-xs font-black text-blue-600 sm:text-right disabled:opacity-40">다른 사진 분석</button>
                </div>
              </div>
              <div className="space-y-3">
                <div className="flex flex-wrap items-center gap-2" aria-label="사진 일정 검토 필터">
                  <button type="button" aria-pressed={reviewFilter === 'all'} onClick={() => setReviewFilter('all')} className={`min-h-10 rounded-xl border px-3 text-xs font-bold ${reviewFilter === 'all' ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-200 bg-white text-slate-700'}`}>전체 {drafts.length}건</button>
                  <button type="button" aria-pressed={reviewFilter === 'needs-review'} onClick={() => setReviewFilter('needs-review')} className={`min-h-10 rounded-xl border px-3 text-xs font-bold ${reviewFilter === 'needs-review' ? 'border-amber-700 bg-amber-700 text-white' : 'border-amber-200 bg-amber-50 text-amber-900'}`}>확인 필요한 일정 {reviewCount}건</button>
                </div>
                {reviewFilter === 'needs-review' && <p className="text-xs leading-relaxed text-slate-600">날짜·글씨·색상 확인 또는 기존 일정 변경이 필요한 항목입니다. 필터는 표시만 바꾸며 숨겨진 일정의 선택 상태도 유지됩니다. 저장 대상은 하단 전체 건수를 확인해 주세요.</p>}
                {reviewFilter === 'needs-review' && visibleDrafts.length === 0 && drafts.length > 0 && <p role="status" className="rounded-xl bg-emerald-50 p-4 text-sm text-emerald-800">추가 확인이 필요한 항목은 없습니다. 전체 목록에서 내용을 한 번 더 확인해 주세요.</p>}
                {drafts.length === 0 && <div className="rounded-2xl border border-dashed border-slate-300 px-4 py-8 text-center text-sm text-slate-600"><p className="font-black">확인할 일정이 없습니다.</p><p className="mt-2 text-xs">하단의 ‘일정 추가’로 사진에서 빠진 일정을 직접 입력할 수 있습니다.</p></div>}
                <fieldset disabled={isSaving} className="min-w-0 space-y-3 disabled:opacity-60">
                {visibleDrafts.map((draft) => (
                  <div key={draft.id} className={`rounded-2xl border p-4 transition-colors ${draft.selected ? 'border-blue-200 bg-blue-50/30' : 'border-slate-100 bg-slate-50 opacity-65'}`}>
                    <div className="flex items-start gap-3">
                      <button
                        disabled={compareSchedule(draft).status === 'duplicate'}
                        onClick={() => updateDraft(draft.id, 'selected', !draft.selected)}
                        aria-label={draft.selected ? '일정 선택 해제' : '일정 선택'}
                        className={`mt-1 flex h-6 w-6 shrink-0 items-center justify-center rounded-lg border-2 ${draft.selected ? 'border-blue-600 bg-blue-600 text-white' : 'border-slate-300 bg-white text-transparent'} disabled:cursor-not-allowed disabled:bg-slate-100`}
                      ><Check size={14} strokeWidth={3} /></button>
                      <div className="grid min-w-0 flex-1 gap-3 md:grid-cols-[140px_1fr]">
                        <select aria-label="일정 유형" value={draft.schedule_type} onChange={(event) => updateDraft(draft.id, 'schedule_type', event.target.value as ScheduleType)} className={`rounded-xl border px-3 py-2.5 text-xs font-black outline-none focus:ring-2 focus:ring-blue-200 ${scheduleCategoryStyles[draft.schedule_type === 'unclassified' ? 'general' : draft.schedule_type].filter}`}>
                          {scheduleTypes.map((type) => <option key={type.value} value={type.value} className="bg-white text-slate-900">{type.label}</option>)}
                        </select>
                        <input ref={draft.id === addedDraftId ? addedTitleRef : undefined} aria-label="일정 제목" value={draft.title} onChange={(event) => updateDraft(draft.id, 'title', event.target.value)} placeholder="일정 제목" className="rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-xs font-black text-slate-800 outline-none focus:border-blue-500" />
                        {draft.schedule_type === 'leave' && (
                          <select aria-label="휴가 구분" value={draft.absence_type} onChange={(event) => updateDraft(draft.id, 'absence_type', event.target.value as AbsenceType)} className={`rounded-xl border px-3 py-2.5 text-xs font-black outline-none focus:ring-2 focus:ring-orange-200 ${scheduleCategoryStyles.leave.filter}`}>
                            <option value="annual">연차</option>
                            <option value="early">조퇴</option>
                            <option value="outing">외출</option>
                          </select>
                        )}
                        <input aria-label={draft.end_date ? '시작 날짜' : '일정 날짜'} type="date" value={draft.date} onChange={(event) => updateDraft(draft.id, 'date', event.target.value)} className="min-w-0 rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-xs font-bold text-slate-700 outline-none focus:border-blue-500" />
                        {draft.end_date && <label className="text-[10px] font-bold text-slate-500">종료 날짜<input aria-label="종료 날짜" type="date" value={draft.end_date} min={draft.date} onChange={(event) => updateDraft(draft.id, 'end_date', event.target.value || null)} className="mt-1 block w-full min-w-0 rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-xs font-bold text-slate-700" /></label>}
                        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                          <input type="time" value={draft.start_time} onChange={(event) => updateDraft(draft.id, 'start_time', event.target.value)} aria-label="시작 시간" className="min-w-0 rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-xs font-bold text-slate-700 outline-none focus:border-blue-500" />
                          <input type="time" value={draft.end_time} onChange={(event) => updateDraft(draft.id, 'end_time', event.target.value)} aria-label="종료 시간" className="min-w-0 rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-xs font-bold text-slate-700 outline-none focus:border-blue-500" />
                        </div>
                      </div>
                      <button aria-label="이 일정 제외" onClick={() => setDrafts((current) => current.filter((item) => item.id !== draft.id))} className="mt-1 shrink-0 rounded-lg p-1 text-slate-400 hover:bg-red-50 hover:text-red-500"><X size={16} /></button>
                    </div>
                    <div className="mt-3 flex flex-wrap items-center gap-2 pl-9 text-[10px] font-bold">
                      {(() => {
                        const comparison = compareSchedule(draft);
                        if (comparison.status === 'duplicate') return <span className="rounded-lg bg-slate-200 px-2 py-1 text-slate-600">기존 일정과 동일 · 등록 제외</span>;
                        if (comparison.status === 'changed') return <span className="rounded-lg bg-amber-100 px-2 py-1 text-amber-700">기존 일정 변경 · {comparison.changedFields.join(', ')}</span>;
                        return <span className="rounded-lg bg-blue-100 px-2 py-1 text-blue-700">새 일정</span>;
                      })()}
                      {draft.is_manual
                        ? <span className="rounded-lg bg-blue-50 px-2 py-1 text-blue-600">직접 추가</span>
                        : <span className={`rounded-lg px-2 py-1 ${draft.confidence >= 0.8 ? 'bg-emerald-50 text-emerald-600' : draft.confidence >= 0.55 ? 'bg-amber-50 text-amber-600' : 'bg-red-50 text-red-600'}`}>인식 신뢰도 {Math.round(draft.confidence * 100)}%</span>}
                      {!draft.is_manual && <span className={`rounded-lg px-2 py-1 ring-1 ring-inset ${(inkColors[draft.ink_color] || inkColors.unknown).style}`}>{(inkColors[draft.ink_color] || inkColors.unknown).label}{draft.color_confidence < 0.8 ? ' · 확인 필요' : ''}</span>}
                      <button onClick={() => updateDraft(draft.id, 'is_urgent', !draft.is_urgent)} className={`rounded-lg px-2 py-1 ${draft.is_urgent ? 'bg-red-500 text-white' : 'bg-slate-100 text-slate-500'}`}>긴급 {draft.is_urgent ? '예' : '아니오'}</button>
                      <button onClick={() => updateDraft(draft.id, 'is_todo', !draft.is_todo)} className={`rounded-lg px-2 py-1 ${draft.is_todo ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-500'}`}>TO DO {draft.is_todo ? '예' : '아니오'}</button>
                    </div>
                    {draft.outside_photo_month && <p className="mt-2 pl-9 text-[11px] font-bold text-amber-800"><AlertTriangle size={12} className="mr-1 inline" />사진 기준 월과 다릅니다. 사진의 날짜를 확인한 뒤 선택해 주세요.</p>}
                    {(draft.warnings.length > 0 || !draft.date) && <div className="mt-2 space-y-1 pl-9 text-[11px] font-medium text-amber-800">{(draft.warnings.length > 0 ? draft.warnings : ['날짜를 확인해 주십시오.']).map((warning, index) => <p key={index}><AlertTriangle size={11} className="mr-1 inline" />{warning}</p>)}</div>}
                    {!draft.is_manual && draft.source_text && <details className="mt-2 pl-9 text-[11px] text-slate-600"><summary className="cursor-pointer font-bold">사진에서 읽은 원문</summary><p className="mt-1 whitespace-pre-wrap rounded-lg bg-slate-50 p-2 leading-relaxed">{draft.source_text}</p></details>}
                  </div>
                ))}
                </fieldset>
              </div>
              </div>
            </div>
          )}
          {error && <p role="alert" className="mt-4 rounded-xl bg-red-50 px-4 py-3 text-xs font-bold text-red-600">{error}</p>}
        </div>

        {hasAnalyzed && (
          <div className="grid shrink-0 grid-cols-[auto_minmax(0,1fr)] gap-2 border-t border-slate-200 bg-white p-3 shadow-[0_-4px_16px_rgba(15,23,42,0.04)] sm:grid-cols-[auto_auto_minmax(0,1fr)] sm:gap-3 md:px-7">
            <button disabled={isSaving} onClick={onClose} className="hidden rounded-xl bg-slate-100 px-5 py-3.5 text-xs font-black text-slate-600 hover:bg-slate-200 disabled:opacity-40 sm:block">취소</button>
            <button disabled={isSaving} onClick={addManualDraft} className="flex items-center justify-center gap-1.5 rounded-xl border border-blue-200 bg-blue-50 px-4 py-3.5 text-xs font-black text-blue-700 hover:bg-blue-100 disabled:opacity-40"><Plus size={16} /> 일정 추가</button>
            <button disabled={isSaving || actionableCount === 0} onClick={importSelected} className="flex min-w-0 items-center justify-center gap-2 rounded-xl bg-blue-600 px-3 py-3.5 text-xs font-black text-white shadow-md hover:bg-blue-700 disabled:opacity-50 sm:text-sm">{isSaving && <LoaderCircle size={16} className="animate-spin" />}{isSaving ? '반영 중...' : `선택 일정 ${actionableCount}건 반영`}</button>
          </div>
        )}
      </div>
    </div>
  );
}
