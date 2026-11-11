export type InferredScheduleType = 'meeting' | 'business_trip' | 'internal' | 'leave' | 'unclassified';

/** Infer a new quick-entry draft only. Existing or manually selected types stay authoritative. */
export const inferScheduleTypeFromText = (source: string): InferredScheduleType => {
  const text = source.normalize('NFKC');
  const explicitType = text.match(/(?:^|\s)(회의|출장|내부\s*일정|휴가|연차|반차|조퇴|외출|일반|미분류)\s*[):：]\s*/u)?.[1].replace(/\s/gu, '');
  if (explicitType === '회의') return 'meeting';
  if (explicitType === '출장') return 'business_trip';
  if (explicitType === '내부일정') return 'internal';
  if (explicitType && ['휴가', '연차', '반차', '조퇴', '외출'].includes(explicitType)) return 'leave';
  if (explicitType === '일반' || explicitType === '미분류') return 'unclassified';

  if (/내부\s*일정/u.test(text)) return 'internal';
  if (/출장/u.test(text)) return 'business_trip';
  if (/연차|휴가|반차|조퇴|외출/u.test(text)) return 'leave';
  if (/협의회|간담회|업무\s*협약(?:식)?|협약식/u.test(text)) return 'internal';
  if (/회의/u.test(text)) return 'meeting';
  return 'unclassified';
};
