export type DocumentUploadStatus = 'queued' | 'uploading' | 'saving' | 'succeeded' | 'failed';

export interface UploadItem {
  id: string;
  file: File;
  /** Captured when the user selects the files; navigation never changes a retry's destination. */
  targetCategory: string;
  /** Stable for every retry of this file. */
  storagePath: string;
  status: DocumentUploadStatus;
  progress: number | null;
  storageUploaded: boolean;
  url?: string;
  error?: string;
  attempts: number;
}

export interface DocumentUploadServices {
  /** Report real transferred-byte percentages when supported; otherwise leave progress null. */
  upload: (item: UploadItem, onProgress: (percentage: number) => void) => Promise<{ url: string }>;
  /**
   * Must be idempotent for item.storagePath / item.url. Look up the stable URL before
   * inserting (or use a unique key + upsert), since a failed response may have committed.
   */
  ensureMetadata: (item: UploadItem & { url: string }) => Promise<void>;
}

export function createDocumentUploads(files: readonly File[], targetCategory: string): UploadItem[] {
  return files.map((file) => {
    const id = globalThis.crypto.randomUUID();
    const extension = file.name.match(/\.([a-zA-Z0-9]{1,12})$/)?.[1]?.toLowerCase();
    return {
      id,
      file,
      targetCategory,
      storagePath: `${id}${extension ? `.${extension}` : ''}`,
      status: 'queued',
      progress: null,
      storageUploaded: false,
      attempts: 0,
    };
  });
}

function uploadErrorMessage(error: unknown): string {
  if (error && typeof error === 'object' && 'message' in error && typeof error.message === 'string') return error.message;
  return '업로드하지 못했습니다. 연결 상태를 확인한 뒤 다시 시도해 주세요.';
}

/** One runner per mounted upload queue. It serializes files and coalesces duplicate retries. */
export function createDocumentUploadRunner(services: DocumentUploadServices) {
  const checkpoints = new Map<string, UploadItem>();
  const inFlight = new Map<string, Promise<UploadItem>>();

  const runOne = (original: UploadItem, onChange: (item: UploadItem) => void): Promise<UploadItem> => {
    const active = inFlight.get(original.id);
    if (active) return active;
    let item = checkpoints.get(original.id) ?? original;
    if (item.status === 'succeeded') {
      onChange(item);
      return Promise.resolve(item);
    }

    const publish = (changes: Partial<UploadItem>) => {
      item = { ...item, ...changes };
      checkpoints.set(item.id, item);
      onChange(item);
    };

    // Deferring work by one microtask installs the lock before callbacks can trigger another run.
    const task = Promise.resolve().then(async () => {
      publish({ status: item.storageUploaded ? 'saving' : 'uploading', error: undefined, attempts: item.attempts + 1 });
      try {
        if (!item.storageUploaded) {
          publish({ progress: null });
          const uploaded = await services.upload(item, (percentage) => {
            if (item.status === 'uploading' && Number.isFinite(percentage)) {
              publish({ progress: Math.max(0, Math.min(100, percentage)) });
            }
          });
          if (!uploaded.url) throw new Error('업로드한 파일의 주소를 확인하지 못했습니다.');
          publish({ storageUploaded: true, url: uploaded.url, progress: 100, status: 'saving' });
        }
        if (!item.url) throw new Error('파일 주소가 없어 문서 목록에 저장하지 못했습니다.');
        await services.ensureMetadata({ ...item, url: item.url });
        publish({ status: 'succeeded', progress: 100, error: undefined });
      } catch (error) {
        publish({ status: 'failed', error: uploadErrorMessage(error) });
      }
      return item;
    }).finally(() => inFlight.delete(original.id));

    inFlight.set(original.id, task);
    return task;
  };

  return {
    async run(items: readonly UploadItem[], onChange: (item: UploadItem) => void): Promise<UploadItem[]> {
      const results: UploadItem[] = [];
      for (const item of items) results.push(await runOne(item, onChange));
      return results;
    },
    /** Release File references after the finished queue is dismissed. Active items are retained. */
    forget(ids: readonly string[]) {
      for (const id of ids) if (!inFlight.has(id)) checkpoints.delete(id);
    },
  };
}
