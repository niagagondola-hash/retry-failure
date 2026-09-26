/**
 * Sync barrel — utilities + services for lazy session sync (AUTH-14).
 *
 * Plan reference: PLAN2 Section 8 (Strategi Sinkronisasi — Lazy Sync),
 * Section 8.3 (lock per sesi), AUTH-14 task spec.
 */
export * from './with-timeout.util';
export * from './sync-lock.service';
export * from './auth-sync.service';
