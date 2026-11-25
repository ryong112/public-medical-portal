type WhiteboardAccess = { ok: true } | { ok: false; status: 401 | 403 | 503 };

export function extractUserBearer(authorization: string | null): string | null {
  if (!authorization || authorization.length > 8192) return null;
  return /^Bearer ([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)$/i.exec(authorization)?.[1] ?? null;
}

/** Token shape is not proof of identity: verify with Supabase Auth, then check the DB role. */
export async function authorizeWhiteboardRequest(
  token: string,
  verifyUser: (token: string) => Promise<boolean>,
  verifyApprovedHuman: () => Promise<boolean>,
): Promise<WhiteboardAccess> {
  try {
    if (!(await verifyUser(token))) return { ok: false, status: 401 };
    if (!(await verifyApprovedHuman())) return { ok: false, status: 403 };
    return { ok: true };
  } catch {
    return { ok: false, status: 503 };
  }
}

// 12 MiB file expands to 16 MiB base64. Permit a bounded envelope for date fields.
export const MAX_IMAGE_BASE64_LENGTH = 16 * 1024 * 1024;
export const MAX_ANALYSIS_BODY_BYTES = MAX_IMAGE_BASE64_LENGTH + 4096;

export class PhotoBodyError extends Error {
  constructor(readonly status: 400 | 413) { super('Invalid photo request body'); }
}

export async function readBoundedPhotoBody(request: Request, maxBytes = MAX_ANALYSIS_BODY_BYTES): Promise<Record<string, unknown>> {
  if (Number(request.headers.get('content-length')) > maxBytes) throw new PhotoBodyError(413);
  if (!request.body) throw new PhotoBodyError(400);
  const reader = request.body.getReader();
  const decoder = new TextDecoder('utf-8', { fatal: true });
  const pieces: string[] = [];
  let bytes = 0;
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      bytes += part.value.byteLength;
      if (bytes > maxBytes) {
        void reader.cancel().catch(() => undefined);
        throw new PhotoBodyError(413);
      }
      pieces.push(decoder.decode(part.value, { stream: true }));
    }
    pieces.push(decoder.decode());
    const value = JSON.parse(pieces.join(''));
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new PhotoBodyError(400);
    return value;
  } catch (error) {
    if (error instanceof PhotoBodyError) throw error;
    throw new PhotoBodyError(400);
  } finally {
    reader.releaseLock();
  }
}
