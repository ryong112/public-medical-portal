'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  CalendarDays,
  FileText,
  FolderOpen,
  MessageCircle,
  Search,
  X,
} from 'lucide-react';

export interface CommandPaletteFile {
  id: number | string;
  name: string;
  category?: string | null;
  created_at?: string | null;
  [key: string]: unknown;
}

export interface CommandPaletteCategory {
  id: number | string;
  name: string;
  [key: string]: unknown;
}

export interface CommandPaletteSchedule {
  id: number | string;
  title: string;
  date?: string | null;
  end_date?: string | null;
  start_time?: string | null;
  schedule_type?: string | null;
  is_notice?: boolean | null;
  created_at?: string | null;
  [key: string]: unknown;
}

export interface CommandPaletteMessage {
  id: number | string;
  content: string;
  created_at?: string | null;
  [key: string]: unknown;
}

interface CommandPaletteProps {
  open: boolean;
  onOpen?: () => void;
  onClose: () => void;
  files: CommandPaletteFile[];
  categories: CommandPaletteCategory[];
  schedules: CommandPaletteSchedule[];
  messages: CommandPaletteMessage[];
  onSelectFile: (file: CommandPaletteFile) => void;
  onSelectCategory: (category: CommandPaletteCategory) => void;
  onSelectSchedule: (schedule: CommandPaletteSchedule) => void;
  onSelectMessage: (message: CommandPaletteMessage) => void;
}

type PaletteResult =
  | { key: string; group: '문서'; title: string; description: string; searchable: string; item: CommandPaletteFile; onSelect: () => void }
  | { key: string; group: '분류'; title: string; description: string; searchable: string; item: CommandPaletteCategory; onSelect: () => void }
  | { key: string; group: '일정'; title: string; description: string; searchable: string; item: CommandPaletteSchedule; onSelect: () => void }
  | { key: string; group: '공유방'; title: string; description: string; searchable: string; item: CommandPaletteMessage; onSelect: () => void };

const groupOrder: PaletteResult['group'][] = ['문서', '분류', '일정', '공유방'];

const normalizeKoreanSearch = (value: string) => value
  .normalize('NFKC')
  .toLocaleLowerCase('ko-KR')
  .replace(/[\s\p{P}\p{S}]+/gu, '');

const matchesQuery = (searchable: string, query: string) => {
  const normalizedQuery = normalizeKoreanSearch(query);
  if (!normalizedQuery) return true;
  const normalizedTarget = normalizeKoreanSearch(searchable);
  const tokens = query.trim().split(/\s+/u).map(normalizeKoreanSearch).filter(Boolean);
  return normalizedTarget.includes(normalizedQuery) || tokens.every((token) => normalizedTarget.includes(token));
};

const formatScheduleDescription = (schedule: CommandPaletteSchedule) => {
  const date = schedule.end_date && schedule.end_date !== schedule.date
    ? `${schedule.date ?? '날짜 미정'} ~ ${schedule.end_date}`
    : schedule.date ?? '날짜 미정';
  const time = schedule.start_time ? ` · ${schedule.start_time}` : '';
  return `${date}${time}${schedule.is_notice ? ' · 공지사항' : ''}`;
};

