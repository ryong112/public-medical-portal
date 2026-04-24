'use client';

import { useEffect, useState, useRef } from 'react';
import { supabase } from '@/lib/supabase';
import JSZip from 'jszip';
import { 
  FileText, FilePlus, Image as ImageIcon, 
  FileSpreadsheet, FileBox, File, Download, Trash2,
  GripVertical, Calendar as CalendarIcon, LayoutDashboard, Plus,
  ChevronLeft, ChevronRight, X, Clock, CalendarDays, Lock, Archive, Menu
} from 'lucide-react';

export default function IntegratedPortal() {
  // --- [1. 보안 및 입장 코드 설정] ---
  const DEPARTMENT_PASSWORD = process.env.NEXT_PUBLIC_ACCESS_CODE || "dphs"; 
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [accessCode, setAccessCode] = useState('');
  const [isError, setIsError] = useState(false);
  const [isMounted, setIsMounted] = useState(false);

  // --- [2. 상태 관리: 팀장님 스타일 100% 고정] ---
  const [messages, setMessages] = useState<any[]>([]);
  const [chatInput, setChatInput] = useState('');
  const [myId, setMyId] = useState<string | null>(null);
  const [isChatOpen, setIsChatOpen] = useState(false);
  const [hasUnread, setHasUnread] = useState(false);
  const [position, setPosition] = useState({ x: 0, y: 0 }); 
  const [isDraggingChat, setIsDraggingChat] = useState(false);
  const dragStartPos = useRef({ x: 0, y: 0 });
  const chatRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const [viewMode, setViewMode] = useState<'files' | 'calendar'>('files');
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

  // --- [3. 초기 로드 및 실시간 구독] ---
  useEffect(() => {
    setIsMounted(true);
    if (localStorage.getItem('dept_auth_confirm') === 'true') setIsAuthenticated(true);
  }, []);

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
        setMessages(prev => [...prev, payload.new]); if (!isChatOpen) setHasUnread(true);
      }).on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'messages' }, (payload) => {
        setMessages(prev => prev.filter(m => m.id !== payload.old.id));
      }).subscribe();
      const fileChannel = supabase.channel('file_main').on('postgres_changes', { event: '*', schema: 'public', table: 'files' }, () => fetchFiles()).subscribe();
      const catChannel = supabase.channel('cat_main').on('postgres_changes', { event: '*', schema: 'public', table: 'categories' }, () => fetchCategories()).subscribe();
      const scheChannel = supabase.channel('sche_main').on('postgres_changes', { event: '*', schema: 'public', table: 'schedules' }, () => fetchSchedules()).subscribe();
      return () => { supabase.removeChannel(chatChannel); supabase.removeChannel(fileChannel); supabase.removeChannel(catChannel); supabase.removeChannel(scheChannel); };
    }
  }, [isAuthenticated, isChatOpen]);

  // --- [4. 기능 함수 로직: 100% 보존] ---
  const onMouseDownChat = (e: React.MouseEvent) => { setIsDraggingChat(true); dragStartPos.current = { x: e.clientX - position.x, y: e.clientY - position.y }; };
  useEffect(() => {
    const onMouseMove = (e: MouseEvent) => { if (!isDraggingChat) return; setPosition({ x: e.clientX - dragStartPos.current.x, y: e.clientY - dragStartPos.current.y }); };
    const onMouseUp = () => setIsDraggingChat(false);
    if (isDraggingChat) { window.addEventListener('mousemove', onMouseMove); window.addEventListener('mouseup', onMouseUp); }
    return () => { window.removeEventListener('mousemove', onMouseMove); window.removeEventListener('mouseup', onMouseUp); };
  }, [isDraggingChat, position]);

  const onDeleteMessage = async (id: number) => { if (!confirm('삭제하시겠습니까?')) return; setMessages(prev => prev.filter(m => m.id !== id)); await supabase.from('messages').delete().eq('id', id); };
  const onDeleteCategoryWithFiles = async (id: number, catName: string) => {
    const targetFiles = files.filter(f => f.category === catName);
    const confirmMsg = targetFiles.length > 0 ? `'${catName}' 분류를 삭제하시겠습니까?\n내부에 저장된 파일 ${targetFiles.length}개도 서버에서 완전히 삭제되어 용량이 확보됩니다.` : `'${catName}' 분류를 삭제하시겠습니까?`;
    if (!confirm(confirmMsg)) return;
    try {
      if (targetFiles.length > 0) {
        const filePaths = targetFiles.map(f => f.url.split('/').pop() || "");
        await supabase.storage.from('files').remove(filePaths);
        await supabase.from('files').delete().eq('category', catName);
      }
      await supabase.from('categories').delete().eq('id', id);
      setSelectedCategory('전체'); fetchCategories(); fetchFiles();
    } catch (e) { alert("삭제 중 오류"); }
  };
  const onDeleteSchedule = async (id: number) => { if (confirm('삭제하시겠습니까?')) { await supabase.from('schedules').delete().eq('id', id); setSelectedSchedule(null); fetchSchedules(); } };
  const onDeleteFile = async (file: any) => { if (!confirm('삭제하시겠습니까?')) return; const path = file.url.split('/').pop() || ""; await supabase.storage.from('files').remove([path]); await supabase.from('files').delete().eq('id', file.id); fetchFiles(); };
  const fetchMessages = async () => { const { data } = await supabase.from('messages').select('*').order('created_at', { ascending: true }); if (data) setMessages(data); };
  const fetchFiles = async () => { const { data } = await supabase.from('files').select('*').order('created_at', { ascending: false }); if (data) setFiles(data); };
  const fetchCategories = async () => { const { data } = await supabase.from('categories').select('*').order('order_index', { ascending: true }); if (data) setCategories(data); };
  const fetchSchedules = async () => { const { data } = await supabase.from('schedules').select('*').order('start_time', { ascending: true }); if (data) setSchedules(data); };
  useEffect(() => { if (isChatOpen) { setHasUnread(false); const timer = setTimeout(() => { if (scrollRef.current) scrollRef.current.scrollIntoView({ behavior: 'smooth', block: 'end' }); }, 100); return () => clearTimeout(timer); } }, [messages, isChatOpen]);
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
  
  // --- [고급 아이콘 디자인 복구] ---
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
  const onAddSchedule = async (dateStr: string) => { const title = prompt(`${dateStr} 일정 제목:`); if (!title) return; const start = prompt(`시작:`, "10:00") || "10:00"; const end = prompt(`종료:`, "11:00") || "11:00"; await supabase.from('schedules').insert([{ title, date: dateStr, start_time: start, end_time: end }]); fetchSchedules(); };
  const onScheduleDragStart = (e: React.DragEvent, id: number) => { setDraggedScheduleId(id); e.dataTransfer.effectAllowed = "move"; };
  const onDayDrop = async (dateStr: string) => { if (draggedScheduleId === null) return; await supabase.from('schedules').update({ date: dateStr }).eq('id', draggedScheduleId); fetchSchedules(); setDraggedScheduleId(null); };
  const handleAuthSubmit = (e: React.FormEvent) => { e.preventDefault(); if (accessCode === DEPARTMENT_PASSWORD) { setIsAuthenticated(true); localStorage.setItem('dept_auth_confirm', 'true'); } else { setIsError(true); setAccessCode(''); } };

  if (!isMounted) return null;

  // --- [보안 화면] ---
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

  // --- [메인 UI] ---
  return (
    <div className="flex flex-col h-screen bg-[#F0F2F5] text-[#2C3E50] overflow-hidden select-none font-sans">
      <header className="bg-[#1A1C1E] p-4 px-6 md:px-8 flex justify-between items-center z-[60] shadow-md text-white border-b border-white/5">
        <div className="flex items-center gap-3">
          <button onClick={() => setIsMobileSidebarOpen(!isMobileSidebarOpen)} className="md:hidden p-2 hover:bg-white/10 rounded-xl transition-colors"><Menu size={24}/></button>
          <span className="text-2xl">📂</span>
          <h1 className="font-extrabold text-base md:text-lg tracking-tight uppercase truncate">공공의료지원과 공유문서함</h1>
        </div>
        <div className="flex items-center gap-3 md:gap-4">
          {/* [PC 버전: 텍스트 포함 / 모바일: 아이콘만] */}
          <button onClick={() => setViewMode(viewMode === 'calendar' ? 'files' : 'calendar')} className="flex items-center gap-2 px-4 md:px-6 py-2.5 rounded-2xl font-black transition-all shadow-md active:scale-95 bg-white text-slate-900 text-xs md:text-sm">
            <CalendarIcon size={18}/> <span className="hidden sm:inline">{viewMode === 'calendar' ? '문서함으로 돌아가기' : '부서 공유 달력'}</span>
          </button>
          <button onClick={() => setIsChatOpen(!isChatOpen)} className="relative bg-[#3498DB] hover:bg-[#2980B9] px-4 md:px-5 py-2.5 rounded-2xl font-black transition-all shadow-md active:scale-95 flex items-center gap-2 text-xs md:text-sm">
            <span>💬 <span className="hidden sm:inline">정보공유방</span></span>
            {hasUnread && <span className="absolute -top-1 -right-1 w-4 h-4 bg-red-500 rounded-full border-2 border-[#1A1C1E] animate-bounce"></span>}
          </button>
          <button onClick={() => { localStorage.removeItem('dept_auth_confirm'); window.location.reload(); }} className="text-slate-500 hover:text-white p-2 transition-colors"><X size={20}/></button>
        </div>
      </header>

      <main className="flex-1 flex overflow-hidden relative">
        {/* 사이드바: PC 상시 노출 / 모바일 햄버거 */}
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

        {/* 배경 오버레이 (모바일용) */}
        {isMobileSidebarOpen && <div onClick={() => setIsMobileSidebarOpen(false)} className="fixed inset-0 bg-black/20 backdrop-blur-sm z-40 md:hidden animate-in fade-in" />}

        {/* 본문 영역 */}
        <section 
          onDragOver={(e) => { e.preventDefault(); if(viewMode==='files') setIsDragOver(true); }} 
          onDragLeave={() => setIsDragOver(false)} 
          onDrop={(e) => { e.preventDefault(); setIsDragOver(false); if(viewMode==='files') handleUpload(e.dataTransfer.files); }} 
          className={`flex-1 flex flex-col bg-white overflow-hidden relative shadow-inner transition-all duration-300 ${isDragOver ? 'bg-blue-50/50' : 'bg-white'}`}
        >
          {isDragOver && (
            <div className="absolute inset-0 z-20 flex items-center justify-center pointer-events-none animate-in fade-in duration-200">
              <div className="bg-blue-600/90 text-white px-10 py-6 rounded-[40px] shadow-2xl font-black flex flex-col items-center gap-4 animate-bounce">
                <FilePlus size={48} /> <p className="text-xl">파일을 이곳에 놓으세요!</p>
              </div>
            </div>
          )}

          <div className="max-w-6xl w-full mx-auto flex flex-col h-full p-6 md:p-12">
            <div className="flex flex-col md:flex-row justify-between items-start mb-10 gap-6">
              <div className="flex-1 w-full">
                <div className="group flex items-center gap-4 mb-2">
                  {isEditingTitle && viewMode === 'files' ? (
                    <div className="flex items-center gap-3 w-full">
                      <input className="text-2xl md:text-4xl font-black text-slate-900 tracking-tighter bg-white border-b-4 border-blue-600 outline-none w-full max-w-2xl py-1" value={editTitleValue} onChange={(e)=>setEditTitleValue(e.target.value)} autoFocus onKeyDown={(e) => e.key === 'Enter' && onUpdateCategoryName()} />
                      <button onClick={onUpdateCategoryName} className="bg-blue-600 text-white px-5 py-2 rounded-2xl text-xs font-black shadow-lg">저장</button>
                    </div>
                  ) : (
                    <>
                      <h2 className="text-2xl md:text-4xl font-black text-slate-800 tracking-tighter uppercase truncate">{viewMode === 'calendar' ? '부서 공유 달력' : selectedCategory}</h2>
                      {viewMode === 'files' && selectedCategory !== '전체' && <button onClick={() => { setEditTitleValue(selectedCategory); setIsEditingTitle(true); }} className="opacity-100 md:opacity-0 group-hover:opacity-100 bg-slate-100 text-slate-400 p-2 rounded-xl hover:text-blue-500 text-xs font-bold transition-all">✎ 수정</button>}
                      {viewMode === 'files' && <button onClick={handleDownloadCategoryZip} disabled={isDownloadingAll} className="flex items-center gap-2 bg-blue-50 text-blue-600 px-4 py-2 rounded-xl text-xs font-black hover:bg-blue-600 hover:text-white transition-all ml-2 shadow-sm"><Archive size={14} /> <span className="hidden sm:inline">전체 다운로드(ZIP)</span></button>}
                    </>
                  )}
                </div>
                <p className="text-xs md:text-sm text-slate-400 font-medium tracking-tight italic">{viewMode === 'calendar' ? '팀원들의 시간을 확인하고 일정을 공유하세요.' : '본 서비스는 부서 전용 시스템입니다.'}</p>
              </div>
              {viewMode === 'files' && (
                <label className="w-full md:w-auto bg-blue-600 text-white px-8 py-3.5 rounded-3xl font-black cursor-pointer shadow-lg active:scale-95 flex items-center justify-center gap-2">
                  <Plus size={18} /><span>파일 업로드</span>
                  <input type="file" className="hidden" multiple onChange={(e) => e.target.files && handleUpload(e.target.files)} />
                </label>
              )}
            </div>

            <div className="flex-1 overflow-auto custom-scrollbar">
              {viewMode === 'calendar' ? (
                <div className="min-w-[600px] md:min-w-0">
                  <div className="flex items-center gap-6 mb-8">
                    <h3 className="text-xl md:text-2xl font-black text-slate-700">{currentMonth.getFullYear()}년 {currentMonth.getMonth() + 1}월</h3>
                    <div className="flex gap-2">
                      <button onClick={() => setCurrentMonth(new Date(currentMonth.setMonth(currentMonth.getMonth() - 1)))} className="p-3 bg-slate-100 rounded-2xl hover:bg-slate-200 transition-colors"><ChevronLeft size={18}/></button>
                      <button onClick={() => setCurrentMonth(new Date(currentMonth.setMonth(currentMonth.getMonth() + 1)))} className="p-3 bg-slate-100 rounded-2xl hover:bg-slate-200 transition-colors"><ChevronRight size={18}/></button>
                      <button onClick={() => setCurrentMonth(new Date())} className="px-6 py-2 bg-slate-900 text-white text-xs font-bold rounded-2xl shadow-md hidden sm:block">오늘</button>
                    </div>
                  </div>
                  <div className="grid grid-cols-7 gap-px bg-slate-200 border border-slate-200 rounded-[32px] overflow-hidden shadow-2xl">
                    {['일', '월', '화', '수', '목', '금', '토'].map(d => (<div key={d} className="bg-slate-50 p-3 md:p-5 text-center text-xs font-black text-slate-400 uppercase tracking-widest">{d}</div>))}
                    {Array.from({length: new Date(currentMonth.getFullYear(), currentMonth.getMonth(), 1).getDay()}).map((_, i) => <div key={`empty-${i}`} className="bg-slate-50/40 min-h-[100px] md:min-h-[160px]" />)}
                    {Array.from({length: new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1, 0).getDate()}).map((_, i) => {
                      const day = i + 1; const dateStr = `${currentMonth.getFullYear()}-${String(currentMonth.getMonth() + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
                      const daySchedules = schedules.filter(s => s.date === dateStr);
                      return (
                        <div key={day} onDragOver={(e)=>e.preventDefault()} onDrop={()=>onDayDrop(dateStr)} className="bg-white min-h-[100px] md:min-h-[160px] p-2 md:p-4 transition-all hover:bg-blue-50/20 group relative border-r border-b border-slate-100">
                          <div className="flex justify-between items-start mb-3"><span className={`text-sm md:text-base font-black ${ (new Date(dateStr).getDay() === 0) ? 'text-red-500' : (new Date(dateStr).getDay() === 6) ? 'text-blue-500' : 'text-slate-800' }`}>{day}</span><button onClick={() => onAddSchedule(dateStr)} className="opacity-0 group-hover:opacity-100 bg-slate-900 text-white p-1 rounded-lg transition-all"><Plus size={12}/></button></div>
                          <div className="space-y-1.5">{daySchedules.map(s => (<div key={s.id} draggable onDragStart={(e)=>onScheduleDragStart(e, s.id)} onClick={()=>setSelectedSchedule(s)} className="bg-white border border-blue-100 text-slate-800 text-[9px] md:text-[11px] p-2 rounded-xl font-bold shadow-sm flex flex-col gap-0.5 truncate cursor-pointer hover:border-blue-400"><div className="flex items-center gap-1 text-blue-600 hidden md:flex"><Clock size={10}/><span className="text-[9px] font-black">{s.start_time}</span></div><span>{s.title}</span></div>))}</div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ) : (
                <div className="min-w-[700px] md:min-w-0">
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
                                {/* [PC에서만 보이는 예쁜 아이콘 박스] */}
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

      {/* 일정 상세 팝업 */}
      {selectedSchedule && (<div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/40 backdrop-blur-sm p-4 animate-in fade-in"><div className="bg-white w-full max-w-md rounded-[32px] shadow-2xl p-8 flex flex-col items-center"><div className="bg-blue-50 p-3 rounded-2xl text-blue-600 mb-6"><CalendarDays size={24}/></div><h3 className="text-2xl font-black text-slate-800 mb-2 leading-tight text-center">{selectedSchedule.title}</h3><p className="text-slate-400 font-bold mb-8 text-center">{selectedSchedule.date} | {selectedSchedule.start_time} - {selectedSchedule.end_time}</p><div className="flex gap-3 w-full"><button onClick={() => onDeleteSchedule(selectedSchedule.id)} className="flex-1 bg-red-50 text-red-500 py-4 rounded-2xl font-black flex items-center justify-center gap-2 hover:bg-red-500 hover:text-white transition-all"><Trash2 size={18}/> 삭제하시겠습니까?</button><button onClick={() => setSelectedSchedule(null)} className="flex-1 bg-slate-900 text-white py-4 rounded-2xl font-black transition-all hover:bg-black">닫기</button></div></div></div>)}

      {/* 정보공유방: PC에서만 드래그 가능, 모바일은 하단 고정 */}
      {isChatOpen && (
        <div ref={chatRef} style={typeof window !== 'undefined' && window.innerWidth > 768 ? { transform: `translate(${position.x}px, ${position.y}px)` } : {}} className="fixed bottom-0 md:bottom-10 right-0 md:right-10 w-full md:w-[420px] h-[80vh] md:h-[650px] bg-[#A9C7E3] rounded-t-[32px] md:rounded-[40px] shadow-2xl border-x-4 border-t-4 md:border-4 border-white flex flex-col z-[100]">
          <div onMouseDown={onMouseDownChat} className="p-5 md:p-6 bg-white/95 backdrop-blur-md flex justify-between items-center cursor-move border-b border-black/5 rounded-t-[28px] md:rounded-t-[36px] text-slate-900"><span className="font-black text-sm">🗨️ 정보공유방</span><button onClick={() => setIsChatOpen(false)} className="w-9 h-9 bg-slate-100 hover:bg-red-500 hover:text-white rounded-full flex items-center justify-center font-bold transition-all">✕</button></div>
          <div className="flex-1 overflow-y-auto p-4 md:p-6 space-y-6">{messages.map((m) => (<div key={m.id} className={`flex ${m.sender_id === myId ? 'flex-row-reverse' : 'flex-row'} items-end gap-2 group`}><button onClick={() => onDeleteMessage(m.id)} className="opacity-0 group-hover:opacity-100 w-7 h-7 bg-white/80 rounded-full text-red-600 font-black text-[11px] flex items-center justify-center transition-all">X</button><div className={`p-4 shadow-xl ${m.sender_id === myId ? 'bg-[#FEE500] rounded-[24px] rounded-tr-none' : 'bg-white rounded-[24px] rounded-tl-none'} max-w-[80%]`}> <p className="text-[15px] text-black font-extrabold whitespace-pre-wrap leading-snug">{m.content}</p></div><span className="text-[10px] font-black text-slate-700 mb-1 leading-none">{new Date(m.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span></div>))} <div ref={scrollRef} /></div>
          <form onSubmit={onSend} className="p-4 md:p-6 bg-white md:rounded-b-[36px] border-t-2 border-slate-50"><div className="flex gap-3"><input className="flex-1 bg-slate-100 p-4 rounded-2xl text-sm font-bold text-slate-900 outline-none focus:ring-4 focus:ring-yellow-400 transition-all" value={chatInput} onChange={(e) => setChatInput(e.target.value)} placeholder="메시지 입력..." /><button className="bg-[#FEE500] hover:bg-[#F9E000] px-6 py-4 rounded-2xl font-black text-sm shadow-lg active:scale-95 transition-all text-slate-900">전송</button></div></form>
        </div>
      )}

      <style jsx global>{`.custom-scrollbar::-webkit-scrollbar { width: 6px; } .custom-scrollbar::-webkit-scrollbar-thumb { background: #CBD5E0; border-radius: 10px; }`}</style>
    </div>
  );
}