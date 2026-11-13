'use client';

import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { AtSign, LoaderCircle, MessageCircle, Send, Trash2, X } from 'lucide-react';
import {
  getChatMentionQuery,
  getChatMentionRanges,
  getChatTextSegments,
  getSelectedChatMentionIds,
  type ChatMentionMember,
} from '@/lib/team-chat-mentions';

export type TeamChatMember = ChatMentionMember;

export interface TeamChatMessage {
  id: number;
  content: string;
  sender_id: string | null;
  created_at: string;
  sender_member_id?: string | null;
  sender_display_name?: string | null;
  mentioned_member_ids?: string[] | null;
}

interface TeamChatPanelProps {
  messages: TeamChatMessage[];
  members: TeamChatMember[];
  currentUserId: string | null;
  currentMemberId?: string | null;
  onSend: (content: string, mentionedMemberIds: string[]) => Promise<void>;
  onDelete: (id: number) => void | Promise<void>;
  onClose: () => void;
  canMention?: boolean;
  focusedMessageId?: number | null;
}

const dateKeyFormatter = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' });
const dateLabelFormatter = new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', year: 'numeric', month: 'long', day: 'numeric', weekday: 'short' });
const timeFormatter = new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', hour: '2-digit', minute: '2-digit', hour12: false });

