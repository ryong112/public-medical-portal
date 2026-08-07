'use client';

import { useCallback, useEffect, useState } from 'react';
import { Check, LoaderCircle, RefreshCw, ShieldCheck, ShieldOff, Smartphone, X } from 'lucide-react';
import { supabase } from '@/lib/supabase';

interface DeviceAccessRow {
  user_id: string;
  device_name: string;
  status: 'pending' | 'approved' | 'blocked';
  is_admin: boolean;
  requested_at: string;
  approved_at: string | null;
  last_seen_at: string;
}

interface DeviceManagerModalProps {
  onClose: () => void;
}

const statusLabel = { pending: '승인 대기', approved: '승인됨', blocked: '차단됨' } as const;

export default function DeviceManagerModal({ onClose }: DeviceManagerModalProps) {
  const [devices, setDevices] = useState<DeviceAccessRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [workingId, setWorkingId] = useState<string | null>(null);
  const [error, setError] = useState('');

  const loadDevices = useCallback(async () => {
    setError('');
    const { data, error: loadError } = await supabase.rpc('list_device_access');
    if (loadError) setError(loadError.message);
    else setDevices((data ?? []) as DeviceAccessRow[]);
    setIsLoading(false);
  }, []);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => void loadDevices());
    const interval = window.setInterval(() => void loadDevices(), 10000);
    return () => {
      window.cancelAnimationFrame(frame);
      window.clearInterval(interval);
    };
  }, [loadDevices]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.stopPropagation();
      onClose();
    };
    document.addEventListener('keydown', handleKeyDown, true);
    return () => document.removeEventListener('keydown', handleKeyDown, true);
  }, [onClose]);

  const updateDevice = async (device: DeviceAccessRow, status: DeviceAccessRow['status'], isAdmin: boolean | null = null) => {
    if (status === 'blocked' && !window.confirm(`'${device.device_name}' 기기를 차단하시겠습니까?`)) return;
    setWorkingId(device.user_id);
    setError('');
    const { error: updateError } = await supabase.rpc('set_device_access', {
      p_user_id: device.user_id,
      p_status: status,
      p_is_admin: isAdmin,
    });
    if (updateError) setError(updateError.message);
    await loadDevices();
    setWorkingId(null);
  };

  return (
    <div className="fixed inset-0 z-[300] flex items-center justify-center bg-slate-950/60 p-4 backdrop-blur-sm" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className="flex max-h-[88vh] w-full max-w-2xl flex-col overflow-hidden rounded-[30px] bg-white shadow-2xl">
        <header className="flex items-center justify-between border-b border-slate-100 px-6 py-5">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-blue-50 text-blue-600"><ShieldCheck size={21} /></div>
            <div><h2 className="text-lg font-black text-slate-900">승인 기기 관리</h2><p className="mt-0.5 text-[10px] font-bold text-slate-400">기기 승인과 차단은 즉시 반영됩니다.</p></div>
          </div>
          <div className="flex gap-2"><button onClick={() => void loadDevices()} aria-label="새로고침" className="rounded-xl bg-slate-100 p-2 text-slate-500"><RefreshCw size={17} /></button><button onClick={onClose} aria-label="닫기" className="rounded-xl bg-slate-100 p-2 text-slate-500"><X size={17} /></button></div>
        </header>

        <div className="flex-1 space-y-3 overflow-y-auto p-5 custom-scrollbar sm:p-6">
          {isLoading && <div className="flex justify-center py-14"><LoaderCircle className="animate-spin text-blue-600" /></div>}
          {!isLoading && devices.length === 0 && <div className="py-14 text-center text-sm font-bold text-slate-400">등록된 기기가 없습니다.</div>}
          {devices.map((device) => (
            <article key={device.user_id} className="rounded-2xl border border-slate-100 p-4">
              <div className="flex items-start gap-3">
                <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${device.status === 'approved' ? 'bg-emerald-50 text-emerald-600' : device.status === 'blocked' ? 'bg-red-50 text-red-500' : 'bg-amber-50 text-amber-500'}`}><Smartphone size={18} /></div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2"><h3 className="truncate text-sm font-black text-slate-800">{device.device_name}</h3>{device.is_admin && <span className="rounded-md bg-blue-50 px-2 py-1 text-[9px] font-black text-blue-600">관리자</span>}<span className={`rounded-md px-2 py-1 text-[9px] font-black ${device.status === 'approved' ? 'bg-emerald-50 text-emerald-600' : device.status === 'blocked' ? 'bg-red-50 text-red-500' : 'bg-amber-50 text-amber-600'}`}>{statusLabel[device.status]}</span></div>
                  <p className="mt-1 font-mono text-[10px] font-bold text-slate-400">{device.user_id.slice(0, 8)} · 마지막 확인 {new Date(device.last_seen_at).toLocaleString('ko-KR')}</p>
                </div>
              </div>
              <div className="mt-4 flex flex-wrap justify-end gap-2">
                {device.status !== 'approved' && <button disabled={workingId === device.user_id} onClick={() => void updateDevice(device, 'approved', false)} className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-500 px-3 py-2 text-[10px] font-black text-white"><Check size={13} /> 승인</button>}
                {device.status === 'approved' && <button disabled={workingId === device.user_id} onClick={() => void updateDevice(device, 'approved', !device.is_admin)} className="rounded-xl bg-blue-50 px-3 py-2 text-[10px] font-black text-blue-600">{device.is_admin ? '관리자 해제' : '관리자 지정'}</button>}
                {device.status !== 'blocked' && <button disabled={workingId === device.user_id} onClick={() => void updateDevice(device, 'blocked', false)} className="inline-flex items-center gap-1.5 rounded-xl bg-red-50 px-3 py-2 text-[10px] font-black text-red-500"><ShieldOff size={13} /> 차단</button>}
              </div>
            </article>
          ))}
          {error && <div className="rounded-xl bg-red-50 px-4 py-3 text-xs font-bold text-red-600">{error}</div>}
        </div>
      </section>
    </div>
  );
}
