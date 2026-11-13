'use client';

import { useCallback, useEffect, useState, useRef } from 'react';
import { supabase } from '@/lib/supabase';
import SharedDashboard from '@/app/components/shared-dashboard';
import DeviceAccessGate from '@/app/components/device-access-gate';
import DeviceManagerModal from '@/app/components/device-manager-modal';
import UndoToast, { type UndoNotice } from '@/app/components/undo-toast';
import ScheduleFormModal, { type NewScheduleInput, type ScheduleRecurrenceSubmission } from '@/app/components/schedule-form-modal';
import WhiteboardImportModal, { type WhiteboardCorrectionInput, type WhiteboardScheduleUpdate } from '@/app/components/whiteboard-import-modal';
import CommandPalette from '@/app/components/command-palette';
import ActivityHistoryModal, { type ActivityLogRow } from '@/app/components/activity-history-modal';
import DashboardKiosk from '@/app/components/dashboard-kiosk';
import MonthlyAbsenceBoard from '@/app/components/monthly-absence-board';
import QuickScheduleInput from '@/app/components/quick-schedule-input';
import YearlyDocumentCleanupModal, { type YearlyCleanupCategory, type YearlyCleanupFile, type YearlyDocumentCleanupTarget } from '@/app/components/yearly-document-cleanup-modal';
import { attachRecurrenceMetadata, createRecurrenceGroupId, isRecurringSchedule, type RecurrenceOccurrenceFields, type RecurrenceScope } from '@/lib/schedule-recurrence';
import { getScheduleCategory, scheduleCategoryOrder, scheduleCategoryStyles } from '@/lib/schedule-category';
import { findDuplicateSchedules, getSchedulePeople, scheduleMatchesPerson, type WorkflowSchedule } from '@/lib/schedule-workflow';
import PortalMobileActions from '@/app/components/portal-mobile-actions';
import PortalDesktopActions from '@/app/components/portal-desktop-actions';
import WeeklySchedulePrint from '@/app/components/weekly-schedule-print';
import DocumentLibrary, { type DocumentFile } from '@/app/components/document-library';
import DocumentPreviewModal from '@/app/components/document-preview-modal';
import DocumentUploadStatus from '@/app/components/document-upload-status';
import CategoryActions from '@/app/components/category-actions';
import { createDocumentUploads, createDocumentUploadRunner, type UploadItem } from '@/lib/document-upload';
import { getRequiredHolidayYears, mergeHolidayYear, type KoreanHoliday } from '@/lib/korean-holidays';
import JSZip from 'jszip';
import { 
  FilePlus,
  Trash2,
  GripVertical, LayoutDashboard, Plus,
  ChevronLeft, ChevronRight, X, Clock, CalendarDays, Archive, Menu, Siren, Pencil, ScanLine, Copy, ExternalLink
} from 'lucide-react';

type PortalSchedule = NewScheduleInput & Partial<RecurrenceOccurrenceFields> & { id: number };

const EXTERNAL_CALENDAR_URL = 'https://my-calendar-eta.vercel.app';
const EXTERNAL_CALENDAR_EMBED_URL = `${EXTERNAL_CALENDAR_URL}/?embed=1`;

const getLocalDateKey = (date = new Date()) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
const isDedicatedKioskLocation = () => typeof window !== 'undefined'
  && new URLSearchParams(window.location.search).get('kiosk') === '1';

type ManagedScreen = Screen & {
  availLeft?: number;
  availTop?: number;
};

const normalizeCategoryLinkName = (name: string) => name
  .replace(/\s*\([^)]*\)\s*$/u, '')
  .replace(/^\s*\d{2,4}년(?:도)?\s*/u, '')
  .trim()
  .toLocaleLowerCase('ko-KR');

const isSameCategory = (firstName: string, secondName: string) => firstName === secondName
  || normalizeCategoryLinkName(firstName) === normalizeCategoryLinkName(secondName);

const getCategoryMeetingTone = (categoryName: string) => {
  if (categoryName.includes('회의록')) return null;
  if (categoryName.includes('확대간부회의')) return {
    text: 'text-slate-500',
    badge: 'bg-white text-slate-700 ring-slate-300',
    active: 'bg-white text-slate-700 ring-slate-200 shadow-sm',
    hover: 'hover:bg-slate-200/60',
  };
  if (categoryName.includes('정책결정회의')) return {
    text: 'text-indigo-700',
    badge: 'bg-indigo-50 text-indigo-700 ring-indigo-200',
    active: 'bg-indigo-50/90 ring-indigo-200 shadow-sm',
    hover: 'hover:bg-indigo-50/60',
  };
  if (categoryName.includes('월례회의')) return {
    text: 'text-amber-700',
    badge: 'bg-amber-50 text-amber-800 ring-amber-200',
    active: 'bg-amber-50/90 ring-amber-200 shadow-sm',
    hover: 'hover:bg-amber-50/60',
  };
  if (categoryName.includes('팀회의')) return {
    text: 'text-teal-700',
    badge: 'bg-teal-50 text-teal-700 ring-teal-200',
    active: 'bg-teal-50/90 ring-teal-200 shadow-sm',
    hover: 'hover:bg-teal-50/60',
  };
  return null;
};

