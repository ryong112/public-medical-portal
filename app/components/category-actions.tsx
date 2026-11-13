'use client';

import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { LoaderCircle, MoreHorizontal, Pencil, Trash2, X } from 'lucide-react';
import { useDocumentDialog } from './document-library';

interface CategoryActionsProps {
  name: string;
  onRename: (name: string) => Promise<void>;
  onDelete: () => void;
}

function RenameCategoryDialog({ name, onRename, onClose }: Omit<CategoryActionsProps, 'onDelete'> & { onClose: () => void }) {
  const [value, setValue] = useState(name);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const saving = useRef(false);
  const input = useRef<HTMLInputElement>(null);
  const dialog = useDocumentDialog(onClose, busy);
  const id = useId();

  useEffect(() => { input.current?.focus(); input.current?.select(); }, []);

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (saving.current) return;
    if (!value.trim()) { setError('분류 이름을 입력해 주세요.'); input.current?.focus(); return; }
    saving.current = true;
    setBusy(true);
    setError('');
    try { await onRename(value); onClose(); }
    catch (failure) { setError(failure instanceof Error ? failure.message : '이름을 변경하지 못했습니다. 다시 시도해 주세요.'); }
    finally { saving.current = false; setBusy(false); }
  };

  return <div className="fixed inset-0 z-[310] flex items-center justify-center bg-slate-950/50 p-4 backdrop-blur-sm" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) onClose(); }}>
    <section ref={dialog} role="dialog" aria-modal="true" aria-labelledby={`${id}-title`} aria-busy={busy} tabIndex={-1} className="w-full max-w-sm rounded-2xl border border-slate-200 bg-white p-5 text-slate-900 shadow-2xl outline-none">
      <header className="mb-5 flex items-center justify-between gap-3"><h2 id={`${id}-title`} className="text-lg font-bold">분류 이름 변경</h2><button type="button" disabled={busy} onClick={onClose} aria-label="분류 이름 변경 닫기" className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 disabled:opacity-40"><X size={18} /></button></header>
      <form onSubmit={(event) => void submit(event)}>
        <label htmlFor={`${id}-name`} className="mb-2 block text-sm font-semibold text-slate-700">분류 이름</label>
        <input ref={input} id={`${id}-name`} value={value} disabled={busy} maxLength={200} autoComplete="off" onChange={(event) => { setValue(event.target.value); setError(''); }} className="min-h-11 w-full rounded-xl border border-slate-300 px-3 text-base text-slate-900 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100" />
        {error && <p role="alert" className="mt-3 rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}
        <footer className="mt-5 flex justify-end gap-2"><button type="button" disabled={busy} onClick={onClose} className="min-h-10 rounded-lg bg-slate-100 px-4 text-sm font-semibold text-slate-600 disabled:opacity-40">취소</button><button type="submit" disabled={busy} className="flex min-h-10 items-center gap-2 rounded-lg bg-blue-600 px-4 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50">{busy && <LoaderCircle size={15} className="animate-spin" />}{busy ? '저장 중…' : '저장'}</button></footer>
      </form>
    </section>
  </div>;
}

