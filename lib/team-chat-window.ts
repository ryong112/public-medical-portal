export interface ChatWindowGeometry {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ChatWindowViewport {
  width: number;
  height: number;
}

export const CHAT_WINDOW_STORAGE_KEY = 'portal.team-chat.window.v1';
export const CHAT_WINDOW_DESKTOP_WIDTH = 768;

/** Never leave the header or resize corner beyond the current screen. */
export function clampChatWindow(geometry: ChatWindowGeometry, viewport: ChatWindowViewport): ChatWindowGeometry {
  const inset = 16;
  const maxWidth = Math.max(1, viewport.width - inset * 2);
  const maxHeight = Math.max(1, viewport.height - inset * 2);
  const width = Math.max(Math.min(340, maxWidth), Math.min(geometry.width, maxWidth));
  const height = Math.max(Math.min(360, maxHeight), Math.min(geometry.height, maxHeight));
  return {
    x: Math.max(inset, Math.min(geometry.x, viewport.width - inset - width)),
    y: Math.max(inset, Math.min(geometry.y, viewport.height - inset - height)),
    width,
    height,
  };
}

export function defaultChatWindow(viewport: ChatWindowViewport): ChatWindowGeometry {
  const width = 420;
  const height = Math.min(720, Math.round(viewport.height * 0.82));
  return clampChatWindow({ x: viewport.width - width - 24, y: viewport.height - height - 24, width, height }, viewport);
}

/** Persist presentation only; malformed or obsolete values cannot break opening. */
export function parseChatWindow(value: string | null): ChatWindowGeometry | null {
  if (!value) return null;
  try {
    const saved: unknown = JSON.parse(value);
    if (!saved || typeof saved !== 'object') return null;
    const row = saved as Record<string, unknown>;
    if (row.version !== 1 || !['x', 'y', 'width', 'height'].every((field) => typeof row[field] === 'number' && Number.isFinite(row[field]))) return null;
    return { x: row.x as number, y: row.y as number, width: row.width as number, height: row.height as number };
  } catch {
    return null;
  }
}
