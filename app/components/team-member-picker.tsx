'use client';

import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { Check, ChevronDown, LoaderCircle, Search, X } from 'lucide-react';

export interface TeamMember {
  id: string;
  display_name: string;
  handle: string;
  active?: boolean;
}

export interface TeamMemberPickerProps {
  members: TeamMember[];
  selectedIds: string[];
  onChange: (memberIds: string[]) => void;
  multiple?: boolean;
  label?: string;
  placeholder?: string;
  disabled?: boolean;
  loading?: boolean;
  error?: string | null;
  unavailable?: boolean;
  legacyNames?: string[];
  onRetry?: () => void;
  className?: string;
}

const handleLabel = (member: TeamMember) => `@${member.handle.replace(/^@/u, '')}`;
const normalizeSearch = (value: string) => value.trim().normalize('NFKC').toLocaleLowerCase('ko-KR');
const focusClass = 'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500';

/** Controlled selection always uses stable member IDs, never a name or device ID. */
export default function TeamMemberPicker({
  members,
  selectedIds,
  onChange,
  multiple = true,
  label = '참석 팀원',
  placeholder = '이름 또는 @아이디 검색',
  disabled = false,
  loading = false,
  error = null,
  unavailable = false,
  legacyNames = [],
  onRetry,
  className = '',
}: TeamMemberPickerProps) {
  const id = useId();
  const root = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [activeId, setActiveId] = useState<string | null>(null);
  const locked = disabled || unavailable;
  const selected = [...new Set(selectedIds)];
  const membersById = useMemo(() => new Map(members.map((member) => [member.id, member])), [members]);
  const search = normalizeSearch(query).replace(/^@/u, '');
  const options = useMemo(() => members.filter((member) => member.active !== false && (
    !search || normalizeSearch(member.display_name).includes(search) || normalizeSearch(member.handle).replace(/^@/u, '').includes(search)
  )), [members, search]);
  const activeIndex = Math.max(0, options.findIndex((member) => member.id === activeId));
  const activeMember = options[activeIndex];
  const showOptions = open && !locked;
  const hasStatus = loading || Boolean(error) || unavailable;

  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      if (root.current && !root.current.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', outside);
    return () => document.removeEventListener('pointerdown', outside);
  }, [open]);

  useEffect(() => {
    if (showOptions && activeMember) {
      document.getElementById(`${id}-option-${activeMember.id}`)?.scrollIntoView?.({ block: 'nearest' });
    }
  }, [id, showOptions, activeMember]);

  const remove = (memberId: string) => {
    if (!locked) {
      onChange(selected.filter((value) => value !== memberId));
      input.current?.focus();
    }
  };
  const choose = (member: TeamMember) => {
    if (locked || loading || member.active === false) return;
    onChange(multiple
      ? selected.includes(member.id) ? selected.filter((value) => value !== member.id) : [...selected, member.id]
      : [member.id]);
    setQuery('');
    setActiveId(member.id);
    input.current?.focus();
    if (!multiple) setOpen(false);
  };
  const keyboard = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.nativeEvent.isComposing) return;
    if (event.key === 'Escape' && open) {
      event.preventDefault();
      event.stopPropagation();
      setOpen(false);
      return;
    }
    if (event.key === 'Enter') {
      // The search field must never submit its enclosing schedule/profile form.
      event.preventDefault();
      if (locked || loading) return;
      if (open && activeMember) choose(activeMember);
      else setOpen(true);
      return;
    }
    if (locked || loading) return;
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      setOpen(true);
      if (options.length) {
        const next = open ? (activeIndex + (event.key === 'ArrowDown' ? 1 : -1) + options.length) % options.length : event.key === 'ArrowUp' ? options.length - 1 : 0;
        setActiveId(options[next].id);
      }
    } else if (open && (event.key === 'Home' || event.key === 'End')) {
      event.preventDefault();
      if (options.length) setActiveId(options[event.key === 'Home' ? 0 : options.length - 1].id);
    }
  };

  return <div ref={root} className={`relative min-w-0 ${className}`} onBlur={(event) => {
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOpen(false);
  }}>
    <label htmlFor={`${id}-input`} className="mb-1.5 block text-xs font-semibold text-slate-600">{label}</label>
    {selected.length > 0 && <ul aria-label={`${label} 선택됨`} className="mb-2 flex min-w-0 flex-wrap gap-1.5">
      {selected.map((memberId) => {
        const member = membersById.get(memberId);
        const unavailableMember = !member || member.active === false;
        return <li key={memberId} className={`inline-flex max-w-full items-center gap-1 rounded-lg border py-1 pl-2 text-xs ${unavailableMember ? 'border-amber-200 bg-amber-50 text-amber-800' : 'border-blue-100 bg-blue-50 text-blue-800'}`}>
          <span className="min-w-0 break-all leading-5"><span className="font-semibold">{member?.display_name || '정보를 확인할 수 없는 팀원'}</span>{member && <span className="ml-1 opacity-75">{handleLabel(member)}</span>}{unavailableMember && <span className="ml-1 text-[10px]">{member ? '비활성' : '등록 확인 필요'}</span>}</span>
          <button type="button" disabled={locked} aria-label={`${member ? `${member.display_name} ${handleLabel(member)}` : '등록 확인이 필요한 팀원'} 선택 해제`} onClick={() => remove(memberId)} className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-md hover:bg-black/5 disabled:cursor-not-allowed disabled:opacity-40 ${focusClass}`}><X size={13} aria-hidden="true" /></button>
        </li>;
      })}
    </ul>}
    <div className="relative">
    <div className={`flex min-h-11 min-w-0 items-center rounded-xl border bg-white focus-within:border-blue-500 focus-within:ring-2 focus-within:ring-blue-100 ${locked ? 'bg-slate-100 opacity-70' : ''} ${error ? 'border-amber-300' : 'border-slate-200'}`}>
      {loading ? <LoaderCircle size={15} aria-hidden="true" className="ml-3 shrink-0 animate-spin text-slate-400 motion-reduce:animate-none" /> : <Search size={15} aria-hidden="true" className="ml-3 shrink-0 text-slate-400" />}
      <input
        ref={input}
        id={`${id}-input`}
        type="text"
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={showOptions}
        aria-controls={showOptions ? `${id}-options` : undefined}
        aria-activedescendant={showOptions && !loading && activeMember ? `${id}-option-${activeMember.id}` : undefined}
        aria-describedby={`${id}-help${hasStatus ? ` ${id}-status` : ''}${legacyNames.length ? ` ${id}-legacy` : ''}`}
        aria-busy={loading}
        autoComplete="off"
        disabled={locked}
        placeholder={unavailable ? '팀원 선택 기능 준비 중' : placeholder}
        value={query}
        onFocus={() => setOpen(true)}
        onChange={(event) => { setQuery(event.target.value); setActiveId(null); setOpen(true); }}
        onKeyDown={keyboard}
        className="w-full min-w-0 bg-transparent px-2 py-2.5 text-sm text-slate-800 outline-none placeholder:text-slate-400 disabled:cursor-not-allowed"
      />
      <button type="button" tabIndex={-1} disabled={locked} aria-label={`${label} 목록 ${showOptions ? '닫기' : '열기'}`} onPointerDown={(event) => event.preventDefault()} onClick={() => { input.current?.focus(); setOpen(!showOptions); }} className="flex h-10 w-9 shrink-0 items-center justify-center rounded-r-xl text-slate-400 hover:text-slate-700 disabled:cursor-not-allowed"><ChevronDown size={15} aria-hidden="true" className={showOptions ? 'rotate-180' : ''} /></button>
    </div>
    {showOptions && <div className="absolute inset-x-0 top-full z-[140] mt-1 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-lg">
      <ul id={`${id}-options`} role="listbox" aria-label={`${label} 검색 결과`} aria-multiselectable={multiple} aria-busy={loading} className="max-h-56 overflow-y-auto overscroll-contain p-1">
        {loading ? <li role="presentation" className="px-3 py-4 text-sm text-slate-500">팀원을 불러오는 중입니다.</li> : options.length ? options.map((member, index) => <li key={member.id} role="presentation">
          <button type="button" id={`${id}-option-${member.id}`} role="option" aria-selected={selected.includes(member.id)} tabIndex={-1} onPointerDown={(event) => event.preventDefault()} onPointerMove={() => setActiveId(member.id)} onClick={() => choose(member)} className={`flex min-h-11 w-full min-w-0 items-center gap-2 rounded-lg px-3 py-2 text-left text-sm ${index === activeIndex ? 'bg-blue-50 text-blue-900' : 'text-slate-700 hover:bg-slate-50'}`}>
            <span className="min-w-0 flex-1 break-all"><span className="font-semibold">{member.display_name}</span><span className="ml-1.5 text-xs text-slate-500">{handleLabel(member)}</span></span>
            {selected.includes(member.id) && <Check size={16} aria-hidden="true" className="shrink-0 text-blue-600" />}
          </button>
        </li>) : <li role="presentation" className="px-3 py-4 text-sm leading-relaxed text-slate-500">{error ? '팀원 목록을 불러오지 못했습니다.' : search ? '검색 결과가 없습니다. 이름 또는 @아이디를 확인해 주세요.' : '등록된 팀원이 없습니다.'}</li>}
      </ul>
    </div>}
    </div>
    <p id={`${id}-help`} className="mt-1.5 text-xs leading-relaxed text-slate-500">{multiple ? '선택한 팀원에게만 개인 알림이 전달됩니다.' : '이름이 같아도 @아이디로 구분할 수 있습니다.'}</p>
    <span className="sr-only" aria-live="polite">{selected.length}명 선택됨</span>
    {hasStatus && <p id={`${id}-status`} role={error ? 'alert' : 'status'} className={`mt-1 text-xs leading-relaxed ${error ? 'text-amber-700' : 'text-slate-500'}`}>
      {unavailable ? '팀원 기능 준비 중입니다. 기존 입력 정보는 그대로 유지됩니다.' : loading ? '팀원 목록을 불러오는 중입니다.' : error}
      {error && !loading && !unavailable && onRetry && <button type="button" onClick={onRetry} className={`ml-2 min-h-8 rounded px-1 font-semibold underline underline-offset-2 ${focusClass}`}>다시 시도</button>}
    </p>}
    {legacyNames.length > 0 && <div id={`${id}-legacy`} className="mt-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs leading-relaxed text-slate-600"><span className="font-semibold">기존 직접 입력 이름</span><span className="ml-1 break-all">{legacyNames.join(', ')}</span><p className="mt-0.5 text-slate-500">기존 기록은 유지되며, 이름만으로 팀원을 연결하거나 알림을 보내지 않습니다.</p></div>}
  </div>;
}
