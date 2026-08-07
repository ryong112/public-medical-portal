'use client';

import { useEffect, useMemo, useState } from 'react';
import { CalendarClock, ChevronDown, ChevronUp, FileClock, Filter, LoaderCircle, RotateCcw, X } from 'lucide-react';

type ActivityTable = 'schedules' | 'messages' | 'categories' | 'files';
type ActivityAction = 'insert' | 'update' | 'delete';

export interface ActivityLogRow {
  id: number;
  table_name: ActivityTable;
  action: ActivityAction;
  record_id: string | null;
  actor_user_id: string | null;
  actor_device_name: string | null;
  before_data: Record<string, unknown> | null;
  after_data: Record<string, unknown> | null;
  created_at: string;
}

interface ActivityHistoryModalProps {
  logs: ActivityLogRow[];
  onClose: () => void;
  isLoading?: boolean;
  onRestore?: (log: ActivityLogRow) => Promise<void>;
}

const tableLabels: Record<ActivityTable, string> = {
  schedules: '일정',
  messages: '공유방',
  categories: '문서 분류',
  files: '문서',
};

const actionLabels: Record<ActivityAction, string> = {
  insert: '추가',
  update: '변경',
  delete: '삭제',
};

const actionTone: Record<ActivityAction, string> = {
  insert: 'bg-emerald-50 text-emerald-700',
  update: 'bg-blue-50 text-blue-700',
  delete: 'bg-red-50 text-red-600',
};

const seoulDateKey = (value: Date | string) => new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Seoul',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
}).format(typeof value === 'string' ? new Date(value) : value);

const getLogTitle = (log: ActivityLogRow) => {
  const row = log.after_data ?? log.before_data ?? {};
  const value = row.title ?? row.name ?? row.content;
  if (typeof value === 'string' && value.trim()) return value.trim();
  return `${tableLabels[log.table_name]} #${log.record_id ?? '-'}`;
};

const getChangedFields = (log: ActivityLogRow) => {
  if (log.action !== 'update' || !log.before_data || !log.after_data) return [];
  const keys = new Set([...Object.keys(log.before_data), ...Object.keys(log.after_data)]);
  return [...keys].filter((key) => JSON.stringify(log.before_data?.[key]) !== JSON.stringify(log.after_data?.[key]));
};

