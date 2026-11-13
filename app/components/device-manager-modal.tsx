'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Check, Link2, LoaderCircle, Pencil, RefreshCw, ShieldCheck, ShieldOff, Smartphone, UserRound, X } from 'lucide-react';
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

interface TeamMemberRow {
  id: string;
  display_name: string;
  handle: string;
}

interface TeamMemberDeviceRow {
  user_id: string;
  member_id: string | null;
  is_kiosk: boolean;
}

const statusLabel = { pending: '승인 대기', approved: '승인됨', blocked: '차단됨' } as const;

export default function DeviceManagerModal({ onClose }: DeviceManagerModalProps) {
  const [devices, setDevices] = useState<DeviceAccessRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [workingId, setWorkingId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [loadError, setLoadError] = useState('');
  const [teamError, setTeamError] = useState('');
  const [members, setMembers] = useState<TeamMemberRow[]>([]);
  const [memberDevices, setMemberDevices] = useState<TeamMemberDeviceRow[]>([]);
  const [teamReady, setTeamReady] = useState(false);
  const [selectedLinks, setSelectedLinks] = useState<Record<string, string>>({});
  const [editingDeviceId, setEditingDeviceId] = useState<string | null>(null);
  const [nameDraft, setNameDraft] = useState('');
  const workingRef = useRef(false);

  const loadDevices = useCallback(async () => {
    try {
      const [deviceResult, memberResult, mappingResult] = await Promise.all([
        supabase.rpc('list_device_access'),
        supabase.rpc('list_team_members'),
        supabase.rpc('list_team_member_devices'),
      ]);
      setLoadError(deviceResult.error ? '기기 목록을 불러오지 못했습니다. 다시 확인해 주세요.' : '');
      if (!deviceResult.error) setDevices((deviceResult.data ?? []) as DeviceAccessRow[]);
      const nextTeamReady = !memberResult.error && !mappingResult.error;
      setTeamReady(nextTeamReady);
      setTeamError(nextTeamReady ? '' : '팀원 연결 정보를 불러오지 못했습니다. 팀원 기능의 데이터베이스 적용 여부를 확인한 뒤 새로고침해 주세요. 기존 기기 승인·차단은 계속 사용할 수 있습니다.');
      if (nextTeamReady) {
        setMembers((memberResult.data ?? []) as TeamMemberRow[]);
        setMemberDevices((mappingResult.data ?? []) as TeamMemberDeviceRow[]);
      }
    } catch {
      setLoadError('기기 정보를 불러오지 못했습니다. 네트워크 연결을 확인한 뒤 다시 시도해 주세요.');
      setTeamReady(false);
    } finally {
      setIsLoading(false);
    }
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
    if (workingRef.current) return;
    if (status === 'blocked' && !window.confirm(`'${device.device_name}' 기기를 차단하시겠습니까?`)) return;
    workingRef.current = true;
    setWorkingId(device.user_id);
    setError('');
    try {
      const { error: updateError } = await supabase.rpc('set_device_access', {
        p_user_id: device.user_id,
        p_status: status,
        p_is_admin: isAdmin,
      });
      if (updateError) throw updateError;
      await loadDevices();
    } catch {
      setError('기기 권한을 변경하지 못했습니다. 현재 관리자 권한을 확인한 뒤 다시 시도해 주세요.');
    } finally {
      workingRef.current = false;
      setWorkingId(null);
    }
  };

  const linkDevice = async (device: DeviceAccessRow, memberId: string) => {
    if (workingRef.current || !teamReady) return;
    const member = members.find((item) => item.id === memberId);
    if (!member) return;
    if (!window.confirm(`'${device.device_name}' 기기를 '${member.display_name} (@${member.handle})' 팀원과 같은 사람의 기기로 연결하시겠습니까?\n\n기존 대화 작성자·과거 일정과 알림의 기록은 이동하지 않습니다. 앞으로의 알림만 새 연결로 전달됩니다.${device.is_admin ? '\n기기의 관리자 권한은 바뀌지 않습니다.' : ''}`)) return;
    workingRef.current = true;
    setWorkingId(device.user_id);
    setError('');
    try {
      const { error: linkError } = await supabase.rpc('admin_link_team_member_device', { p_user_id: device.user_id, p_member_id: memberId });
      if (linkError) throw linkError;
      setSelectedLinks((previous) => { const next = { ...previous }; delete next[device.user_id]; return next; });
      setEditingDeviceId(null);
      await loadDevices();
    } catch {
      setError('팀원 연결을 변경하지 못했습니다. 기기 승인 상태와 관리자 권한을 확인한 뒤 다시 시도해 주세요.');
    } finally {
      workingRef.current = false;
      setWorkingId(null);
    }
  };

  const renameMember = async (device: DeviceAccessRow, member: TeamMemberRow) => {
    if (workingRef.current || !teamReady) return;
    const displayName = nameDraft.trim();
    if (!displayName || displayName.length > 100) {
      setError('팀원 이름은 1~100자로 입력해 주세요.');
      return;
    }
    workingRef.current = true;
    setWorkingId(device.user_id);
    setError('');
    try {
      const { error: renameError } = await supabase.rpc('admin_set_team_member_name', { p_member_id: member.id, p_display_name: displayName });
      if (renameError) throw renameError;
      setEditingDeviceId(null);
      await loadDevices();
    } catch {
      setError('팀원 이름을 저장하지 못했습니다. 입력한 이름을 확인한 뒤 다시 시도해 주세요.');
    } finally {
      workingRef.current = false;
      setWorkingId(null);
    }
  };

  return (
    <div className="fixed inset-0 z-[300] flex items-center justify-center bg-slate-950/60 p-3 backdrop-blur-sm sm:p-4" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section role="dialog" aria-modal="true" aria-labelledby="device-manager-title" className="flex max-h-[88dvh] w-full max-w-2xl flex-col overflow-hidden rounded-[30px] bg-white shadow-2xl">
        <header className="flex shrink-0 items-center justify-between gap-2 border-b border-slate-100 px-4 py-5 sm:px-6">
          <div className="flex min-w-0 items-center gap-3">
            <div className="hidden h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-blue-50 text-blue-600 sm:flex"><ShieldCheck size={21} /></div>
            <div className="min-w-0"><h2 id="device-manager-title" className="text-base font-black text-slate-900 sm:text-lg">기기·팀원 관리</h2><p className="mt-0.5 text-[10px] font-bold text-slate-400">기기 승인과 차단은 즉시 반영됩니다.</p></div>
          </div>
          <div className="flex shrink-0 gap-2"><button type="button" onClick={() => { setError(''); void loadDevices(); }} aria-label="새로고침" className="rounded-xl bg-slate-100 p-2 text-slate-500"><RefreshCw size={17} /></button><button type="button" onClick={onClose} aria-label="닫기" className="rounded-xl bg-slate-100 p-2 text-slate-500"><X size={17} /></button></div>
        </header>

        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3 custom-scrollbar sm:p-6">
          {!isLoading && <p className="rounded-xl bg-blue-50 px-3 py-2.5 text-[11px] leading-relaxed text-blue-700">같은 사람의 PC·휴대폰은 같은 팀원에 연결하세요. 기기의 관리자 권한과 팀원 연결은 별개이며, 전광판 전용 기기는 팀원 목록에서 제외됩니다.</p>}
          {loadError && <div role="alert" className="rounded-xl bg-red-50 px-4 py-3 text-xs font-bold text-red-600">{loadError}</div>}
          {teamError && <div role="status" className="rounded-xl bg-amber-50 px-4 py-3 text-xs leading-relaxed text-amber-700">{teamError}</div>}
          {error && <div role="alert" className="rounded-xl bg-red-50 px-4 py-3 text-xs font-bold text-red-600">{error}</div>}
          {isLoading && <div className="flex justify-center py-14"><LoaderCircle className="animate-spin text-blue-600" /></div>}
          {!isLoading && devices.length === 0 && <div className="py-14 text-center text-sm font-bold text-slate-400">등록된 기기가 없습니다.</div>}
          {devices.map((device) => {
            const mapping = memberDevices.find((item) => item.user_id === device.user_id);
            const member = members.find((item) => item.id === mapping?.member_id);
            const selectedMemberId = selectedLinks[device.user_id] ?? mapping?.member_id ?? '';
            const isEditingName = editingDeviceId === device.user_id;
            return (
            <article key={device.user_id} className="min-w-0 rounded-2xl border border-slate-100 p-3 sm:p-4">
              <div className="flex items-start gap-3">
                <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${device.status === 'approved' ? 'bg-emerald-50 text-emerald-600' : device.status === 'blocked' ? 'bg-red-50 text-red-500' : 'bg-amber-50 text-amber-500'}`}><Smartphone size={18} /></div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2"><h3 className="truncate text-sm font-black text-slate-800">{device.device_name}</h3>{device.is_admin && <span className="rounded-md bg-blue-50 px-2 py-1 text-[9px] font-black text-blue-600">관리자</span>}<span className={`rounded-md px-2 py-1 text-[9px] font-black ${device.status === 'approved' ? 'bg-emerald-50 text-emerald-600' : device.status === 'blocked' ? 'bg-red-50 text-red-500' : 'bg-amber-50 text-amber-600'}`}>{statusLabel[device.status]}</span></div>
                  <p className="mt-1 break-words font-mono text-[10px] font-bold leading-relaxed text-slate-400">{device.user_id.slice(0, 8)} · 마지막 확인 {new Date(device.last_seen_at).toLocaleString('ko-KR')}</p>
                </div>
              </div>
              {teamReady && mapping?.is_kiosk && <div className="mt-3 rounded-xl bg-slate-50 px-3 py-2.5 text-[11px] leading-relaxed text-slate-500"><span className="font-bold text-slate-600">전광판 · 자동 연결</span><p className="mt-1 break-words">{member ? `${member.display_name} (@${member.handle}) · 원본 승인 기기의 팀원 연결을 따릅니다.` : '원본 승인 기기의 연결을 따릅니다. 별도의 팀원 프로필을 만들지 않습니다.'}</p></div>}
              {teamReady && device.status === 'approved' && mapping && !mapping.is_kiosk && (!device.is_admin || Boolean(mapping.member_id)) && <div className="mt-3 space-y-3 rounded-xl border border-blue-100 bg-blue-50/40 p-3">
                <div className="flex min-w-0 items-start gap-2"><UserRound size={14} className="mt-0.5 shrink-0 text-blue-500" /><div className="min-w-0 flex-1"><p className="break-words text-xs font-bold text-slate-700">{member?.display_name ?? '연결된 팀원 없음'}</p>{member && <p className="mt-1 break-all text-[10px] text-slate-400">@{member.handle}</p>}</div>{member && !isEditingName && <button type="button" disabled={Boolean(workingId)} onClick={() => { setEditingDeviceId(device.user_id); setNameDraft(member.display_name); setError(''); }} className="inline-flex shrink-0 items-center gap-1 rounded-lg bg-white px-2 py-1.5 text-[10px] font-bold text-blue-600 disabled:opacity-50"><Pencil size={11} />이름 수정</button>}</div>
                {member && isEditingName && <form onSubmit={(event) => { event.preventDefault(); void renameMember(device, member); }} className="space-y-2"><label className="block"><span className="mb-1 block text-[10px] font-bold text-slate-500">표시 이름</span><input value={nameDraft} onChange={(event) => setNameDraft(event.target.value)} maxLength={100} disabled={Boolean(workingId)} aria-label={`${device.device_name} 팀원 표시 이름`} className="w-full min-w-0 rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-xs text-slate-800 outline-none focus:border-blue-400" /></label><p className="text-[10px] leading-relaxed text-slate-400">연결된 모든 기기에 같은 이름이 표시됩니다. @아이디는 바뀌지 않습니다.</p><div className="flex justify-end gap-1.5"><button type="button" disabled={Boolean(workingId)} onClick={() => setEditingDeviceId(null)} className="rounded-lg px-2.5 py-1.5 text-[10px] font-bold text-slate-500 disabled:opacity-50">취소</button><button type="submit" disabled={Boolean(workingId) || !nameDraft.trim()} className="rounded-lg bg-blue-600 px-2.5 py-1.5 text-[10px] font-bold text-white disabled:opacity-50">이름 저장</button></div></form>}
                <div><label className="mb-1.5 block text-[10px] font-bold text-slate-500" htmlFor={`team-device-${device.user_id}`}>같은 사람의 다른 기기 연결</label><div className="flex min-w-0 flex-col gap-2 sm:flex-row"><select id={`team-device-${device.user_id}`} value={selectedMemberId} onChange={(event) => setSelectedLinks((previous) => ({ ...previous, [device.user_id]: event.target.value }))} disabled={Boolean(workingId)} className="min-w-0 flex-1 rounded-lg border border-slate-200 bg-white px-2 py-2 text-[11px] text-slate-700 outline-none focus:border-blue-400 disabled:opacity-50"><option value="" disabled>연결할 팀원 선택</option>{members.map((item) => <option key={item.id} value={item.id}>{item.display_name} (@{item.handle})</option>)}</select><button type="button" disabled={Boolean(workingId) || !selectedMemberId || selectedMemberId === mapping.member_id} onClick={() => void linkDevice(device, selectedMemberId)} className="inline-flex shrink-0 items-center justify-center gap-1.5 rounded-lg bg-white px-3 py-2 text-[10px] font-bold text-blue-600 ring-1 ring-blue-100 disabled:opacity-40"><Link2 size={12} />연결 변경</button></div><p className="mt-1.5 text-[10px] leading-relaxed text-slate-400">동일인인 경우에만 변경하세요. 과거 대화·일정·알림 기록은 다른 팀원으로 이동하지 않습니다.</p></div>
              </div>}
              <div className="mt-4 flex flex-wrap justify-end gap-2">
                {workingId === device.user_id && <LoaderCircle size={15} aria-label="변경 사항 저장 중" className="mr-auto self-center animate-spin text-blue-500" />}
                {device.status !== 'approved' && <button type="button" disabled={Boolean(workingId)} onClick={() => void updateDevice(device, 'approved', false)} className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-500 px-3 py-2 text-[10px] font-black text-white disabled:opacity-50"><Check size={13} /> 승인</button>}
                {device.status === 'approved' && <button type="button" disabled={Boolean(workingId)} onClick={() => void updateDevice(device, 'approved', !device.is_admin)} className="rounded-xl bg-blue-50 px-3 py-2 text-[10px] font-black text-blue-600 disabled:opacity-50">{device.is_admin ? '관리자 해제' : '관리자 지정'}</button>}
                {device.status !== 'blocked' && <button type="button" disabled={Boolean(workingId)} onClick={() => void updateDevice(device, 'blocked', false)} className="inline-flex items-center gap-1.5 rounded-xl bg-red-50 px-3 py-2 text-[10px] font-black text-red-500 disabled:opacity-50"><ShieldOff size={13} /> 차단</button>}
              </div>
            </article>
          ); })}
        </div>
      </section>
    </div>
  );
}
