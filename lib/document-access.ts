import { supabase } from './supabase';

const projectUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const referencePrefix = 'storage://files/';
const legacyPrefix = '/storage/v1/object/public/files/';

function isSafeKeyPart(part: string): boolean {
  return part.length > 0 && part.length <= 255 && part !== '.' && part !== '..'
    && !/[\\/?#%]/u.test(part) && !Array.from(part).some((character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127);
}

/** Decode a record only as an object key. Never return a stored URL as a fetch target. */
export function getDocumentStoragePath(value: unknown, expectedProject = projectUrl): string | null {
  if (typeof value !== 'string' || !value || value.length > 2048 || value.trim() !== value) return null;
  try {
    let encoded: string;
    if (value.startsWith(referencePrefix)) encoded = value.slice(referencePrefix.length);
    else {
      if (!expectedProject) return null;
      // Capture the raw path before URL normalization can remove dot segments.
      const match = /^https?:\/\/[^\\/?#]+(\/[^?#]*)$/u.exec(value);
      if (!match || !match[1].startsWith(legacyPrefix)) return null;
      const url = new URL(value);
      if (url.origin !== new URL(expectedProject).origin || url.username || url.password) return null;
      encoded = match[1].slice(legacyPrefix.length);
    }
    const parts = encoded.split('/').map(decodeURIComponent);
    return parts.every(isSafeKeyPart) ? parts.join('/') : null;
  } catch {
    return null;
  }
}

export function getNewDocumentReference(path: string): string {
  const parts = path.split('/');
  if (!parts.every(isSafeKeyPart)) throw new Error('문서의 저장 경로를 확인하지 못했습니다.');
  return `${referencePrefix}${parts.map(encodeURIComponent).join('/')}`;
}

/** Supabase checks the current session and Storage policy on every original-file request. */
export async function downloadDocumentBlob(reference: unknown, signal?: AbortSignal, maxBytes?: number): Promise<Blob> {
  const key = getDocumentStoragePath(reference);
  if (!key || !projectUrl || !publishableKey) throw new Error('이 문서는 문서함 저장소에서 확인할 수 없습니다.');
  const { data, error } = await supabase.auth.getSession();
  if (error || !data.session?.access_token) throw new Error('기기 승인을 확인한 뒤 다시 시도해 주세요.');
  const endpoint = new URL(`/storage/v1/object/authenticated/files/${key.split('/').map(encodeURIComponent).join('/')}`, projectUrl);
  const response = await fetch(endpoint, {
    headers: { apikey: publishableKey, authorization: `Bearer ${data.session.access_token}` },
    signal,
    redirect: 'error',
    cache: 'no-store',
    credentials: 'omit',
    referrerPolicy: 'no-referrer',
  });
  if (!response.ok) {
    if ([401, 403].includes(response.status)) throw new Error('이 문서를 열 수 있는 권한이 없습니다.');
    throw new Error(`문서를 불러오지 못했습니다. (HTTP ${response.status})`);
  }
  const tooBig = () => new Error('50 MB보다 큰 문서는 다운로드하여 확인해 주세요.');
  if (maxBytes !== undefined && Number(response.headers.get('content-length')) > maxBytes) {
    await response.body?.cancel().catch(() => undefined);
    throw tooBig();
  }
  const blob = await response.blob();
  if (maxBytes !== undefined && blob.size > maxBytes) throw tooBig();
  return blob;
}
