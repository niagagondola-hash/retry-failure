/**
 * withTimeout — race a Promise against a setTimeout-based timeout (AUTH-14).
 *
 * Plan reference: PLAN2 Section 8.2 (alur lazy sync — blocking sync timeout 2s),
 * Section 8.7 (grace period — blocking sync; kalau gagal, tetap pakai cache).
 *
 * Used by `LazySyncMiddleware` to enforce a max wait on blocking sync calls so
 * that auth-server outage cannot stall users beyond `SYNC_BLOCKING_TIMEOUT_MS`
 * (default 2s per plan2 §16). On timeout the caller falls back to stale cache.
 *
 * Implementation notes:
 *   - Promise.race between the input promise and a `setTimeout`-driven rejecter.
 *   - Timer is `unref()`'d so it does not keep the Node event loop alive solely
 *     for the purpose of firing a pending timeout (clean shutdown semantics).
 *   - `finally` clears the timer whether the input promise wins or the timeout
 *     wins, so no leaked timer resource.
 *
 * @typeParam T - resolved value type of the input promise
 * @param promise - the async operation to guard
 * @param ms - timeout in milliseconds
 * @param label - human-readable label included in the timeout error message
 * @returns the resolved value of `promise`, or rejects with `Error("<label> timeout after <ms>ms")`
 */
export function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  label = 'operation',
): Promise<T> {
  let timer: NodeJS.Timeout | undefined;

  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`${label} timeout after ${ms}ms`)),
      ms,
    );
    // Do not keep the event loop alive just to fire this timer.
    timer.unref?.();
  });

  return Promise.race([promise, timeout]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}
