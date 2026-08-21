'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, ChevronDown, Clock3 } from 'lucide-react';

interface TimeListPickerProps {
  label: string;
  value: string;
  disabled?: boolean;
  minimumTime?: string;
  durationFrom?: string;
  align?: 'left' | 'right';
  onChange: (value: string) => void;
}

const toMinutes = (time: string) => {
  const [hour, minute] = time.split(':').map(Number);
  return hour * 60 + minute;
};

const formatTime = (time: string) => {
  if (!/^\d{2}:\d{2}$/u.test(time)) return '시간 선택';
  const [hour, minute] = time.split(':').map(Number);
  const period = hour < 12 ? '오전' : '오후';
  const displayHour = hour % 12 || 12;
  return `${period} ${displayHour}:${String(minute).padStart(2, '0')}`;
};

const formatDuration = (minutes: number) => {
  if (minutes <= 0) return '';
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  if (hours === 0) return `${remainder}분`;
  if (remainder === 0) return `${hours}시간`;
  return `${hours}시간 ${remainder}분`;
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

const timeOptions = Array.from({ length: 48 }, (_, index) => {
  const hour = Math.floor(index / 2);
  const minute = index % 2 === 0 ? 0 : 30;
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
});

export default function TimeListPicker({
  label,
  value,
  disabled = false,
  minimumTime,
  durationFrom,
  align = 'left',
  onChange,
}: TimeListPickerProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [directValue, setDirectValue] = useState('');
  const [directError, setDirectError] = useState('');
  const rootRef = useRef<HTMLDivElement>(null);
  const selectedRef = useRef<HTMLButtonElement>(null);

  const options = useMemo(() => {
    if (!minimumTime) return timeOptions;
    const minimum = toMinutes(minimumTime);
    return timeOptions.filter((time) => toMinutes(time) > minimum);
  }, [minimumTime]);

  useEffect(() => {
    if (!isOpen) return;
    const closeOnOutsidePress = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setIsOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setIsOpen(false);
    };
    document.addEventListener('pointerdown', closeOnOutsidePress);
    document.addEventListener('keydown', closeOnEscape);
    const frame = window.requestAnimationFrame(() => selectedRef.current?.scrollIntoView({ block: 'center' }));
    return () => {
      document.removeEventListener('pointerdown', closeOnOutsidePress);
      document.removeEventListener('keydown', closeOnEscape);
      window.cancelAnimationFrame(frame);
    };
  }, [isOpen]);

  const applyDirectTime = () => {
    const parsed = parseDirectTime(directValue);
    if (!parsed) {
      setDirectError('예: 930 또는 14:20');
      return;
    }
    if (minimumTime && toMinutes(parsed) <= toMinutes(minimumTime)) {
      setDirectError(`${formatTime(minimumTime)} 이후로 입력해 주세요.`);
      return;
    }
    onChange(parsed);
    setDirectValue('');
    setDirectError('');
    setIsOpen(false);
  };

  return (
    <div ref={rootRef} className="relative min-w-0">
      <span className="mb-1.5 block text-[10px] font-bold text-slate-400">{label}</span>
      <button
        type="button"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        onClick={() => {
          setDirectError('');
          setIsOpen((current) => !current);
        }}
        className="flex w-full items-center justify-between gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-left text-sm font-black text-slate-800 outline-none transition-colors hover:border-blue-300 focus-visible:border-blue-500 focus-visible:ring-2 focus-visible:ring-blue-100 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-300"
      >
        <span className="flex min-w-0 items-center gap-2 truncate"><Clock3 size={14} className="shrink-0 text-blue-500" />{disabled ? '선택 안 함' : formatTime(value)}</span>
        <ChevronDown size={14} className={`shrink-0 text-slate-400 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
      </button>

      {isOpen && !disabled && (
        <div className={`absolute top-full z-[80] mt-2 w-[260px] overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl ${align === 'right' ? 'right-0' : 'left-0'}`}>
          <div
            className="border-b border-slate-100 bg-slate-50 p-2.5"
          >
            <div className="flex gap-2">
              <input
                autoFocus
                inputMode="numeric"
                value={directValue}
                onChange={(event) => {
                  setDirectValue(event.target.value);
                  setDirectError('');
                }}
                onKeyDown={(event) => {
                  if (event.key !== 'Enter') return;
                  event.preventDefault();
                  applyDirectTime();
                }}
                placeholder="직접 입력  예: 1030"
                aria-label={`${label} 직접 입력`}
                className="min-w-0 flex-1 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-black text-slate-800 outline-none focus:border-blue-500"
              />
              <button type="button" onClick={applyDirectTime} className="rounded-xl bg-slate-900 px-3 text-[10px] font-black text-white">적용</button>
            </div>
            {directError && <p className="mt-1.5 px-1 text-[10px] font-bold text-red-500">{directError}</p>}
          </div>

          <div role="listbox" aria-label={`${label} 선택`} className="max-h-64 overflow-y-auto p-1.5">
            {options.map((time) => {
              const selected = time === value;
              const duration = durationFrom ? formatDuration(toMinutes(time) - toMinutes(durationFrom)) : '';
              return (
                <button
                  key={time}
                  ref={selected ? selectedRef : undefined}
                  type="button"
                  role="option"
                  aria-selected={selected}
                  onClick={() => {
                    onChange(time);
                    setIsOpen(false);
                  }}
                  className={`flex w-full items-center justify-between rounded-xl px-3 py-2.5 text-left transition-colors ${selected ? 'bg-blue-600 text-white' : 'text-slate-700 hover:bg-blue-50'}`}
                >
                  <span className="text-xs font-black">{formatTime(time)}</span>
                  <span className={`flex items-center gap-1.5 text-[10px] font-bold ${selected ? 'text-blue-100' : 'text-slate-400'}`}>
                    {duration}{selected && <Check size={13} strokeWidth={3} />}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
