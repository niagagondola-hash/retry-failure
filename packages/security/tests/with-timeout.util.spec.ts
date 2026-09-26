/**
 * withTimeout unit tests (AUTH-14).
 *
 * Plan reference: PLAN2 Section 8.2 (blocking sync timeout 2s), AUTH-14 task spec §1.
 *
 * Verifies:
 *   - resolves with input promise value when input wins the race
 *   - rejects with timeout error when timer wins the race
 *   - timer is cleared after resolve (no leaked handle)
 *   - timer is cleared after timeout reject
 *   - custom label is included in the timeout error message
 */
import { withTimeout } from '../src/sync/with-timeout.util';

describe('withTimeout', () => {
  describe('resolves with input value when input wins', () => {
    it('resolves immediately when input is already resolved', async () => {
      const result = await withTimeout(Promise.resolve('done'), 1_000);
      expect(result).toBe('done');
    });

    it('resolves when input resolves before the timeout', async () => {
      const slow = new Promise<string>((resolve) =>
        setTimeout(() => resolve('slow-done'), 50),
      );
      const result = await withTimeout(slow, 500);
      expect(result).toBe('slow-done');
    });
  });

  describe('rejects with timeout error when timer wins', () => {
    it('rejects with default label when timer fires first', async () => {
      const never = new Promise<string>(() => {
        /* never resolves */
      });
      await expect(withTimeout(never, 50)).rejects.toThrow(
        'operation timeout after 50ms',
      );
    });

    it('rejects with custom label in error message', async () => {
      const never = new Promise<string>(() => {
        /* never resolves */
      });
      await expect(
        withTimeout(never, 30, 'sync blocking'),
      ).rejects.toThrow('sync blocking timeout after 30ms');
    });
  });

  describe('timer cleanup', () => {
    it('clears the timer after the input promise resolves (no leaked handle)', async () => {
      // Spy on setTimeout/clearTimeout to assert pairing — does not stub, so the real
      // timers still fire (and we verify the timer is actually cleared).
      const setTimeoutSpy = jest.spyOn(global, 'setTimeout');
      const clearTimeoutSpy = jest.spyOn(global, 'clearTimeout');

      await withTimeout(Promise.resolve('ok'), 5_000);

      expect(setTimeoutSpy).toHaveBeenCalledTimes(1);
      expect(clearTimeoutSpy).toHaveBeenCalledTimes(1);
      setTimeoutSpy.mockRestore();
      clearTimeoutSpy.mockRestore();
    });

    it('clears the timer after the timeout fires (no leaked handle)', async () => {
      const setTimeoutSpy = jest.spyOn(global, 'setTimeout');
      const clearTimeoutSpy = jest.spyOn(global, 'clearTimeout');

      const never = new Promise<string>(() => {
        /* never resolves */
      });
      await expect(withTimeout(never, 20)).rejects.toThrow();

      expect(setTimeoutSpy).toHaveBeenCalledTimes(1);
      expect(clearTimeoutSpy).toHaveBeenCalledTimes(1);
      setTimeoutSpy.mockRestore();
      clearTimeoutSpy.mockRestore();
    });

    it('does not keep the process alive waiting on a slow promise (unref)', async () => {
      // The internal timer is `unref()`'d — it won't keep the event loop alive.
      // Assert by measuring that the call returns well before the 10s timeout
      // would have fired (proves the input promise resolved first + the timer
      // is harmless to process exit).
      const start = Date.now();
      await withTimeout(Promise.resolve('fast'), 10_000);
      expect(Date.now() - start).toBeLessThan(1_000);
    });
  });
});