const formatMessageDescription = (value?: string | null) => {
  if (!value) return '공유방 메시지';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '공유방 메시지';
  return new Intl.DateTimeFormat('ko-KR', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
};

const groupStyle = {
  문서: { icon: FileText, iconClass: 'bg-blue-50 text-blue-600' },
  분류: { icon: FolderOpen, iconClass: 'bg-emerald-50 text-emerald-600' },
  일정: { icon: CalendarDays, iconClass: 'bg-violet-50 text-violet-600' },
  공유방: { icon: MessageCircle, iconClass: 'bg-amber-50 text-amber-600' },
} satisfies Record<PaletteResult['group'], { icon: typeof Search; iconClass: string }>;

export default function CommandPalette({
  open,
  onOpen,
  onClose,
  files,
  categories,
  schedules,
  messages,
  onSelectFile,
  onSelectCategory,
  onSelectSchedule,
  onSelectMessage,
}: CommandPaletteProps) {
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const resultRefs = useRef(new Map<string, HTMLButtonElement>());

  const results = useMemo<PaletteResult[]>(() => {
    const candidates: PaletteResult[] = [
      ...files.map((file): PaletteResult => ({
        key: `file-${file.id}`,
        group: '문서',
        title: file.name,
        description: file.category ? `${file.category} 문서함` : '문서',
        searchable: `${file.name} ${file.category ?? ''}`,
        item: file,
        onSelect: () => onSelectFile(file),
      })),
      ...categories.map((category): PaletteResult => ({
        key: `category-${category.id}`,
        group: '분류',
        title: category.name,
        description: '문서함 분류로 이동',
        searchable: category.name,
        item: category,
        onSelect: () => onSelectCategory(category),
      })),
      ...schedules.map((schedule): PaletteResult => ({
        key: `schedule-${schedule.id}`,
        group: '일정',
        title: schedule.title,
        description: formatScheduleDescription(schedule),
        searchable: `${schedule.title} ${schedule.date ?? ''} ${schedule.end_date ?? ''} ${schedule.schedule_type ?? ''} ${schedule.is_notice ? '공지사항 공지' : ''}`,
        item: schedule,
        onSelect: () => onSelectSchedule(schedule),
      })),
      ...messages.map((message): PaletteResult => ({
        key: `message-${message.id}`,
        group: '공유방',
        title: message.content,
        description: formatMessageDescription(message.created_at),
        searchable: message.content,
        item: message,
        onSelect: () => onSelectMessage(message),
      })),
    ];

    const filtered = candidates.filter((result) => matchesQuery(result.searchable, query));
    return groupOrder.flatMap((group) => filtered.filter((result) => result.group === group).slice(0, query.trim() ? 6 : 3));
  }, [categories, files, messages, onSelectCategory, onSelectFile, onSelectMessage, onSelectSchedule, query, schedules]);

  useEffect(() => {
    const handleGlobalKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLocaleLowerCase() === 'k') {
        event.preventDefault();
        if (open) inputRef.current?.focus();
        else onOpen?.();
        return;
      }
      if (!open) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        setActiveIndex((current) => results.length === 0 ? 0 : (current + 1) % results.length);
        return;
      }
      if (event.key === 'ArrowUp') {
        event.preventDefault();
        setActiveIndex((current) => results.length === 0 ? 0 : (current - 1 + results.length) % results.length);
        return;
      }
      if (event.key === 'Enter' && results[activeIndex]) {
        event.preventDefault();
        results[activeIndex].onSelect();
        onClose();
      }
    };

    window.addEventListener('keydown', handleGlobalKeyDown);
    return () => window.removeEventListener('keydown', handleGlobalKeyDown);
  }, [activeIndex, onClose, onOpen, open, results]);

  useEffect(() => {
    if (!open) return;
    const frame = window.requestAnimationFrame(() => inputRef.current?.focus());
    return () => window.cancelAnimationFrame(frame);
  }, [open]);

  useEffect(() => {
    const activeResult = results[activeIndex];
    if (activeResult) resultRefs.current.get(activeResult.key)?.scrollIntoView({ block: 'nearest' });
  }, [activeIndex, results]);

  if (!open) return null;

  const groupedResults = groupOrder
    .map((group) => ({ group, items: results.filter((result) => result.group === group) }))
    .filter(({ items }) => items.length > 0);

  return (
    <div
      className="fixed inset-0 z-[350] flex items-start justify-center bg-slate-950/55 p-3 pt-[8vh] backdrop-blur-sm sm:p-6 sm:pt-[10vh]"
      onMouseDown={(event) => event.target === event.currentTarget && onClose()}
      role="presentation"
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-label="통합 검색"
        className="flex max-h-[82vh] w-full max-w-2xl flex-col overflow-hidden rounded-[26px] border border-white/70 bg-white shadow-2xl sm:rounded-[32px]"
      >
        <header className="flex items-center gap-3 border-b border-slate-100 px-4 py-4 sm:px-6 sm:py-5">
          <Search className="shrink-0 text-blue-600" size={21} strokeWidth={2.5} />
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setActiveIndex(0);
            }}
            placeholder="문서, 분류, 일정, 공유방 검색"
            aria-label="통합 검색어"
            className="min-w-0 flex-1 bg-transparent text-sm font-bold text-slate-900 outline-none placeholder:text-slate-400 sm:text-base"
          />
          {query && (
            <button onClick={() => { setQuery(''); setActiveIndex(0); }} aria-label="검색어 지우기" className="rounded-lg p-1.5 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700">
              <X size={16} />
            </button>
          )}
          <kbd className="hidden rounded-lg border border-slate-200 bg-slate-50 px-2 py-1 text-[10px] font-black text-slate-400 sm:inline">ESC</kbd>
        </header>

        <div className="custom-scrollbar flex-1 overflow-y-auto px-2 py-3 sm:px-4 sm:py-4">
          {groupedResults.map(({ group, items }) => (
            <div key={group} className="mb-4 last:mb-0">
              <div className="mb-1.5 px-3 text-[10px] font-black uppercase tracking-[0.16em] text-slate-400">{group}</div>
              <div className="space-y-1">
                {items.map((result) => {
                  const resultIndex = results.findIndex((candidate) => candidate.key === result.key);
                  const style = groupStyle[result.group];
                  const Icon = style.icon;
                  return (
                    <button
                      key={result.key}
                      ref={(node) => {
                        if (node) resultRefs.current.set(result.key, node);
                        else resultRefs.current.delete(result.key);
                      }}
                      onMouseEnter={() => setActiveIndex(resultIndex)}
                      onClick={() => {
                        result.onSelect();
                        onClose();
                      }}
                      className={`flex w-full items-center gap-3 rounded-2xl px-3 py-3 text-left transition-all sm:px-4 ${activeIndex === resultIndex ? 'bg-slate-900 text-white shadow-lg' : 'text-slate-900 hover:bg-slate-50'}`}
                    >
                      <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${activeIndex === resultIndex ? 'bg-white/10 text-white' : style.iconClass}`}>
                        <Icon size={18} />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-black">{result.title}</span>
                        <span className={`mt-0.5 block truncate text-[10px] font-bold sm:text-[11px] ${activeIndex === resultIndex ? 'text-slate-300' : 'text-slate-400'}`}>{result.description}</span>
                      </span>
                      <span className={`hidden text-[9px] font-black sm:block ${activeIndex === resultIndex ? 'text-slate-400' : 'text-slate-300'}`}>ENTER</span>
                    </button>
                  );
                })}
              </div>
            </div>
          ))}

          {results.length === 0 && (
            <div className="flex flex-col items-center justify-center px-6 py-16 text-center">
              <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-slate-100 text-slate-400"><Search size={23} /></div>
              <p className="text-sm font-black text-slate-700">검색 결과가 없습니다.</p>
              <p className="mt-1 text-xs font-bold text-slate-400">다른 이름이나 날짜로 검색해 보세요.</p>
            </div>
          )}
        </div>

        <footer className="hidden items-center justify-between border-t border-slate-100 bg-slate-50/80 px-6 py-3 text-[10px] font-bold text-slate-400 sm:flex">
          <span>↑↓ 이동 · Enter 열기 · Esc 닫기</span>
          <span>Ctrl/⌘ + K</span>
        </footer>
      </section>
    </div>
  );
}
