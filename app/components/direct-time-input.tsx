'use client';

import { useState } from 'react';
import { Clock3 } from 'lucide-react';

interface DirectTimeInputProps {
  label: string;
  value: string;
  disabled?: boolean;
  minimumTime?: string;
  durationFrom?: string;
  onChange: (value: string) => void;
}

const toMinutes = (time: string) => {
  const [hour, minute] = time.split(':').map(Number);
  return hour * 60 + minute;
};

const parseDirectTime = (input: string) => {
  const normalized = input.trim().replace(/\s+/gu, '');
  const colonMatch = normalized.match(/^(\d{1,2}):(\d{1,2})$/u);
  let hour: number;
  let minute: number;

  if (colonMatch) {
    hour = Number(colonMatch[1]);
    minute = Number(colonMatch[2]);
  } else {
    const digits = normalized.replace(/\D/gu, '');
    if (digits.length < 1 || digits.length > 4) return null;
    if (digits.length <= 2) {
      hour = Number(digits);
      minute = 0;
    } else {
      hour = Number(digits.slice(0, -2));
      minute = Number(digits.slice(-2));
    }
  }

  if (!Number.isInteger(hour) || !Number.isInteger(minute) || hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
};

const formatDuration = (minutes: number) => {
  if (minutes <= 0) return '';
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  if (hours === 0) return `${remainder}분`;
  if (remainder === 0) return `${hours}시간`;
  return `${hours}시간 ${remainder}분`;
};

export default function DirectTimeInput({
  label,
  value,
  disabled = false,
  minimumTime,
  durationFrom,
  onChange,
}: DirectTimeInputProps) {
  const [draft, setDraft] = useState(value);
  const [isEditing, setIsEditing] = useState(false);
  const [error, setError] = useState('');

  const commit = () => {
    if (disabled) return;
    const parsed = parseDirectTime(draft);
    if (!parsed) {
      setDraft(value);
      setIsEditing(false);
      setError('예: 930 또는 14:20');
      return;
    }
    if (minimumTime && toMinutes(parsed) <= toMinutes(minimumTime)) {
      setDraft(value);
      setIsEditing(false);
      setError('시작 시간 이후로 입력해 주세요.');
      return;
    }
    setDraft(parsed);
    setIsEditing(false);
    setError('');
    if (parsed !== value) onChange(parsed);
  };

  const hour = /^\d{2}:\d{2}$/u.test(value) ? Number(value.slice(0, 2)) : null;
  const period = hour === null ? '' : hour < 12 ? '오전' : '오후';
  const duration = durationFrom && /^\d{2}:\d{2}$/u.test(value)
    ? formatDuration(toMinutes(value) - toMinutes(durationFrom))
    : '';

  return (
    <label className="block min-w-0">
      <span className="mb-1.5 flex items-center justify-between gap-2 text-[10px] font-bold text-slate-400">
        <span>{label}</span>
        {!disabled && duration && <span className="font-black text-blue-500">{duration}</span>}
      </span>
      <span className={`flex min-h-11 items-center rounded-xl border bg-white transition-colors focus-within:ring-2 ${
        error ? 'border-red-300 focus-within:border-red-500 focus-within:ring-red-100' : 'border-slate-200 focus-within:border-blue-500 focus-within:ring-blue-100'
      } ${disabled ? 'cursor-not-allowed bg-slate-100' : ''}`}>
        <Clock3 size={14} className={`ml-3 shrink-0 ${disabled ? 'text-slate-300' : 'text-blue-500'}`} />
        <input
          type="text"
          inputMode="numeric"
          disabled={disabled}
          value={disabled ? '' : isEditing ? draft : value}
          placeholder={disabled ? '선택 안 함' : '예: 1030'}
          aria-label={`${label} 시간 직접 입력`}
          onFocus={(event) => {
            setDraft(value);
            setIsEditing(true);
            setError('');
            event.currentTarget.select();
          }}
          onChange={(event) => {
            setDraft(event.target.value);
            setError('');
          }}
          onBlur={commit}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              event.currentTarget.blur();
            }
            if (event.key === 'Escape') {
              setDraft(value);
              setIsEditing(false);
              setError('');
              event.currentTarget.blur();
            }
          }}
          className="min-w-0 flex-1 bg-transparent px-2 py-2.5 text-sm font-black text-slate-800 outline-none placeholder:text-slate-300 disabled:cursor-not-allowed"
        />
        {!disabled && period && <span className="mr-2.5 shrink-0 rounded-lg bg-blue-50 px-2 py-1 text-[10px] font-black text-blue-600">{period}</span>}
      </span>
      {error && <span className="mt-1 block text-[9px] font-bold text-red-500">{error}</span>}
    </label>
  );
}
