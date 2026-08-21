'use client';

import { useEffect, useState } from 'react';
import { CheckCircle2, LoaderCircle, ShieldAlert } from 'lucide-react';
import { supabase } from '@/lib/supabase';

type PairStatus = 'checking' | 'success' | 'not-authenticated' | 'not-approved' | 'error';

export default function KioskPairClient({ requestId }: { requestId: string }) {
  const [status, setStatus] = useState<PairStatus>('checking');
  const [message, setMessage] = useState('기존 기기 승인을 전광판에 연결하고 있습니다.');

  useEffect(() => {
    let cancelled = false;

    const approvePairing = async () => {
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(requestId)) {
        setStatus('error');
        setMessage('유효하지 않은 전광판 연결 요청입니다.');
        return;
      }

      const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
      if (cancelled) return;
      if (sessionError || !sessionData.session) {
        setStatus('not-authenticated');
        setMessage('이 Edge 프로필에는 기존 기기 승인이 없습니다. 승인된 홈페이지에서 다시 실행해 주십시오.');
        return;
      }

      const { data: access, error: accessError } = await supabase.rpc('get_device_access_status');
      if (cancelled) return;
      if (accessError || access?.status !== 'approved') {
        setStatus('not-approved');
        setMessage('현재 Edge 프로필이 승인된 기기가 아닙니다. 관리자 승인 후 다시 실행해 주십시오.');
        return;
      }

      const { error: pairingError } = await supabase.rpc('approve_kiosk_pair', {
        p_request_id: requestId,
      });
      if (cancelled) return;
      if (pairingError) {
        setStatus('error');
        setMessage(pairingError.message);
        return;
      }

      setStatus('success');
      setMessage('전광판 인증이 자동으로 완료되었습니다. 전광판 화면으로 돌아갑니다.');
    };

    void approvePairing();
    return () => {
      cancelled = true;
    };
  }, [requestId]);

  const isSuccess = status === 'success';
  const isChecking = status === 'checking';

  return (
    <main className="flex min-h-dvh items-center justify-center bg-slate-950 p-5 text-slate-900">
      <section className="w-full max-w-md rounded-[32px] bg-white p-8 text-center shadow-2xl">
        <div className={`mx-auto flex h-16 w-16 items-center justify-center rounded-2xl ${
          isSuccess ? 'bg-emerald-50 text-emerald-600' : isChecking ? 'bg-blue-50 text-blue-600' : 'bg-red-50 text-red-500'
        }`}>
          {isSuccess ? <CheckCircle2 size={32} /> : isChecking ? <LoaderCircle className="animate-spin" size={30} /> : <ShieldAlert size={30} />}
        </div>
        <p className="mt-6 text-[10px] font-black uppercase tracking-[0.18em] text-blue-600">Kiosk Approval</p>
        <h1 className="mt-2 text-xl font-black">전광판 자동 인증</h1>
        <p className="mt-4 text-sm font-bold leading-6 text-slate-500">{message}</p>
        {isSuccess && (
          <button type="button" onClick={() => window.close()} className="mt-6 w-full rounded-2xl bg-slate-900 py-3.5 text-sm font-black text-white">
            이 탭 닫기
          </button>
        )}
      </section>
    </main>
  );
}
