/**
 * Runtime mutable mock configuration + counters (plan section 8.3).
 *
 * Singleton — registered as `@Injectable()` in module providers, default scope
 * (request-scoped would reset state on every request, which defeats the purpose).
 *
 * Mutations are applied via `update()` from PUT /admin/config. Hot reload not
 * required: state lives in-memory and is updated synchronously.
 */

export type FailureMode =
  | 'always-success'
  | 'fail-first-n'
  | 'server-error'
  | 'always-timeout'
  | 'client-error'
  | 'random'
  | 'succeed-but-drop-response'
  | 'rate-limited';

export const FAILURE_MODES: readonly FailureMode[] = [
  'always-success',
  'fail-first-n',
  'server-error',
  'always-timeout',
  'client-error',
  'random',
  'succeed-but-drop-response',
  'rate-limited',
] as const;

export interface MockConfig {
  /** Active failure mode. */
  mode: FailureMode;
  /** For `fail-first-n`: number of failed attempts before success. */
  n: number;
  /** For `random`: success probability 0..1. */
  probability: number;
  /** For `rate-limited`: value of `Retry-After` header (seconds). */
  retryAfterSeconds: number;
  /** For `always-timeout`: delay before response (ms). */
  timeoutMs: number;
}

export interface MockStats {
  requestCount: number;
  successCount: number;
  failureCount: number;
  replayCount: number;
  actualChargesCount: number;
}

export const DEFAULT_CONFIG: MockConfig = {
  mode: 'always-success',
  n: 0,
  probability: 0.5,
  retryAfterSeconds: 10,
  timeoutMs: 5000,
};

/**
 * In-memory runtime state. Persists for the lifetime of the process.
 * Restart resets all state — acceptable for demo (see TASK-15 caveats).
 */
export class MockState {
  config: MockConfig = { ...DEFAULT_CONFIG };

  // Aggregate counters
  requestCount = 0;
  successCount = 0;
  failureCount = 0;
  replayCount = 0;
  actualChargesCount = 0;

  /**
   * Per-key attempt counter for `fail-first-n` mode.
   * Replays do NOT consume this counter (they short-circuit before mode handler).
   */
  failFirstNCounter = new Map<string, number>();

  /** Merge partial config. Returns the new config object. */
  update(partial: Partial<MockConfig>): MockConfig {
    this.config = { ...this.config, ...partial };
    return this.config;
  }

  /** Snapshot stats (immutable copy). */
  stats(): MockStats {
    return {
      requestCount: this.requestCount,
      successCount: this.successCount,
      failureCount: this.failureCount,
      replayCount: this.replayCount,
      actualChargesCount: this.actualChargesCount,
    };
  }

  /** Reset all counters + per-key state. Config left untouched. */
  reset(): void {
    this.requestCount = 0;
    this.successCount = 0;
    this.failureCount = 0;
    this.replayCount = 0;
    this.actualChargesCount = 0;
    this.failFirstNCounter.clear();
  }
}