const messageDate = (value: string) => {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

export default function TeamChatPanel({
  messages,
  members,
  currentUserId,
  currentMemberId,
  onSend,
  onDelete,
  onClose,
  canMention = true,
  focusedMessageId = null,
}: TeamChatPanelProps) {
  const [draft, setDraft] = useState('');
  const [caret, setCaret] = useState(0);
  const [selectedMembers, setSelectedMembers] = useState<TeamChatMember[]>([]);
  const [activeSuggestion, setActiveSuggestion] = useState(0);
  const [dismissedQuery, setDismissedQuery] = useState<string | null>(null);
  const [isSending, setIsSending] = useState(false);
  const [deletingIds, setDeletingIds] = useState<number[]>([]);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLElement>(null);
  const lastFocusedMessageRef = useRef<number | null>(null);
  const sendingRef = useRef(false);
  const deletingRef = useRef(new Set<number>());
  const identifier = useId();
  const titleId = `${identifier}-title`;
  const hintId = `${identifier}-hint`;
  const listId = `${identifier}-members`;
  const queryKey = `${caret}:${draft}`;
  const mentionQuery = canMention && !isSending && dismissedQuery !== queryKey ? getChatMentionQuery(draft, caret) : null;

  const availableMembers = useMemo(() => {
    const ids = new Set<string>();
    return members.filter((member) => {
      if (!member.handle || ids.has(member.id)) return false;
      ids.add(member.id);
      return true;
    });
  }, [members]);
  const memberById = useMemo(() => new Map(availableMembers.map((member) => [member.id, member])), [availableMembers]);
  const query = mentionQuery?.query.toLocaleLowerCase('ko-KR');
  const suggestions = mentionQuery ? availableMembers.filter((member) => !query
    || member.display_name.toLocaleLowerCase('ko-KR').includes(query)
    || member.handle.toLocaleLowerCase('ko-KR').includes(query)).slice(0, 6) : [];
  const suggestionIndex = Math.min(activeSuggestion, Math.max(0, suggestions.length - 1));
  const activeRecipients = selectedMembers.filter((member) => memberById.get(member.id)?.handle === member.handle
    && getChatMentionRanges(draft, member.handle).length > 0);
  const sortedMessages = useMemo(() => [...messages].sort((left, right) => {
    const leftTime = messageDate(left.created_at)?.getTime();
    const rightTime = messageDate(right.created_at)?.getTime();
    return leftTime !== undefined && rightTime !== undefined ? leftTime - rightTime || left.id - right.id : left.id - right.id;
  }), [messages]);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    if (focusedMessageId === null) bottomRef.current?.scrollIntoView?.({ block: 'nearest' });
  }, [focusedMessageId, messages.length]);

  useEffect(() => {
    if (focusedMessageId === null) {
      lastFocusedMessageRef.current = null;
      return;
    }
    if (lastFocusedMessageRef.current === focusedMessageId) return;
    const message = panelRef.current?.querySelector<HTMLElement>(`[data-team-message-id="${focusedMessageId}"]`);
    if (!message) return;
    message.scrollIntoView?.({ block: 'center' });
    lastFocusedMessageRef.current = focusedMessageId;
  }, [focusedMessageId, messages]);

  const updateDraft = (value: string, nextCaret: number) => {
    setDraft(value);
    setCaret(nextCaret);
    setSelectedMembers((previous) => previous.filter((member) => getChatMentionRanges(value, member.handle).length > 0));
    setActiveSuggestion(0);
    setDismissedQuery(null);
    setError(null);
  };

  const chooseMember = (member: TeamChatMember) => {
    if (!mentionQuery) return;
    const suffix = draft.slice(mentionQuery.end);
    const token = `@${member.handle}${suffix.startsWith(' ') ? '' : ' '}`;
    const nextDraft = `${draft.slice(0, mentionQuery.start)}${token}${suffix}`;
    const nextCaret = mentionQuery.start + token.length;
    setDraft(nextDraft);
    setCaret(nextCaret);
    setSelectedMembers((previous) => [...previous.filter((item) => item.id !== member.id
      && getChatMentionRanges(nextDraft, item.handle).length > 0), member]);
    setActiveSuggestion(0);
    setError(null);
    requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.setSelectionRange(nextCaret, nextCaret);
    });
  };

  const sendMessage = async () => {
    if (!draft.trim() || sendingRef.current) return;
    const content = draft.trim();
    const mentionedIds = canMention ? getSelectedChatMentionIds(content, activeRecipients) : [];
    sendingRef.current = true;
    setIsSending(true);
    setError(null);
    try {
      await onSend(content, mentionedIds);
      setDraft('');
      setCaret(0);
      setSelectedMembers([]);
      setDismissedQuery(null);
    } catch {
      setError('메시지를 보내지 못했습니다. 작성한 내용은 그대로 보관되어 있습니다. 다시 시도해 주세요.');
    } finally {
      sendingRef.current = false;
      setIsSending(false);
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  };

  const deleteMessage = async (id: number) => {
    if (deletingRef.current.has(id)) return;
    deletingRef.current.add(id);
    setDeletingIds((previous) => [...previous, id]);
    setError(null);
    try {
      await onDelete(id);
    } catch {
      setError('메시지를 삭제하지 못했습니다. 잠시 후 다시 시도해 주세요.');
    } finally {
      deletingRef.current.delete(id);
      setDeletingIds((previous) => previous.filter((value) => value !== id));
    }
  };

  return (
    <section
      ref={panelRef}
      role="dialog"
      aria-labelledby={titleId}
      className="fixed bottom-0 right-0 z-[100] flex h-[min(82dvh,720px)] w-full min-w-0 flex-col overflow-hidden rounded-t-[28px] border border-slate-200 bg-slate-50 shadow-2xl md:bottom-6 md:right-6 md:w-[420px] md:max-w-[calc(100vw-3rem)] md:rounded-[28px]"
      onKeyDown={(event) => {
        if (event.key !== 'Escape' || event.nativeEvent.isComposing) return;
        event.stopPropagation();
        if (mentionQuery) {
          event.preventDefault();
          setDismissedQuery(queryKey);
        } else onClose();
      }}
    >
      <header className="flex shrink-0 items-center justify-between gap-3 border-b border-slate-200 bg-white px-5 py-4">
        <div className="flex min-w-0 items-center gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-blue-50 text-blue-600"><MessageCircle size={20} /></span>
          <div className="min-w-0"><h2 id={titleId} className="text-sm font-black text-slate-900">정보공유방</h2><p className="mt-1 text-[11px] font-medium text-slate-500">팀의 소식과 이야기를 나눠 보세요</p></div>
        </div>
        <button type="button" onClick={onClose} aria-label="정보공유방 닫기" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-slate-100 text-slate-500 transition hover:bg-slate-200 focus-visible:outline-2 focus-visible:outline-blue-500"><X size={18} /></button>
      </header>

      <div role="log" aria-label="정보공유방 메시지" aria-live="polite" aria-relevant="additions" className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-5">
        {!sortedMessages.length && <div className="flex min-h-36 flex-col items-center justify-center gap-2 text-center"><MessageCircle size={26} className="text-slate-300" /><p className="text-sm font-bold text-slate-500">아직 나눈 이야기가 없어요</p><p className="text-xs text-slate-400">첫 소식을 남겨 보세요.</p></div>}
        {sortedMessages.map((message, index) => {
          const date = messageDate(message.created_at);
          const dateKey = date ? dateKeyFormatter.format(date) : 'unknown';
          const previousDate = index ? messageDate(sortedMessages[index - 1].created_at) : null;
          const previousDateKey = previousDate ? dateKeyFormatter.format(previousDate) : 'unknown';
          const showDate = index === 0 || dateKey !== previousDateKey;
          const isOwn = message.sender_member_id
            ? message.sender_member_id === currentMemberId
            : Boolean(currentUserId && message.sender_id === currentUserId);
          const author = message.sender_member_id ? memberById.get(message.sender_member_id) : null;
          const authorName = message.sender_display_name || author?.display_name || (isOwn ? '나' : message.sender_member_id ? '이전 팀원' : '이전 대화 참여자');
          return (
            <div key={message.id}>
              {showDate && <div className="mb-5 mt-2 flex items-center gap-3" aria-label={date ? dateLabelFormatter.format(date) : '날짜 정보 없음'}><span className="h-px flex-1 bg-slate-200" /><span className="shrink-0 text-[10px] font-bold text-slate-400">{date ? dateLabelFormatter.format(date) : '날짜 정보 없음'}</span><span className="h-px flex-1 bg-slate-200" /></div>}
              <article data-team-message-id={message.id} className={`group mb-4 flex min-w-0 gap-2 ${isOwn ? 'flex-row-reverse' : ''} ${focusedMessageId === message.id ? 'rounded-2xl bg-amber-50/70 ring-2 ring-amber-200 ring-offset-4' : ''}`} aria-label={`${authorName}의 메시지`}>
                <span aria-hidden="true" className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-xl text-xs font-black ${isOwn ? 'bg-blue-100 text-blue-700' : 'bg-white text-slate-500 ring-1 ring-slate-200'}`}>{authorName.slice(0, 1)}</span>
                <div className={`flex min-w-0 max-w-[calc(100%-3rem)] flex-col ${isOwn ? 'items-end' : 'items-start'}`}>
                  <div className={`mb-1.5 flex max-w-full items-baseline gap-2 ${isOwn ? 'flex-row-reverse' : ''}`}><span className="truncate text-[11px] font-bold text-slate-600">{authorName}</span><time dateTime={date ? date.toISOString() : undefined} className="shrink-0 text-[10px] text-slate-400">{date ? timeFormatter.format(date) : '--:--'}</time></div>
                  <div className={`max-w-full whitespace-pre-wrap break-words rounded-2xl px-3.5 py-3 text-[13px] font-medium leading-relaxed [overflow-wrap:anywhere] ${isOwn ? 'rounded-tr-sm bg-blue-600 text-white' : 'rounded-tl-sm border border-slate-200 bg-white text-slate-800'}`}>
                    {getChatTextSegments(message.content, availableMembers, message.mentioned_member_ids ?? []).map((segment, segmentIndex) => segment.memberId
                      ? <span key={segmentIndex} title={memberById.get(segment.memberId)?.display_name} className={`rounded px-0.5 font-bold ${isOwn ? 'bg-white/20 text-white' : 'bg-blue-50 text-blue-700'}`}>{segment.text}</span>
                      : <span key={segmentIndex}>{segment.text}</span>)}
                  </div>
                  <button type="button" aria-label={`${authorName}의 메시지 삭제`} disabled={deletingIds.includes(message.id)} onClick={() => void deleteMessage(message.id)} className="mt-1 flex min-h-7 items-center gap-1 px-1 text-[10px] text-slate-400 transition hover:text-red-500 focus-visible:opacity-100 focus-visible:outline-2 focus-visible:outline-blue-500 disabled:opacity-50 md:opacity-0 md:group-hover:opacity-100">{deletingIds.includes(message.id) ? <LoaderCircle size={11} className="animate-spin" /> : <Trash2 size={11} />}삭제</button>
                </div>
              </article>
            </div>
          );
        })}
        <div ref={bottomRef} />
      </div>

      <form onSubmit={(event) => { event.preventDefault(); void sendMessage(); }} className="relative shrink-0 border-t border-slate-200 bg-white p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] md:p-4">
        {mentionQuery && <div id={listId} role="listbox" aria-label="멘션할 팀원" className="absolute bottom-full left-3 right-3 mb-2 max-h-64 overflow-y-auto rounded-2xl border border-slate-200 bg-white p-1.5 shadow-xl">
          <div className="flex items-center gap-1.5 px-2.5 py-2 text-[10px] font-bold text-slate-400"><AtSign size={12} />알림을 받을 팀원을 선택하세요</div>
          {suggestions.length ? suggestions.map((member, index) => <button type="button" role="option" id={`${listId}-${index}`} key={member.id} aria-selected={index === suggestionIndex} onMouseDown={(event) => event.preventDefault()} onClick={() => chooseMember(member)} className={`flex w-full items-center justify-between gap-2 rounded-xl px-3 py-2.5 text-left ${index === suggestionIndex ? 'bg-blue-50 text-blue-700' : 'text-slate-700 hover:bg-slate-50'}`}><span className="truncate text-xs font-bold">{member.display_name}</span><span className="truncate text-[11px] text-slate-400">@{member.handle}</span></button>) : <p className="px-3 py-3 text-xs text-slate-500">일치하는 팀원이 없습니다.</p>}
        </div>}
        {activeRecipients.length > 0 && <div aria-label="멘션 알림 대상" className="mb-2 flex flex-wrap gap-1.5">{activeRecipients.map((member) => <span key={member.id} className="inline-flex max-w-full items-center gap-1 rounded-lg bg-blue-50 py-1 pl-2 text-[10px] font-bold text-blue-700"><AtSign size={10} className="shrink-0" /><span className="truncate">{member.display_name}</span><button type="button" aria-label={`${member.display_name} 멘션 알림 대상에서 제외`} onClick={() => setSelectedMembers((previous) => previous.filter((item) => item.id !== member.id))} disabled={isSending} className="flex h-5 w-5 shrink-0 items-center justify-center rounded hover:bg-blue-100 disabled:opacity-50"><X size={11} /></button></span>)}</div>}
        {error && <p role="alert" className="mb-2 rounded-xl bg-red-50 px-3 py-2 text-xs leading-relaxed text-red-600">{error}</p>}
        <div className="flex items-end gap-2 rounded-2xl border border-slate-200 bg-slate-50 p-2 focus-within:border-blue-300 focus-within:ring-2 focus-within:ring-blue-100">
          <textarea
            ref={inputRef}
            value={draft}
            readOnly={isSending}
            rows={2}
            aria-label="공유방 메시지 작성"
            aria-describedby={hintId}
            aria-autocomplete={canMention ? 'list' : undefined}
            aria-controls={mentionQuery ? listId : undefined}
            aria-activedescendant={mentionQuery && suggestions.length ? `${listId}-${suggestionIndex}` : undefined}
            placeholder={canMention ? '메시지 입력 · @로 팀원 멘션' : '메시지를 입력하세요'}
            onChange={(event) => updateDraft(event.target.value, event.target.selectionStart)}
            onSelect={(event) => { const input = event.currentTarget; setCaret(input.selectionStart === input.selectionEnd ? input.selectionStart : -1); }}
            onKeyDown={(event) => {
              if (event.nativeEvent.isComposing) return;
              if (mentionQuery && suggestions.length && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
                event.preventDefault();
                setActiveSuggestion((suggestionIndex + (event.key === 'ArrowDown' ? 1 : -1) + suggestions.length) % suggestions.length);
              } else if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault();
                if (mentionQuery && suggestions.length) chooseMember(suggestions[suggestionIndex]);
                else void sendMessage();
              }
            }}
            className="max-h-32 min-h-12 min-w-0 flex-1 resize-none bg-transparent px-1.5 py-1 text-sm leading-relaxed text-slate-900 outline-none placeholder:text-slate-400"
          />
          <button type="submit" disabled={!draft.trim() || isSending} aria-label={isSending ? '메시지 전송 중' : '메시지 전송'} className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-blue-600 text-white transition hover:bg-blue-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500 disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-400">{isSending ? <LoaderCircle size={17} className="animate-spin" /> : <Send size={17} />}</button>
        </div>
        <p id={hintId} className="mt-2 px-1 text-[10px] leading-relaxed text-slate-400">{canMention ? '@ 입력 후 목록에서 선택한 팀원에게만 알림 · ' : '팀원 연결 후 @멘션 사용 가능 · '}Enter 전송 / Shift+Enter 줄바꿈</p>
      </form>
    </section>
  );
}
