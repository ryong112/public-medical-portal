'use client';

import { useState } from 'react';
import { BellRing, CalendarPlus, Clock3, Siren, X } from 'lucide-react';

export interface NewScheduleInput {
  title: string;
  date: string;
  start_time: string;
  end_time: string;
  is_notice: boolean;
  is_urgent: boolean;
  is_completed: boolean;
}

interface ScheduleFormModalProps {
  date: string;
  onClose: () => void;
  onSubmit: (schedule: NewScheduleInput) => Promise<void>;
}

const addMinutes = (time: string, minutes: number) => {
  const [hour, minute] = time.split(':').map(Number);
  const total = Math.min(hour * 60 + minute + minutes, 23 * 60 + 59);
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
};

const getDefaultTimes = (date: string) => {
  const now = new Date();
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  if (date !== today) return { start: '10:00', end: '11:00' };

  const roundedTotal = Math.min(Math.ceil((now.getHours() * 60 + now.getMinutes() + 1) / 30) * 30, 23 * 60);
  const start = `${String(Math.floor(roundedTotal / 60)).padStart(2, '0')}:${String(roundedTotal % 60).padStart(2, '0')}`;
  return { start, end: addMinutes(start, 60) };
};

export default function ScheduleFormModal({ date, onClose, onSubmit }: ScheduleFormModalProps) {
  const defaults = getDefaultTimes(date);
  const [title, setTitle] = useState('');
  const [startTime, setStartTime] = useState(defaults.start);
  const [endTime, setEndTime] = useState(defaults.end);
  const [isNotice, setIsNotice] = useState(false);
  const [isUrgent, setIsUrgent] = useState(false);
  const [error, setError] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  const applyDuration = (minutes: number) => {
    setEndTime(addMinutes(startTime, minutes));
    setError('');
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!title.trim()) {
      setError('일정 제목을 입력해 주십시오.');
      return;
    }
    if (endTime <= startTime) {
      setError('종료 시간은 시작 시간보다 늦어야 합니다.');
      return;
    }

    setIsSaving(true);
    setError('');
    try {
      await onSubmit({
        title: title.trim(),
        date,
        start_time: startTime,
        end_time: endTime,
        is_notice: isNotice,
        is_urgent: isUrgent,
        is_completed: false,
      });
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : '일정을 등록하지 못했습니다.');
      setIsSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[240] flex items-center justify-center bg-slate-950/55 p-4 backdrop-blur-sm" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <form onSubmit={handleSubmit} className="max-h-[92vh] w-full max-w-lg overflow-y-auto rounded-[30px] bg-white p-6 shadow-2xl md:p-8">
        <div className="mb-7 flex items-start justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-blue-50 text-blue-600">
              <CalendarPlus size={23} />
            </div>
            <div>
              <h2 className="text-xl font-black text-slate-900">일정 추가</h2>
              <p className="mt-1 text-xs font-bold text-slate-400">{date}</p>
            </div>
          </div>
          <button type="button" onClick={onClose} aria-label="닫기" className="rounded-xl bg-slate-100 p-2 text-slate-500 transition-colors hover:bg-slate-200">
            <X size={18} />
          </button>
        </div>

        <label className="block">
          <span className="mb-2 block text-xs font-black text-slate-600">일정 제목</span>
          <input autoFocus value={title} onChange={(event) => setTitle(event.target.value)} placeholder="일정 제목을 입력해 주십시오." className="w-full rounded-2xl border-2 border-slate-100 bg-slate-50 px-4 py-3.5 text-sm font-bold text-slate-900 outline-none transition-all focus:border-blue-500 focus:bg-white" />
        </label>

        <div className="mt-5 rounded-2xl border border-slate-100 bg-slate-50 p-4">
          <div className="mb-3 flex items-center gap-2 text-xs font-black text-slate-600"><Clock3 size={15} /> 일정 시간</div>
          <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3">
            <label>
              <span className="mb-1.5 block text-[10px] font-bold text-slate-400">시작</span>
              <input type="time" value={startTime} onChange={(event) => { setStartTime(event.target.value); setEndTime(addMinutes(event.target.value, 60)); setError(''); }} className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm font-black text-slate-800 outline-none focus:border-blue-500" />
            </label>
            <span className="mt-5 text-slate-300">→</span>
            <label>
              <span className="mb-1.5 block text-[10px] font-bold text-slate-400">종료</span>
              <input type="time" value={endTime} onChange={(event) => { setEndTime(event.target.value); setError(''); }} className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm font-black text-slate-800 outline-none focus:border-blue-500" />
            </label>
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            {[{ label: '30분', minutes: 30 }, { label: '1시간', minutes: 60 }, { label: '2시간', minutes: 120 }, { label: '업무시간', minutes: 480 }].map((duration) => (
              <button key={duration.label} type="button" onClick={() => applyDuration(duration.minutes)} className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-[10px] font-black text-slate-500 transition-colors hover:border-blue-300 hover:text-blue-600">{duration.label}</button>
            ))}
          </div>
        </div>

        <div className="mt-5 rounded-2xl border border-slate-100 p-4">
          <div className="mb-3 flex items-center gap-2 text-xs font-black text-slate-700"><BellRing size={15} className="text-violet-500" /> 이 일정을 공지사항에 추가하시겠습니까?</div>
          <div className="grid grid-cols-2 gap-2">
            <button type="button" onClick={() => setIsNotice(true)} className={`rounded-xl py-2.5 text-xs font-black transition-all ${isNotice ? 'bg-violet-600 text-white shadow-md' : 'bg-slate-100 text-slate-500 hover:bg-slate-200'}`}>네</button>
            <button type="button" onClick={() => setIsNotice(false)} className={`rounded-xl py-2.5 text-xs font-black transition-all ${!isNotice ? 'bg-slate-800 text-white shadow-md' : 'bg-slate-100 text-slate-500 hover:bg-slate-200'}`}>아니오</button>
          </div>
        </div>

        <button type="button" onClick={() => setIsUrgent((current) => !current)} className={`mt-3 flex w-full items-center gap-3 rounded-2xl border p-4 text-left transition-all ${isUrgent ? 'border-red-300 bg-red-50 text-red-700' : 'border-slate-100 bg-white text-slate-600 hover:bg-slate-50'}`}>
          <span className={`flex h-10 w-10 items-center justify-center rounded-xl ${isUrgent ? 'bg-red-500 text-white' : 'bg-slate-100 text-slate-400'}`}><Siren size={19} /></span>
          <span className="flex-1">
            <span className="block text-xs font-black">긴급 일정으로 표시</span>
            <span className="mt-1 block text-[10px] font-bold opacity-60">브리핑과 공지사항에 사이렌 아이콘을 표시합니다.</span>
          </span>
          <span className={`h-5 w-9 rounded-full p-0.5 transition-colors ${isUrgent ? 'bg-red-500' : 'bg-slate-200'}`}><span className={`block h-4 w-4 rounded-full bg-white shadow transition-transform ${isUrgent ? 'translate-x-4' : ''}`} /></span>
        </button>

        {error && <p className="mt-4 rounded-xl bg-red-50 px-4 py-3 text-xs font-bold text-red-600">{error}</p>}

        <div className="mt-7 flex gap-3">
          <button type="button" onClick={onClose} className="flex-1 rounded-2xl bg-slate-100 py-3.5 text-sm font-black text-slate-600 transition-colors hover:bg-slate-200">취소</button>
          <button disabled={isSaving} className="flex-1 rounded-2xl bg-blue-600 py-3.5 text-sm font-black text-white shadow-lg transition-all hover:bg-blue-700 disabled:cursor-wait disabled:opacity-60">{isSaving ? '등록 중...' : '일정 추가'}</button>
        </div>
      </form>
    </div>
  );
}