export default function CategoryActions({ name, onRename, onDelete }: CategoryActionsProps) {
  const [open, setOpen] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [position, setPosition] = useState({ left: 0, top: 0 });
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const anchorPosition = useRef<{ top: number; left: number } | null>(null);
  const initialFocus = useRef<'first' | 'last'>('first');
  const id = useId();
  const closeMenu = (restoreFocus = false) => { setOpen(false); if (restoreFocus) trigger.current?.focus({ preventScroll: true }); };

  useLayoutEffect(() => {
    if (!open || !trigger.current || !menu.current) return;
    const anchor = trigger.current.getBoundingClientRect();
    anchorPosition.current = { top: anchor.top, left: anchor.left };
    const bounds = menu.current.getBoundingClientRect();
    setPosition({
      left: Math.max(8, Math.min(anchor.right - bounds.width, window.innerWidth - bounds.width - 8)),
      top: Math.max(8, anchor.bottom + 4 + bounds.height <= window.innerHeight - 8 ? anchor.bottom + 4 : anchor.top - bounds.height - 4),
    });
    const items = menu.current.querySelectorAll<HTMLButtonElement>('[role="menuitem"]');
    items[initialFocus.current === 'last' ? items.length - 1 : 0]?.focus({ preventScroll: true });
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!trigger.current?.contains(target) && !menu.current?.contains(target)) setOpen(false);
    };
    const dismiss = () => setOpen(false);
    const scroll = (event: Event) => {
      if (menu.current?.contains(event.target as Node) || !trigger.current || !anchorPosition.current) return;
      const current = trigger.current.getBoundingClientRect();
      // A queued scroll event may arrive just after the menu opens. Dismiss only
      // when its source really moved, not when unrelated content scrolls.
      if (Math.abs(current.top - anchorPosition.current.top) > 1 || Math.abs(current.left - anchorPosition.current.left) > 1) dismiss();
    };
    document.addEventListener('pointerdown', outside, true);
    document.addEventListener('scroll', scroll, true);
    window.addEventListener('resize', dismiss);
    return () => { document.removeEventListener('pointerdown', outside, true); document.removeEventListener('scroll', scroll, true); window.removeEventListener('resize', dismiss); };
  }, [open]);

  return <div className="shrink-0" data-category-actions>
    <button ref={trigger} id={`${id}-trigger`} type="button" draggable={false} aria-label={`${name} 분류 메뉴`} aria-haspopup="menu" aria-expanded={open} aria-controls={open ? `${id}-menu` : undefined} title="분류 메뉴" onDragStart={(event) => { event.preventDefault(); event.stopPropagation(); }} onClick={() => { initialFocus.current = 'first'; setOpen((value) => !value); }} onKeyDown={(event) => {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); initialFocus.current = event.key === 'ArrowUp' ? 'last' : 'first'; setOpen(true); }
      if (event.key === 'Escape') closeMenu(true);
    }} className={`flex h-9 w-8 items-center justify-center rounded-lg text-slate-500 transition-colors hover:bg-slate-200 hover:text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 ${open ? 'bg-white text-slate-900 shadow-sm' : ''}`}><MoreHorizontal size={17} /></button>
    {open && createPortal(<div ref={menu} id={`${id}-menu`} role="menu" aria-label={`${name} 분류 메뉴`} aria-labelledby={`${id}-trigger`} style={{ left: position.left, top: position.top }} className="fixed z-[100] w-44 max-w-[calc(100vw-1rem)] rounded-xl border border-slate-200 bg-white p-1.5 text-slate-800 shadow-xl" onKeyDown={(event) => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); closeMenu(true); }
      else if (event.key === 'Tab') { closeMenu(true); }
      else if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
        event.preventDefault();
        const items = Array.from(menu.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') ?? []);
        const current = items.indexOf(document.activeElement as HTMLButtonElement);
        const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : (current + (event.key === 'ArrowUp' ? -1 : 1) + items.length) % items.length;
        items[next]?.focus();
      }
    }}>
      <button type="button" role="menuitem" tabIndex={-1} onClick={() => { closeMenu(true); setRenaming(true); }} className="flex min-h-10 w-full items-center gap-2.5 rounded-lg px-3 text-left text-sm font-semibold hover:bg-slate-100 focus:bg-slate-100 focus:outline-none"><Pencil size={15} />이름 변경</button>
      <div role="separator" className="my-1 border-t border-slate-100" />
      <button type="button" role="menuitem" tabIndex={-1} onClick={() => { closeMenu(true); onDelete(); }} className="flex min-h-10 w-full items-center gap-2.5 rounded-lg px-3 text-left text-sm font-semibold text-red-600 hover:bg-red-50 focus:bg-red-50 focus:outline-none"><Trash2 size={15} />삭제</button>
    </div>, document.body)}
    {renaming && createPortal(<RenameCategoryDialog name={name} onRename={onRename} onClose={() => setRenaming(false)} />, document.body)}
  </div>;
}
