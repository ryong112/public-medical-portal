'use client';

import { useRef, useState } from 'react';
import NextImage from 'next/image';
import { AlertTriangle, Camera, Check, ImagePlus, LoaderCircle, Plus, ScanText, Trash2, X } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import type { NewScheduleInput } from '@/app/components/schedule-form-modal';

type ScheduleType = 'meeting' | 'business_trip' | 'internal' | 'leave' | 'unclassified';

interface AnalyzedSchedule {
  id: string;
  selected: boolean;
  title: string;
  date: string;
  start_time: string;
  end_time: string;
  schedule_type: ScheduleType;
  is_urgent: boolean;
  is_todo: boolean;
  confidence: number;
  source_text: string;
  warnings: string[];
  original_title: string;
  original_schedule_type: ScheduleType;
  is_manual: boolean;
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
  onImport: (schedules: NewScheduleInput[], corrections: WhiteboardCorrectionInput[]) => Promise<void>;
}

const scheduleTypes: Array<{ value: ScheduleType; label: string }> = [
  { value: 'meeting', label: '회의)' },
  { value: 'business_trip', label: '출장)' },
  { value: 'internal', label: '내부일정)' },
  { value: 'leave', label: '휴가)' },
  { value: 'unclassified', label: '미분류)' },
];

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

  try {
    const image = await loadImage(file);
    const maxDimension = 2000;
    const scale = Math.min(1, maxDimension / Math.max(image.naturalWidth, image.naturalHeight));
    const width = Math.max(1, Math.round(image.naturalWidth * scale));
    const height = Math.max(1, Math.round(image.naturalHeight * scale));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('사진을 변환하지 못했습니다.');
    context.drawImage(image, 0, 0, width, height);

    const blob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((result) => result ? resolve(result) : reject(new Error('사진을 압축하지 못했습니다.')), 'image/jpeg', 0.82);
    });
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

