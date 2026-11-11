const retryableStatuses = new Set([408, 500, 502, 503, 504]);
const retryDelays = [500, 1000];
const wait = (milliseconds: number) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds));

// Retry only transient HTTP failures within the caller's original deadline.
// Rate limits and configuration errors must remain visible to the caller.
export const fetchWithPhotoRetry = async (
  input: RequestInfo | URL,
  init: RequestInit,
  fetcher: typeof fetch = fetch,
  pause: (milliseconds: number) => Promise<void> = wait,
): Promise<Response> => {
  for (let attempt = 0; ; attempt += 1) {
    init.signal?.throwIfAborted();
    const response = await fetcher(input, init);
    if (!retryableStatuses.has(response.status) || attempt >= retryDelays.length) return response;

    // This response will not be returned or read; release its connection first.
    if (response.body) await response.body.cancel().catch(() => undefined);
    init.signal?.throwIfAborted();
    await pause(retryDelays[attempt]);
    init.signal?.throwIfAborted();
  }
};