export default function ActivityHistoryModal({ logs, onClose, isLoading = false, onRestore }: ActivityHistoryModalProps) {
  const [tableFilter, setTableFilter] = useState<'all' | ActivityTable>('all');
  const [actionFilter, setActionFilter] = useState<'all' | ActivityAction>('all');
  const [periodFilter, setPeriodFilter] = useState<'today' | 'all'>('today');
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [restoringId, setRestoringId] = useState<number | null>(null);
  const todayKey = seoulDateKey(new Date());

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.stopPropagation();
      onClose();
    };
    document.addEventListener('keydown', handleKeyDown, true);
    return () => document.removeEventListener('keydown', handleKeyDown, true);
  }, [onClose]);

  const todayLogs = useMemo(
    () => logs.filter((log) => seoulDateKey(log.created_at) === todayKey),
    [logs, todayKey],
  );

  const filteredLogs = useMemo(() => logs
    .filter((log) => periodFilter === 'all' || seoulDateKey(log.created_at) === todayKey)
    .filter((log) => tableFilter === 'all' || log.table_name === tableFilter)
    .filter((log) => actionFilter === 'all' || log.action === actionFilter)
    .sort((left, right) => new Date(right.created_at).getTime() - new Date(left.created_at).getTime()),
  [actionFilter, logs, periodFilter, tableFilter, todayKey]);

  const todayCounts = useMemo(() => ({
    insert: todayLogs.filter((log) => log.action === 'insert').length,
    update: todayLogs.filter((log) => log.action === 'update').length,
    delete: todayLogs.filter((log) => log.action === 'delete').length,
  }), [todayLogs]);

  return (
    <div className="fixed inset-0 z-[310] flex items-center justify-center bg-slate-950/60 p-3 backdrop-blur-sm md:p-6" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className="flex max-h-[92vh] w-full max-w-5xl flex-col overflow-hidden rounded-[30px] bg-white shadow-2xl">
        <header className="flex shrink-0 items-center justify-between border-b border-slate-100 px-5 py-4 md:px-7 md:py-5">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-blue-50 text-blue-600"><FileClock size={21} /></div>
            <div className="min-w-0"><h2 className="text-lg font-black text-slate-900 md:text-xl">변경 이력</h2><p className="mt-0.5 truncate text-[10px] font-bold text-slate-400">일정·문서·분류·공유방의 변경 내용을 확인합니다.</p></div>
          </div>
          <button onClick={onClose} aria-label="닫기" className="rounded-xl bg-slate-100 p-2 text-slate-500 transition-colors hover:bg-slate-200"><X size={18} /></button>
        </header>

        <div className="flex-1 overflow-y-auto p-5 custom-scrollbar md:p-7">
          <section>
            <div className="mb-3 flex items-center gap-2"><CalendarClock size={16} className="text-blue-600" /><h3 className="text-sm font-black text-slate-800">오늘 변경 요약</h3></div>
            <div className="grid grid-cols-3 gap-2 md:gap-3">
              {(['insert', 'update', 'delete'] as ActivityAction[]).map((action) => (
                <div key={action} className="rounded-2xl border border-slate-100 bg-slate-50 px-3 py-3 md:px-5 md:py-4">
                  <span className={`inline-flex rounded-lg px-2 py-1 text-[9px] font-black ${actionTone[action]}`}>{actionLabels[action]}</span>
                  <p className="mt-2 text-xl font-black text-slate-900 md:text-2xl">{todayCounts[action]}<span className="ml-1 text-[10px] text-slate-400">건</span></p>
                </div>
              ))}
            </div>
          </section>

          <section className="mt-5 rounded-2xl border border-slate-100 bg-white p-3 md:p-4">
            <div className="mb-3 flex items-center gap-2 text-xs font-black text-slate-600"><Filter size={14} /> 필터</div>
            <div className="grid gap-2 sm:grid-cols-3">
              <select aria-label="조회 기간" value={periodFilter} onChange={(event) => setPeriodFilter(event.target.value as 'today' | 'all')} className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-xs font-black text-slate-700 outline-none focus:border-blue-400">
                <option value="today">오늘</option><option value="all">전체 기간</option>
              </select>
              <select aria-label="항목 종류" value={tableFilter} onChange={(event) => setTableFilter(event.target.value as 'all' | ActivityTable)} className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-xs font-black text-slate-700 outline-none focus:border-blue-400">
                <option value="all">모든 항목</option>{(Object.keys(tableLabels) as ActivityTable[]).map((table) => <option key={table} value={table}>{tableLabels[table]}</option>)}
              </select>
              <select aria-label="변경 종류" value={actionFilter} onChange={(event) => setActionFilter(event.target.value as 'all' | ActivityAction)} className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-xs font-black text-slate-700 outline-none focus:border-blue-400">
                <option value="all">모든 변경</option>{(Object.keys(actionLabels) as ActivityAction[]).map((action) => <option key={action} value={action}>{actionLabels[action]}</option>)}
              </select>
            </div>
          </section>

          <section className="mt-4 space-y-2">
            {isLoading && <div className="py-14 text-center text-sm font-bold text-slate-400">변경 이력을 불러오고 있습니다.</div>}
            {!isLoading && filteredLogs.length === 0 && <div className="rounded-2xl bg-slate-50 py-14 text-center text-sm font-bold text-slate-400">조건에 맞는 변경 이력이 없습니다.</div>}
            {!isLoading && filteredLogs.map((log) => {
              const isExpanded = expandedId === log.id;
              const changedFields = getChangedFields(log);
              return (
                <article key={log.id} className="overflow-hidden rounded-2xl border border-slate-100 bg-white">
                  <button onClick={() => setExpandedId(isExpanded ? null : log.id)} className="flex w-full items-center gap-3 p-4 text-left transition-colors hover:bg-slate-50">
                    <span className={`shrink-0 rounded-lg px-2.5 py-1.5 text-[9px] font-black ${actionTone[log.action]}`}>{actionLabels[log.action]}</span>
                    <span className="min-w-0 flex-1"><span className="block truncate text-xs font-black text-slate-800 md:text-sm">{getLogTitle(log)}</span><span className="mt-1 block text-[9px] font-bold text-slate-400 md:text-[10px]">{tableLabels[log.table_name]} · {log.actor_device_name ?? '시스템'} · {new Date(log.created_at).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })}</span></span>
                    {changedFields.length > 0 && <span className="hidden shrink-0 text-[9px] font-bold text-slate-400 sm:block">{changedFields.length}개 항목 변경</span>}
                    {isExpanded ? <ChevronUp size={16} className="shrink-0 text-slate-400" /> : <ChevronDown size={16} className="shrink-0 text-slate-400" />}
                  </button>
                  {isExpanded && (
                    <div className="border-t border-slate-100 bg-slate-50/60 p-4">
                      {changedFields.length > 0 && <p className="mb-3 text-[10px] font-bold text-blue-600">변경된 항목: {changedFields.join(', ')}</p>}
                      {onRestore && (log.table_name === 'schedules' || log.table_name === 'messages') && log.action !== 'insert' && log.before_data && (
                        <div className="mb-3 flex justify-end">
                          <button
                            disabled={restoringId !== null}
                            onClick={async () => {
                              if (!confirm(log.action === 'delete' ? '삭제된 항목을 복원하시겠습니까?' : '이 항목을 변경 전 상태로 되돌리시겠습니까?')) return;
                              setRestoringId(log.id);
                              try { await onRestore(log); } finally { setRestoringId(null); }
                            }}
                            className="flex items-center gap-1.5 rounded-xl bg-blue-600 px-3 py-2 text-[10px] font-black text-white transition-colors hover:bg-blue-700 disabled:opacity-50"
                          >{restoringId === log.id ? <LoaderCircle size={13} className="animate-spin" /> : <RotateCcw size={13} />} {log.action === 'delete' ? '삭제 복원' : '변경 전으로 복원'}</button>
                        </div>
                      )}
                      <div className="grid gap-3 md:grid-cols-2">
                        <div><p className="mb-2 text-[10px] font-black text-slate-500">변경 전</p><pre className="max-h-72 overflow-auto whitespace-pre-wrap break-all rounded-xl bg-slate-900 p-3 text-[10px] leading-relaxed text-slate-200 custom-scrollbar">{log.before_data ? JSON.stringify(log.before_data, null, 2) : '없음'}</pre></div>
                        <div><p className="mb-2 text-[10px] font-black text-slate-500">변경 후</p><pre className="max-h-72 overflow-auto whitespace-pre-wrap break-all rounded-xl bg-slate-900 p-3 text-[10px] leading-relaxed text-slate-200 custom-scrollbar">{log.after_data ? JSON.stringify(log.after_data, null, 2) : '없음'}</pre></div>
                      </div>
                    </div>
                  )}
                </article>
              );
            })}
          </section>
        </div>
      </section>
    </div>
  );
}
