export interface ReviewablePhotoSchedule {
  title: string;
  date: string;
  is_manual?: boolean;
  confidence: number;
  color_confidence: number;
  ink_color: string;
  outside_photo_month?: boolean;
  warnings: string[];
}

export function photoScheduleNeedsReview(schedule: ReviewablePhotoSchedule, comparison: 'new' | 'changed' | 'duplicate') {
  if (!schedule.title.trim() || !schedule.date || schedule.outside_photo_month) return true;
  if (comparison === 'changed') return true;
  if (schedule.is_manual) return false;
  return schedule.confidence < 0.8 || schedule.color_confidence < 0.8
    || ['unknown', 'teal'].includes(schedule.ink_color) || schedule.warnings.length > 0;
}
