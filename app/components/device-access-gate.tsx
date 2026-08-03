'use client';

import { useCallback, useEffect, useState } from 'react';
import { CheckCircle2, Clock3, Laptop, LoaderCircle, RefreshCw, ShieldAlert, Smartphone } from 'lucide-react';
import { supabase } from '@/lib/supabase';

type DeviceStatus = 'checking' | 'unregistered' | 'pending' | 'approved' | 'blocked' | 'error';

interface DeviceAccessInfo {
  status: Exclude<DeviceStatus, 'checking' | 'error'>;
  user_id: string;
  device_name?: string;
  is_admin: boolean;
}

interface DeviceAccessGateProps {
  onApproved: (access: { userId: string; isAdmin: boolean }) => void;
}

export default function DeviceAccessGate({ onApproved }: DeviceAccessGateProps) {
  const [status, setStatus] = useState<DeviceStatus>('checking');
  const [accessInfo, setAccessInfo] = useState<DeviceAccessInfo | null>(null);
  const [deviceName, setDeviceName] = useState('');
  const [isRequesting, setIsRequesting] = useState(false);
  const [error, setError] = useState('');

  const checkAccess = useCallback(async () => {
    setError('');
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      let session = sessionData.session;
      if (!session) {
        const { data, error: signInError } = await supabase.auth.signInAnonymously();
        if (signInError) throw signInError;
        session = data.session;
      }
      if (!session) throw new Error('기기 인증 정보를 만들지 못했습니다.');

      const { data, error: statusError } = await supabase.rpc('get_device_access_status');
      if (statusError) throw statusError;
      const nextAccess = data as DeviceAccessInfo;
      setAccessInfo(nextAccess);
      setStatus(nextAccess.status);
      if (nextAccess.device_name) setDeviceName(nextAccess.device_name);
      if (nextAccess.status === 'approved') onApproved({ userId: nextAccess.user_id, isAdmin: nextAccess.is_admin });
    } catch (accessError) {
      const message = accessError instanceof Error ? accessError.message : '기기 인증을 확인하지 못했습니다.';
      setError(message.includes('Anonymous sign-ins are disabled')
        ? 'Supabase에서 익명 로그인을 먼저 활성화해야 합니다.'
        : message);
      setStatus('error');
    }
  }, [onApproved]);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => void checkAccess());
    return () => window.cancelAnimationFrame(frame);
  }, [checkAccess]);

  useEffect(() => {
    if (status !== 'pending') return;
    const interval = window.setInterval(() => void checkAccess(), 5000);
    return () => window.clearInterval(interval);
  }, [checkAccess, status]);

  const requestAccess = async () => {
    if (deviceName.trim().length < 2) {
      setError('승인할 수 있도록 성함과 사용 기기를 입력해 주십시오.');
      return;
    }
    setIsRequesting(true);
    setError('');
    const { data, error: requestError } = await supabase.rpc('request_device_access', { p_device_name: deviceName.trim() });
    setIsRequesting(false);
    if (requestError) {
      setError(requestError.message);
      return;
    }
    const nextAccess = data as DeviceAccessInfo;
    setAccessInfo(nextAccess);
    setStatus(nextAccess.status);
  };

  const icon = /iPhone|iPad|Android/i.test(deviceName) ? <Smartphone size={30} /> : <Laptop size={30} />;

  return (
    <main className="flex min-h-dvh items-center justify-center bg-slate-950 p-5 text-slate-900">
      <section className="w-full max-w-md rounded-[32px] bg-white p-7 shadow-2xl sm:p-9">
        <div className="mb-7 flex items-center gap-4">
          <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-blue-50 text-blue-600">{icon}</div>
          <div>
            <p className="text-[10px] font-black uppercase tracking-[0.18em] text-blue-600">Device Access</p>
            <h1 className="mt-1 text-xl font-black text-slate-900">공공의료지원과 기기 승인</h1>
          </div>
        </div>

        {status === 'checking' && (
          <div className="flex flex-col items-center rounded-2xl bg-slate-50 py-10 text-slate-500">
            <LoaderCircle className="animate-spin text-blue-600" size={28} />
            <p className="mt-4 text-sm font-black">이 기기의 승인 상태를 확인하고 있습니다.</p>
          </div>
        )}

        {status === 'unregistered' && (
          <div>
            <p className="mb-5 text-sm font-bold leading-6 text-slate-500">회원가입 없이 이 브라우저만 승인받습니다. 관리자가 확인할 수 있도록 성함과 사용 기기를 함께 입력해 주십시오. 한 번 승인되면 관리자가 차단하기 전까지 계속 이용할 수 있습니다.</p>
            <label className="block">
              <span className="mb-2 block text-xs font-black text-slate-600">성함 · 사용 기기</span>
              <input value={deviceName} onChange={(event) => setDeviceName(event.target.value)} maxLength={80} placeholder="예: 홍길동 사내 PC / 홍길동 iPhone" autoComplete="name" className="w-full rounded-2xl border-2 border-slate-100 bg-slate-50 px-4 py-3.5 text-sm font-bold outline-none transition-colors focus:border-blue-500 focus:bg-white" />
            </label>
            <button onClick={requestAccess} disabled={isRequesting} className="mt-4 flex w-full items-center justify-center gap-2 rounded-2xl bg-blue-600 py-4 text-sm font-black text-white shadow-lg transition-colors hover:bg-blue-700 disabled:opacity-60">
              {isRequesting ? <LoaderCircle className="animate-spin" size={17} /> : <ShieldAlert size={17} />} 승인 요청
            </button>
          </div>
        )}

        {status === 'pending' && (
          <div className="text-center">
            <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-amber-50 text-amber-500"><Clock3 size={30} /></div>
            <h2 className="mt-5 text-lg font-black">관리자 승인을 기다리고 있습니다.</h2>
            <p className="mt-2 text-sm font-bold text-slate-400">{accessInfo?.device_name ?? deviceName}</p>
            {accessInfo?.user_id && <p className="mt-4 rounded-xl bg-slate-50 px-3 py-2 font-mono text-[11px] font-bold text-slate-500">요청 번호 {accessInfo.user_id.slice(0, 8)}</p>}
            <button onClick={() => void checkAccess()} className="mt-5 inline-flex items-center gap-2 rounded-xl bg-slate-900 px-5 py-3 text-xs font-black text-white"><RefreshCw size={14} /> 승인 상태 확인</button>
          </div>
        )}

        {status === 'blocked' && (
          <div className="text-center">
            <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-red-50 text-red-500"><ShieldAlert size={30} /></div>
            <h2 className="mt-5 text-lg font-black">차단된 기기입니다.</h2>
            <p className="mt-2 text-sm font-bold text-slate-400">관리자에게 다시 승인을 요청해 주십시오.</p>
            <button onClick={() => void checkAccess()} className="mt-5 inline-flex items-center gap-2 rounded-xl bg-slate-900 px-5 py-3 text-xs font-black text-white"><RefreshCw size={14} /> 승인 상태 다시 확인</button>
          </div>
        )}

        {status === 'approved' && (
          <div className="flex flex-col items-center rounded-2xl bg-emerald-50 py-10 text-emerald-600"><CheckCircle2 size={32} /><p className="mt-3 text-sm font-black">승인되었습니다.</p></div>
        )}

        {error && <div className="mt-5 rounded-xl bg-red-50 px-4 py-3 text-xs font-bold leading-5 text-red-600">{error}</div>}
        {status === 'error' && <button onClick={() => { setStatus('checking'); void checkAccess(); }} className="mt-4 w-full rounded-xl bg-slate-900 py-3 text-xs font-black text-white">다시 확인</button>}
      </section>
    </main>
  );
}
