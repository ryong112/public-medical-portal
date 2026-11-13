/** Keep readable rows; only the local list changes pages when it fills up. */
export function getKioskPageSize(height: number, rowHeight: number, total: number, maxRows = 6): number {
  const row = Math.max(36, Number.isFinite(rowHeight) ? rowHeight : 76);
  const maximum = Math.max(1, Number.isFinite(maxRows) ? Math.floor(maxRows) : 6);
  const available = Math.max(0, Number.isFinite(height) ? height : 0);
  const capacity = Math.max(1, Math.min(maximum, Math.floor((available + 6) / (row + 6))));
  return total <= capacity ? capacity : Math.max(1, Math.min(maximum, Math.floor((available - 32 + 6) / (row + 6))));
}
