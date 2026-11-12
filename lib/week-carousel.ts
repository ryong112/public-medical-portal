export const normalizeWeekCarouselIndex = (index: number, total: number): number => {
  const length = Number.isFinite(total) ? Math.max(0, Math.floor(total)) : 0;
  if (!length) return 0;
  const offset = Number.isFinite(index) ? Math.floor(index) : 0;
  return ((offset % length) + length) % length;
};

export const canRotateWeekCarousel = (total: number, visibleRows: number): boolean => total > Math.max(1, Math.floor(visibleRows));

/** The last slot is the next entering row, never a separate schedule copy. */
export const getWeekCarouselIndices = (total: number, index: number, visibleRows: number, includeEnteringRow = false): number[] => {
  const length = Number.isFinite(total) ? Math.max(0, Math.floor(total)) : 0;
  const visible = Math.max(1, Math.floor(visibleRows));
  if (!length) return [];
  const count = Math.min(length, visible + (includeEnteringRow && canRotateWeekCarousel(length, visible) ? 1 : 0));
  const start = normalizeWeekCarouselIndex(index, length);
  return Array.from({ length: count }, (_, slot) => normalizeWeekCarouselIndex(start + slot, length));
};

export const nextWeekCarouselIndex = (index: number, total: number): number => normalizeWeekCarouselIndex(index + 1, total);
