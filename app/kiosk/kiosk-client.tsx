'use client';

import { useCallback, useEffect, useState } from 'react';
import { LoaderCircle } from 'lucide-react';
import DashboardKiosk, { type KioskSchedule } from '@/app/components/dashboard-kiosk';
import DeviceAccessGate from '@/app/components/device-access-gate';
import { supabase } from '@/lib/supabase';
import type { AbsenceMember } from '@/lib/absence-calendar';

export default function KioskClient({ nativeLauncher }: { nativeLauncher: boolean }) {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [schedules, setSchedules] = useState<KioskSchedule[]>([]);
  const [members, setMembers] = useState<AbsenceMember[]>([]);
  const handleApproved = useCallback(() => setIsAuthenticated(true), []);

  const fetchSchedules = useCallback(async () => {
    const { data, error } = await supabase.from('schedules').select('*').order('start_time', { ascending: true });
    if (error) {
      console.error('전광판 일정을 불러오지 못했습니다.', error);
      setIsLoading(false);
      return;
    }
    setSchedules((data ?? []).filter((schedule) => schedule.recurrence_status !== 'cancelled'));
    setIsLoading(false);
  }, []);

  const fetchMembers = useCallback(async () => {
    const { data, error } = await supabase.rpc('list_team_members');
    if (!error && Array.isArray(data)) setMembers(data.filter((member): member is AbsenceMember => Boolean(member && typeof member === 'object' && typeof member.id === 'string' && typeof member.display_name === 'string' && typeof member.handle === 'string')));
  }, []);

  useEffect(() => {
    if (!isAuthenticated) return;
    const initialFetchTimer = window.setTimeout(() => { void fetchSchedules(); void fetchMembers(); }, 0);
    const channel = supabase
      .channel('kiosk_schedules')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'schedules' }, () => void fetchSchedules())
      .subscribe();
    const verifyTimer = window.setInterval(async () => {
      const { data, error } = await supabase.rpc('get_device_access_status');
      if (!error && data?.status !== 'approved') setIsAuthenticated(false);
      else if (!error) void fetchMembers();
    }, 30_000);
    return () => {
      window.clearTimeout(initialFetchTimer);
      window.clearInterval(verifyTimer);
      void supabase.removeChannel(channel);
    };
  }, [fetchMembers, fetchSchedules, isAuthenticated]);

  if (!isAuthenticated) {
    return <DeviceAccessGate onApproved={handleApproved} nativeKioskPairing={nativeLauncher} />;
  }

  if (isLoading) {
    return (
      <main className="flex min-h-dvh items-center justify-center bg-[#071022] text-blue-200">
        <div className="flex items-center gap-3 text-sm font-black"><LoaderCircle className="animate-spin" size={22} /> 전광판을 준비하고 있습니다.</div>
      </main>
    );
  }

  return (
    <DashboardKiosk
      schedules={schedules}
      members={members}
      dedicatedWindow
      nativeLauncher={nativeLauncher}
      onClose={() => {
        window.close();
        window.setTimeout(() => window.location.assign('about:blank'), 100);
      }}
    />
  );
}
