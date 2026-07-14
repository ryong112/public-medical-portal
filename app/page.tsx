'use client';

import { useEffect, useState, useRef } from 'react';
import { supabase } from '@/lib/supabase';
import SharedDashboard from '@/app/components/shared-dashboard';
import UndoToast, { type UndoNotice } from '@/app/components/undo-toast';
import ScheduleFormModal, { type NewScheduleInput } from '@/app/components/schedule-form-modal';
import JSZip from 'jszip';
import { 
  FileText, FilePlus,
  FileSpreadsheet, FileBox, File, Download, Trash2,
  GripVertical, Calendar as CalendarIcon, LayoutDashboard, Plus,
  ChevronLeft, ChevronRight, X, Clock, CalendarDays, Lock, Archive, Menu, Siren, Pencil
} from 'lucide-react';

export default function IntegratedPortal() {
  const DEPARTMENT_PASSWORD = process.env.NEXT_PUBLIC_ACCESS_CODE || "dphs"; 
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [accessCode, setAccessCode] = useState('');
  const [isError, setIsError] = useState(false);
  const [isMounted, setIsMounted] = useState(false);

  const [viewMode, setViewMode] = useState<'files' | 'calendar' | 'external_calendar' | 'dashboard'>('dashboard');
  
  const [messages, setMessages] = useState<any[]>([]);
  const [chatInput, setChatInput] = useState('');
  const [myId, setMyId] = useState<string | null>(null);
  const [isChatOpen, setIsChatOpen] = useState(false);
  
  // 알림 상태
  const [hasUnread, setHasUnread] = useState(false);
  const [hasNewSchedule, setHasNewSchedule] = useState(false); 

  // [신규 추가] 공지사항 관련 상태 관리
  const [noticeIndex, setNoticeIndex] = useState(0);
  const [isNoticeHovered, setIsNoticeHovered] = useState(false);

  const [position, setPosition] = useState({ x: 0, y: 0 }); 
  const [isDraggingChat, setIsDraggingChat] = useState(false);
  const dragStartPos = useRef({ x: 0, y: 0 });
  const chatRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const [files, setFiles] = useState<any[]>([]);
  const [categories, setCategories] = useState<any[]>([]);
  const [newCatName, setNewCatName] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('전체');
  const [uploading, setUploading] = useState(false);
  const [isDownloadingAll, setIsDownloadingAll] = useState(false); 
  const [draggedItemIndex, setDraggedItemIndex] = useState<number | null>(null);
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [editTitleValue, setEditTitleValue] = useState('');
  const [isDragOver, setIsDragOver] = useState(false);
  const [isMobileSidebarOpen, setIsMobileSidebarOpen] = useState(false);

  const [schedules, setSchedules] = useState<any[]>([]);
  const [currentMonth, setCurrentMonth] = useState(new Date());
  const [selectedSchedule, setSelectedSchedule] = useState<any | null>(null);
  const [draggedScheduleId, setDraggedScheduleId] = useState<number | null>(null);
  const [scheduleFormDate, setScheduleFormDate] = useState<string | null>(null);
  const [editingSchedule, setEditingSchedule] = useState<any | null>(null);
  const [undoNotices, setUndoNotices] = useState<UndoNotice[]>([]);
  const pendingDeleteKeysRef = useRef(new Set<string>());
  const undoTimersRef = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const undoActionsRef = useRef(new Map<string, { keys: string[]; restore: () => void }>());

  useEffect(() => {
    setIsMounted(true);
    if (localStorage.getItem('dept_auth_confirm') === 'true') setIsAuthenticated(true);
  }, []);

  // 1. 정보공유방(채팅) 영구 읽음 처리
  useEffect(() => {
    if (messages.length > 0) {
      const maxId = Math.max(...messages.map(m => m.id));
      const lastSeenId = parseInt(localStorage.getItem('last_seen_chat_id') || '0', 10);
      
      if (isChatOpen) {
        localStorage.setItem('last_seen_chat_id', maxId.toString());
        setHasUnread(false);
      } else if (maxId > lastSeenId) {
        setHasUnread(true);
      }
    }
  }, [messages, isChatOpen]);

  // 2. 부서 공유 달력 영구 읽음 처리
  useEffect(() => {
    if (schedules.length > 0) {
      const maxId = Math.max(...schedules.map(s => s.id));
      const lastSeenId = parseInt(localStorage.getItem('last_seen_schedule_id') || '0', 10);
      
      if (viewMode === 'calendar') {
        localStorage.setItem('last_seen_schedule_id', maxId.toString());
        setHasNewSchedule(false);
      } else if (maxId > lastSeenId) {
        setHasNewSchedule(true);
      }
    }
  }, [schedules, viewMode]);

  // [신규 추가] 공지사항 실적 전광판 롤링 타이머 로직 (4초마다 회전)
  useEffect(() => {
    if (activeNotices.length <= 1 || isNoticeHovered) return;
    const interval = setInterval(() => {
      setNoticeIndex(prev => (prev + 1) % activeNotices.length);
    }, 4000);
    return () => clearInterval(interval);
  }, [schedules, isNoticeHovered]);

  // [신규 추가] 데이터 삭제 등으로 인덱스 범위 초과 방지 롤백 방어
  useEffect(() => {
    if (activeNotices.length > 0 && noticeIndex >= activeNotices.length) {
      setNoticeIndex(0);
    }
  }, [schedules]);

  useEffect(() => {
    if (isAuthenticated) {
      let anonId = localStorage.getItem('chat_anon_id');
      if (!anonId) {
        anonId = Math.random().toString(36).substring(2, 12);
        localStorage.setItem('chat_anon_id', anonId);
      }
      setMyId(anonId);
      fetchMessages(); fetchFiles(); fetchCategories(); fetchSchedules();

      const chatChannel = supabase.channel('chat_main').on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, (payload) => {
        setMessages(prev => [...prev, payload.new]); 
      }).on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'messages' }, (payload) => {
        setMessages(prev => prev.filter(m => m.id !== payload.old.id));
      }).subscribe();
      
      const fileChannel = supabase.channel('file_main').on('postgres_changes', { event: '*', schema: 'public', table: 'files' }, () => fetchFiles()).subscribe();
      const catChannel = supabase.channel('cat_main').on('postgres_changes', { event: '*', schema: 'public', table: 'categories' }, () => fetchCategories()).subscribe();
      const scheChannel = supabase.channel('sche_main').on('postgres_changes', { event: '*', schema: 'public', table: 'schedules' }, () => fetchSchedules()).subscribe();

      return () => { supabase.removeChannel(chatChannel); supabase.removeChannel(fileChannel); supabase.removeChannel(catChannel); supabase.removeChannel(scheChannel); };
    }
  }, [isAuthenticated]);

  // 데이터 필터링 계산 자동 처리 (오늘 날짜 기준 진행 중인 공지만 정렬 노출)
  const todayStr = new Date().toISOString().split('T')[0];
  const activeNotices = schedules
    .filter(s => s.is_notice && s.date >= todayStr)
    .sort((a, b) => a.date.localeCompare(b.date));

  // [신규 추가] 정밀 디데이 계산기 함수
  const getDDay = (dateStr: string) => {
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const target = new Date(dateStr); target.setHours(0, 0, 0, 0);
    const diffTime = target.getTime() - today.getTime();
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    if (diffDays === 0) return 'D-Day';
    return `D-${diffDays}`;
  };

  const formatScheduleTime = (schedule: any) => {
    if (schedule.start_time && schedule.end_time) return `${schedule.start_time} - ${schedule.end_time}`;
    if (schedule.start_time) return `${schedule.start_time}부터`;
    if (schedule.end_time) return `${schedule.end_time}까지`;
    return '시간 미정';
  };

  const onMouseDownChat = (e: React.MouseEvent) => { setIsDraggingChat(true); dragStartPos.current = { x: e.clientX - position.x, y: e.clientY - position.y }; };
  useEffect(() => {
    const onMouseMove = (e: MouseEvent) => { if (!isDraggingChat) return; setPosition({ x: e.clientX - dragStartPos.current.x, y: e.clientY - dragStartPos.current.y }); };
    const onMouseUp = () => setIsDraggingChat(false);
    if (isDraggingChat) { window.addEventListener('mousemove', onMouseMove); window.addEventListener('mouseup', onMouseUp); }
    return () => { window.removeEventListener('mousemove', onMouseMove); window.removeEventListener('mouseup', onMouseUp); };
  }, [isDraggingChat, position]);

  const queueUndoableDeletion = ({
    label,
    keys,
    hide,
    restore,
    commit,
  }: {
    label: string;
    keys: string[];
    hide: () => void;
    restore: () => void;
    commit: () => Promise<void>;
  }) => {
    if (keys.some((key) => pendingDeleteKeysRef.current.has(key))) return;

    const token = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    keys.forEach((key) => pendingDeleteKeysRef.current.add(key));
    undoActionsRef.current.set(token, { keys, restore });
    hide();
    setUndoNotices((current) => [...current, { token, label }]);

    const timer = setTimeout(async () => {
      setUndoNotices((current) => current.filter((notice) => notice.token !== token));
      try {
        await commit();
      } catch (error) {
        restore();
        alert(error instanceof Error ? error.message : '삭제 중 오류가 발생했습니다.');
      } finally {
        keys.forEach((key) => pendingDeleteKeysRef.current.delete(key));
        undoActionsRef.current.delete(token);
        undoTimersRef.current.delete(token);
      }
    }, 8000);

    undoTimersRef.current.set(token, timer);
  };

  const undoDeletion = (token: string) => {
    const action = undoActionsRef.current.get(token);
    const timer = undoTimersRef.current.get(token);
    if (!action || !timer) return;

    clearTimeout(timer);
    action.restore();
    action.keys.forEach((key) => pendingDeleteKeysRef.current.delete(key));
    undoActionsRef.current.delete(token);
    undoTimersRef.current.delete(token);
    setUndoNotices((current) => current.filter((notice) => notice.token !== token));
  };

  const dismissUndoNotice = (token: string) => {
    setUndoNotices((current) => current.filter((notice) => notice.token !== token));
  };

  const onDeleteMessage = (id: number) => {
    if (!confirm('메시지를 삭제하시겠습니까?')) return;
    const target = messages.find((message) => message.id === id);
    if (!target) return;

    queueUndoableDeletion({
      label: '메시지가 삭제 대기 중입니다.',
      keys: [`message:${id}`],
      hide: () => setMessages((current) => current.filter((message) => message.id !== id)),
      restore: () => setMessages((current) => current.some((message) => message.id === id) ? current : [...current, target].sort((a, b) => a.id - b.id)),
      commit: async () => {
        const { error } = await supabase.from('messages').delete().eq('id', id);
        if (error) throw new Error(`메시지를 삭제하지 못했습니다: ${error.message}`);
      },
    });
  };

  const onDeleteCategoryWithFiles = (id: number, catName: string) => {
    const targetFiles = files.filter(f => f.category === catName);
    const targetCategory = categories.find((category) => category.id === id);
    if (!targetCategory) return;
    const confirmMsg = targetFiles.length > 0 ? `'${catName}' 분류와 파일 ${targetFiles.length}개를 삭제하시겠습니까?\n8초 동안 삭제를 되돌릴 수 있습니다.` : `'${catName}' 분류를 삭제하시겠습니까?`;
    if (!confirm(confirmMsg)) return;

    queueUndoableDeletion({
      label: `'${catName}' 분류가 삭제 대기 중입니다.`,
      keys: [`category:${id}`, ...targetFiles.map((file) => `file:${file.id}`)],
      hide: () => {
        setCategories((current) => current.filter((category) => category.id !== id));
        setFiles((current) => current.filter((file) => file.category !== catName));
        setSelectedCategory('전체');
      },
      restore: () => {
        setCategories((current) => current.some((category) => category.id === id) ? current : [...current, targetCategory].sort((a, b) => a.order_index - b.order_index));
        setFiles((current) => {
          const existingIds = new Set(current.map((file) => file.id));
          return [...current, ...targetFiles.filter((file) => !existingIds.has(file.id))].sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''));
        });
        setSelectedCategory(catName);
      },
      commit: async () => {
        if (targetFiles.length > 0) {
          const { error: fileError } = await supabase.from('files').delete().eq('category', catName);
          if (fileError) throw new Error(`분류의 파일을 삭제하지 못했습니다: ${fileError.message}`);
        }
        const { error: categoryError } = await supabase.from('categories').delete().eq('id', id);
        if (categoryError) throw new Error(`분류를 삭제하지 못했습니다: ${categoryError.message}`);
        if (targetFiles.length > 0) {
          const filePaths = targetFiles.map(f => f.url.split('/').pop() || "");
          const { error: storageError } = await supabase.storage.from('files').remove(filePaths);
          if (storageError) throw new Error(`파일 저장소를 정리하지 못했습니다: ${storageError.message}`);
        }
      },
    });
  };

  const onDeleteSchedule = (id: number) => {
    if (!confirm('일정을 삭제하시겠습니까?')) return;
    const target = schedules.find((schedule) => schedule.id === id);
    if (!target) return;

    queueUndoableDeletion({
      label: `'${target.title}' 일정이 삭제 대기 중입니다.`,
      keys: [`schedule:${id}`],
      hide: () => { setSchedules((current) => current.filter((schedule) => schedule.id !== id)); setSelectedSchedule(null); },
      restore: () => setSchedules((current) => current.some((schedule) => schedule.id === id) ? current : [...current, target]),
      commit: async () => {
        const { error } = await supabase.from('schedules').delete().eq('id', id);
        if (error) throw new Error(`일정을 삭제하지 못했습니다: ${error.message}`);
      },
    });
  };

  const onDeleteFile = (file: any) => {
    if (!confirm('파일을 삭제하시겠습니까?')) return;
    const path = file.url.split('/').pop() || "";
    queueUndoableDeletion({
      label: `'${file.name}' 파일이 삭제 대기 중입니다.`,
      keys: [`file:${file.id}`],
      hide: () => setFiles((current) => current.filter((item) => item.id !== file.id)),
      restore: () => setFiles((current) => current.some((item) => item.id === file.id) ? current : [file, ...current]),
      commit: async () => {
        const { error: fileError } = await supabase.from('files').delete().eq('id', file.id);
        if (fileError) throw new Error(`파일 정보를 삭제하지 못했습니다: ${fileError.message}`);
        const { error: storageError } = await supabase.storage.from('files').remove([path]);
        if (storageError) throw new Error(`파일 저장소를 정리하지 못했습니다: ${storageError.message}`);
      },
    });
  };

  const fetchMessages = async () => { const { data } = await supabase.from('messages').select('*').order('created_at', { ascending: true }); if (data) setMessages(data.filter((message) => !pendingDeleteKeysRef.current.has(`message:${message.id}`))); };
  const fetchFiles = async () => { const { data } = await supabase.from('files').select('*').order('created_at', { ascending: false }); if (data) setFiles(data.filter((file) => !pendingDeleteKeysRef.current.has(`file:${file.id}`))); };
  const fetchCategories = async () => { const { data } = await supabase.from('categories').select('*').order('order_index', { ascending: true }); if (data) setCategories(data.filter((category) => !pendingDeleteKeysRef.current.has(`category:${category.id}`))); };
  const fetchSchedules = async () => { const { data } = await supabase.from('schedules').select('*').order('start_time', { ascending: true }); if (data) setSchedules(data.filter((schedule) => !pendingDeleteKeysRef.current.has(`schedule:${schedule.id}`))); };
  
  useEffect(() => { if (isChatOpen) { const timer = setTimeout(() => { if (scrollRef.current) scrollRef.current.scrollIntoView({ behavior: 'smooth', block: 'end' }); }, 100); return () => clearTimeout(timer); } }, [messages, isChatOpen]);
  
  const onSend = async (e: React.FormEvent) => { e.preventDefault(); if (!chatInput.trim()) return; await supabase.from('messages').insert([{ content: chatInput, sender_id: myId }]); setChatInput(''); };
  const handleDownloadCategoryZip = async () => {
    const targetFiles = files.filter(f => selectedCategory === '전체' || f.category === selectedCategory);
    if (targetFiles.length === 0) return alert("파일이 없습니다.");
    setIsDownloadingAll(true); const zip = new JSZip();
    try {
      const promises = targetFiles.map(async (file) => { const res = await fetch(file.url); const blob = await res.blob(); zip.file(file.name, blob); });
      await Promise.all(promises); const content = await zip.generateAsync({ type: "blob" });
      const link = document.createElement('a'); link.href = window.URL.createObjectURL(content); link.download = `${selectedCategory}_백업_${new Date().toLocaleDateString()}.zip`; link.click();
    } catch (e) { alert("압축 오류"); } finally { setIsDownloadingAll(false); }
  };
  const handleDownload = async (url: string, originalName: string) => { try { const response = await fetch(url); const blob = await response.blob(); const downloadUrl = window.URL.createObjectURL(blob); const link = document.createElement('a'); link.href = downloadUrl; link.download = originalName; document.body.appendChild(link); link.click(); link.remove(); window.URL.revokeObjectURL(downloadUrl); } catch (e) { alert('오류'); } };
  
  const getFileIcon = (fileName: string) => {
    const ext = fileName.split('.').pop()?.toLowerCase(); const iconSize = 20;
    if (ext === 'hwp') return { icon: <FileText size={iconSize} className="text-blue-500" />, color: 'bg-blue-50', label: 'HWP' };
    if (ext === 'pdf') return { icon: <FileText size={iconSize} className="text-red-500" />, color: 'bg-red-50', label: 'PDF' };
    if (ext === 'ppt' || ext === 'pptx') return { icon: <FileSpreadsheet size={iconSize} className="text-orange-500" />, color: 'bg-orange-50', label: 'PPT' };
    if (ext === 'xls' || ext === 'xlsx') return { icon: <FileSpreadsheet size={iconSize} className="text-green-600" />, color: 'bg-green-50', label: 'XLS' };
    return { icon: <File size={iconSize} className="text-slate-400" />, color: 'bg-slate-50', label: 'FILE' };
  };

  const handleUpload = async (fileList: FileList | File[]) => {
    setUploading(true);
    for (const file of Array.from(fileList)) {
      const safeFileName = `${Date.now()}_${Math.random().toString(36).substring(2, 7)}.${file.name.split('.').pop()}`;
      const { data } = await supabase.storage.from('files').upload(safeFileName, file);
      if (data) {
        const { data: { publicUrl } } = supabase.storage.from('files').getPublicUrl(safeFileName);
        await supabase.from('files').insert([{ name: file.name, url: publicUrl, size: file.size, category: selectedCategory === '전체' ? '일반' : selectedCategory }]);
      }
    }
    await fetchFiles(); setUploading(false);
  };
  const onUpdateCategoryName = async () => { 
    const targetCat = categories.find(c => c.name === selectedCategory); if (!targetCat || !editTitleValue.trim()) return; 
    await supabase.from('categories').update({ name: editTitleValue.trim() }).eq('id', targetCat.id); 
    setSelectedCategory(editTitleValue.trim()); setIsEditingTitle(false); fetchCategories(); 
  };

  const onAddSchedule = (dateStr: string) => {
    setEditingSchedule(null);
    setScheduleFormDate(dateStr);
  };

  const onSaveSchedule = async (schedule: NewScheduleInput) => {
    const { error } = editingSchedule
      ? await supabase.from('schedules').update(schedule).eq('id', editingSchedule.id)
      : await supabase.from('schedules').insert([schedule]);
    if (error) throw new Error(`일정을 저장하지 못했습니다: ${error.message}`);
    await fetchSchedules();
    setScheduleFormDate(null);
    setEditingSchedule(null);
  };

  const onEditSchedule = (schedule: any) => {
    setEditingSchedule(schedule);
    setScheduleFormDate(schedule.date);
    setSelectedSchedule(null);
  };

  const onToggleScheduleComplete = async (schedule: any) => {
    const nextCompleted = !schedule.is_completed;
    setSchedules((current) => current.map((item) => item.id === schedule.id ? { ...item, is_completed: nextCompleted } : item));
    const { error } = await supabase.from('schedules').update({ is_completed: nextCompleted }).eq('id', schedule.id);
    if (error) {
      setSchedules((current) => current.map((item) => item.id === schedule.id ? { ...item, is_completed: schedule.is_completed } : item));
      alert(`완료 상태를 변경하지 못했습니다: ${error.message}`);
    }
  };

  const onScheduleDragStart = (e: React.DragEvent, id: number) => { setDraggedScheduleId(id); e.dataTransfer.effectAllowed = "move"; };
  const onDayDrop = async (dateStr: string) => { if (draggedScheduleId === null) return; await supabase.from('schedules').update({ date: dateStr }).eq('id', draggedScheduleId); fetchSchedules(); setDraggedScheduleId(null); };
  const handleAuthSubmit = (e: React.FormEvent) => { e.preventDefault(); if (accessCode === DEPARTMENT_PASSWORD) { setIsAuthenticated(true); localStorage.setItem('dept_auth_confirm', 'true'); } else { setIsError(true); setAccessCode(''); } };

  if (!isMounted) return null;

  if (!isAuthenticated) {
    return (
      <div className="h-screen bg-[#1A1C1E] flex items-center justify-center p-6 font-sans">
        <div className="bg-white w-full max-w-md rounded-[40px] shadow-2xl p-12 flex flex-col items-center">
          <div className="bg-blue-50 p-6 rounded-[32px] mb-8 text-blue-600 shadow-inner"><Lock size={48} strokeWidth={2.5} /></div>
          <h1 className="text-2xl font-black text-slate-800 mb-2 tracking-tight text-center leading-tight">공공의료지원과 전용</h1>
          <form onSubmit={handleAuthSubmit} className="w-full space-y-4">
            <input type="password" className={`w-full bg-white border-2 ${isError ? 'border-red-400' : 'border-slate-100'} p-5 rounded-[24px] font-black text-center outline-none focus:border-blue-500 transition-all text-xl text-slate-900 shadow-sm`} placeholder="코드 입력" value={accessCode} onChange={(e) => { setAccessCode(e.target.value); setIsError(false); }} autoFocus />
            <button className="w-full bg-slate-900 hover:bg-black text-white py-5 rounded-[24px] font-black shadow-xl transition-all hover:-translate-y-1 active:scale-95 text-lg">인증 및 입장</button>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-screen bg-[#F0F2F5] text-[#2C3E50] overflow-hidden select-none font-sans">
      <header className="bg-[#1A1C1E] p-3 md:p-4 px-4 md:px-8 flex justify-between items-center z-[60] shadow-md text-white border-b border-white/5 gap-2">
        <div className="flex items-center gap-2 md:gap-3 overflow-hidden shrink-0">
          <button onClick={() => setIsMobileSidebarOpen(!isMobileSidebarOpen)} className="md:hidden p-1 hover:bg-white/10 rounded-lg transition-colors shrink-0"><Menu size={22}/></button>
          <span className="text-lg md:text-2xl hidden sm:inline shrink-0">📂</span>
          <h1 className="font-extrabold text-xs sm:text-sm md:text-lg tracking-tight uppercase truncate">공공의료지원과 문서함</h1>
        </div>

        {/* ===================================================================== */}
        {/* [신규 기능 연동] 빨간색 테두리 빈 영역 채우기 - 공지사항 롤링 전광판 플레이스 */}
        {/* ===================================================================== */}
        <div 
          className="hidden lg:flex flex-1 max-w-sm xl:max-w-md mx-4 relative h-10 items-center bg-white/5 hover:bg-white/10 rounded-xl px-4 text-xs font-bold border border-white/10 cursor-pointer overflow-visible transition-colors"
          onMouseEnter={() => setIsNoticeHovered(true)}
          onMouseLeave={() => setIsNoticeHovered(false)}
        >
          {activeNotices.length > 0 ? (
            <>
              <div className="flex items-center justify-between w-full h-full gap-2 animate-in fade-in duration-300">
                <span className="bg-red-500/20 text-red-400 px-2 py-0.5 rounded text-[10px] font-black shrink-0 animate-pulse">공지사항</span>
                <span className="truncate flex-1 text-slate-200">{activeNotices[noticeIndex].title}</span>
                <span className="text-yellow-400 font-black shrink-0 ml-2">{getDDay(activeNotices[noticeIndex].date)}</span>
              </div>

              {/* 마우스 호버 시 아래로 미끄러지듯 대형 전광판 팝업 펼쳐짐 */}
              {isNoticeHovered && (
                <div className="absolute top-11 left-0 w-full bg-[#25282A] border border-white/10 rounded-xl shadow-2xl p-3 flex flex-col gap-1.5 z-[100] animate-in slide-in-from-top-2 duration-200">
                  <div className="text-[10px] text-slate-500 font-black border-b border-white/5 pb-1.5 mb-1 flex justify-between">
                    <span>진행 중인 모든 부서 공지 ({activeNotices.length}건)</span>
                  </div>
                  <div className="max-h-48 overflow-y-auto custom-scrollbar space-y-1.5 pr-1">
                    {activeNotices.map((notice, idx) => (
                      <div key={notice.id} className={`flex items-center justify-between p-2 rounded-lg transition-colors ${idx === noticeIndex ? 'bg-white/10 text-white ring-1 ring-white/10' : 'text-slate-300 hover:bg-white/5'}`}>
                        <span className="truncate flex-1 mr-4">{notice.title}</span>
                        <div className="flex items-center gap-3 shrink-0 text-[11px]">
                          <span className="text-slate-500 font-medium text-[10px]">{notice.date}</span>
                          <span className="text-yellow-400 font-black w-12 text-right">{getDDay(notice.date)}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          ) : (
            <span className="text-slate-500 font-medium italic mx-auto">진행 중인 주요 공지사항이 없습니다.</span>
          )}
        </div>
        {/* ===================================================================== */}

        <div className="flex items-center gap-1.5 md:gap-4 shrink-0 overflow-x-auto scrollbar-hide">
          <a 
            href="https://docs.google.com/spreadsheets/d/1yz_fMbsVe0__VJWe6F0ObbrV2jvnRotqi03-mrnnZUc/edit?usp=sharing" 
            target="_blank" 
            rel="noopener noreferrer"
            className="flex items-center gap-1.5 md:gap-2 px-2.5 md:px-6 py-2 md:py-2.5 rounded-xl md:rounded-2xl font-black transition-all shadow-md active:scale-95 bg-emerald-500 hover:bg-emerald-600 text-white text-xs md:text-sm shrink-0"
          >
            <FileBox size={16} className="md:w-[18px] md:h-[18px]"/> <span className="hidden md:inline">홍보물품 반출대장</span>
          </a>

          <a 
            href="https://docs.google.com/spreadsheets/d/1lDD-otVP5s7h-94deku3hLRF4buztn0lO0MBqzNN17M/edit?usp=sharing" 
            target="_blank" 
            rel="noopener noreferrer"
            className="flex items-center gap-1.5 md:gap-2 px-2.5 md:px-6 py-2 md:py-2.5 rounded-xl md:rounded-2xl font-black transition-all shadow-md active:scale-95 bg-emerald-500 hover:bg-emerald-600 text-white text-xs md:text-sm shrink-0"
          >
            <FileSpreadsheet size={16} className="md:w-[18px] md:h-[18px]"/> <span className="hidden md:inline">실적공유</span>
          </a>

          <button 
            onClick={() => setViewMode(viewMode === 'external_calendar' ? 'files' : 'external_calendar')} 
            className="flex items-center gap-1.5 md:gap-2 px-2.5 md:px-6 py-2 md:py-2.5 rounded-xl md:rounded-2xl font-black transition-all shadow-md active:scale-95 bg-indigo-500 hover:bg-indigo-600 text-white text-xs md:text-sm shrink-0"
          >
            <CalendarDays size={16} className="md:w-[18px] md:h-[18px]"/> <span className="hidden md:inline">{viewMode === 'external_calendar' ? '문서함' : '손)일정확인'}</span>
          </button>

          <button 
            onClick={() => setViewMode(viewMode === 'calendar' ? 'files' : 'calendar')} 
            className="relative flex items-center gap-1.5 md:gap-2 px-2.5 md:px-6 py-2 md:py-2.5 rounded-xl md:rounded-2xl font-black transition-all shadow-md active:scale-95 bg-white text-slate-900 text-xs md:text-sm shrink-0"
          >
            <CalendarIcon size={16} className="md:w-[18px] md:h-[18px]"/> <span className="hidden md:inline">{viewMode === 'calendar' ? '문서함' : '일정 공유'}</span>
            {hasNewSchedule && viewMode !== 'calendar' && <span className="absolute -top-1 -right-1 w-3 h-3 md:w-4 md:h-4 bg-red-500 rounded-full border-2 border-[#1A1C1E] animate-bounce"></span>}
          </button>

          <button 
            onClick={() => setIsChatOpen(!isChatOpen)} 
            className="relative bg-[#3498DB] hover:bg-[#2980B9] px-2.5 md:px-5 py-2 md:py-2.5 rounded-xl md:rounded-2xl font-black transition-all shadow-md active:scale-95 flex items-center gap-1.5 md:gap-2 text-xs md:text-sm text-white shrink-0"
          >
            <span>💬 <span className="hidden md:inline">정보공유방</span></span>
            {hasUnread && !isChatOpen && <span className="absolute -top-1 -right-1 w-3 h-3 md:w-4 md:h-4 bg-red-500 rounded-full border-2 border-[#1A1C1E] animate-bounce"></span>}
          </button>

          <button onClick={() => { localStorage.removeItem('dept_auth_confirm'); window.location.reload(); }} className="text-slate-500 hover:text-white p-1 md:p-2 transition-colors ml-0.5 md:ml-0 shrink-0"><X size={18} className="md:w-[20px] md:h-[20px]"/></button>
        </div>
      </header>

      <main className="flex-1 flex overflow-hidden relative">
        <aside className={`
          fixed md:relative inset-y-0 left-0 z-50 w-80 bg-[#EBEEF2] border-r border-slate-300 flex flex-col shadow-2xl md:shadow-none transition-transform duration-300 transform
          ${isMobileSidebarOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0'}
        `}>
          <div className="p-6 pb-2 text-slate-400 flex justify-between items-center">
            <p className="text-[10px] font-black uppercase tracking-[0.2em] px-2 italic">Classification</p>
            <button onClick={() => setIsMobileSidebarOpen(false)} className="md:hidden text-slate-600"><X size={20}/></button>
          </div>
          <div className="flex-1 overflow-y-auto px-6 py-2 custom-scrollbar">
            <div className="space-y-1.5 mb-4">
              <button onClick={() => { setViewMode('dashboard'); setIsMobileSidebarOpen(false); }} className={`w-full flex items-center gap-3 px-4 py-3.5 rounded-xl text-sm font-bold transition-all ${viewMode === 'dashboard' ? 'bg-slate-900 shadow-lg text-white' : 'text-slate-500 hover:bg-slate-200/60'}`}><LayoutDashboard size={17} /> 공공의료지원과 일정</button>
              <div className="h-px bg-slate-300/70 my-3" />
              <button onClick={() => { setViewMode('files'); setSelectedCategory('전체'); setIsMobileSidebarOpen(false); }} className={`w-full text-left px-4 py-3.5 rounded-xl text-sm font-bold transition-all ${selectedCategory === '전체' && viewMode === 'files' ? 'bg-white shadow-md text-blue-600 ring-1 ring-slate-200' : 'text-slate-500 hover:bg-slate-200/60'}`}>🏠 전체 문서 보기</button>
              {categories.map((cat, idx) => (
                <div key={cat.id} draggable onDragStart={() => setDraggedItemIndex(idx)} onDragOver={(e) => e.preventDefault()} onDrop={async() => {
                   if (draggedItemIndex === null || draggedItemIndex === idx) return;
                   const newCats = [...categories]; const item = newCats.splice(draggedItemIndex, 1)[0]; newCats.splice(idx, 0, item);
                   setCategories(newCats); for(let i=0; i<newCats.length; i++) await supabase.from('categories').update({order_index: i}).eq('id', newCats[i].id);
                   setDraggedItemIndex(null);
                }} className={`group relative flex items-center gap-1 cursor-grab active:cursor-grabbing transition-transform ${draggedItemIndex === idx ? 'opacity-30' : 'opacity-100'}`}>
                  <div className="absolute left-1 opacity-0 group-hover:opacity-40"><GripVertical size={14}/></div>
                  <button onClick={() => { setViewMode('files'); setSelectedCategory(cat.name); setIsMobileSidebarOpen(false); }} className={`flex-1 text-left px-4 py-3.5 rounded-xl text-sm font-bold transition-all pl-6 ${selectedCategory === cat.name && viewMode === 'files' ? 'bg-white shadow-md text-blue-600 ring-1 ring-slate-200' : 'text-slate-500 hover:bg-slate-200/60'}`}>📁 {cat.name}</button>
                  <button onClick={() => onDeleteCategoryWithFiles(cat.id, cat.name)} className="absolute right-2 top-4 opacity-0 group-hover:opacity-100 text-red-300 hover:text-red-500 text-xs px-2 transition-opacity">✕</button>
                </div>
              ))}
            </div>
          </div>
          <div className="p-6 border-t border-slate-300 bg-[#EBEEF2]">
            <div className="flex gap-2 bg-white p-2.5 rounded-2xl border border-slate-200 focus-within:ring-2 focus-within:ring-blue-100 shadow-sm transition-all"><input className="flex-1 bg-transparent border-none text-xs font-bold outline-none px-2 text-slate-900" placeholder="분류 추가..." value={newCatName} onChange={(e) => setNewCatName(e.target.value)} onKeyDown={async(e) => { if(e.key === 'Enter' && newCatName.trim()) { await supabase.from('categories').insert([{ name: newCatName.trim(), order_index: categories.length }]); setNewCatName(''); } }} /><button onClick={async() => { if(newCatName.trim()) { await supabase.from('categories').insert([{ name: newCatName.trim(), order_index: categories.length }]); setNewCatName(''); } }} className="bg-slate-900 text-white w-8 h-8 rounded-xl shadow-sm font-black text-sm">+</button></div>
          </div>
        </aside>

        {isMobileSidebarOpen && <div onClick={() => setIsMobileSidebarOpen(false)} className="fixed inset-0 bg-black/20 backdrop-blur-sm z-40 md:hidden animate-in fade-in" />}

        <section 
          onDragOver={(e) => { e.preventDefault(); if(viewMode==='files') setIsDragOver(true); }} 
          onDragLeave={() => setIsDragOver(false)} 
          onDrop={(e) => { e.preventDefault(); setIsDragOver(false); if(viewMode==='files') handleUpload(e.dataTransfer.files); }} 
          className={`flex-1 flex flex-col bg-white overflow-hidden relative shadow-inner transition-all duration-300 min-h-0 ${isDragOver ? 'bg-blue-50/50' : 'bg-white'}`}
        >
          {isDragOver && (
            <div className="absolute inset-0 z-20 flex items-center justify-center pointer-events-none animate-in fade-in duration-200">
              <div className="bg-blue-600/90 text-white px-10 py-6 rounded-[40px] shadow-2xl font-black flex flex-col items-center gap-4 animate-bounce">
                <FilePlus size={48} /> <p className="text-xl">파일을 이곳에 놓아 주십시오.</p>
              </div>
            </div>
          )}

          <div className={`max-w-6xl w-full mx-auto flex flex-col flex-1 overflow-hidden min-h-0 ${viewMode === 'external_calendar' || viewMode === 'calendar' ? 'p-2 md:p-4' : viewMode === 'dashboard' ? 'p-3 md:p-6' : 'p-6 md:p-12'}`}>
            
            {viewMode !== 'dashboard' && <div className={`flex flex-col md:flex-row justify-between items-start gap-4 shrink-0 ${viewMode === 'external_calendar' || viewMode === 'calendar' ? 'mb-2 md:mb-4' : 'mb-10'}`}>
              <div className="flex-1 w-full overflow-hidden">
                <div className="group flex items-center gap-4 mb-1">
                  {isEditingTitle && viewMode === 'files' ? (
                    <div className="flex items-center gap-3 w-full">
                      <input className="text-2xl md:text-4xl font-black text-slate-900 tracking-tighter bg-white border-b-4 border-blue-600 outline-none w-full max-w-2xl py-1" value={editTitleValue} onChange={(e)=>setEditTitleValue(e.target.value)} autoFocus onKeyDown={(e) => e.key === 'Enter' && onUpdateCategoryName()} />
                      <button onClick={onUpdateCategoryName} className="bg-blue-600 text-white px-5 py-2 rounded-2xl text-xs font-black shadow-lg">저장</button>
                    </div>
                  ) : (
                    <>
                      <h2 className={`font-black text-slate-800 tracking-tighter uppercase truncate ${viewMode === 'external_calendar' || viewMode === 'calendar' ? 'text-xl md:text-2xl' : 'text-2xl md:text-4xl'}`}>
                        {viewMode === 'calendar' ? '일정 공유 달력' : viewMode === 'external_calendar' ? '손)일정확인' : selectedCategory}
                      </h2>
                      {viewMode === 'files' && selectedCategory !== '전체' && <button onClick={() => { setEditTitleValue(selectedCategory); setIsEditingTitle(true); }} className="opacity-100 md:opacity-0 group-hover:opacity-100 bg-slate-100 text-slate-400 p-2 rounded-xl hover:text-blue-500 text-xs font-bold transition-all">✎ 수정</button>}
                      {viewMode === 'files' && <button onClick={handleDownloadCategoryZip} disabled={isDownloadingAll} className="flex items-center gap-2 bg-blue-50 text-blue-600 px-4 py-2 rounded-xl text-xs font-black hover:bg-blue-600 hover:text-white transition-all ml-2 shadow-sm"><Archive size={14} /> <span className="hidden sm:inline">전체 다운로드(ZIP)</span></button>}
                    </>
                  )}
                </div>
                <p className="text-[10px] md:text-xs text-slate-400 font-medium tracking-tight italic truncate">
                  {viewMode === 'calendar' ? '주요 일정을 확인하고 공유할 수 있습니다.' : viewMode === 'external_calendar' ? '연동된 외부 일정을 확인합니다.' : '부서 자료를 분류별로 확인할 수 있습니다.'}
                </p>
              </div>
              {viewMode === 'files' && (
                <label className="w-full md:w-auto bg-blue-600 text-white px-8 py-3.5 rounded-3xl font-black cursor-pointer shadow-lg active:scale-95 flex items-center justify-center gap-2 shrink-0">
                  <Plus size={18} /><span>파일 업로드</span>
                  <input type="file" className="hidden" multiple onChange={(e) => e.target.files && handleUpload(e.target.files)} />
                </label>
              )}
            </div>}

            <div className={`flex-1 flex flex-col min-h-0 ${viewMode === 'external_calendar' || viewMode === 'calendar' || viewMode === 'dashboard' ? 'overflow-hidden' : 'overflow-auto custom-scrollbar'}`}>
              
              {viewMode === 'dashboard' ? (
                <SharedDashboard
                  files={files}
                  schedules={schedules}
                  messages={messages}
                  onChangeView={setViewMode}
                  onOpenChat={() => setIsChatOpen(true)}
                  onOpenFile={handleDownload}
                  onOpenSchedule={setSelectedSchedule}
                  onToggleScheduleComplete={onToggleScheduleComplete}
                />
              ) : viewMode === 'external_calendar' ? (
                <div className="w-full h-full relative rounded-[16px] md:rounded-[24px] overflow-hidden shadow-xl bg-slate-50">
                  <iframe 
                    src="https://my-calendar-eta.vercel.app" 
                    className="absolute inset-0 w-full h-full border-0" 
                    title="손 일정확인 외부 달력" 
                  />
                </div>

              ) : viewMode === 'calendar' ? (
                <div className="flex-1 flex flex-col min-h-0 w-full">
                  <div className="flex items-center gap-6 mb-4 shrink-0">
                    <h3 className="text-xl md:text-2xl font-black text-slate-700">{currentMonth.getFullYear()}년 {currentMonth.getMonth() + 1}월</h3>
                    <div className="flex gap-2">
                      <button onClick={() => setCurrentMonth(new Date(currentMonth.setMonth(currentMonth.getMonth() - 1)))} className="p-2 md:p-3 bg-slate-100 rounded-xl hover:bg-slate-200 transition-colors"><ChevronLeft size={18}/></button>
                      <button onClick={() => setCurrentMonth(new Date(currentMonth.setMonth(currentMonth.getMonth() + 1)))} className="p-2 md:p-3 bg-slate-100 rounded-xl hover:bg-slate-200 transition-colors"><ChevronRight size={18}/></button>
                      <button onClick={() => setCurrentMonth(new Date())} className="px-5 py-2 bg-slate-900 text-white text-xs font-bold rounded-xl shadow-md hidden sm:block">오늘</button>
                    </div>
                  </div>

                  <div className="flex-1 flex flex-col min-h-0 bg-slate-200 border border-slate-200 rounded-[16px] md:rounded-[32px] overflow-hidden shadow-2xl">
                    <div className="grid grid-cols-7 bg-slate-50 border-b border-slate-200 shrink-0">
                      {['일', '월', '화', '수', '목', '금', '토'].map(d => (
                        <div key={d} className="p-2 md:p-3 text-center text-[10px] md:text-xs font-black text-slate-400 uppercase tracking-widest">{d}</div>
                      ))}
                    </div>
                    
                    <div className="flex-1 grid grid-cols-7 gap-px bg-slate-200 min-h-0 auto-rows-fr">
                      {Array.from({length: new Date(currentMonth.getFullYear(), currentMonth.getMonth(), 1).getDay()}).map((_, i) => <div key={`empty-${i}`} className="bg-slate-50/40" />)}
                      {Array.from({length: new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1, 0).getDate()}).map((_, i) => {
                        const day = i + 1; const dateStr = `${currentMonth.getFullYear()}-${String(currentMonth.getMonth() + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
                        const daySchedules = schedules.filter(s => s.date === dateStr);
                        return (
                          <div key={day} onDragOver={(e)=>e.preventDefault()} onDrop={()=>onDayDrop(dateStr)} className="bg-white flex flex-col min-h-0 p-1.5 md:p-3 transition-all hover:bg-blue-50/20 group relative border-r border-b border-slate-100">
                            <div className="flex justify-between items-start mb-1.5 shrink-0">
                              {/* 공지사항 지정 일정은 날짜 칸 내부에서도 눈에 띄게 테두리 가벼운 강조 효과 */}
                              <span className={`text-xs md:text-sm font-black ${daySchedules.some(s => s.is_notice) ? 'bg-red-50 text-red-600 px-1 rounded' : (new Date(dateStr).getDay() === 0) ? 'text-red-500' : (new Date(dateStr).getDay() === 6) ? 'text-blue-500' : 'text-slate-800'}`}>{day}</span>
                              <button onClick={() => onAddSchedule(dateStr)} className="opacity-0 group-hover:opacity-100 bg-slate-900 text-white p-1 rounded-md transition-all"><Plus size={10}/></button>
                            </div>
                            <div className="flex-1 overflow-y-auto custom-scrollbar space-y-1 pr-1">
                              {daySchedules.map(s => (
                                <div key={s.id} draggable onDragStart={(e)=>onScheduleDragStart(e, s.id)} onClick={()=>setSelectedSchedule(s)} className={`border text-slate-800 text-[9px] md:text-[10px] p-1.5 rounded-lg font-bold shadow-sm flex flex-col gap-0.5 truncate cursor-pointer transition-all ${s.is_notice ? 'bg-red-50/70 border-red-200 hover:border-red-400' : 'bg-white border-blue-100 hover:border-blue-400'}`}>
                                  <div className="flex items-center gap-1 text-blue-600 hidden md:flex">
                                    <Clock size={9}/>
                                    <span className={`text-[8px] font-black ${s.is_notice ? 'text-red-500' : 'text-blue-600'}`}>{formatScheduleTime(s)}</span>
                                    {s.is_notice && <span className="bg-red-500 text-white px-1 rounded-[4px] text-[7px] scale-90">공지</span>}
                                  </div>
                                  <span className={`flex items-center gap-1 ${s.is_notice ? 'text-red-900 font-extrabold' : ''} ${s.is_completed ? 'text-slate-400 line-through opacity-60' : ''}`}>{s.is_urgent && <Siren size={10} className="shrink-0 text-red-500" />}{s.title}</span>
                                </div>
                              ))}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>

              ) : (
                <div className="min-w-[700px] md:min-w-0 h-full pr-2 pb-10">
                  <div className="relative mb-10 group"><span className="absolute left-6 top-5 text-slate-300 font-black text-[10px] tracking-widest hidden md:block">SEARCH</span><input className="w-full bg-[#F8FAFC] border border-slate-100 p-4 md:p-5 md:pl-24 rounded-3xl text-sm font-bold text-slate-800 outline-none focus:bg-white focus:ring-4 focus:ring-blue-50 shadow-sm transition-all" placeholder="파일명 검색..." value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} /></div>
                  <table className="w-full text-left">
                    <thead className="sticky top-0 bg-white z-10 border-b border-slate-100">
                      <tr className="text-[11px] text-slate-300 font-black uppercase tracking-widest"><th className="pb-5 px-4 w-2/3">Document Title</th><th className="pb-5">Label</th><th className="pb-5 text-right px-4">Action</th></tr>
                    </thead>
                    <tbody className="divide-y divide-slate-50">
                      {files.filter(f => f.name.toLowerCase().includes(searchQuery.toLowerCase()) && (selectedCategory === '전체' || f.category === selectedCategory)).map(file => {
                        const info = getFileIcon(file.name);
                        return (
                          <tr key={file.id} className="group hover:bg-slate-50/50 transition-all">
                            <td className="py-6 px-4">
                              <div onClick={() => handleDownload(file.url, file.name)} className="flex items-center gap-4 cursor-pointer">
                                <div className={`w-12 h-12 ${info.color} rounded-2xl flex flex-col items-center justify-center border border-transparent group-hover:border-slate-200 shadow-sm transition-all`}>
                                  {info.icon} <span className="text-[7px] font-black text-slate-400 mt-0.5">{info.label}</span>
                                </div>
                                <span className="font-bold text-slate-900 text-sm md:text-base group-hover:text-blue-600 transition-colors">{file.name}</span>
                              </div>
                            </td>
                            <td className="py-6"><span className="text-[10px] font-black bg-blue-50 text-blue-500 px-3 py-1.5 rounded-lg border border-blue-100 uppercase">{file.category}</span></td>
                            <td className="py-6 text-right px-4 space-x-4"><button onClick={() => handleDownload(file.url, file.name)} className="text-blue-400 hover:text-blue-600 transition-colors"><Download size={18}/></button><button onClick={() => onDeleteFile(file)} className="text-red-200 hover:text-red-500 transition-colors"><Trash2 size={18}/></button></td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        </section>
      </main>

      {scheduleFormDate && (
        <ScheduleFormModal
          key={`${scheduleFormDate}-${editingSchedule?.id ?? 'new'}`}
          date={scheduleFormDate}
          initialSchedule={editingSchedule ?? undefined}
          onClose={() => { setScheduleFormDate(null); setEditingSchedule(null); }}
          onSubmit={onSaveSchedule}
        />
      )}

      {selectedSchedule && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm">
          <div className="flex w-full max-w-md flex-col items-center rounded-[32px] bg-white p-8 shadow-2xl">
            <div className={`mb-6 rounded-2xl p-3 ${selectedSchedule.is_urgent ? 'bg-red-50 text-red-600' : 'bg-blue-50 text-blue-600'}`}>
              {selectedSchedule.is_urgent ? <Siren size={24} /> : <CalendarDays size={24} />}
            </div>
            {selectedSchedule.is_urgent && <span className="mb-3 rounded-lg bg-red-500 px-3 py-1 text-[10px] font-black text-white">긴급 일정</span>}
            <h3 className={`mb-2 text-center text-2xl font-black leading-tight ${selectedSchedule.is_completed ? 'text-slate-400 line-through' : 'text-slate-800'}`}>{selectedSchedule.title}</h3>
            <p className="mb-8 text-center font-bold text-slate-400">{selectedSchedule.date} | {formatScheduleTime(selectedSchedule)}</p>
            <div className="grid w-full grid-cols-2 gap-3">
              <button onClick={() => onEditSchedule(selectedSchedule)} className="flex items-center justify-center gap-2 rounded-2xl bg-blue-50 py-4 font-black text-blue-600 transition-all hover:bg-blue-600 hover:text-white"><Pencil size={17}/> 일정 수정</button>
              <button onClick={() => onDeleteSchedule(selectedSchedule.id)} className="flex items-center justify-center gap-2 rounded-2xl bg-red-50 py-4 font-black text-red-500 transition-all hover:bg-red-500 hover:text-white"><Trash2 size={18}/> 일정 삭제</button>
              <button onClick={() => setSelectedSchedule(null)} className="col-span-2 rounded-2xl bg-slate-900 py-4 font-black text-white transition-all hover:bg-black">닫기</button>
            </div>
          </div>
        </div>
      )}

      {isChatOpen && (
        <div ref={chatRef} style={typeof window !== 'undefined' && window.innerWidth > 768 ? { transform: `translate(${position.x}px, ${position.y}px)` } : {}} className="fixed bottom-0 md:bottom-10 right-0 md:right-10 w-full md:w-[420px] h-[80vh] md:h-[650px] bg-[#A9C7E3] rounded-t-[32px] md:rounded-[40px] shadow-2xl border-x-4 border-t-4 md:border-4 border-white flex flex-col z-[100]">
          <div onMouseDown={onMouseDownChat} className="p-5 md:p-6 bg-white/95 backdrop-blur-md flex justify-between items-center cursor-move border-b border-black/5 rounded-t-[28px] md:rounded-t-[36px] text-slate-900"><span className="font-black text-sm">🗨️ 정보공유방</span><button onClick={() => setIsChatOpen(false)} className="w-9 h-9 bg-slate-100 hover:bg-red-500 hover:text-white rounded-full flex items-center justify-center font-bold transition-all">✕</button></div>
          <div className="flex-1 overflow-y-auto p-4 md:p-6 space-y-6">{messages.map((m) => (<div key={m.id} className={`flex ${m.sender_id === myId ? 'flex-row-reverse' : 'flex-row'} items-end gap-2 group`}><button onClick={() => onDeleteMessage(m.id)} className="opacity-0 group-hover:opacity-100 w-7 h-7 bg-white/80 rounded-full text-red-600 font-black text-[11px] flex items-center justify-center transition-all">X</button><div className={`p-4 shadow-xl ${m.sender_id === myId ? 'bg-[#FEE500] rounded-[24px] rounded-tr-none' : 'bg-white rounded-[24px] rounded-tl-none'} max-w-[80%]`}> <p className="text-[15px] text-black font-extrabold whitespace-pre-wrap leading-snug">{m.content}</p></div><span className="text-[10px] font-black text-slate-700 mb-1 leading-none">{new Date(m.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span></div>))} <div ref={scrollRef} /></div>
          <form onSubmit={onSend} className="p-4 md:p-6 bg-white md:rounded-b-[36px] border-t-2 border-slate-50"><div className="flex gap-3"><input className="flex-1 bg-slate-100 p-4 rounded-2xl text-sm font-bold text-slate-900 outline-none focus:ring-4 focus:ring-yellow-400 transition-all" value={chatInput} onChange={(e) => setChatInput(e.target.value)} placeholder="메시지 입력..." /><button className="bg-[#FEE500] hover:bg-[#F9E000] px-6 py-4 rounded-2xl font-black text-sm shadow-lg active:scale-95 transition-all text-slate-900">전송</button></div></form>
        </div>
      )}

      <UndoToast notices={undoNotices} onUndo={undoDeletion} onDismiss={dismissUndoNotice} />

      <style jsx global>{`
        html, body { margin: 0; padding: 0; height: 100%; overflow: hidden; }
        .custom-scrollbar::-webkit-scrollbar { width: 6px; } 
        .custom-scrollbar::-webkit-scrollbar-thumb { background: #CBD5E0; border-radius: 10px; } 
        .scrollbar-hide::-webkit-scrollbar { display: none; } 
        .scrollbar-hide { -ms-overflow-style: none; scrollbar-width: none; }
      `}</style>
    </div>
  );
}