export default function IntegratedPortal() {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isDeviceAdmin, setIsDeviceAdmin] = useState(false);
  const [isDeviceManagerOpen, setIsDeviceManagerOpen] = useState(false);
  const [isMounted, setIsMounted] = useState(false);
  const [todayStr, setTodayStr] = useState(() => getLocalDateKey());

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
  const [uploadItems, setUploadItems] = useState<UploadItem[]>([]);
  const uploadBusyRef = useRef(false);
  const [previewFile, setPreviewFile] = useState<DocumentFile | null>(null);
  const [metadataAvailable, setMetadataAvailable] = useState(false);
  const metadataAvailableRef = useRef(false);
  const [myScheduleName, setMyScheduleName] = useState('');
  const [showMySchedules, setShowMySchedules] = useState(false);
  const [isWeeklyPrintOpen, setIsWeeklyPrintOpen] = useState(false);
  const [scheduleLoadError, setScheduleLoadError] = useState('');
  const [uploadRunner] = useState(() => createDocumentUploadRunner({
    upload: async (item) => {
      const { error } = await supabase.storage.from('files').upload(item.storagePath, item.file, { upsert: true });
      if (error) throw new Error(`파일 전송 실패: ${error.message}`);
      const { data } = supabase.storage.from('files').getPublicUrl(item.storagePath);
      return { url: data.publicUrl };
    },
    ensureMetadata: async (item) => {
      if (metadataAvailableRef.current) {
        const { error } = await supabase.rpc('register_uploaded_document', { p_name: item.file.name, p_url: item.url, p_size: item.file.size, p_category: item.targetCategory });
        if (error) throw new Error(`목록 등록 실패: ${error.message}`);
        return;
      }
      // The URL belongs to this upload's stable UUID path. Recheck before retrying
      // a metadata request whose response may have been lost after committing.
      const { data, error: lookupError } = await supabase.from('files').select('id').eq('url', item.url).limit(1);
      if (lookupError) throw new Error(`등록 결과 확인 실패: ${lookupError.message}`);
      if (data?.length) return;
      const { error } = await supabase.from('files').insert({ name: item.file.name, url: item.url, size: item.file.size, category: item.targetCategory });
      if (error) throw new Error(`목록 등록 실패: ${error.message}`);
    },
  }));
  const [isDownloadingAll, setIsDownloadingAll] = useState(false); 
  const [draggedItemIndex, setDraggedItemIndex] = useState<number | null>(null);
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [editTitleValue, setEditTitleValue] = useState('');
  const [isDragOver, setIsDragOver] = useState(false);
  const [isMobileSidebarOpen, setIsMobileSidebarOpen] = useState(false);

  const [schedules, setSchedules] = useState<any[]>([]);
  const [currentMonth, setCurrentMonth] = useState(new Date());
  const [selectedCalendarDate, setSelectedCalendarDate] = useState(() => getLocalDateKey());
  const [koreanHolidays, setKoreanHolidays] = useState<Record<string, string[]>>({});
  const [selectedSchedule, setSelectedSchedule] = useState<any | null>(null);
  const [draggedScheduleId, setDraggedScheduleId] = useState<number | null>(null);
  const [scheduleFormDate, setScheduleFormDate] = useState<string | null>(null);
  const [editingSchedule, setEditingSchedule] = useState<any | null>(null);
  const [isCopyingSchedule, setIsCopyingSchedule] = useState(false);
  const [isWhiteboardImportOpen, setIsWhiteboardImportOpen] = useState(false);
  const [isCommandPaletteOpen, setIsCommandPaletteOpen] = useState(false);
  const [isActivityHistoryOpen, setIsActivityHistoryOpen] = useState(false);
  const [isKioskOpen, setIsKioskOpen] = useState(isDedicatedKioskLocation);
  const [kioskLaunchNotice, setKioskLaunchNotice] = useState('');
  const [isDedicatedKiosk] = useState(isDedicatedKioskLocation);
  const [isAbsenceBoardOpen, setIsAbsenceBoardOpen] = useState(false);
  const [isQuickScheduleOpen, setIsQuickScheduleOpen] = useState(false);
  const [isYearlyCleanupOpen, setIsYearlyCleanupOpen] = useState(false);
  const [isActivityHistoryLoading, setIsActivityHistoryLoading] = useState(false);
  const [activityLogs, setActivityLogs] = useState<ActivityLogRow[]>([]);
  const [recurrenceScope, setRecurrenceScope] = useState<RecurrenceScope>('this');
  const [pendingRecurrenceMove, setPendingRecurrenceMove] = useState<{ schedule: PortalSchedule; targetDate: string } | null>(null);
  const [undoNotices, setUndoNotices] = useState<UndoNotice[]>([]);
  const pendingDeleteKeysRef = useRef(new Set<string>());
  const undoTimersRef = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const undoActionsRef = useRef(new Map<string, { keys: string[]; restore: () => void }>());

  useEffect(() => {
    setIsMounted(true);
    try { setMyScheduleName(localStorage.getItem('portal-schedule-person') ?? ''); } catch { /* Storage may be disabled. */ }
  }, []);

  useEffect(() => {
    if (!isDedicatedKiosk) return;
    const kioskUrl = new URL('/kiosk', window.location.origin);
    // 오래된 전광판 링크도 기본은 설치 없는 브라우저 창으로 엽니다.
    // 실행기를 명시한 기존 링크만 별도 호환 경로를 유지합니다.
    if (new URLSearchParams(window.location.search).get('launcher') === '1') {
      kioskUrl.searchParams.set('launcher', '1');
    }
    window.location.replace(kioskUrl.toString());
  }, [isDedicatedKiosk]);

  useEffect(() => {
    const interval = window.setInterval(() => {
      const nextToday = getLocalDateKey();
      setTodayStr((currentToday) => currentToday === nextToday ? currentToday : nextToday);
    }, 60_000);
    return () => window.clearInterval(interval);
  }, []);

  const handleDeviceApproved = useCallback((access: { userId: string; isAdmin: boolean }) => {
    setIsAuthenticated(true);
    setIsDeviceAdmin(access.isAdmin);
  }, []);

  useEffect(() => {
    if (!isAuthenticated) return;
    const verifyAccess = async () => {
      const { data, error } = await supabase.rpc('get_device_access_status');
      if (error) {
        console.error('기기 승인 상태를 확인하지 못했습니다.', error);
        return;
      }
      if (data?.status !== 'approved') {
        setIsAuthenticated(false);
        setIsDeviceAdmin(false);
        setIsDeviceManagerOpen(false);
        setIsActivityHistoryOpen(false);
        setIsYearlyCleanupOpen(false);
        return;
      }
      const nextIsAdmin = Boolean(data.is_admin);
      setIsDeviceAdmin(nextIsAdmin);
      if (!nextIsAdmin) {
        setIsDeviceManagerOpen(false);
        setIsActivityHistoryOpen(false);
        setIsYearlyCleanupOpen(false);
      }
    };
    const interval = window.setInterval(() => void verifyAccess(), 30000);
    return () => window.clearInterval(interval);
  }, [isAuthenticated]);

  const holidayYearsKey = getRequiredHolidayYears(currentMonth.getFullYear(), todayStr).join(',');
  useEffect(() => {
    const controller = new AbortController();
    for (const year of holidayYearsKey.split(',').filter(Boolean).map(Number)) {
      fetch(`/api/korean-holidays?year=${year}`, { signal: controller.signal })
        .then(async (response) => {
          if (!response.ok) throw new Error('대한민국 공휴일을 불러오지 못했습니다.');
          const payload = await response.json() as { holidays: KoreanHoliday[] };
          if (!Array.isArray(payload.holidays)) throw new Error('대한민국 공휴일 응답을 확인하지 못했습니다.');
          return payload.holidays;
        })
        .then((holidays) => {
          if (!controller.signal.aborted) setKoreanHolidays((previous) => mergeHolidayYear(previous, year, holidays));
        })
        .catch((error) => {
          if (controller.signal.aborted) return;
          console.error(error);
        });
    }
    return () => controller.abort();
  }, [holidayYearsKey]);

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
      void supabase.from('schedules').select('owner_name,attendee_names,location,linked_file_ids').limit(1)
        .then(({ error }) => { metadataAvailableRef.current = !error; setMetadataAvailable(!error); });

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
  const activeNotices = schedules
    .filter(s => s.is_notice && (s.end_date && s.end_date >= s.date ? s.end_date : s.date) >= todayStr)
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

  const getScheduleDDay = (schedule: any) => {
    const endDate = schedule.end_date && schedule.end_date >= schedule.date ? schedule.end_date : schedule.date;
    if (schedule.date <= todayStr && endDate >= todayStr) return schedule.date === todayStr ? 'D-Day' : '진행 중';
    return getDDay(schedule.date);
  };

  const formatScheduleTime = (schedule: any) => {
    if (schedule.start_time && schedule.end_time) return `${schedule.start_time} - ${schedule.end_time}`;
    if (schedule.start_time) return `${schedule.start_time}부터`;
    if (schedule.end_time) return `${schedule.end_time}까지`;
    return '시간 미정';
  };

  const getScheduleEndDate = (schedule: any) => schedule.end_date && schedule.end_date >= schedule.date ? schedule.end_date : schedule.date;

  const formatScheduleDateRange = (schedule: any) => {
    const endDate = getScheduleEndDate(schedule);
    return endDate === schedule.date ? schedule.date : `${schedule.date} ~ ${endDate}`;
  };

  const formatCalendarScheduleTime = (schedule: any, dateStr: string) => {
    const endDate = getScheduleEndDate(schedule);
    if (endDate === schedule.date) return formatScheduleTime(schedule);
    if (dateStr === schedule.date) return schedule.start_time ? `${schedule.start_time}부터` : '일정 시작';
    if (dateStr === endDate) return schedule.end_time ? `${schedule.end_time}까지` : '일정 종료';
    return '기간 일정';
  };

  const visibleSchedules = showMySchedules ? schedules.filter((schedule) => scheduleMatchesPerson(schedule, myScheduleName)) : schedules;
  const schedulePeople = getSchedulePeople(schedules);
  const getCalendarSchedulesForDate = (dateStr: string) => visibleSchedules
    .filter((schedule) => schedule.date <= dateStr && getScheduleEndDate(schedule) >= dateStr)
    .slice()
    .sort((first, second) => {
      const firstTime = first.start_time ?? first.end_time ?? '99:99';
      const secondTime = second.start_time ?? second.end_time ?? '99:99';
      const timeOrder = firstTime.localeCompare(secondTime);
      if (timeOrder !== 0) return timeOrder;
      const titleOrder = String(first.title ?? '').localeCompare(String(second.title ?? ''), 'ko-KR');
      if (titleOrder !== 0) return titleOrder;
      return String(first.id).localeCompare(String(second.id));
    });

  const formatCalendarDateHeading = (dateStr: string) => {
    const [year, month, day] = dateStr.split('-').map(Number);
    return new Intl.DateTimeFormat('ko-KR', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      weekday: 'long',
    }).format(new Date(year, month - 1, day));
  };

  const getCalendarScheduleTypeLabel = (schedule: (typeof schedules)[number]) => {
    if (getScheduleCategory(schedule) === 'leave') {
      if (['early', 'early_am', 'early_pm'].includes(schedule.absence_type)) return '조퇴';
      if (schedule.absence_type === 'outing') return '외출';
      return '연차';
    }
    return scheduleCategoryStyles[getScheduleCategory(schedule)].label;
  };

  const moveCalendarMonth = (offset: number) => {
    const nextMonth = new Date(currentMonth.getFullYear(), currentMonth.getMonth() + offset, 1);
    const nextMonthKey = `${nextMonth.getFullYear()}-${String(nextMonth.getMonth() + 1).padStart(2, '0')}`;
    setCurrentMonth(nextMonth);
    setSelectedCalendarDate(todayStr.startsWith(nextMonthKey) ? todayStr : `${nextMonthKey}-01`);
  };

  const moveCalendarToToday = () => {
    setCurrentMonth(new Date());
    setSelectedCalendarDate(todayStr);
  };

  const addDaysToDateKey = (dateKey: string, days: number) => {
    const [year, month, day] = dateKey.split('-').map(Number);
    const date = new Date(year, month - 1, day);
    date.setDate(date.getDate() + days);
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  };

  const getDateDifference = (startDate: string, endDate: string) => {
    const [startYear, startMonth, startDay] = startDate.split('-').map(Number);
    const [endYear, endMonth, endDay] = endDate.split('-').map(Number);
    return Math.round((Date.UTC(endYear, endMonth - 1, endDay) - Date.UTC(startYear, startMonth - 1, startDay)) / 86_400_000);
  };

  const formatScheduleTitle = (schedule: any) => {
    if (schedule.schedule_type === 'leave' && ['early', 'early_am', 'early_pm'].includes(schedule.absence_type)) return `조퇴) ${schedule.title}`;
    if (schedule.schedule_type === 'leave' && schedule.absence_type === 'outing') return `외출) ${schedule.title}`;
    const labels: Record<string, string> = { meeting: '회의)', business_trip: '출장)', internal: '내부일정)', leave: '휴가)' };
    const prefix = labels[schedule.schedule_type];
    return prefix ? `${prefix} ${schedule.title}` : schedule.title;
  };

  const getCategoryScheduleKey = (categoryName: string) => {
    if (categoryName.includes('회의록')) return null;
    if (categoryName.includes('정책결정회의')) return '정책결정회의';
    if (categoryName.includes('월례회의')) return '월례회의';
    if (categoryName.includes('팀회의')) return '팀회의';
    if (categoryName.includes('확대간부회의')) return '확대간부회의';

    const normalizedName = categoryName
      .replace(/^\s*\d{2,4}년(?:도)?\s*/u, '')
      .replace(/\([^)]*\)/gu, '')
      .replace(/회의록\s*$/u, '회의')
      .replace(/(?:공유자료|공유문서|자료|문서)\s*$/u, '')
      .trim();
    return normalizedName.length >= 3 ? normalizedName : null;
  };

  const getNextCategoryScheduleDate = (categoryName: string) => {
    const scheduleKey = getCategoryScheduleKey(categoryName);
    if (!scheduleKey) return null;

    const directSchedule = schedules
      .filter((schedule) => typeof schedule.title === 'string' && schedule.title.trim().length >= 2 && (schedule.title.includes(scheduleKey) || scheduleKey.includes(schedule.title)) && getScheduleEndDate(schedule) >= todayStr)
      .sort((first, second) => first.date.localeCompare(second.date))[0];
    if (directSchedule) return directSchedule.date;

    // 팀회의 일정이 따로 등록되지 않은 경우 정책결정회의가 있는 주의 월요일을 사용합니다.
    if (scheduleKey === '팀회의') {
      const policySchedule = schedules
        .filter((schedule) => typeof schedule.title === 'string' && schedule.title.includes('정책결정회의'))
        .map((schedule) => {
          const policyDate = new Date(`${schedule.date}T00:00:00`);
          const daysFromMonday = (policyDate.getDay() + 6) % 7;
          policyDate.setDate(policyDate.getDate() - daysFromMonday);
          return getLocalDateKey(policyDate);
        })
        .filter((date) => date >= todayStr)
        .sort()[0];
      return policySchedule ?? null;
    }

    return null;
  };

  const formatUpcomingCategoryDate = (dateKey: string) => {
    const [year, month, day] = dateKey.split('-').map(Number);
    const currentYear = Number(todayStr.slice(0, 4));
    const weekday = ['일', '월', '화', '수', '목', '금', '토'][new Date(year, month - 1, day).getDay()];
    return `${year !== currentYear ? `${year}년 ` : ''}${month}월 ${day}일(${weekday}) 예정`;
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
    const targetFiles = files.filter(f => isSameCategory(f.category, catName));
    const targetCategory = categories.find((category) => category.id === id);
    if (!targetCategory) return;
    const confirmMsg = targetFiles.length > 0 ? `'${catName}' 분류와 파일 ${targetFiles.length}개를 삭제하시겠습니까?\n8초 동안 삭제를 되돌릴 수 있습니다.` : `'${catName}' 분류를 삭제하시겠습니까?`;
    if (!confirm(confirmMsg)) return;

    queueUndoableDeletion({
      label: `'${catName}' 분류가 삭제 대기 중입니다.`,
      keys: [`category:${id}`, ...targetFiles.map((file) => `file:${file.id}`)],
      hide: () => {
        setCategories((current) => current.filter((category) => category.id !== id));
        setFiles((current) => current.filter((file) => !isSameCategory(file.category, catName)));
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
          const { error: fileError } = await supabase.from('files').delete().in('id', targetFiles.map((file) => file.id));
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
      label: `'${formatScheduleTitle(target)}' 일정이 삭제 대기 중입니다.`,
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
  const fetchSchedules = async () => {
    const { data, error } = await supabase.from('schedules').select('*').order('start_time', { ascending: true });
    if (error) { setScheduleLoadError('일정을 새로 불러오지 못했습니다. 연결 상태를 확인한 뒤 다시 시도해 주세요.'); return; }
    setScheduleLoadError('');
    if (data) setSchedules(data.filter((schedule) => schedule.recurrence_status !== 'cancelled' && !pendingDeleteKeysRef.current.has(`schedule:${schedule.id}`)));
  };

  const openActivityHistory = async () => {
    if (!isDeviceAdmin) return;
    setIsActivityHistoryOpen(true);
    setIsActivityHistoryLoading(true);
    const { data, error } = await supabase
      .from('activity_logs')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(500);
    if (error) {
      console.error('변경 이력을 불러오지 못했습니다.', error);
      alert('변경 이력 기능을 사용하려면 새 활동 이력 SQL을 Supabase에서 먼저 실행해 주십시오.');
    } else {
      setActivityLogs((data ?? []) as ActivityLogRow[]);
    }
    setIsActivityHistoryLoading(false);
  };

  const restoreActivityLog = async (log: ActivityLogRow) => {
    if (!log.record_id || !log.before_data || (log.table_name !== 'schedules' && log.table_name !== 'messages')) return;
    const allowedFields = log.table_name === 'schedules'
      ? ['title', 'date', 'end_date', 'start_time', 'end_time', 'is_notice', 'is_urgent', 'is_completed', 'is_todo', 'schedule_type', 'absence_type', 'recurrence_group_id', 'recurrence_original_date', 'recurrence_index', 'recurrence_status', 'recurrence_is_exception', 'recurrence_cancelled_at', ...(metadataAvailable ? ['owner_name', 'attendee_names', 'location', 'linked_file_ids'] : [])]
      : ['content', 'sender_id', 'created_at'];
    const restoredValues = Object.fromEntries(
      allowedFields
        .filter((field) => field in log.before_data!)
        .map((field) => [field, log.before_data![field]]),
    );

    const result = log.action === 'delete'
      ? await supabase.from(log.table_name).insert({ id: log.record_id, ...restoredValues })
      : await supabase.from(log.table_name).update(restoredValues).eq('id', log.record_id);
    if (result.error) {
      alert(`항목을 복원하지 못했습니다: ${result.error.message}`);
      return;
    }

    await Promise.all([fetchSchedules(), fetchMessages()]);
    const { data } = await supabase.from('activity_logs').select('*').order('created_at', { ascending: false }).limit(500);
    if (data) setActivityLogs(data as ActivityLogRow[]);
  };
  
  useEffect(() => { if (isChatOpen) { const timer = setTimeout(() => { if (scrollRef.current) scrollRef.current.scrollIntoView({ behavior: 'smooth', block: 'end' }); }, 100); return () => clearTimeout(timer); } }, [messages, isChatOpen]);
  
  const onSend = async (e: React.FormEvent) => { e.preventDefault(); if (!chatInput.trim()) return; await supabase.from('messages').insert([{ content: chatInput, sender_id: myId }]); setChatInput(''); };
  const handleDownloadCategoryZip = async () => {
    const targetFiles = files.filter(f => selectedCategory === '전체' || isSameCategory(f.category, selectedCategory));
    if (targetFiles.length === 0) return alert("파일이 없습니다.");
    setIsDownloadingAll(true); const zip = new JSZip();
    try {
      const usedNames = new Set<string>();
      const promises = targetFiles.map(async (file) => {
        let name = String(file.name).replace(/[\\/]/gu, '_');
        while (usedNames.has(name)) name = `${file.id}_${name}`;
        usedNames.add(name);
        const res = await fetch(file.url);
        if (!res.ok) throw new Error(`${file.name} 다운로드 실패`);
        zip.file(name, await res.blob());
      });
      await Promise.all(promises); const content = await zip.generateAsync({ type: "blob" });
      const link = document.createElement('a'); const url = window.URL.createObjectURL(content); link.href = url; link.download = `${selectedCategory}_백업_${new Date().toLocaleDateString()}.zip`; link.click(); window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) { alert("압축 오류"); } finally { setIsDownloadingAll(false); }
  };
  const downloadCleanupCategoryZip = async (category: YearlyCleanupCategory, targetFiles: YearlyCleanupFile[]) => {
    if (targetFiles.length === 0) return;
    const zip = new JSZip();
    for (const [index, file] of targetFiles.entries()) {
      const url = typeof file.url === 'string' ? file.url : '';
      if (!url) throw new Error(`${file.name} 파일의 다운로드 주소가 없습니다.`);
      const response = await fetch(url);
      if (!response.ok) throw new Error(`${file.name} 파일을 내려받지 못했습니다.`);
      const duplicateSafeName = index === 0 ? file.name : `${String(index + 1).padStart(3, '0')}_${file.name}`;
      zip.file(duplicateSafeName, await response.blob());
    }
    const content = await zip.generateAsync({ type: 'blob' });
    const downloadUrl = window.URL.createObjectURL(content);
    const link = document.createElement('a');
    link.href = downloadUrl;
    link.download = `${category.name}_전체문서.zip`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => window.URL.revokeObjectURL(downloadUrl), 1000);
  };

  const getStoragePathFromPublicUrl = (url: unknown) => {
    if (typeof url !== 'string' || !url) return '';
    const marker = '/storage/v1/object/public/files/';
    const markerIndex = url.indexOf(marker);
    if (markerIndex >= 0) return decodeURIComponent(url.slice(markerIndex + marker.length));
    try { return decodeURIComponent(new URL(url).pathname.split('/').pop() ?? ''); } catch { return decodeURIComponent(url.split('/').pop() ?? ''); }
  };

  const executeYearlyDocumentCleanup = async (targets: YearlyDocumentCleanupTarget[]) => {
    if (!isDeviceAdmin) throw new Error('관리자 기기에서만 연도 문서를 정리할 수 있습니다.');
    const conflictingTarget = targets.find((target) => categories.some((category) => category.id !== target.category.id && category.name.trim().toLocaleLowerCase('ko-KR') === target.nextCategoryName.trim().toLocaleLowerCase('ko-KR')));
    if (conflictingTarget) throw new Error(`이미 '${conflictingTarget.nextCategoryName}' 분류가 있습니다. 기존 분류 이름을 먼저 정리해 주십시오.`);

    const targetFiles = targets.flatMap((target) => target.files);
    const fileIds = targetFiles.map((file) => file.id);
    if (fileIds.length > 0) {
      const filesWithPaths = targetFiles.map((file) => ({ file, path: getStoragePathFromPublicUrl(file.url) }));
      const missingPathFile = filesWithPaths.find((item) => !item.path);
      if (missingPathFile) throw new Error(`${missingPathFile.file.name} 문서의 Storage 경로를 확인하지 못했습니다.`);
      const storagePaths = [...new Set(filesWithPaths.map((item) => item.path))];
      for (let index = 0; index < storagePaths.length; index += 100) {
        const { error: storageError } = await supabase.storage.from('files').remove(storagePaths.slice(index, index + 100));
        if (storageError) throw new Error(`문서 저장공간을 정리하지 못했습니다: ${storageError.message}`);
      }
      for (let index = 0; index < fileIds.length; index += 100) {
        const { error: databaseError } = await supabase.from('files').delete().in('id', fileIds.slice(index, index + 100));
        if (databaseError) throw new Error(`문서 목록을 정리하지 못했습니다: ${databaseError.message}`);
      }
    }

    for (const target of targets) {
      const { error } = await supabase.from('categories').update({ name: target.nextCategoryName }).eq('id', target.category.id);
      if (error) throw new Error(`${target.category.name} 분류를 다음 연도로 변경하지 못했습니다: ${error.message}`);
    }
    await Promise.all([fetchFiles(), fetchCategories()]);
  };
  const handleDownload = async (url: string, originalName: string) => { try { const response = await fetch(url); if (!response.ok) throw new Error('파일 응답 오류'); const blob = await response.blob(); const downloadUrl = window.URL.createObjectURL(blob); const link = document.createElement('a'); link.href = downloadUrl; link.download = originalName; document.body.appendChild(link); link.click(); link.remove(); window.setTimeout(() => window.URL.revokeObjectURL(downloadUrl), 1000); } catch { alert('파일을 내려받지 못했습니다. 연결 상태를 확인한 뒤 다시 시도해 주세요.'); } };
  
  const runUploads = async (items: UploadItem[]) => {
    if (uploadBusyRef.current || items.length === 0) return;
    uploadBusyRef.current = true;
    setUploading(true);
    try {
      await uploadRunner.run(items, (item) => setUploadItems((current) => current.map((entry) => entry.id === item.id ? item : entry)));
      await fetchFiles();
    } finally { uploadBusyRef.current = false; setUploading(false); }
  };
  const handleUpload = async (fileList: FileList | File[]) => {
    if (uploadBusyRef.current) return alert('현재 파일 전송이 끝난 뒤 추가해 주세요.');
    const items = createDocumentUploads(Array.from(fileList), selectedCategory === '전체' ? '일반' : selectedCategory);
    setUploadItems((current) => [...current, ...items]);
    await runUploads(items);
  };
  const updateDocument = async (file: DocumentFile, values: { name: string; category: string }) => {
    const { data, error } = await supabase.from('files').update(values).eq('id', file.id).select('id');
    if (error || !data?.length) throw new Error(error?.message ?? '문서가 삭제되었거나 수정할 수 없습니다.');
    await fetchFiles();
  };
  const renameCategory = async (id: number, value: string) => {
    const targetCat = categories.find((category) => category.id === id);
    if (!targetCat) throw new Error('분류가 삭제되었거나 더 이상 존재하지 않습니다.');
    const nextName = value.trim();
    if (!nextName || nextName.length > 200 || /[\x00-\x1f]/u.test(nextName)) throw new Error('분류 이름은 1~200자로 입력해 주세요.');
    if (nextName === '전체') throw new Error('‘전체’는 전체 문서 보기에서 사용하는 이름입니다. 다른 이름을 입력해 주세요.');
    if (targetCat.name === nextName) return;
    if (categories.some((category) => category.id !== id && category.name.trim().toLocaleLowerCase('ko-KR') === nextName.toLocaleLowerCase('ko-KR'))) throw new Error('같은 이름의 분류가 이미 있습니다.');
    const { error } = await supabase.rpc('rename_category_with_files', { p_old_name: targetCat.name, p_new_name: nextName });
    if (error) throw new Error(`분류 이름을 변경하지 못했습니다: ${error.message}`);
    setSelectedCategory((current) => current === targetCat.name ? nextName : current);
    setCategories((current) => current.map((category) => category.id === id ? { ...category, name: nextName } : category));
    setFiles((current) => current.map((file) => file.category === targetCat.name ? { ...file, category: nextName } : file));
    await Promise.all([fetchCategories(), fetchFiles()]);
  };

  const onUpdateCategoryName = async () => {
    const targetCat = categories.find((category) => category.name === selectedCategory);
    if (!targetCat) return;
    try { await renameCategory(targetCat.id, editTitleValue); setIsEditingTitle(false); }
    catch (error) { alert(error instanceof Error ? error.message : '분류 이름을 변경하지 못했습니다.'); }
  };

  const onAddSchedule = (dateStr: string) => {
    setEditingSchedule(null);
    setIsCopyingSchedule(false);
    setScheduleFormDate(dateStr);
  };

  const confirmScheduleDuplicates = async (entries: WorkflowSchedule[], excludedIds: Array<number | string> = []) => {
    if (entries.length === 0) return;
    const firstDate = entries.map((entry) => entry.date).sort()[0];
    const lastDate = entries.map((entry) => entry.end_date && entry.end_date > entry.date ? entry.end_date : entry.date).sort().at(-1)!;
    const existing: WorkflowSchedule[] = [];
    // Read the overlapping dates in pages: Supabase's row limit must not hide
    // a duplicate once the shared calendar has accumulated many schedules.
    const pageSize = 500;
    for (let offset = 0; ; offset += pageSize) {
      const { data, error } = await supabase.from('schedules')
        .select('id,title,date,end_date,recurrence_status').lte('date', lastDate)
        .or(`end_date.gte.${firstDate},date.gte.${firstDate}`)
        .order('id', { ascending: true }).range(offset, offset + pageSize - 1);
      if (error) throw new Error('기존 일정과 중복 여부를 확인하지 못했습니다. 연결 상태를 확인하고 다시 저장해 주세요.');
      existing.push(...(data ?? []));
      if (!data || data.length < pageSize) break;
    }
    const matches = findDuplicateSchedules(entries, existing, excludedIds);
    if (matches.length === 0) return;
    const summary = [...new Set(matches.map((match) => `${match.existing.date} · ${match.existing.title}${match.inBatch ? ' (이번 입력 안에서 중복)' : ''}`))];
    const wording = matches.some((match) => match.kind === 'similar') ? '동일하거나 비슷한 내용' : '동일한 내용';
    if (!window.confirm(`같은 날짜에 ${wording}의 일정이 기입되어 있습니다. 그래도 등록하시겠습니까?\n\n${summary.slice(0, 5).join('\n')}${summary.length > 5 ? `\n외 ${summary.length - 5}건` : ''}\n\n확인: 그대로 저장 / 취소: 내용 다시 확인`)) {
      throw new Error('저장하지 않았습니다. 내용을 확인한 뒤 다시 등록할 수 있습니다.');
    }
  };

  const onSaveSchedule = async (scheduleEntries: NewScheduleInput[], recurrence?: ScheduleRecurrenceSubmission) => {
    const schedule = scheduleEntries[0];
    if (!schedule) return;
    const editingScheduleDate = editingSchedule ? String(editingSchedule.date) : '';
    const editingGroup = editingSchedule && !isCopyingSchedule && isRecurringSchedule(editingSchedule) && recurrenceScope !== 'this';
    const affected = editingGroup ? schedules.filter((item) => item.recurrence_group_id === editingSchedule.recurrence_group_id
      && item.recurrence_status === 'active' && (recurrenceScope === 'all' || item.recurrence_index >= editingSchedule.recurrence_index)) : [];
    const shiftedDays = editingGroup && recurrenceScope === 'all' ? getDateDifference(editingScheduleDate, schedule.date) : 0;
    const candidates = editingGroup ? affected.map((item) => ({ ...schedule, date: addDaysToDateKey(item.date, shiftedDays), end_date: item.end_date ? addDaysToDateKey(item.end_date, shiftedDays) : null })) : scheduleEntries;
    await confirmScheduleDuplicates(candidates, editingGroup ? affected.map((item) => item.id) : editingSchedule && !isCopyingSchedule ? [editingSchedule.id] : []);
    if (editingSchedule && !isCopyingSchedule) {
      if (isRecurringSchedule(editingSchedule) && recurrenceScope !== 'this') {
        const dayDelta = getDateDifference(editingScheduleDate, schedule.date);
        let shiftedGroup = false;
        const sharedValues = {
          title: schedule.title,
          start_time: schedule.start_time,
          end_time: schedule.end_time,
          is_notice: schedule.is_notice,
          is_urgent: schedule.is_urgent,
          is_completed: schedule.is_completed,
          is_todo: schedule.is_todo,
          schedule_type: schedule.schedule_type,
          absence_type: schedule.absence_type,
          ...(schedule.owner_name !== undefined ? { owner_name: schedule.owner_name } : {}),
          ...(schedule.attendee_names !== undefined ? { attendee_names: schedule.attendee_names } : {}),
          ...(schedule.location !== undefined ? { location: schedule.location } : {}),
          ...(schedule.linked_file_ids !== undefined ? { linked_file_ids: schedule.linked_file_ids } : {}),
        };
        if (recurrenceScope === 'all' && dayDelta !== 0) {
          const { error: shiftError } = await supabase.rpc('shift_schedule_recurrence_group', {
            p_group_id: editingSchedule.recurrence_group_id,
            p_day_delta: dayDelta,
          });
          if (shiftError) throw new Error(`반복 일정 전체 날짜를 이동하지 못했습니다: ${shiftError.message}`);
          shiftedGroup = true;
        }
        let query = supabase
          .from('schedules')
          .update(sharedValues)
          .eq('recurrence_group_id', editingSchedule.recurrence_group_id)
          .eq('recurrence_status', 'active');
        if (recurrenceScope === 'future') query = query.gte('recurrence_index', editingSchedule.recurrence_index);
        const { error } = await query;
        if (error) {
          if (shiftedGroup) await supabase.rpc('shift_schedule_recurrence_group', {
            p_group_id: editingSchedule.recurrence_group_id,
            p_day_delta: -dayDelta,
          });
          throw new Error(`반복 일정을 변경하지 못했습니다: ${error.message}`);
        }
      } else {
        const update = isRecurringSchedule(editingSchedule)
          ? { ...schedule, recurrence_is_exception: true }
          : schedule;
        const { error } = await supabase.from('schedules').update(update).eq('id', editingSchedule.id);
        if (error) throw new Error(`일정을 저장하지 못했습니다: ${error.message}`);
      }
    } else if (recurrence) {
      const recurrenceGroupId = createRecurrenceGroupId();
      const { error: groupError } = await supabase.from('schedule_recurrence_groups').insert({
        id: recurrenceGroupId,
        ...recurrence,
      });
      if (groupError) throw new Error(`반복 일정 기반을 만들지 못했습니다. 반복 일정 SQL 적용 여부를 확인해 주십시오: ${groupError.message}`);

      const recurringSchedules = attachRecurrenceMetadata(scheduleEntries, recurrenceGroupId).schedules;
      const { error: scheduleError } = await supabase.from('schedules').insert(recurringSchedules);
      if (scheduleError) {
        await supabase.from('schedule_recurrence_groups').delete().eq('id', recurrenceGroupId);
        throw new Error(`반복 일정을 저장하지 못했습니다: ${scheduleError.message}`);
      }
    } else {
      const { error } = await supabase.from('schedules').insert(scheduleEntries);
      if (error) throw new Error(`일정을 저장하지 못했습니다: ${error.message}`);
    }
    await fetchSchedules();
    setScheduleFormDate(null);
    setEditingSchedule(null);
    setIsCopyingSchedule(false);
    setRecurrenceScope('this');
  };

  const onEditSchedule = (schedule: any) => {
    setEditingSchedule(schedule);
    setIsCopyingSchedule(false);
    setScheduleFormDate(schedule.date);
    setSelectedSchedule(null);
  };

  const onCopySchedule = (schedule: any) => {
    setEditingSchedule(schedule);
    setIsCopyingSchedule(true);
    setScheduleFormDate(schedule.date);
    setSelectedSchedule(null);
    setRecurrenceScope('this');
  };

  const onCancelRecurringSchedule = (schedule: any) => {
    const targets = schedules.filter((candidate) => {
      if (recurrenceScope === 'this') return candidate.id === schedule.id;
      if (candidate.recurrence_group_id !== schedule.recurrence_group_id) return false;
      return recurrenceScope === 'all' || candidate.recurrence_index >= schedule.recurrence_index;
    });
    if (targets.length === 0 || !confirm(`${targets.length}개의 반복 일정을 취소하시겠습니까?`)) return;

    queueUndoableDeletion({
      label: `반복 일정 ${targets.length}건이 취소 대기 중입니다.`,
      keys: targets.map((target) => `schedule:${target.id}`),
      hide: () => { setSchedules((current) => current.filter((item) => !targets.some((target) => target.id === item.id))); setSelectedSchedule(null); setRecurrenceScope('this'); },
      restore: () => setSchedules((current) => [...current, ...targets.filter((target) => !current.some((item) => item.id === target.id))]),
      commit: async () => {
        const { error } = await supabase.from('schedules').update({ recurrence_status: 'cancelled', recurrence_cancelled_at: new Date().toISOString() }).in('id', targets.map((target) => target.id));
        if (error) throw new Error(`반복 일정을 취소하지 못했습니다: ${error.message}`);
      },
    });
  };

  const onImportWhiteboardSchedules = async (
    importedSchedules: NewScheduleInput[],
    updates: WhiteboardScheduleUpdate[],
    corrections: WhiteboardCorrectionInput[],
  ) => {
    await confirmScheduleDuplicates([...importedSchedules, ...updates.map((update) => update.values)], updates.map((update) => update.id));
    if (importedSchedules.length > 0) {
      const { error } = await supabase.from('schedules').insert(importedSchedules);
      if (error) throw new Error(`일정을 등록하지 못했습니다: ${error.message}`);
    }
    for (const update of updates) {
      const { error } = await supabase.from('schedules').update(update.values).eq('id', update.id);
      if (error) throw new Error(`기존 일정을 변경하지 못했습니다: ${error.message}`);
    }

    if (corrections.length > 0) {
      const { error: correctionError } = await supabase.rpc('save_whiteboard_corrections', {
        p_corrections: corrections,
      });
      if (correctionError) console.error('화이트보드 교정 기록을 저장하지 못했습니다:', correctionError.message);
    }

    await fetchSchedules();
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
  const moveSingleSchedule = async (schedule: PortalSchedule, dateStr: string) => {
    const endDate = getScheduleEndDate(schedule);
    const duration = getDateDifference(schedule.date, endDate);
    const update = {
      date: dateStr,
      end_date: duration > 0 ? addDaysToDateKey(dateStr, duration) : null,
      ...(isRecurringSchedule(schedule) ? { recurrence_is_exception: true } : {}),
    };
    const { error } = await supabase.from('schedules').update(update).eq('id', schedule.id);
    if (error) throw new Error(`일정을 이동하지 못했습니다: ${error.message}`);
  };

  const moveEntireRecurrence = async (schedule: PortalSchedule, dateStr: string) => {
    const sourceDate = String(schedule.date);
    if (!isRecurringSchedule(schedule)) return moveSingleSchedule(schedule, dateStr);
    const dayDelta = getDateDifference(sourceDate, dateStr);
    if (dayDelta === 0) return;
    const { error } = await supabase.rpc('shift_schedule_recurrence_group', {
      p_group_id: schedule.recurrence_group_id,
      p_day_delta: dayDelta,
    });
    if (error) throw new Error(`반복 일정 전체를 이동하지 못했습니다: ${error.message}`);
  };

  const confirmRecurrenceMove = async (scope: 'this' | 'all') => {
    if (!pendingRecurrenceMove) return;
    const { schedule, targetDate } = pendingRecurrenceMove;
    setPendingRecurrenceMove(null);
    try {
      if (scope === 'all') await moveEntireRecurrence(schedule, targetDate);
      else await moveSingleSchedule(schedule, targetDate);
      await fetchSchedules();
      setSelectedCalendarDate(targetDate);
    } catch (error) {
      alert(error instanceof Error ? error.message : '일정을 이동하지 못했습니다.');
    }
  };

  const onDayDrop = async (dateStr: string) => {
    if (draggedScheduleId === null) return;
    const draggedSchedule = schedules.find((schedule) => schedule.id === draggedScheduleId);
    if (!draggedSchedule) return;
    setDraggedScheduleId(null);
    if (dateStr === draggedSchedule.date) return;
    if (isRecurringSchedule(draggedSchedule)) {
      setPendingRecurrenceMove({ schedule: draggedSchedule, targetDate: dateStr });
      return;
    }
    try {
      await moveSingleSchedule(draggedSchedule, dateStr);
      await fetchSchedules();
      setSelectedCalendarDate(dateStr);
    } catch (error) {
      alert(error instanceof Error ? error.message : '일정을 이동하지 못했습니다.');
    }
  };
  const handlePortalExit = () => {
    window.location.assign('about:blank');
  };

  const openKioskWindow = () => {
    const openInlineKiosk = (notice = '') => {
      setKioskLaunchNotice(notice);
      setIsKioskOpen(true);
      if (!document.fullscreenElement) {
        void document.documentElement.requestFullscreen?.().catch(() => undefined);
      }
    };

    // 모바일 브라우저는 별도 창의 크기 조절을 지원하지 않으므로 현재 화면에서 엽니다.
    if (window.matchMedia('(max-width: 767px)').matches) {
      openInlineKiosk();
      return;
    }

    const kioskUrl = new URL('/kiosk', window.location.origin);

    // 팝업은 클릭 이벤트와 같은 실행 흐름에서 즉시 열어야 브라우저가
    // 사용자 동작으로 인식합니다. 설치나 모니터 접근 권한은 요청하지 않습니다.
    // 같은 이름의 창을 재사용하고, 다른 모니터로의 이동은 사용자가 선택합니다.
    const targetScreen = window.screen as ManagedScreen;
    const left = targetScreen.availLeft ?? 0;
    const top = targetScreen.availTop ?? 0;
    const width = targetScreen.availWidth || window.screen.availWidth;
    const height = targetScreen.availHeight || window.screen.availHeight;
    let kioskWindow: Window | null;
    try {
      kioskWindow = window.open(
        kioskUrl.toString(),
        'dphs-dashboard-kiosk',
        `popup,fullscreen,left=${left},top=${top},width=${width},height=${height}`,
      );
    } catch {
      openInlineKiosk('별도 창을 열지 못해 현재 화면에서 전광판을 열었습니다.');
      return;
    }

    if (!kioskWindow) {
      openInlineKiosk('별도 창을 열지 못해 현재 화면에서 전광판을 열었습니다.');
      return;
    }

    kioskWindow.focus();
  };

  const selectedCalendarSchedules = getCalendarSchedulesForDate(selectedCalendarDate);
  const selectedCalendarHolidayNames = koreanHolidays[selectedCalendarDate] ?? [];

  if (!isMounted) return null;

  if (isDedicatedKiosk) {
    return <main className="min-h-dvh bg-[#071022]" aria-label="전광판 전용 화면으로 이동 중" />;
  }

  if (!isAuthenticated) {
    return <DeviceAccessGate onApproved={handleDeviceApproved} />;
  }

  return (
    <div className="flex h-dvh flex-col overflow-hidden bg-[#F0F2F5] font-sans text-[#2C3E50]">
      <header className={`z-[60] flex items-center justify-between gap-2 border-b border-white/5 bg-[#1A1C1E] text-white shadow-md sm:px-4 lg:px-6 xl:px-8 xl:py-4 ${viewMode === 'external_calendar' ? 'px-2 py-2 sm:py-3' : viewMode === 'dashboard' ? 'px-3 py-2' : 'px-3 py-3'}`}>
        <div className="flex min-w-0 items-center gap-2 md:gap-3 overflow-hidden">
          <button aria-label="분류 메뉴" aria-expanded={isMobileSidebarOpen} onClick={() => setIsMobileSidebarOpen(!isMobileSidebarOpen)} className="shrink-0 rounded-lg p-1.5 transition-colors hover:bg-white/10 xl:hidden"><Menu size={22}/></button>
          <span className="text-lg md:text-2xl hidden sm:inline shrink-0">📂</span>
          <h1 className="font-extrabold text-xs sm:text-sm md:text-lg tracking-tight uppercase truncate">공공의료지원과 문서함</h1>
        </div>

        {/* ===================================================================== */}
        {/* [신규 기능 연동] 빨간색 테두리 빈 영역 채우기 - 공지사항 롤링 전광판 플레이스 */}
        {/* ===================================================================== */}
        <div 
          className={`relative mx-4 hidden h-10 max-w-md flex-1 cursor-pointer items-center overflow-visible rounded-xl border border-white/10 bg-white/5 px-4 text-xs font-bold transition-colors hover:bg-white/10 ${activeNotices.length > 0 ? '2xl:flex' : ''}`}
          onMouseEnter={() => setIsNoticeHovered(true)}
          onMouseLeave={() => setIsNoticeHovered(false)}
        >
          {activeNotices.length > 0 ? (
            <>
              <div className="flex items-center justify-between w-full h-full gap-2 animate-in fade-in duration-300">
                <span className="bg-red-500/15 text-red-300 px-2 py-0.5 rounded text-[10px] font-bold shrink-0">공지사항</span>
                <span className="truncate flex-1 text-slate-200">{formatScheduleTitle(activeNotices[noticeIndex])}</span>
                <span className="text-yellow-400 font-black shrink-0 ml-2">{getScheduleDDay(activeNotices[noticeIndex])}</span>
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
                        <span className="truncate flex-1 mr-4">{formatScheduleTitle(notice)}</span>
                        <div className="flex items-center gap-3 shrink-0 text-[11px]">
                          <span className="text-slate-500 font-medium text-[10px]">{notice.date}</span>
                          <span className="text-yellow-400 font-black min-w-12 text-right">{getScheduleDDay(notice)}</span>
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

        <PortalDesktopActions
          currentView={viewMode}
          onView={setViewMode}
          onChat={() => setIsChatOpen(!isChatOpen)}
          onSearch={() => setIsCommandPaletteOpen(true)}
          onQuickAdd={() => setIsQuickScheduleOpen(true)}
          onKiosk={openKioskWindow}
          onHistory={() => void openActivityHistory()}
          onDevices={() => setIsDeviceManagerOpen(true)}
          onCleanup={() => setIsYearlyCleanupOpen(true)}
          onExit={handlePortalExit}
          isAdmin={isDeviceAdmin}
          isChatOpen={isChatOpen}
          hasUnread={hasUnread}
          hasNewSchedule={hasNewSchedule}
        />
        <PortalMobileActions view={viewMode} onView={setViewMode} onChat={() => setIsChatOpen(true)} onSearch={() => setIsCommandPaletteOpen(true)} onQuickAdd={() => setIsQuickScheduleOpen(true)} onKiosk={openKioskWindow} onHistory={() => void openActivityHistory()} onDevices={() => setIsDeviceManagerOpen(true)} onCleanup={() => setIsYearlyCleanupOpen(true)} onExit={handlePortalExit} isAdmin={isDeviceAdmin} />
      </header>

      {uploadItems.length > 0 && <DocumentUploadStatus items={uploadItems} onRetry={(ids) => void runUploads(uploadItems.filter((item) => ids.includes(item.id) && item.status === 'failed'))} onDismiss={() => { if (uploadBusyRef.current) return; uploadRunner.forget(uploadItems.map((item) => item.id)); setUploadItems([]); }} />}

      <main className="flex-1 flex overflow-hidden relative">
        <aside className={`
          fixed bottom-0 left-0 top-14 z-50 flex w-[min(20rem,88vw)] flex-col border-r border-slate-300 bg-[#EBEEF2] shadow-2xl transition-transform duration-300 transform xl:relative xl:inset-auto xl:w-[clamp(18rem,20vw,23.5rem)] xl:shrink-0 xl:shadow-none
          ${isMobileSidebarOpen ? 'translate-x-0' : '-translate-x-full xl:translate-x-0'}
        `}>
          <div className="flex justify-end px-4 pt-3 text-slate-400 xl:hidden">
            <button aria-label="분류 메뉴 닫기" onClick={() => setIsMobileSidebarOpen(false)} className="p-2 text-slate-600 xl:hidden"><X size={20}/></button>
          </div>
          <div className="flex-1 overflow-y-auto px-6 py-2 custom-scrollbar">
            <div className="space-y-1.5 mb-4">
              <button onClick={() => { setViewMode('dashboard'); setIsMobileSidebarOpen(false); }} aria-current={viewMode === 'dashboard' ? 'page' : undefined} className={`w-full flex items-center gap-3 px-4 py-3.5 rounded-xl text-sm font-bold transition-all ${viewMode === 'dashboard' ? 'bg-slate-900 shadow-lg text-white' : 'text-slate-500 hover:bg-slate-200/60'}`}><LayoutDashboard size={17} /> 홈</button>
              <div className="h-px bg-slate-300/70 my-3" />
              <button onClick={() => { setViewMode('files'); setSelectedCategory('전체'); setIsMobileSidebarOpen(false); }} className={`w-full text-left px-4 py-3.5 rounded-xl text-sm font-bold transition-all ${selectedCategory === '전체' && viewMode === 'files' ? 'bg-white shadow-md text-blue-600 ring-1 ring-slate-200' : 'text-slate-500 hover:bg-slate-200/60'}`}>🏠 전체 문서 보기</button>
              {categories.map((cat, idx) => {
                const nextScheduleDate = getNextCategoryScheduleDate(cat.name);
                const meetingTone = getCategoryMeetingTone(cat.name);
                const isSelected = selectedCategory === cat.name && viewMode === 'files';
                return (
                <div key={cat.id} draggable onDragStart={() => setDraggedItemIndex(idx)} onDragOver={(e) => e.preventDefault()} onDrop={async() => {
                   if (draggedItemIndex === null || draggedItemIndex === idx) return;
                   const newCats = [...categories]; const item = newCats.splice(draggedItemIndex, 1)[0]; newCats.splice(idx, 0, item);
                   setCategories(newCats); for(let i=0; i<newCats.length; i++) await supabase.from('categories').update({order_index: i}).eq('id', newCats[i].id);
                  setDraggedItemIndex(null);
                }} className={`group relative flex items-center gap-1 cursor-grab active:cursor-grabbing transition-transform ${draggedItemIndex === idx ? 'opacity-30' : 'opacity-100'}`}>
                  <div className="absolute left-1 opacity-0 group-hover:opacity-40"><GripVertical size={14}/></div>
                  <button onClick={() => { setViewMode('files'); setSelectedCategory(cat.name); setIsMobileSidebarOpen(false); }} title={cat.name} className={`min-w-0 flex-1 rounded-xl py-3.5 pl-6 pr-1 text-left text-sm font-bold ring-1 ring-transparent transition-all ${isSelected ? (meetingTone?.active ?? 'bg-white text-blue-600 ring-slate-200 shadow-md') : `${meetingTone?.hover ?? 'text-slate-500 hover:bg-slate-200/60'}`}`}>
                    <span className="flex min-w-0 items-center justify-between gap-2">
                      <span className={`min-w-0 truncate text-[13px] font-extrabold 2xl:text-sm ${meetingTone?.text ?? (isSelected ? 'text-blue-600' : 'text-slate-500')}`}>📁 {cat.name}</span>
                      {nextScheduleDate && meetingTone && (
                        <span className={`shrink-0 whitespace-nowrap rounded-lg px-2.5 py-1.5 text-[11px] font-black leading-none tracking-tight ring-1 ring-inset 2xl:px-3 2xl:text-xs ${meetingTone.badge}`}>
                          {formatUpcomingCategoryDate(nextScheduleDate)}
                        </span>
                      )}
                    </span>
                  </button>
                  <CategoryActions name={cat.name} onRename={(name) => renameCategory(cat.id, name)} onDelete={() => onDeleteCategoryWithFiles(cat.id, cat.name)} />
                </div>
                );
              })}
            </div>
          </div>
          <div className="p-6 border-t border-slate-300 bg-[#EBEEF2]">
            <div className="flex gap-2 bg-white p-2.5 rounded-2xl border border-slate-200 focus-within:ring-2 focus-within:ring-blue-100 shadow-sm transition-all"><input className="flex-1 bg-transparent border-none text-xs font-bold outline-none px-2 text-slate-900" placeholder="분류 추가..." value={newCatName} onChange={(e) => setNewCatName(e.target.value)} onKeyDown={async(e) => { if(e.key === 'Enter' && newCatName.trim()) { await supabase.from('categories').insert([{ name: newCatName.trim(), order_index: categories.length }]); setNewCatName(''); } }} /><button onClick={async() => { if(newCatName.trim()) { await supabase.from('categories').insert([{ name: newCatName.trim(), order_index: categories.length }]); setNewCatName(''); } }} className="bg-slate-900 text-white w-8 h-8 rounded-xl shadow-sm font-black text-sm">+</button></div>
          </div>
        </aside>

        {isMobileSidebarOpen && <div onClick={() => setIsMobileSidebarOpen(false)} className="fixed inset-0 z-40 bg-black/20 backdrop-blur-sm animate-in fade-in xl:hidden" />}

        <section 
          onDragOver={(e) => { e.preventDefault(); if(viewMode==='files') setIsDragOver(true); }} 
          onDragLeave={() => setIsDragOver(false)} 
          onDrop={(e) => { e.preventDefault(); setIsDragOver(false); if(viewMode==='files') handleUpload(e.dataTransfer.files); }} 
          className={`flex-1 flex flex-col bg-white overflow-hidden relative shadow-inner transition-all duration-300 min-h-0 min-w-0 ${isDragOver ? 'bg-blue-50/50' : 'bg-white'}`}
        >
          {isDragOver && (
            <div className="absolute inset-0 z-20 flex items-center justify-center pointer-events-none animate-in fade-in duration-200">
              <div className="bg-blue-600/90 text-white px-10 py-6 rounded-[40px] shadow-2xl font-black flex flex-col items-center gap-4 animate-bounce">
                <FilePlus size={48} /> <p className="text-xl">파일을 이곳에 놓아 주십시오.</p>
              </div>
            </div>
          )}

          <div className={`flex w-full flex-1 flex-col overflow-hidden min-h-0 min-w-0 ${viewMode === 'calendar' ? 'mr-auto max-w-[1600px]' : viewMode === 'dashboard' ? 'mx-auto max-w-none' : viewMode === 'external_calendar' ? 'mx-auto max-w-[1600px]' : 'mx-auto max-w-6xl'} ${viewMode === 'external_calendar' ? 'p-0 sm:p-3 lg:p-4' : viewMode === 'calendar' ? 'p-2 sm:p-3 lg:p-4' : viewMode === 'dashboard' ? 'p-2 sm:p-3' : 'p-4 sm:p-6 lg:p-10 2xl:p-12'}`}>
            
            {viewMode === 'files' && <div className="mb-10 flex shrink-0 flex-col items-start justify-between gap-4 md:flex-row">
              <div className="flex-1 w-full overflow-hidden">
                <div className="group flex items-center gap-4 mb-1">
                  {isEditingTitle && viewMode === 'files' ? (
                    <div className="flex items-center gap-3 w-full">
                      <input className="text-2xl md:text-4xl font-black text-slate-900 tracking-tighter bg-white border-b-4 border-blue-600 outline-none w-full max-w-2xl py-1" value={editTitleValue} onChange={(e)=>setEditTitleValue(e.target.value)} autoFocus onKeyDown={(e) => e.key === 'Enter' && onUpdateCategoryName()} />
                      <button onClick={onUpdateCategoryName} className="bg-blue-600 text-white px-5 py-2 rounded-2xl text-xs font-black shadow-lg">저장</button>
                    </div>
                  ) : (
                    <>
                      <h2 className={`truncate text-2xl font-black uppercase tracking-tighter md:text-4xl ${getCategoryMeetingTone(selectedCategory)?.text ?? 'text-slate-800'}`}>
                        {selectedCategory}
                      </h2>
                      {viewMode === 'files' && selectedCategory !== '전체' && <button onClick={() => { setEditTitleValue(selectedCategory); setIsEditingTitle(true); }} className="opacity-100 md:opacity-0 group-hover:opacity-100 bg-slate-100 text-slate-400 p-2 rounded-xl hover:text-blue-500 text-xs font-bold transition-all">✎ 수정</button>}
                      {viewMode === 'files' && <button onClick={handleDownloadCategoryZip} disabled={isDownloadingAll} className="flex items-center gap-2 bg-blue-50 text-blue-600 px-4 py-2 rounded-xl text-xs font-black hover:bg-blue-600 hover:text-white transition-all ml-2 shadow-sm"><Archive size={14} /> <span className="hidden sm:inline">전체 다운로드(ZIP)</span></button>}
                    </>
                  )}
                </div>
                <p className="text-[10px] md:text-xs text-slate-400 font-medium tracking-tight italic truncate">
                  부서 자료를 분류별로 확인할 수 있습니다.
                </p>
              </div>
              {viewMode === 'files' && (
                <label className={`w-full md:w-auto bg-blue-600 text-white px-8 py-3.5 rounded-3xl font-black shadow-lg flex items-center justify-center gap-2 shrink-0 ${uploading ? 'cursor-wait opacity-60' : 'cursor-pointer active:scale-95'}`}>
                  <Plus size={18} /><span>{uploading ? '파일 전송 중...' : '파일 업로드'}</span>
                  <input aria-label="파일 업로드" disabled={uploading} type="file" className="sr-only" multiple onChange={(e) => { if (e.target.files) void handleUpload(e.target.files); e.target.value = ''; }} />
                </label>
              )}
            </div>}

            {(viewMode === 'dashboard' || viewMode === 'calendar') && <div className="mb-2 flex shrink-0 items-center justify-between gap-1 rounded-xl border border-slate-200 bg-slate-50 px-2 py-1" data-schedule-scope>
              <div className="flex items-center gap-1" aria-label="일정 표시 범위">
                <button aria-pressed={!showMySchedules} onClick={() => setShowMySchedules(false)} className={`min-h-8 whitespace-nowrap rounded-lg px-2 text-xs font-bold ${!showMySchedules ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-200'}`}>전체 일정</button>
                <button aria-pressed={showMySchedules} disabled={!metadataAvailable || !myScheduleName.trim()} onClick={() => setShowMySchedules(true)} className={`min-h-8 whitespace-nowrap rounded-lg px-2 text-xs font-bold disabled:cursor-not-allowed disabled:opacity-50 ${showMySchedules ? 'bg-blue-600 text-white' : 'text-slate-600 hover:bg-slate-200'}`}>내 일정만</button>
              </div>
              <label className="flex min-w-0 items-center gap-1 whitespace-nowrap text-xs font-bold text-slate-600">내 이름
                <input aria-label="내 일정 기준 이름" title="담당자 또는 참석자에 이 이름이 있는 일정만 표시합니다. 접근 권한 설정이 아닙니다." list="portal-schedule-people" maxLength={100} disabled={!metadataAvailable} value={myScheduleName} onChange={(event) => { setMyScheduleName(event.target.value); if (!event.target.value.trim()) setShowMySchedules(false); try { localStorage.setItem('portal-schedule-person', event.target.value); } catch { /* Optional preference only. */ } }} placeholder="이름" className="min-h-8 w-20 rounded-lg border border-slate-300 bg-white px-2 text-sm text-slate-900 disabled:bg-slate-100 sm:w-28" />
              </label>
              <datalist id="portal-schedule-people">{schedulePeople.map((name) => <option key={name} value={name} />)}</datalist>
            </div>}
            {scheduleLoadError && <div role="alert" className="mb-2 flex shrink-0 items-center justify-between gap-2 rounded-xl bg-amber-50 p-3 text-xs text-amber-900"><span>{scheduleLoadError}</span><button onClick={() => void fetchSchedules()} className="shrink-0 rounded-lg bg-white px-3 py-2 font-bold">다시 시도</button></div>}
            <div className={`flex-1 flex flex-col min-h-0 ${viewMode === 'calendar' ? 'overflow-y-auto xl:overflow-hidden' : viewMode === 'external_calendar' || viewMode === 'dashboard' ? 'overflow-hidden' : 'overflow-auto custom-scrollbar'}`}>
              
              {viewMode === 'dashboard' ? (
                <SharedDashboard
                  schedules={visibleSchedules}
                  holidaysByDate={koreanHolidays}
                  onChangeView={setViewMode}
                  onOpenCalendarDate={(date) => {
                    const target = new Date(`${date}T12:00:00`);
                    if (!Number.isFinite(target.getTime()) || getLocalDateKey(target) !== date) return;
                    setCurrentMonth(new Date(target.getFullYear(), target.getMonth(), 1));
                    setSelectedCalendarDate(date);
                    setViewMode('calendar');
                  }}
                  onOpenChat={() => setIsChatOpen(true)}
                  onOpenSchedule={setSelectedSchedule}
                  onToggleScheduleComplete={onToggleScheduleComplete}
                  onOpenAbsenceBoard={() => setIsAbsenceBoardOpen(true)}
                  onPrintWeek={() => setIsWeeklyPrintOpen(true)}
                />
              ) : viewMode === 'external_calendar' ? (
                <div className="relative h-full w-full overflow-hidden bg-slate-50 sm:rounded-[24px] sm:shadow-xl">
                  <div className="flex h-full items-center justify-center bg-[radial-gradient(circle_at_top,rgba(37,99,235,0.12),transparent_45%)] p-6 sm:hidden">
                    <a
                      href={EXTERNAL_CALENDAR_URL}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex w-full max-w-sm flex-col items-center rounded-[28px] border border-blue-100 bg-white px-6 py-10 text-center shadow-xl transition-transform active:scale-[0.98]"
                    >
                      <span className="flex h-16 w-16 items-center justify-center rounded-2xl bg-blue-600 text-white shadow-lg shadow-blue-200"><CalendarDays size={30} /></span>
                      <strong className="mt-5 text-xl font-black tracking-tight text-slate-900">일정 확인하러 가기</strong>
                      <span className="mt-2 text-xs font-bold leading-5 text-slate-500">휴대폰에 최적화된 일정 공유 달력을 새 창에서 엽니다.</span>
                      <span className="mt-6 inline-flex items-center gap-1.5 rounded-xl bg-blue-600 px-5 py-3 text-sm font-black text-white">일정 열기 <ExternalLink size={15} /></span>
                    </a>
                  </div>
                  <iframe
                    src={EXTERNAL_CALENDAR_EMBED_URL}
                    className="absolute inset-0 hidden h-full w-full border-0 sm:block"
                    title="손 일정확인 외부 달력"
                  />
                </div>

              ) : viewMode === 'calendar' ? (
                <div className="flex min-h-full w-full flex-col pb-3 sm:pb-4 lg:pb-5 xl:min-h-0 xl:flex-1">
                  <div className="mb-2 grid shrink-0 grid-cols-[minmax(0,1fr)_auto] items-end gap-2 sm:mb-3 sm:flex sm:flex-wrap sm:items-center sm:gap-4 md:gap-5">
                    <div className="min-w-0 sm:flex sm:items-center sm:gap-4">
                      <div className="min-w-0">
                      <p className="text-[9px] font-black uppercase tracking-[0.16em] text-blue-600 sm:text-[10px]">일정 공유 달력</p>
                      <h3 className="mt-0.5 text-lg font-black tracking-tight text-slate-800 sm:text-xl md:text-2xl">{currentMonth.getFullYear()}년 {currentMonth.getMonth() + 1}월</h3>
                      </div>
                      <div className="mt-1.5 flex gap-1.5 sm:mt-0 sm:gap-2">
                        <button type="button" onClick={() => moveCalendarMonth(-1)} aria-label="이전 달" className="rounded-xl bg-slate-100 p-2 transition-colors hover:bg-slate-200 md:p-3"><ChevronLeft size={18}/></button>
                        <button type="button" onClick={() => moveCalendarMonth(1)} aria-label="다음 달" className="rounded-xl bg-slate-100 p-2 transition-colors hover:bg-slate-200 md:p-3"><ChevronRight size={18}/></button>
                        <button type="button" onClick={moveCalendarToToday} className="rounded-xl bg-slate-900 px-3 py-2 text-[10px] font-bold text-white shadow-md sm:px-5 sm:text-xs">오늘</button>
                      </div>
                    </div>
                    <div className="flex items-center justify-end gap-1.5 sm:ml-auto sm:gap-2">
                      <button onClick={() => setIsWeeklyPrintOpen(true)} className="min-h-10 rounded-xl border border-slate-200 bg-white px-3 text-xs font-bold text-slate-700 hover:bg-slate-50">주간 출력</button>
                      <button onClick={() => setIsWhiteboardImportOpen(true)} className="flex items-center gap-1.5 rounded-xl bg-blue-600 px-2.5 py-2.5 text-[9px] font-black text-white shadow-md transition-colors hover:bg-blue-700 sm:gap-2 sm:px-3 sm:text-[10px] md:px-4 md:text-xs"><ScanLine size={15} /> <span className="hidden sm:inline">화이트보드 가져오기</span><span className="sm:hidden">사진 분석</span></button>
                    </div>
                  </div>

                  <div aria-label="일정 분류 색상" className="mb-2 flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 px-0.5 text-[9px] font-bold text-slate-600 sm:mb-3 sm:text-[10px]">
                    {scheduleCategoryOrder.map((category) => (
                      <span key={category} className="inline-flex items-center gap-1.5" title={category === 'internal' ? '부서 내부 협의회·간담회·업무협약식 등' : undefined}>
                        <span aria-hidden="true" className={`h-2 w-2 rounded-full ${scheduleCategoryStyles[category].dot}`} />{category === 'leave' ? '휴가·조퇴·외출' : scheduleCategoryStyles[category].label}
                      </span>
                    ))}
                  </div>

                  <div className="grid min-h-0 flex-1 gap-3 xl:grid-cols-[minmax(0,1fr)_300px] 2xl:grid-cols-[minmax(0,1fr)_360px]">
                    <div className="min-w-0 rounded-[16px] xl:overflow-hidden xl:rounded-[28px]">
                      <div className="flex min-h-[410px] min-w-0 flex-col overflow-hidden rounded-[16px] border border-slate-200 bg-slate-200 shadow-xl sm:min-h-[560px] xl:h-full xl:min-h-0 xl:rounded-[28px]">
                        <div className="grid shrink-0 grid-cols-7 border-b border-slate-200 bg-slate-50">
                          {['일', '월', '화', '수', '목', '금', '토'].map((d, index) => (
                            <div
                              key={d}
                              className={`p-1.5 text-center text-[9px] font-black uppercase tracking-widest sm:p-2 sm:text-[10px] md:p-3 md:text-xs ${index === 0 ? 'text-red-500' : index === 6 ? 'text-blue-500' : 'text-slate-800'}`}
                            >
                              {d}
                            </div>
                          ))}
                        </div>

                        <div className="grid min-h-0 flex-1 auto-rows-fr grid-cols-7 gap-px bg-slate-200">
                          {Array.from({length: new Date(currentMonth.getFullYear(), currentMonth.getMonth(), 1).getDay()}).map((_, i) => <div key={`empty-${i}`} className="bg-slate-50/50" />)}
                          {Array.from({length: new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1, 0).getDate()}).map((_, i) => {
                            const day = i + 1;
                            const dateStr = `${currentMonth.getFullYear()}-${String(currentMonth.getMonth() + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
                            const daySchedules = getCalendarSchedulesForDate(dateStr);
                            const visibleLimit = 3;
                            const visibleSchedules = daySchedules.slice(0, visibleLimit);
                            const hiddenScheduleCount = Math.max(0, daySchedules.length - visibleSchedules.length);
                            const isToday = dateStr === todayStr;
                            const isSelectedDay = dateStr === selectedCalendarDate;
                            const holidayNames = koreanHolidays[dateStr] ?? [];
                            const isHoliday = holidayNames.length > 0;
                            return (
                              <div
                                key={day}
                                role="button"
                                tabIndex={0}
                                aria-label={`${currentMonth.getMonth() + 1}월 ${day}일, 일정 ${daySchedules.length}건`}
                                aria-pressed={isSelectedDay}
                                onClick={() => setSelectedCalendarDate(dateStr)}
                                onKeyDown={(event) => {
                                  if (event.currentTarget !== event.target || !['Enter', ' '].includes(event.key)) return;
                                  event.preventDefault();
                                  setSelectedCalendarDate(dateStr);
                                }}
                                onDragOver={(event) => event.preventDefault()}
                                onDrop={(event) => {
                                  event.preventDefault();
                                  setSelectedCalendarDate(dateStr);
                                  void onDayDrop(dateStr);
                                }}
                                className={`group relative flex min-h-0 cursor-pointer flex-col border-b border-r border-slate-100 p-1 outline-none transition-all hover:bg-blue-50/50 focus-visible:z-20 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-500 ${isToday ? 'z-10 bg-blue-50/80 ring-2 ring-inset ring-blue-500' : isSelectedDay ? 'z-[9] bg-sky-50/70 ring-2 ring-inset ring-sky-300' : isHoliday ? 'bg-red-50/25' : 'bg-white'}`}
                              >
                                <div className="mb-1 flex shrink-0 items-start justify-between gap-0.5 sm:gap-1">
                                  <div className="flex min-w-0 items-center gap-1 sm:gap-1.5">
                                    <span className={`flex h-5 min-w-5 shrink-0 items-center justify-center rounded-md px-0.5 text-[10px] font-black sm:h-6 sm:min-w-6 sm:rounded-lg sm:px-1 sm:text-xs md:h-7 md:min-w-7 md:text-sm ${isToday ? 'bg-blue-600 text-white shadow-md' : isHoliday || daySchedules.some((schedule) => schedule.is_notice) ? 'bg-red-50 text-red-600' : new Date(`${dateStr}T00:00:00`).getDay() === 0 ? 'text-red-500' : new Date(`${dateStr}T00:00:00`).getDay() === 6 ? 'text-blue-500' : 'text-slate-800'}`}>{day}</span>
                                    {daySchedules.length > 0 && <span className={`shrink-0 whitespace-nowrap rounded-md px-1 py-0.5 text-[8px] font-black tabular-nums md:text-[9px] ${isToday ? 'bg-blue-100 text-blue-700' : 'bg-slate-100 text-slate-500'}`}>{daySchedules.length}건</span>}
                                    {isToday && <span className="hidden shrink-0 whitespace-nowrap rounded-md bg-blue-100 px-1 py-0.5 text-[8px] font-black text-blue-700 sm:inline md:text-[9px]">오늘</span>}
                                    {isHoliday && <span title={holidayNames.join(', ')} className="hidden truncate text-[8px] font-extrabold text-red-500 lg:block md:text-[9px]">{holidayNames.join(' · ')}</span>}
                                  </div>
                                  <button
                                    type="button"
                                    onClick={(event) => {
                                      event.stopPropagation();
                                      setSelectedCalendarDate(dateStr);
                                      onAddSchedule(dateStr);
                                    }}
                                    aria-label={`${currentMonth.getMonth() + 1}월 ${day}일 일정 추가`}
                                    className="absolute right-1 top-1 z-20 hidden rounded-md bg-slate-900 p-1 text-white opacity-0 transition-all hover:bg-blue-600 focus-visible:opacity-100 sm:block sm:group-hover:opacity-100"
                                  >
                                    <Plus size={10}/>
                                  </button>
                                </div>

                                <div className="mt-auto flex min-h-4 flex-wrap items-end gap-0.5 px-0.5 pb-0.5 sm:hidden" aria-hidden="true">
                                  {daySchedules.slice(0, 3).map((schedule) => {
                                    const category = getScheduleCategory(schedule);
                                    return <span key={schedule.id} data-calendar-dot-category={category} className={`h-1.5 w-1.5 rounded-full ${scheduleCategoryStyles[category].dot} ${schedule.is_urgent ? 'ring-1 ring-red-500 ring-offset-1' : ''}`} />;
                                  })}
                                  {daySchedules.length > 3 && <span className="ml-0.5 text-[7px] font-black leading-none text-slate-500">+{daySchedules.length - 3}</span>}
                                </div>

                                <div className="hidden min-h-0 flex-1 space-y-1 overflow-hidden sm:block">
                                  {visibleSchedules.map((schedule) => {
                                    const category = getScheduleCategory(schedule);
                                    const categoryStyle = scheduleCategoryStyles[category];
                                    const endDate = getScheduleEndDate(schedule);
                                    const isRange = endDate > schedule.date;
                                    const weekday = new Date(`${dateStr}T00:00:00`).getDay();
                                    const segmentStartsHere = dateStr === schedule.date || weekday === 0;
                                    const segmentEndsHere = dateStr === endDate || weekday === 6;
                                    const rangeEdges = isRange
                                      ? `${segmentStartsHere ? 'ml-1 rounded-l-lg border-l' : 'rounded-l-none border-l-0'} ${segmentEndsHere ? 'mr-1 rounded-r-lg border-r' : 'rounded-r-none border-r-0'}`
                                      : 'mx-1 rounded-lg';
                                    return (
                                      <button
                                        type="button"
                                        key={schedule.id}
                                        data-calendar-category={category}
                                        draggable
                                        title={`${formatCalendarScheduleTime(schedule, dateStr)} · ${formatScheduleTitle(schedule)}`}
                                        onDragStart={(event) => onScheduleDragStart(event, schedule.id)}
                                        onClick={(event) => {
                                          event.stopPropagation();
                                          setSelectedCalendarDate(dateStr);
                                        }}
                                        className={`relative z-[1] grid min-h-6 min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-1 border px-1 py-0.5 text-left font-bold shadow-sm transition-all lg:grid-cols-[auto_minmax(0,1fr)_auto] xl:grid-cols-[minmax(0,1fr)_auto] 2xl:grid-cols-[auto_minmax(0,1fr)_auto] ${rangeEdges} ${categoryStyle.chip} ${schedule.is_urgent ? 'ring-1 ring-red-400' : ''}`}
                                      >
                                        <span className={`hidden max-w-[68px] truncate text-[9px] font-black tabular-nums lg:block xl:hidden 2xl:block ${categoryStyle.time}`}>{formatCalendarScheduleTime(schedule, dateStr)}</span>
                                        <span className={`min-w-0 truncate text-[9px] font-extrabold ${schedule.is_completed ? 'text-slate-500 line-through opacity-60' : ''}`}>{formatScheduleTitle(schedule)}</span>
                                        {schedule.is_urgent ? <Siren size={10} className="shrink-0 text-red-500" /> : schedule.is_notice ? <span className="rounded bg-red-500 px-1 text-[7px] font-black text-white">공지</span> : null}
                                      </button>
                                    );
                                  })}
                                  {hiddenScheduleCount > 0 && (
                                    <button
                                      type="button"
                                      onClick={(event) => {
                                        event.stopPropagation();
                                        setSelectedCalendarDate(dateStr);
                                      }}
                                      className="mx-1 flex items-center justify-center rounded-md bg-slate-100/90 px-2 py-1 text-[8px] font-black text-slate-500 transition-colors hover:bg-blue-100 hover:text-blue-700 md:text-[9px]"
                                    >
                                      +{hiddenScheduleCount}건 더보기
                                    </button>
                                  )}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    </div>

                    <aside aria-labelledby="selected-calendar-date-heading" aria-live="polite" className="flex min-h-0 max-h-[68dvh] flex-col overflow-hidden rounded-[20px] border border-slate-200 bg-white shadow-xl sm:max-h-[70dvh] xl:h-full xl:max-h-none xl:rounded-[24px]">
                      <div className="shrink-0 border-b border-slate-100 bg-gradient-to-br from-slate-50 to-white p-3 sm:p-4">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <p className="text-[9px] font-black uppercase tracking-[0.18em] text-blue-600">선택한 날짜</p>
                            <h4 id="selected-calendar-date-heading" className="mt-1 break-keep text-lg font-black leading-tight text-slate-900 2xl:text-xl">{formatCalendarDateHeading(selectedCalendarDate)}</h4>
                          </div>
                          <span className="shrink-0 rounded-xl bg-slate-900 px-2.5 py-1.5 text-[10px] font-black text-white">{selectedCalendarSchedules.length}건</span>
                        </div>
                        {selectedCalendarHolidayNames.length > 0 && (
                          <div className="mt-2 flex flex-wrap gap-1.5">
                            {selectedCalendarHolidayNames.map((holidayName) => <span key={holidayName} className="rounded-lg bg-red-50 px-2 py-1 text-[9px] font-black text-red-600">{holidayName}</span>)}
                          </div>
                        )}
                        <button type="button" onClick={() => onAddSchedule(selectedCalendarDate)} className="mt-3 flex w-full items-center justify-center gap-1.5 rounded-xl bg-blue-600 px-3 py-2.5 text-xs font-black text-white shadow-sm transition-colors hover:bg-blue-700"><Plus size={14}/> 이 날짜에 일정 추가</button>
                      </div>

                      <div className="min-h-0 flex-1 touch-pan-y space-y-2.5 overflow-y-auto overscroll-contain p-3 custom-scrollbar [-webkit-overflow-scrolling:touch]">
                        {selectedCalendarSchedules.length === 0 ? (
                          <div className="flex h-full min-h-44 flex-col items-center justify-center rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-5 text-center">
                            <CalendarDays size={30} className="text-slate-300" />
                            <p className="mt-3 text-sm font-black text-slate-600">등록된 일정이 없습니다.</p>
                            <p className="mt-1 text-[10px] font-bold text-slate-400">날짜 칸의 + 또는 위 버튼으로 바로 추가할 수 있습니다.</p>
                          </div>
                        ) : selectedCalendarSchedules.map((schedule) => {
                          const isRange = getScheduleEndDate(schedule) > schedule.date;
                          const category = getScheduleCategory(schedule);
                          const categoryStyle = scheduleCategoryStyles[category];
                          return (
                            <button
                              type="button"
                              key={schedule.id}
                              data-calendar-detail-category={category}
                              onClick={() => setSelectedSchedule(schedule)}
                              className={`w-full rounded-2xl border border-l-4 p-3.5 text-left shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-md ${categoryStyle.chip} ${categoryStyle.accent} ${schedule.is_urgent ? 'ring-1 ring-red-400' : ''}`}
                            >
                              <div className="flex flex-wrap items-center justify-between gap-2">
                                <span className={`flex items-center gap-1.5 text-sm font-black tabular-nums ${categoryStyle.time}`}><Clock size={14}/>{formatScheduleTime(schedule)}</span>
                                <div className="flex flex-wrap justify-end gap-1">
                                  <span className={`rounded-md px-1.5 py-1 text-[8px] font-black ring-1 ring-inset ${categoryStyle.badge}`}>{getCalendarScheduleTypeLabel(schedule)}</span>
                                  {isRange && <span className="rounded-md bg-white/80 px-1.5 py-1 text-[8px] font-black text-slate-600">기간</span>}
                                  {schedule.is_notice && <span className="rounded-md bg-red-500 px-1.5 py-1 text-[8px] font-black text-white">공지</span>}
                                  {schedule.is_urgent && <span className="rounded-md bg-red-100 px-1.5 py-1 text-[8px] font-black text-red-600">긴급</span>}
                                </div>
                              </div>
                              <p className={`mt-2 break-keep text-sm font-extrabold leading-5 text-slate-900 ${schedule.is_completed ? 'text-slate-400 line-through opacity-70' : ''}`}>{formatScheduleTitle(schedule)}</p>
                              <p className="mt-1.5 text-xs font-medium text-slate-600">{formatScheduleDateRange(schedule)}</p>
                              {(schedule.owner_name || schedule.location) && <p className="mt-1.5 text-xs font-medium text-slate-700">{[schedule.owner_name && `담당 ${schedule.owner_name}`, schedule.location].filter(Boolean).join(' · ')}</p>}
                              {schedule.linked_file_ids?.length > 0 && <p className="mt-1 text-xs font-bold text-blue-700">관련 문서 {schedule.linked_file_ids.length}개</p>}
                            </button>
                          );
                        })}
                      </div>
                    </aside>
                  </div>
                </div>

              ) : (
                <div className="min-w-0 pb-10">
                  <label className="mb-4 block text-sm font-bold text-slate-700">문서 검색<input aria-label="파일명 검색" className="mt-2 w-full rounded-2xl border border-slate-200 bg-slate-50 p-3 text-sm font-medium text-slate-900 outline-none focus:ring-2 focus:ring-blue-500" placeholder="파일명 검색..." value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} /></label>
                  <DocumentLibrary files={files.filter((file) => file.name.toLowerCase().includes(searchQuery.toLowerCase()) && (selectedCategory === '전체' || isSameCategory(file.category ?? '', selectedCategory)))} categories={categories.map((category) => category.name)} onDownload={(file) => void handleDownload(file.url, file.name)} onDelete={onDeleteFile} onUpdate={updateDocument} onPreview={setPreviewFile} />
                </div>
              )}
            </div>
          </div>
        </section>
      </main>

      {isWeeklyPrintOpen && <WeeklySchedulePrint schedules={visibleSchedules} initialStartDate={todayStr} scopeLabel={showMySchedules ? `${myScheduleName} 님의 일정` : '팀 전체 일정'} onClose={() => setIsWeeklyPrintOpen(false)} />}
      <DocumentPreviewModal file={previewFile} onClose={() => setPreviewFile(null)} onDownload={(file) => void handleDownload(file.url, file.name)} />

      {isWhiteboardImportOpen && (
        <WhiteboardImportModal
          onClose={() => setIsWhiteboardImportOpen(false)}
          initialMonth={`${currentMonth.getFullYear()}-${String(currentMonth.getMonth() + 1).padStart(2, '0')}`}
          existingSchedules={schedules}
          onImport={onImportWhiteboardSchedules}
        />
      )}

      {isDeviceManagerOpen && <DeviceManagerModal onClose={() => setIsDeviceManagerOpen(false)} />}

      <CommandPalette
        open={isCommandPaletteOpen}
        onOpen={() => setIsCommandPaletteOpen(true)}
        onClose={() => setIsCommandPaletteOpen(false)}
        files={files}
        categories={categories}
        schedules={schedules}
        messages={messages}
        onSelectFile={(file) => handleDownload(String(file.url), file.name)}
        onSelectCategory={(category) => { setViewMode('files'); setSelectedCategory(category.name); setIsMobileSidebarOpen(false); }}
        onSelectSchedule={(schedule) => setSelectedSchedule(schedule)}
        onSelectMessage={() => setIsChatOpen(true)}
      />

      {isDeviceAdmin && isActivityHistoryOpen && (
        <ActivityHistoryModal
          logs={activityLogs}
          isLoading={isActivityHistoryLoading}
          onRestore={restoreActivityLog}
          onClose={() => setIsActivityHistoryOpen(false)}
        />
      )}

      {isKioskOpen && <DashboardKiosk schedules={schedules} dedicatedWindow={isDedicatedKiosk} initialNotice={kioskLaunchNotice} onClose={() => {
        if (isDedicatedKiosk) window.close();
        else setIsKioskOpen(false);
      }} />}

      <MonthlyAbsenceBoard
        open={isAbsenceBoardOpen}
        onClose={() => setIsAbsenceBoardOpen(false)}
        schedules={schedules}
        currentDate={todayStr}
        onOpenSchedule={(schedule) => { setIsAbsenceBoardOpen(false); setSelectedSchedule(schedule); }}
      />

      <QuickScheduleInput
        open={isQuickScheduleOpen}
        onClose={() => setIsQuickScheduleOpen(false)}
        defaultDate={todayStr}
        onSubmit={async (schedule) => { await onSaveSchedule([schedule]); }}
      />

      <YearlyDocumentCleanupModal
        open={isDeviceAdmin && isYearlyCleanupOpen}
        onClose={() => setIsYearlyCleanupOpen(false)}
        categories={categories}
        files={files}
        currentYear={Number(todayStr.slice(0, 4))}
        onDownloadCategoryZip={downloadCleanupCategoryZip}
        onExecuteCleanup={executeYearlyDocumentCleanup}
        onRefresh={() => Promise.all([fetchCategories(), fetchFiles()]).then(() => undefined)}
      />

      {scheduleFormDate && (
        <ScheduleFormModal
          key={`${scheduleFormDate}-${editingSchedule?.id ?? 'new'}`}
          date={scheduleFormDate}
          initialSchedule={editingSchedule ?? undefined}
          existingSchedules={schedules}
          copyMode={isCopyingSchedule}
          availableFiles={files}
          people={schedulePeople}
          metadataAvailable={metadataAvailable}
          onClose={() => { setScheduleFormDate(null); setEditingSchedule(null); setIsCopyingSchedule(false); setRecurrenceScope('this'); }}
          onSubmit={onSaveSchedule}
        />
      )}

      {selectedSchedule && (
        <div inert={previewFile !== null} className="fixed inset-0 z-[200] flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm">
          <div role="dialog" aria-modal="true" aria-label="일정 상세" className="flex max-h-[90dvh] w-full max-w-lg flex-col items-center overflow-y-auto rounded-[28px] bg-white p-5 shadow-2xl sm:p-8">
            <div className={`mb-4 rounded-2xl p-3 ${selectedSchedule.is_urgent ? 'bg-red-50 text-red-600' : scheduleCategoryStyles[getScheduleCategory(selectedSchedule)].icon}`}>
              {selectedSchedule.is_urgent ? <Siren size={24} /> : <CalendarDays size={24} />}
            </div>
            {selectedSchedule.is_urgent && <span className="mb-3 rounded-lg bg-red-500 px-3 py-1 text-[10px] font-black text-white">긴급 일정</span>}
            <span className={`mb-3 rounded-lg px-2.5 py-1.5 text-[10px] font-black ring-1 ring-inset ${scheduleCategoryStyles[getScheduleCategory(selectedSchedule)].badge}`}>{getCalendarScheduleTypeLabel(selectedSchedule)}</span>
            <h3 className={`mb-2 text-center text-2xl font-black leading-tight ${selectedSchedule.is_completed ? 'text-slate-400 line-through' : 'text-slate-800'}`}>{formatScheduleTitle(selectedSchedule)}</h3>
            <p className="mb-5 text-center text-sm font-bold text-slate-600">{formatScheduleDateRange(selectedSchedule)} | {formatScheduleTime(selectedSchedule)}</p>
            {(selectedSchedule.owner_name || selectedSchedule.attendee_names?.length || selectedSchedule.location || selectedSchedule.linked_file_ids?.length) ? <div className="mb-5 w-full space-y-3 rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-800">
              {selectedSchedule.owner_name && <p><span className="mr-2 font-bold text-slate-600">담당자</span>{selectedSchedule.owner_name}</p>}
              {selectedSchedule.attendee_names?.length > 0 && <p className="break-words"><span className="mr-2 font-bold text-slate-600">참석자</span>{selectedSchedule.attendee_names.join(', ')}</p>}
              {selectedSchedule.location && <p className="break-words"><span className="mr-2 font-bold text-slate-600">장소</span>{selectedSchedule.location}</p>}
              {selectedSchedule.linked_file_ids?.length > 0 && <div><p className="mb-2 font-bold text-slate-600">관련 문서</p><ul className="space-y-1">{selectedSchedule.linked_file_ids.map((id: number) => {
                const file = files.find((candidate) => Number(candidate.id) === Number(id));
                return <li key={id}>{file ? <button onClick={() => setPreviewFile(file)} className="min-h-10 w-full break-words rounded-lg border border-blue-200 bg-white px-3 py-2 text-left text-sm font-bold text-blue-700 hover:bg-blue-50">{file.name}</button> : <span className="text-xs text-slate-500">삭제되었거나 접근할 수 없는 문서</span>}</li>;
              })}</ul></div>}
            </div> : null}
            {isRecurringSchedule(selectedSchedule) && (
              <div className="mb-5 w-full rounded-2xl bg-slate-50 p-3">
                <p className="mb-2 text-[10px] font-black text-slate-500">반복 일정 적용 범위</p>
                <div className="grid grid-cols-2 gap-1.5">
                  {([
                    { value: 'this', label: '이번 일정만' },
                    { value: 'all', label: '전체 반복 일정' },
                  ] as const).map((scope) => (
                    <button key={scope.value} type="button" onClick={() => setRecurrenceScope(scope.value)} className={`rounded-xl px-2 py-2 text-[10px] font-black transition-colors ${recurrenceScope === scope.value ? 'bg-blue-600 text-white' : 'bg-white text-slate-500 hover:bg-slate-100'}`}>{scope.label}</button>
                  ))}
                </div>
                {recurrenceScope !== 'this' && <p className="mt-2 text-[9px] font-bold text-slate-400">날짜를 옮기면 모든 회차가 같은 일수만큼 함께 이동합니다.</p>}
              </div>
            )}
            <div className="grid w-full grid-cols-3 gap-3">
              <button onClick={() => onEditSchedule(selectedSchedule)} className="flex items-center justify-center gap-2 rounded-2xl bg-blue-50 py-4 font-black text-blue-600 transition-all hover:bg-blue-600 hover:text-white"><Pencil size={17}/> 일정 수정</button>
              <button onClick={() => onCopySchedule(selectedSchedule)} className="flex items-center justify-center gap-2 rounded-2xl bg-slate-100 py-4 font-black text-slate-600 transition-all hover:bg-slate-700 hover:text-white"><Copy size={17}/> 일정 복사</button>
              <button onClick={() => isRecurringSchedule(selectedSchedule) ? onCancelRecurringSchedule(selectedSchedule) : onDeleteSchedule(Number((selectedSchedule as { id: number }).id))} className="flex items-center justify-center gap-2 rounded-2xl bg-red-50 py-4 font-black text-red-500 transition-all hover:bg-red-500 hover:text-white"><Trash2 size={18}/> {isRecurringSchedule(selectedSchedule) ? '일정 취소' : '일정 삭제'}</button>
              <button onClick={() => { setSelectedSchedule(null); setRecurrenceScope('this'); }} className="col-span-3 rounded-2xl bg-slate-900 py-4 font-black text-white transition-all hover:bg-black">닫기</button>
            </div>
          </div>
        </div>
      )}

      {pendingRecurrenceMove && (
        <div className="fixed inset-0 z-[240] flex items-center justify-center bg-slate-950/50 p-4 backdrop-blur-sm" role="dialog" aria-modal="true" aria-labelledby="recurrence-move-title">
          <div className="w-full max-w-md rounded-[28px] bg-white p-6 shadow-2xl sm:p-7">
            <div className="mb-5 flex items-start gap-3">
              <div className="rounded-2xl bg-blue-50 p-3 text-blue-600"><CalendarDays size={22}/></div>
              <div className="min-w-0">
                <p className="text-[10px] font-black uppercase tracking-[0.16em] text-blue-600">반복 일정 이동</p>
                <h3 id="recurrence-move-title" className="mt-1 text-xl font-black text-slate-900">어느 범위까지 변경하시겠습니까?</h3>
                <p className="mt-2 text-sm font-bold text-slate-500">{pendingRecurrenceMove.schedule.date} → {pendingRecurrenceMove.targetDate}</p>
              </div>
            </div>
            <div className="space-y-2.5">
              <button type="button" onClick={() => void confirmRecurrenceMove('this')} className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-4 text-left transition-colors hover:border-blue-300 hover:bg-blue-50">
                <span className="block text-sm font-black text-slate-900">이번 일정만 이동</span>
                <span className="mt-1 block text-[11px] font-bold text-slate-400">선택한 회차만 새 날짜로 옮깁니다.</span>
              </button>
              <button type="button" onClick={() => void confirmRecurrenceMove('all')} className="w-full rounded-2xl bg-blue-600 px-4 py-4 text-left text-white shadow-lg transition-colors hover:bg-blue-700">
                <span className="block text-sm font-black">전체 반복 일정 이동</span>
                <span className="mt-1 block text-[11px] font-bold text-blue-100">모든 회차를 {Math.abs(getDateDifference(pendingRecurrenceMove.schedule.date, pendingRecurrenceMove.targetDate))}일씩 함께 {getDateDifference(pendingRecurrenceMove.schedule.date, pendingRecurrenceMove.targetDate) > 0 ? '뒤로' : '앞으로'} 옮깁니다.</span>
              </button>
            </div>
            <button type="button" onClick={() => setPendingRecurrenceMove(null)} className="mt-3 w-full rounded-2xl bg-slate-100 py-3.5 text-sm font-black text-slate-600 hover:bg-slate-200">취소</button>
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
