'use client';

import { useEffect, useState, useRef } from 'react';
import { supabase } from '@/lib/supabase';
import { 
  FileText, FilePlus, Image as ImageIcon, 
  FileSpreadsheet, FileBox, File, Download, Trash2,
  GripVertical, Calendar as CalendarIcon, LayoutDashboard, Plus,
  ChevronLeft, ChevronRight, X, Clock, CalendarDays, Lock
} from 'lucide-react';

export default function IntegratedPortal() {
  // --- [1. 보안 및 입장 코드 설정] ---
  const DEPARTMENT_PASSWORD = process.env.NEXT_PUBLIC_ACCESS_CODE || "dphs"; 
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [accessCode, setAccessCode] = useState('');
  const [isError, setIsError] = useState(false);
  const [isMounted, setIsMounted] = useState(false);

  // --- [2. 채팅 상태 및 로직: 팀장님 스타일 100% 고정 / 절대 수정 금지] ---
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

  // --- [3. 문서함 및 일정 공통 로직 상태] ---
  const [viewMode, setViewMode] = useState<'files' | 'calendar'>('files');
  const [files, setFiles] = useState<any[]>([]);
  const [categories, setCategories] = useState<any[]>([]);
  const [newCatName, setNewCatName] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('전체');
  const [uploading, setUploading] = useState(false);
  const [isDragOver, setIsDragOver] = useState(false);
  const [draggedItemIndex, setDraggedItemIndex] = useState<number | null>(null);
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [editTitleValue, setEditTitleValue] = useState('');

  // --- [4. 달력 특화 상태: 상세 팝업 및 드래그 상태] ---
  const [schedules, setSchedules] = useState<any[]>([]);
  const [currentMonth, setCurrentMonth] = useState(new Date());
  const [selectedSchedule, setSelectedSchedule] = useState<any | null>(null); 
  const [draggedScheduleId, setDraggedScheduleId] = useState<number | null>(null); 

  // --- [5. 초기 마운트 및 보안 체크] ---
  useEffect(() => {
    setIsMounted(true);
    if (localStorage.getItem('dept_auth_confirm') === 'true') {
      setIsAuthenticated(true);
    }
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

  // --- [6. 기능 함수 로직 (팀장님 코드와 100% 동일)] ---
  useEffect(() => {
    if (isChatOpen) {
      setHasUnread(false);
      const timer = setTimeout(() => { if (scrollRef.current) scrollRef.current.scrollIntoView({ behavior: 'smooth', block: 'end' }); }, 100);
      return () => clearTimeout(timer);
    }
  }, [messages, isChatOpen]);

  const onMouseDownChat = (e: React.MouseEvent) => { setIsDraggingChat(true); dragStartPos.current = { x: e.clientX - position.x, y: e.clientY - position.y }; };
  useEffect(() => {
    const onMouseMove = (e: MouseEvent) => { if (!isDraggingChat) return; setPosition({ x: e.clientX - dragStartPos.current.x, y: e.clientY - dragStartPos.current.y }); };
    const onMouseUp = () => setIsDraggingChat(false);
    if (isDraggingChat) { window.addEventListener('mousemove', onMouseMove); window.addEventListener('mouseup', onMouseUp); }
    return () => { window.removeEventListener('mousemove', onMouseMove); window.removeEventListener('mouseup', onMouseUp); };
  }, [isDraggingChat]);

  const onSend = async (e: React.FormEvent) => { e.preventDefault(); if (!chatInput.trim()) return; await supabase.from('messages').insert([{ content: chatInput, sender_id: myId }]); setChatInput(''); };
  const onDeleteMessage = async (id: number) => { if (!confirm('삭제하시겠습니까?')) return; setMessages(prev => prev.filter(m => m.id !== id)); await supabase.from('messages').delete().eq('id', id); };
  const fetchMessages = async () => { const { data } = await supabase.from('messages').select('*').order('created_at', { ascending: true }); if (data) setMessages(data); };
  const fetchFiles = async () => { const { data } = await supabase.from('files').select('*').order('created_at', { ascending: false }); if (data) setFiles(data); };
  const fetchCategories = async () => { const { data } = await supabase.from('categories').select('*').order('order_index', { ascending: true }); if (data) setCategories(data); };
  const fetchSchedules = async () => { const { data } = await supabase.from('schedules').select('*').order('start_time', { ascending: true }); if (data) setSchedules(data); };
  const onAddSchedule = async (dateStr: string) => { const title = prompt(`${dateStr} 일정 제목:`); if (!title) return; const start = prompt(`시작:`, "10:00") || "10:00"; const end = prompt(`종료:`, "11:00") || "11:00"; await supabase.from('schedules').insert([{ title, date: dateStr, start_time: start, end_time: end }]); fetchSchedules(); };
  const onDeleteSchedule = async (id: number) => { if (confirm('삭제?')) { await supabase.from('schedules').delete().eq('id', id); setSelectedSchedule(null); fetchSchedules(); } };
  const onScheduleDragStart = (e: React.DragEvent, id: number) => { setDraggedScheduleId(id); e.dataTransfer.effectAllowed = "move"; };
  const onDayDrop = async (dateStr: string) => { if (draggedScheduleId === null) return; await supabase.from('schedules').update({ date: dateStr }).eq('id', draggedScheduleId); fetchSchedules(); setDraggedScheduleId(null); };
  const handleDownload = async (url: string, originalName: string) => { try { const response = await fetch(url); const blob = await response.blob(); const downloadUrl = window.URL.createObjectURL(blob); const link = document.createElement('a'); link.href = downloadUrl; link.download = originalName; document.body.appendChild(link); link.click(); link.remove(); window.URL.revokeObjectURL(downloadUrl); } catch (e) { alert('다운로드 오류'); } };
  const getFileIcon = (fileName: string) => { const ext = fileName.split('.').pop()?.toLowerCase(); if (ext === 'hwp') return { icon: <FileText size={20} className="text-blue-500" />, color: 'bg-blue-50', label: 'HWP' }; if (ext === 'pdf') return { icon: <FileText size={20} className="text-red-500" />, color: 'bg-red-50', label: 'PDF' }; return { icon: <File size={20} className="text-slate-400" />, color: 'bg-slate-50', label: 'FILE' }; };
  const handleUpload = async (fileList: FileList | File[]) => { setUploading(true); for (const file of Array.from(fileList)) { const safeFileName = `${Date.now()}_${Math.random().toString(36).substring(2, 7)}.${file.name.split('.').pop()}`; const { data } = await supabase.storage.from('files').upload(safeFileName, file); if (data) { const { data: { publicUrl } } = supabase.storage.from('files').getPublicUrl(safeFileName); await supabase.from('files').insert([{ name: file.name, url: publicUrl, size: file.size, category: selectedCategory === '전체' ? '일반' : selectedCategory }]); } } await fetchFiles(); setUploading(false); };
  
  // --- [인플레이스 수정 함수] ---
  const onUpdateCategoryName = async () => { 
    const targetCat = categories.find(c => c.name === selectedCategory); 
    if (!targetCat || !editTitleValue.trim()) return; 
    await supabase.from('categories').update({ name: editTitleValue.trim() }).eq('id', targetCat.id); 
    setSelectedCategory(editTitleValue.trim()); 
    setIsEditingTitle(false); 
    fetchCategories(); 
  };

  const handleAuthSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (accessCode === DEPARTMENT_PASSWORD) { setIsAuthenticated(true); localStorage.setItem('dept_auth_confirm', 'true'); } 
    else { setIsError(true); setAccessCode(''); }
  };

  if (!isMounted) return null;

  // --- [인증 전 화면] ---
  if (!isAuthenticated) {
    return (
      <div className="h-screen bg-[#1A1C1E] flex items-center justify-center p-6 font-sans">
        <div className="bg-white w-full max-w-md rounded-[40px] shadow-2xl p-12 flex flex-col items-center animate-in zoom-in-95 duration-300">
          <div className="bg-blue-50 p-6 rounded-[32px] mb-8 text-blue-600 shadow-inner"><Lock size={48} strokeWidth={2.5} /></div>
          <h1 className="text-2xl font-black text-slate-800 mb-2 tracking-tight text-center">공공의료지원과 전용</h1>
          <p className="text-slate-400 font-bold mb-10 text-center text-sm italic">입장 코드를 입력하여 본인 인증을 완료하세요.</p>
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
      <header className="bg-[#1A1C1E] p-4 px-8 flex justify-between items-center z-50 shadow-md text-white border-b border-white/5">
        <div className="flex items-center gap-3"><span className="text-2xl">📂</span><h1 className="font-extrabold text-lg tracking-tight uppercase">공공의료지원과 공유문서함</h1></div>
        <div className="flex items-center gap-4">
          <button onClick={() => setViewMode(viewMode === 'calendar' ? 'files' : 'calendar')} className={`flex items-center gap-2 px-6 py-2.5 rounded-2xl font-black transition-all shadow-md active:scale-95 ${viewMode === 'calendar' ? 'bg-slate-700 text-white' : 'bg-white text-slate-900 hover:bg-slate-100'}`}><CalendarIcon size={18}/><span>{viewMode === 'calendar' ? '문서함으로 돌아가기' : '부서 공유 달력'}</span></button>
          {/* 버튼 명칭 '정보공유방'으로 변경 */}
          <button onClick={() => setIsChatOpen(!isChatOpen)} className="relative bg-[#3498DB] hover:bg-[#2980B9] px-5 py-2.5 rounded-2xl font-black transition-all shadow-md active:scale-95 flex items-center gap-2"><span>💬 정보공유방</span>{hasUnread && <span className="absolute -top-1 -right-1 w-4 h-4 bg-red-500 rounded-full border-2 border-[#1A1C1E] animate-bounce"></span>}</button>
          <button onClick={() => { localStorage.removeItem('dept_auth_confirm'); window.location.reload(); }} className="text-slate-500 hover:text-white p-2 transition-colors"><X size={20}/></button>
        </div>
      </header>

      <main className="flex-1 flex overflow-hidden">
        <aside className="w-80 bg-[#EBEEF2] border-r border-slate-300 flex flex-col shadow-[inset_-4px_0_12px_rgba(0,0,0,0.03)] h-full">
          <div className="p-6 pb-2 text-slate-400"><p className="text-[10px] font-black uppercase tracking-[0.2em] px-2 italic">Classification</p></div>
          <div className="flex-1 overflow-y-auto px-6 py-2 custom-scrollbar">
            <div className="space-y-1.5 mb-4">
              <button onClick={() => { setViewMode('files'); setSelectedCategory('전체'); }} className={`w-full text-left px-4 py-3.5 rounded-xl text-sm font-bold transition-all ${selectedCategory === '전체' && viewMode === 'files' ? 'bg-white shadow-md text-blue-600 ring-1 ring-slate-200' : 'text-slate-500 hover:bg-slate-200/60'}`}>🏠 전체 문서 보기</button>
              {categories.map((cat, idx) => (
                <div key={cat.id} draggable onDragStart={() => setDraggedItemIndex(idx)} onDragOver={(e) => e.preventDefault()} onDrop={async() => {
                   if (draggedItemIndex === null || draggedItemIndex === idx) return;
                   const newCats = [...categories]; const item = newCats.splice(draggedItemIndex, 1)[0]; newCats.splice(idx, 0, item);
                   setCategories(newCats); for(let i=0; i<newCats.length; i++) await supabase.from('categories').update({order_index: i}).eq('id', newCats[i].id);
                   setDraggedItemIndex(null);
                }} className={`group relative flex items-center gap-1 cursor-grab active:cursor-grabbing transition-transform ${draggedItemIndex === idx ? 'opacity-30' : 'opacity-100'}`}>
                  <div className="absolute left-1 opacity-0 group-hover:opacity-40"><GripVertical size={14}/></div>
                  <button onClick={() => { setViewMode('files'); setSelectedCategory(cat.name); }} className={`flex-1 text-left px-4 py-3.5 rounded-xl text-sm font-bold transition-all pl-6 ${selectedCategory === cat.name && viewMode === 'files' ? 'bg-white shadow-md text-blue-600 ring-1 ring-slate-200' : 'text-slate-500 hover:bg-slate-200/60'}`}>📁 {cat.name}</button>
                  <button onClick={async() => { if(confirm('삭제?')) await supabase.from('categories').delete().eq('id', cat.id); }} className="absolute right-2 top-4 opacity-0 group-hover:opacity-100 text-red-300 hover:text-red-500 text-xs px-2 transition-opacity">✕</button>
                </div>
              ))}
            </div>
          </div>
          <div className="p-6 border-t border-slate-300 bg-[#EBEEF2]">
            <div className="flex gap-2 bg-white p-2.5 rounded-2xl border border-slate-200 focus-within:ring-2 focus-within:ring-blue-100 shadow-sm transition-all"><input className="flex-1 bg-transparent border-none text-xs font-bold outline-none px-2 text-slate-900" placeholder="분류 추가..." value={newCatName} onChange={(e) => setNewCatName(e.target.value)} onKeyDown={async(e) => { if(e.key === 'Enter' && newCatName.trim()) { await supabase.from('categories').insert([{ name: newCatName.trim(), order_index: categories.length }]); setNewCatName(''); } }} />
            <button onClick={async() => { if(newCatName.trim()) { await supabase.from('categories').insert([{ name: newCatName.trim(), order_index: categories.length }]); setNewCatName(''); } }} className="bg-slate-900 text-white w-8 h-8 rounded-xl shadow-sm font-black text-sm">+</button></div>
          </div>
        </aside>

        <section onDragOver={(e) => { e.preventDefault(); if(viewMode==='files') setIsDragOver(true); }} onDragLeave={() => setIsDragOver(false)} onDrop={(e) => { e.preventDefault(); setIsDragOver(false); if(viewMode==='files') handleUpload(e.dataTransfer.files); }} className={`flex-1 flex flex-col bg-white overflow-hidden relative shadow-inner transition-colors duration-200 ${isDragOver ? 'bg-blue-50/50' : 'bg-white'}`}>
          <div className="max-w-6xl w-full mx-auto flex flex-col h-full p-12">
            <div className="flex justify-between items-start mb-10">
              <div className="flex-1">
                {/* [중요: 인플레이스 수정 UI - 제목 자리에 바로 입력창 노출] */}
                <div className="group flex items-center gap-4 mb-2">
                  {isEditingTitle && viewMode === 'files' ? (
                    <div className="flex items-center gap-3 w-full">
                      <input 
                        className="text-4xl font-black text-slate-900 tracking-tighter bg-white border-b-4 border-blue-600 outline-none w-full max-w-2xl py-1" 
                        value={editTitleValue} 
                        onChange={(e)=>setEditTitleValue(e.target.value)} 
                        autoFocus 
                        onKeyDown={(e) => e.key === 'Enter' && onUpdateCategoryName()}
                      />
                      <button onClick={onUpdateCategoryName} className="bg-blue-600 text-white px-5 py-2 rounded-2xl text-xs font-black shadow-lg">저장</button>
                      <button onClick={() => setIsEditingTitle(false)} className="bg-slate-200 text-slate-600 px-5 py-2 rounded-2xl text-xs font-black">취소</button>
                    </div>
                  ) : (
                    <>
                      <h2 className="text-4xl font-black text-slate-800 tracking-tighter uppercase">{viewMode === 'calendar' ? '부서 공유 달력' : selectedCategory}</h2>
                      {viewMode === 'files' && selectedCategory !== '전체' && (
                        <button onClick={() => { setEditTitleValue(selectedCategory); setIsEditingTitle(true); }} className="opacity-0 group-hover:opacity-100 bg-slate-100 text-slate-400 p-2 rounded-xl hover:text-blue-500 text-xs font-bold transition-all">✎ 수정</button>
                      )}
                    </>
                  )}
                </div>
                <p className="text-sm text-slate-400 font-medium tracking-tight italic">{viewMode === 'calendar' ? '팀원들의 시간을 확인하고 일정을 공유하세요.' : '부서 전용 공유 폴더를 체계적으로 관리하세요.'}</p>
              </div>
              {viewMode === 'files' && (<label className="bg-blue-600 text-white px-8 py-3.5 rounded-3xl font-black cursor-pointer shadow-lg active:scale-95 flex items-center gap-2"><Plus size={18} /><span>파일 업로드</span><input type="file" className="hidden" multiple onChange={(e) => e.target.files && handleUpload(e.target.files)} /></label>)}
            </div>

            {viewMode === 'calendar' ? (
              <div className="flex-1 flex flex-col overflow-hidden">
                <div className="flex items-center gap-6 mb-8">
                  <h3 className="text-2xl font-black text-slate-700">{currentMonth.getFullYear()}년 {currentMonth.getMonth() + 1}월</h3>
                  <div className="flex gap-2"><button onClick={() => setCurrentMonth(new Date(currentMonth.setMonth(currentMonth.getMonth() - 1)))} className="p-3 bg-slate-100 rounded-2xl hover:bg-slate-200 transition-colors"><ChevronLeft size={18}/></button><button onClick={() => setCurrentMonth(new Date(currentMonth.setMonth(currentMonth.getMonth() + 1)))} className="p-3 bg-slate-100 rounded-2xl hover:bg-slate-200 transition-colors"><ChevronRight size={18}/></button><button onClick={() => setCurrentMonth(new Date())} className="px-6 py-2 bg-slate-900 text-white text-xs font-bold rounded-2xl shadow-md">오늘</button></div>
                </div>
                <div className="flex-1 overflow-y-auto pr-2 custom-scrollbar">
                  <div className="grid grid-cols-7 gap-px bg-slate-200 border border-slate-200 rounded-[32px] overflow-hidden shadow-2xl">
                    {['일', '월', '화', '수', '목', '금', '토'].map(d => (<div key={d} className="bg-slate-50 p-5 text-center text-xs font-black text-slate-400 uppercase tracking-widest">{d}</div>))}
                    {Array.from({length: new Date(currentMonth.getFullYear(), currentMonth.getMonth(), 1).getDay()}).map((_, i) => <div key={`empty-${i}`} className="bg-slate-50/40 min-h-[160px]" />)}
                    {Array.from({length: new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1, 0).getDate()}).map((_, i) => {
                      const day = i + 1; const dateStr = `${currentMonth.getFullYear()}-${String(currentMonth.getMonth() + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
                      const daySchedules = schedules.filter(s => s.date === dateStr);
                      return (
                        <div key={day} onDragOver={(e)=>e.preventDefault()} onDrop={()=>onDayDrop(dateStr)} className="bg-white min-h-[160px] p-4 transition-all hover:bg-blue-50/20 group relative border-r border-b border-slate-100">
                          <div className="flex justify-between items-start mb-3"><span className={`text-base font-black ${ (new Date(dateStr).getDay() === 0) ? 'text-red-500' : (new Date(dateStr).getDay() === 6) ? 'text-blue-500' : 'text-slate-800' }`}>{day}</span><button onClick={() => onAddSchedule(dateStr)} className="opacity-0 group-hover:opacity-100 bg-slate-900 text-white p-1.5 rounded-xl shadow-lg transition-all hover:scale-110"><Plus size={14}/></button></div>
                          <div className="space-y-2">{daySchedules.map(s => (<div key={s.id} draggable onDragStart={(e)=>onScheduleDragStart(e, s.id)} onClick={()=>setSelectedSchedule(s)} className="bg-white border border-blue-100 text-slate-800 text-[11px] p-2.5 rounded-xl font-bold shadow-sm flex flex-col gap-0.5 group/item relative overflow-hidden cursor-pointer hover:border-blue-400 hover:shadow-md transition-all active:scale-95"><div className="flex items-center gap-1 text-blue-600 mb-0.5"><Clock size={10}/><span className="text-[9px] font-black">{s.start_time} - {s.end_time}</span></div><span className="truncate text-slate-700">{s.title}</span></div>))}</div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            ) : (
              <>
                <div className="relative mb-10 group"><span className="absolute left-6 top-5 text-slate-300 font-black text-[10px] tracking-widest">SEARCH</span><input className="w-full bg-[#F8FAFC] border border-slate-100 p-5 pl-24 rounded-3xl text-sm font-bold text-slate-900 outline-none focus:bg-white focus:ring-4 focus:ring-blue-50 shadow-sm transition-all shadow-[inset_0_2px_4px_rgba(0,0,0,0.02)]" placeholder="파일명 검색..." value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} /></div>
                <div className="flex-1 overflow-y-auto pr-2 custom-scrollbar"><table className="w-full text-left"><thead className="sticky top-0 bg-white z-10 border-b border-slate-100"><tr className="text-[11px] text-slate-300 font-black uppercase tracking-widest"><th className="pb-5 px-4 w-2/3">Document Title</th><th className="pb-5">Label</th><th className="pb-5 text-right px-4">Action</th></tr></thead><tbody className="divide-y divide-slate-50">{files.filter(f => f.name.toLowerCase().includes(searchQuery.toLowerCase()) && (selectedCategory === '전체' || f.category === selectedCategory)).map(file => { const info = getFileIcon(file.name); return (<tr key={file.id} className="group hover:bg-slate-50/50 transition-all hover:translate-x-1"><td className="py-6 px-4"><div onClick={() => handleDownload(file.url, file.name)} className="flex items-center gap-4 cursor-pointer"><div className={`w-12 h-12 ${info.color} rounded-2xl flex flex-col items-center justify-center border border-transparent group-hover:border-slate-200 shadow-sm transition-all`}>{info.icon}<span className="text-[7px] font-black text-slate-400 mt-0.5">{info.label}</span></div><span className="font-bold text-slate-900 text-base group-hover:text-blue-600 transition-colors">{file.name}</span></div></td><td className="py-6"><span className="text-[10px] font-black bg-blue-50 text-blue-500 px-3 py-1.5 rounded-lg border border-blue-100 uppercase">{file.category}</span></td><td className="py-6 text-right px-4 space-x-4"><button onClick={() => handleDownload(file.url, file.name)} className="text-blue-400 hover:text-blue-600 transition-colors"><Download size={18}/></button><button onClick={async () => { if(confirm('삭제?')) await supabase.from('files').delete().eq('id', file.id); }} className="text-red-200 hover:text-red-500 transition-colors"><Trash2 size={18}/></button></td></tr>); })}</tbody></table></div>
              </>
            )}
          </div>
        </section>
      </main>

      {selectedSchedule && (<div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/40 backdrop-blur-sm p-4 animate-in fade-in duration-200"><div className="bg-white w-full max-w-md rounded-[32px] shadow-2xl overflow-hidden animate-in zoom-in-95 duration-200"><div className="p-8 flex flex-col items-center"><div className="bg-blue-50 p-3 rounded-2xl text-blue-600 mb-6"><CalendarDays size={24}/></div><h3 className="text-2xl font-black text-slate-800 mb-2 leading-tight text-center">{selectedSchedule.title}</h3><p className="text-slate-400 font-bold mb-8 text-center">{selectedSchedule.date} | {selectedSchedule.start_time} - {selectedSchedule.end_time}</p><div className="flex gap-3 w-full"><button onClick={async () => { if(confirm('삭제?')) { await supabase.from('schedules').delete().eq('id', selectedSchedule.id); setSelectedSchedule(null); fetchSchedules(); } }} className="flex-1 bg-red-50 text-red-500 py-4 rounded-2xl font-black flex items-center justify-center gap-2 transition-all hover:bg-red-500 hover:text-white"><Trash2 size={18}/> 삭제</button><button onClick={() => setSelectedSchedule(null)} className="flex-1 bg-slate-900 text-white py-4 rounded-2xl font-black transition-all hover:bg-black">닫기</button></div></div></div></div>)}

      {isChatOpen && (
        <div ref={chatRef} style={{ transform: `translate(${position.x}px, ${position.y}px)`, willChange: 'transform' }} className="fixed bottom-10 right-10 w-[420px] h-[650px] bg-[#A9C7E3] rounded-[40px] shadow-[0_30px_60px_rgba(0,0,0,0.3)] border-4 border-white flex flex-col z-[100]">
          <div onMouseDown={onMouseDownChat} className="p-6 bg-white/95 backdrop-blur-md flex justify-between items-center cursor-move border-b border-black/5 rounded-t-[36px] text-slate-900"><span className="font-black text-sm">🗨️ 정보공유방</span><button onClick={() => setIsChatOpen(false)} className="w-9 h-9 bg-slate-100 hover:bg-red-500 hover:text-white rounded-full flex items-center justify-center font-bold transition-all">✕</button></div>
          <div className="flex-1 overflow-y-auto p-6 space-y-6">{messages.map((m) => (<div key={m.id} className={`flex ${m.sender_id === myId ? 'flex-row-reverse' : 'flex-row'} items-end gap-2 group`}><button onClick={() => onDeleteMessage(m.id)} className="opacity-0 group-hover:opacity-100 w-7 h-7 bg-white/80 rounded-full text-red-600 font-black text-[11px] flex items-center justify-center transition-all">X</button><div className={`p-4 shadow-xl ${m.sender_id === myId ? 'bg-[#FEE500] rounded-[24px] rounded-tr-none' : 'bg-white rounded-[24px] rounded-tl-none'} max-w-[80%]`}> <p className="text-[15px] text-black font-extrabold whitespace-pre-wrap leading-snug">{m.content}</p></div><span className="text-[10px] font-black text-slate-700 mb-1 leading-none">{new Date(m.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span></div>))} <div ref={scrollRef} /></div>
          <form onSubmit={onSend} className="p-6 bg-white rounded-b-[36px] border-t-2 border-slate-50"><div className="flex gap-3"><input className="flex-1 bg-slate-100 p-4 rounded-2xl text-sm font-bold text-slate-900 outline-none focus:ring-4 focus:ring-yellow-400 transition-all" value={chatInput} onChange={(e) => setChatInput(e.target.value)} placeholder="메시지 입력..." /><button className="bg-[#FEE500] hover:bg-[#F9E000] px-6 py-4 rounded-2xl font-black text-sm shadow-lg active:scale-95 transition-all text-slate-900">전송</button></div></form>
        </div>
      )}

      <style jsx global>{`.custom-scrollbar::-webkit-scrollbar { width: 6px; } .custom-scrollbar::-webkit-scrollbar-track { bg: transparent; } .custom-scrollbar::-webkit-scrollbar-thumb { background: #CBD5E0; border-radius: 10px; } .custom-scrollbar::-webkit-scrollbar-thumb:hover { background: #A0AEC0; } @keyframes shake { 0%, 100% { transform: translateX(0); } 10%, 30%, 50%, 70%, 90% { transform: translateX(-5px); } 20%, 40%, 60%, 80% { transform: translateX(5px); } } .animate-shake { animation: shake 0.5s; }`}</style>
    </div>
  );
}