export default function WhiteboardImportModal({ onClose, onImport }: WhiteboardImportModalProps) {
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [originalFile, setOriginalFile] = useState<File | null>(null);
  const [analysisFile, setAnalysisFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState('');
  const [drafts, setDrafts] = useState<AnalyzedSchedule[]>([]);
  const [isPreparing, setIsPreparing] = useState(false);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [error, setError] = useState('');

  const selectFile = async (file?: File) => {
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      setError('이미지 파일만 선택할 수 있습니다.');
      return;
    }

    setIsPreparing(true);
    setError('');
    setDrafts([]);
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
      const now = new Date();
      const currentDate = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
      const { data, error: functionError } = await supabase.functions.invoke('analyze-whiteboard', {
        body: { imageBase64, mimeType: analysisFile.type, currentDate },
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
      setDrafts(schedules.map((schedule: Partial<AnalyzedSchedule>, index: number) => ({
        id: `${Date.now()}-${index}`,
        selected: Boolean(schedule.title && schedule.date),
        title: schedule.title ?? '',
        date: schedule.date ?? '',
        start_time: schedule.start_time ?? '',
        end_time: schedule.end_time ?? '',
        schedule_type: scheduleTypes.some((type) => type.value === schedule.schedule_type) ? schedule.schedule_type as ScheduleType : 'unclassified',
        is_urgent: Boolean(schedule.is_urgent),
        is_todo: false,
        confidence: typeof schedule.confidence === 'number' ? schedule.confidence : 0,
        source_text: schedule.source_text ?? '',
        warnings: Array.isArray(schedule.warnings) ? schedule.warnings : [],
        original_title: schedule.title ?? '',
        original_schedule_type: scheduleTypes.some((type) => type.value === schedule.schedule_type) ? schedule.schedule_type as ScheduleType : 'unclassified',
        is_manual: false,
      })));
      if (schedules.length === 0) setError('사진에서 일정을 찾지 못했습니다. 다른 각도에서 다시 촬영해 주십시오.');
    } catch (analysisError) {
      setError(analysisError instanceof Error ? analysisError.message : '사진을 분석하지 못했습니다.');
    } finally {
      setIsAnalyzing(false);
    }
  };

  const updateDraft = <K extends keyof AnalyzedSchedule>(id: string, key: K, value: AnalyzedSchedule[K]) => {
    setDrafts((current) => current.map((draft) => draft.id === id ? { ...draft, [key]: value } : draft));
  };

  const addManualDraft = () => {
    setDrafts((current) => [...current, {
      id: `manual-${Date.now()}`,
      selected: true,
      title: '',
      date: '',
      start_time: '',
      end_time: '',
      schedule_type: 'unclassified',
      is_urgent: false,
      is_todo: false,
      confidence: 1,
      source_text: '',
      warnings: [],
      original_title: '',
      original_schedule_type: 'unclassified',
      is_manual: true,
    }]);
    setError('');
  };

  const importSelected = async () => {
    const selected = drafts.filter((draft) => draft.selected);
    if (selected.length === 0) {
      setError('등록할 일정을 선택해 주십시오.');
      return;
    }
    if (selected.some((draft) => !draft.title.trim() || !draft.date)) {
      setError('선택한 일정의 제목과 날짜를 모두 입력해 주십시오.');
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

      await onImport(selected.map((draft) => ({
        title: draft.title.trim(),
        date: draft.date,
        start_time: draft.start_time || null,
        end_time: draft.end_time || null,
        schedule_type: draft.schedule_type,
        is_notice: false,
        is_urgent: draft.is_urgent,
        is_completed: false,
        is_todo: draft.is_todo,
      })), corrections);
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
    setError('');
  };

  return (
    <div className="fixed inset-0 z-[250] flex items-center justify-center bg-slate-950/60 p-3 backdrop-blur-sm md:p-6">
      <div className="flex max-h-[94vh] w-full max-w-4xl flex-col overflow-hidden rounded-[30px] bg-white shadow-2xl">
        <div className="flex shrink-0 items-center justify-between border-b border-slate-100 px-5 py-4 md:px-7">
          <div>
            <h2 className="text-lg font-black text-slate-900 md:text-xl">화이트보드 일정 가져오기</h2>
            <p className="mt-1 text-[11px] font-bold text-slate-400">사진을 분석한 뒤 확인한 일정만 등록합니다.</p>
          </div>
          <button onClick={onClose} aria-label="닫기" className="rounded-xl bg-slate-100 p-2 text-slate-500 hover:bg-slate-200"><X size={18} /></button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 custom-scrollbar md:p-7">
          {drafts.length === 0 ? (
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
                    <button onClick={() => cameraInputRef.current?.click()} className="flex items-center justify-center gap-2 rounded-2xl bg-blue-600 px-5 py-3 text-xs font-black text-white shadow-lg hover:bg-blue-700"><Camera size={16} /> 카메라로 촬영</button>
                    <button onClick={() => fileInputRef.current?.click()} className="flex items-center justify-center gap-2 rounded-2xl bg-slate-900 px-5 py-3 text-xs font-black text-white hover:bg-black"><ImagePlus size={16} /> 사진 또는 파일 선택</button>
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
                      <button onClick={removePhoto} className="rounded-xl bg-red-50 p-2 text-red-500 hover:bg-red-100"><Trash2 size={16} /></button>
                    </div>
                    <div className="mt-5 rounded-xl bg-blue-50 p-3 text-[11px] font-bold leading-relaxed text-blue-700">사진은 일정 추출에만 사용되며 Supabase Storage에는 저장하지 않습니다.</div>
                    <button disabled={isAnalyzing} onClick={analyze} className="mt-5 flex items-center justify-center gap-2 rounded-2xl bg-blue-600 py-3.5 text-sm font-black text-white shadow-lg hover:bg-blue-700 disabled:cursor-wait disabled:opacity-60">
                      {isAnalyzing ? <LoaderCircle size={18} className="animate-spin" /> : <ScanText size={18} />}{isAnalyzing ? '사진 분석 중...' : '일정 분석 시작'}
                    </button>
                  </div>
                </div>
              )}
              {isPreparing && <div className="mt-4 flex items-center justify-center gap-2 text-xs font-black text-blue-600"><LoaderCircle size={16} className="animate-spin" /> 사진을 압축하고 있습니다.</div>}
            </>
          ) : (
            <div>
              <div className="mb-4 flex flex-col justify-between gap-3 sm:flex-row sm:items-end">
                <div>
                  <h3 className="text-lg font-black text-slate-900">추출된 일정 확인</h3>
                  <p className="mt-1 text-xs font-bold text-slate-400">틀린 내용과 일정 유형을 수정한 뒤 등록할 항목을 선택해 주십시오.</p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <button onClick={addManualDraft} className="flex items-center gap-1.5 rounded-xl bg-slate-900 px-3 py-2 text-xs font-black text-white hover:bg-black"><Plus size={14} /> 일정 직접 추가</button>
                  <button onClick={removePhoto} className="px-2 py-2 text-left text-xs font-black text-blue-600 sm:text-right">다른 사진 분석</button>
                </div>
              </div>
              <div className="space-y-3">
                {drafts.map((draft) => (
                  <div key={draft.id} className={`rounded-2xl border p-4 transition-colors ${draft.selected ? 'border-blue-200 bg-blue-50/30' : 'border-slate-100 bg-slate-50 opacity-65'}`}>
                    <div className="flex items-start gap-3">
                      <button onClick={() => updateDraft(draft.id, 'selected', !draft.selected)} className={`mt-1 flex h-6 w-6 shrink-0 items-center justify-center rounded-lg border-2 ${draft.selected ? 'border-blue-600 bg-blue-600 text-white' : 'border-slate-300 bg-white text-transparent'}`}><Check size={14} strokeWidth={3} /></button>
                      <div className="grid min-w-0 flex-1 gap-3 md:grid-cols-[140px_1fr]">
                        <select value={draft.schedule_type} onChange={(event) => updateDraft(draft.id, 'schedule_type', event.target.value as ScheduleType)} className="rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-xs font-black text-slate-700 outline-none focus:border-blue-500">
                          {scheduleTypes.map((type) => <option key={type.value} value={type.value}>{type.label}</option>)}
                        </select>
                        <input value={draft.title} onChange={(event) => updateDraft(draft.id, 'title', event.target.value)} placeholder="일정 제목" className="rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-xs font-black text-slate-800 outline-none focus:border-blue-500" />
                        <input type="date" value={draft.date} onChange={(event) => updateDraft(draft.id, 'date', event.target.value)} className="rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-xs font-bold text-slate-700 outline-none focus:border-blue-500" />
                        <div className="grid grid-cols-2 gap-2">
                          <input type="time" value={draft.start_time} onChange={(event) => updateDraft(draft.id, 'start_time', event.target.value)} aria-label="시작 시간" className="min-w-0 rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-xs font-bold text-slate-700 outline-none focus:border-blue-500" />
                          <input type="time" value={draft.end_time} onChange={(event) => updateDraft(draft.id, 'end_time', event.target.value)} aria-label="종료 시간" className="min-w-0 rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-xs font-bold text-slate-700 outline-none focus:border-blue-500" />
                        </div>
                      </div>
                      <button onClick={() => setDrafts((current) => current.filter((item) => item.id !== draft.id))} className="mt-1 shrink-0 text-slate-300 hover:text-red-500"><X size={16} /></button>
                    </div>
                    <div className="mt-3 flex flex-wrap items-center gap-2 pl-9 text-[10px] font-bold">
                      {draft.is_manual
                        ? <span className="rounded-lg bg-blue-50 px-2 py-1 text-blue-600">직접 추가</span>
                        : <span className={`rounded-lg px-2 py-1 ${draft.confidence >= 0.8 ? 'bg-emerald-50 text-emerald-600' : draft.confidence >= 0.55 ? 'bg-amber-50 text-amber-600' : 'bg-red-50 text-red-600'}`}>인식 신뢰도 {Math.round(draft.confidence * 100)}%</span>}
                      <button onClick={() => updateDraft(draft.id, 'is_urgent', !draft.is_urgent)} className={`rounded-lg px-2 py-1 ${draft.is_urgent ? 'bg-red-500 text-white' : 'bg-slate-100 text-slate-500'}`}>긴급 {draft.is_urgent ? '예' : '아니오'}</button>
                      <button onClick={() => updateDraft(draft.id, 'is_todo', !draft.is_todo)} className={`rounded-lg px-2 py-1 ${draft.is_todo ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-500'}`}>TO DO {draft.is_todo ? '예' : '아니오'}</button>
                      {(draft.warnings.length > 0 || !draft.date) && <span className="flex items-center gap-1 text-amber-600"><AlertTriangle size={11} /> {draft.warnings[0] || '날짜를 확인해 주십시오.'}</span>}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
          {error && <p className="mt-4 rounded-xl bg-red-50 px-4 py-3 text-xs font-bold text-red-600">{error}</p>}
        </div>

        {drafts.length > 0 && (
          <div className="flex shrink-0 gap-3 border-t border-slate-100 p-4 md:px-7">
            <button onClick={onClose} className="flex-1 rounded-2xl bg-slate-100 py-3.5 text-sm font-black text-slate-600 hover:bg-slate-200">취소</button>
            <button disabled={isSaving} onClick={importSelected} className="flex flex-1 items-center justify-center gap-2 rounded-2xl bg-blue-600 py-3.5 text-sm font-black text-white shadow-lg hover:bg-blue-700 disabled:cursor-wait disabled:opacity-60">{isSaving && <LoaderCircle size={16} className="animate-spin" />}{isSaving ? '등록 중...' : `선택한 일정 등록 (${drafts.filter((draft) => draft.selected).length})`}</button>
          </div>
        )}
      </div>
    </div>
  );
}
