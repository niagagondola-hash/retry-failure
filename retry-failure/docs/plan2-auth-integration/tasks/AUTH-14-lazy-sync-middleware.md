# AUTH-14 — security — Lazy sync middleware (SWR + lock + timeout)

> **Task ID**: AUTH-14
> **Plan**: Plan 2 — Auth Integration (v1.2.2)
> **Depends on**: AUTH-13
> **Estimated effort**: L (~3-4 jam)
> **Plan reference**: Section 8 (Strategi Sinkronisasi — Lazy Sync), Section 8.1 (tiga pemicu), Section 8.2 (alur lazy sync), Section 8.3 (lock per sesi), Section 8.4 (middleware vs guard), Section 8.5 (webhook opsional), Section 8.6 (skenario user delete/rename), Section 8.7 (grace period), Section 16 (env SYNC_*)

---

## Goal

Implementasi `LazySyncMiddleware` (stale-while-revalidate pattern) yang menjalankan background sync bila session `last_sync_at` stale (5-30 menit), atau blocking sync bila very stale (>30 menit). Pakai `SyncLockService` (anti-race via Redis `SET NX` atau Memory `Map`) dan `AuthSyncService` (call auth `/api/v1/me/permissions` + update session).

## Scope

**In scope**:
- `LazySyncMiddleware` (`packages/security/src/middleware/lazy-sync.middleware.ts`):
  - Implementasi `NestMiddleware` (atau Express middleware function).
  - Baca cookie `sid` → `SessionStore.get(sid)`.
  - Bila session tidak ada → `next()` (SessionGuard akan handle 401).
  - Hitung `age = Date.now() - session.lastSyncAt`.
  - **`age < FRESH_TTL` (5 menit)** → `next()` (fresh, no sync).
  - **`FRESH_TTL <= age < STALE_TTL` (5-30 menit)** → trigger background sync (non-blocking), `next()`.
  - **`age >= STALE_TTL` (30 menit)** → blocking sync dengan timeout 2s. Bila timeout → log warning + `next()` (use stale cache). Bila sync success → update session + `next()`.
  - **`age >= MAX_STALE_TTL` (2 jam)** → invalidate session (delete + 401). Plan2 section 8.7 "Batas maksimal".
- `SyncLockService` (`packages/security/src/sync/sync-lock.service.ts`):
  - `acquireLock(sid, ttlSec)` → delegate to `SessionStore.acquireLock(`sync:lock:${sid}`, ttlSec)`.
  - `releaseLock(sid)` → delegate to `SessionStore.releaseLock(`sync:lock:${sid}`)`.
  - Return boolean dari `acquireLock` (true = acquired, false = already held).
- `AuthSyncService` (`packages/security/src/sync/auth-sync.service.ts`):
  - `syncSession(session)`:
    - Call `OAuthClientService.fetchPermissions(session.accessToken)` → return `{ user, role, permissionCodes }`.
    - Update `CacheRepository.upsertCachedUser({ user_id, username, email, name, is_super_admin })`.
    - Update `SessionStore.updateSync(sid, permissionCodes, Date.now())`.
  - Return updated permissionCodes atau throw bila auth gagal.
- Configurable TTLs via env (plan2 section 16):
  - `SYNC_FRESH_TTL_MS=300000` (5 menit)
  - `SYNC_STALE_TTL_MS=1800000` (30 menit)
  - `SYNC_MAX_STALE_TTL_MS=7200000` (2 jam)
  - `SYNC_BLOCKING_TIMEOUT_MS=2000` (2 detik)
  - `SYNC_LOCK_TTL_SEC=10` (10 detik)
- `withTimeout(promise, ms)` helper — race Promise vs setTimeout.
- Background sync — fire-and-forget (tidak await di middleware). Catch errors + log.
- **`AUTH_MODE=disabled`**: skip middleware (no sync).
- Unit test: fresh / stale (background) / very stale (blocking) / timeout / lock held / max stale.

**Out of scope**:
- Webhook sync (plan2 section 8.5) — opsional, skip.
- User delete / rename handling via webhook → skip (lazy sync handle saat trigger berikutnya).
- Session cleanup scheduler (cron) → tidak (Redis TTL + LRU Memory handle).
- Distributed tracing spans → plan2 section 13.3 menyebut span untuk lazy sync, tapi observability di task terpisah.
- Metrics (`auth_sync_total`, `auth_sync_duration_seconds`) → tidak di task ini (plan2 section 13.2 metrics, di-task terpisah).

## Files to create/modify

- `packages/security/src/middleware/lazy-sync.middleware.ts` — full implementation
- `packages/security/src/sync/auth-sync.service.ts` — full implementation
- `packages/security/src/sync/sync-lock.service.ts` — full implementation
- `packages/security/src/sync/with-timeout.util.ts` — race Promise vs setTimeout
- `packages/security/src/middleware/index.ts` — barrel
- `packages/security/src/security.module.ts` — wire middleware sebagai provider
- `packages/security/test/lazy-sync.middleware.spec.ts` — unit test (mock SessionStore + AuthSyncService)
- `packages/security/test/auth-sync.service.spec.ts` — unit test (mock OAuthClientService + CacheRepository + SessionStore)
- `packages/security/test/sync-lock.service.spec.ts` — unit test (mock SessionStore)

## Implementation steps

1. **`with-timeout.util.ts`**:
   ```ts
   export function withTimeout<T>(promise: Promise<T>, ms: number, label = 'operation'): Promise<T> {
     let timer: NodeJS.Timeout;
     const timeout = new Promise<never>((_, reject) => {
       timer = setTimeout(() => reject(new Error(`${label} timeout after ${ms}ms`)), ms);
       timer.unref?.();
     });
     return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
   }
   ```

2. **`sync-lock.service.ts`**:
   ```ts
   import { Injectable, Inject, Logger } from '@nestjs/common';
   import { SessionStore, SESSION_STORE } from '../session-store';

   @Injectable()
   export class SyncLockService {
     private readonly logger = new Logger('SyncLockService');
     constructor(@Inject(SESSION_STORE) private readonly store: SessionStore) {}

     async acquire(sid: string, ttlSec = 10): Promise<boolean> {
       const key = `sync:lock:${sid}`;
       const acquired = await this.store.acquireLock(key, ttlSec);
       if (acquired) {
         this.logger.debug(`Acquired lock sid=${sid.substring(0, 8)}... ttl=${ttlSec}s`);
       }
       return acquired;
     }

     async release(sid: string): Promise<void> {
       const key = `sync:lock:${sid}`;
       await this.store.releaseLock(key);
     }
   }
   ```

3. **`auth-sync.service.ts`**:
   ```ts
   import { Injectable, Inject, Logger } from '@nestjs/common';
   import { OAuthClientService } from '../oauth/oauth-client.service';
   import { SessionStore, Session, SESSION_STORE } from '../session-store';
   import { CacheRepository } from '../cache/cache.repository';

   @Injectable()
   export class AuthSyncService {
     private readonly logger = new Logger('AuthSyncService');

     constructor(
       private readonly oauthClient: OAuthClientService,
       private readonly cache: CacheRepository,
       @Inject(SESSION_STORE) private readonly sessionStore: SessionStore,
     ) {}

     /**
      * Sync session with auth server: fetch fresh permissions + update cache + session.
      * Throws bila auth server error (network / 5xx / token expired).
      */
     async syncSession(session: Session): Promise<{ permissionCodes: string[]; user: any }> {
       this.logger.log(`Syncing session sid=${session.sid.substring(0, 8)}... userId=${session.userId}`);

       const data = await this.oauthClient.fetchPermissions(session.accessToken);

       // Update cached_users
       await this.cache.upsertCachedUser({
         user_id: data.user.id,
         username: data.user.username,
         email: data.user.email,
         name: data.user.name,
         is_super_admin: data.user.isSuperAdmin,
       });

       // Update session (permissionCodes + lastSyncAt)
       await this.sessionStore.updateSync(session.sid, data.permissionCodes, Date.now());

       this.logger.log(`Synced session sid=${session.sid.substring(0, 8)}... permissionCodes=${data.permissionCodes.length}`);
       return { permissionCodes: data.permissionCodes, user: data.user };
     }
   }
   ```

4. **`lazy-sync.middleware.ts`**:
   ```ts
   import { Injectable, Inject, Logger, NestMiddleware } from '@nestjs/common';
   import { Request, Response, NextFunction } from 'express';
   import { SessionStore, SESSION_STORE } from '../session-store';
   import { AuthSyncService } from '../sync/auth-sync.service';
   import { SyncLockService } from '../sync/sync-lock.service';
   import { SecurityOptions } from '../security.types';
   import { withTimeout } from '../sync/with-timeout.util';

   @Injectable()
   export class LazySyncMiddleware implements NestMiddleware {
     private readonly logger = new Logger('LazySyncMiddleware');
     private readonly freshTtlMs: number;
     private readonly staleTtlMs: number;
     private readonly maxStaleTtlMs: number;
     private readonly blockingTimeoutMs: number;
     private readonly lockTtlSec: number;

     constructor(
       @Inject(SESSION_STORE) private readonly store: SessionStore,
       private readonly syncService: AuthSyncService,
       private readonly lockService: SyncLockService,
       @Inject('SECURITY_OPTIONS') options: SecurityOptions,
     ) {
       this.freshTtlMs = options.syncFreshTtlMs ?? 300_000;       // 5 min
       this.staleTtlMs = options.syncStaleTtlMs ?? 1_800_000;     // 30 min
       this.maxStaleTtlMs = options.syncMaxStaleTtlMs ?? 7_200_000; // 2 hours
       this.blockingTimeoutMs = options.syncBlockingTimeoutMs ?? 2_000;
       this.lockTtlSec = options.syncLockTtlSec ?? 10;
     }

     async use(req: Request & { cookies?: Record<string, string> }, res: Response, next: NextFunction): Promise<void> {
       // AUTH_MODE=disabled: skip
       const options = (this as any).options as SecurityOptions;
       if (options?.authMode === 'disabled') {
         return next();
       }

       const cookies = req.cookies ?? parseCookies(req.headers.cookie);
       const sid = cookies['sid'];
       if (!sid) return next();

       const session = await this.store.get(sid);
       if (!session) return next(); // SessionGuard will handle 401

       const age = Date.now() - session.lastSyncAt;

       // Case 1: max stale → invalidate session (force re-login)
       if (age >= this.maxStaleTtlMs) {
         this.logger.warn(`Session sid=${sid.substring(0, 8)}... exceeded MAX_STALE_TTL (${this.maxStaleTtlMs}ms) — invalidating`);
         await this.store.delete(sid);
         // Continue → SessionGuard will see no session → 401
         return next();
       }

       // Case 2: fresh → no sync
       if (age < this.freshTtlMs) {
         return next();
       }

       // Case 3: stale (5-30 min) → background sync (non-blocking)
       if (age < this.staleTtlMs) {
         this.triggerBackgroundSync(session);
         return next();
       }

       // Case 4: very stale (>30 min) → blocking sync with timeout
       try {
         await withTimeout(
           this.doSync(session),
           this.blockingTimeoutMs,
           'sync blocking',
         );
       } catch (err) {
         this.logger.warn(`Blocking sync failed sid=${sid.substring(0, 8)}...: ${(err as Error).message} — using stale cache`);
       }
       return next();
     }

     private triggerBackgroundSync(session: any): void {
       // Fire-and-forget. Catch errors to avoid unhandled rejection.
       setImmediate(async () => {
         try {
           await this.doSync(session);
         } catch (err) {
           this.logger.warn(`Background sync failed sid=${session.sid.substring(0, 8)}...: ${(err as Error).message}`);
         }
       });
     }

     private async doSync(session: any): Promise<void> {
       const acquired = await this.lockService.acquire(session.sid, this.lockTtlSec);
       if (!acquired) {
         this.logger.debug(`Lock held by another process sid=${session.sid.substring(0, 8)}... — skip sync`);
         return;
       }
       try {
         await this.syncService.syncSession(session);
       } finally {
         await this.lockService.release(session.sid);
       }
     }
   }

   function parseCookies(raw: string | undefined): Record<string, string> {
     if (!raw) return {};
     const out: Record<string, string> = {};
     for (const part of raw.split(';')) {
       const [k, v] = part.trim().split('=');
       if (k && v) out[k] = v;
     }
     return out;
   }
   ```

5. **Wire di `SecurityModule.forRoot`**:
   ```ts
   providers: [
     // ... existing
     AuthSyncService,
     SyncLockService,
     LazySyncMiddleware,
   ],
   exports: [AuthSyncService, SyncLockService, LazySyncMiddleware],
   ```
   > Catatan: middleware tidak otomatis global. Di payment-api `AppModule.configure(consumer)` apply middleware:
   ```ts
   consumer.apply(LazySyncMiddleware).forRoutes({ path: '*', method: RequestMethod.ALL });
   ```
   Tapi `@Public()` endpoints (health, docs) sebaiknya skip — apply untuk routes yang butuh auth saja.

6. **Unit test `lazy-sync.middleware.spec.ts`**:
   - Mock `SessionStore`, `AuthSyncService`, `SyncLockService`, `Reflector`.
   - Test:
     - `AUTH_MODE=disabled` → middleware skip, `next()` dipanggil tanpa lookup session.
     - No cookie sid → `next()` tanpa store.get.
     - Session tidak ada → `next()` tanpa sync.
     - Fresh (age < 5 min) → `next()` tanpa sync.
     - Stale (5 < age < 30 min) → background sync dipanggil (non-blocking), `next()` segera.
     - Very stale (age > 30 min) → blocking sync dengan timeout 2s, `next()` setelah sync.
     - Very stale + sync timeout → `next()` dengan warning log.
     - Max stale (age > 2 jam) → session di-delete, `next()` (SessionGuard akan 401).
     - Lock held (acquire return false) → sync tidak dipanggil, `next()` segera.
     - Background sync error → tidak propagate (caught), `next()` sudah called.
     - Blocking sync error → tidak propagate (caught via withTimeout), `next()` called dengan warning.

7. **Unit test `auth-sync.service.spec.ts`**:
   - Mock `OAuthClientService`, `CacheRepository`, `SessionStore`.
   - Test:
     - `syncSession` happy path → fetchPermissions + upsertCachedUser + updateSync called.
     - `fetchPermissions` throws (auth down) → syncSession throws, session tidak di-update.
     - `upsertCachedUser` throws → syncSession throws (let middleware catch + use stale).
     - Verify `permissionCodes` baru di-persist ke session store.

8. **Unit test `sync-lock.service.spec.ts`**:
   - Mock `SessionStore`.
   - Test:
     - `acquire(sid, ttlSec)` calls `store.acquireLock('sync:lock:<sid>', ttlSec)` → return true bila acquired.
     - `release(sid)` calls `store.releaseLock('sync:lock:<sid>')`.

## Acceptance criteria

- [ ] `LazySyncMiddleware.use(req, res, next)` mengikuti alur plan2 section 8.2:
  - age < 5 menit → `next()` (fresh, no sync).
  - 5 ≤ age < 30 menit → `triggerBackgroundSync` + `next()` (non-blocking).
  - 30 ≤ age < 2 jam → blocking sync (timeout 2s) + `next()`.
  - age ≥ 2 jam → `store.delete(sid)` + `next()` (SessionGuard 401).
- [ ] `AUTH_MODE=disabled` → middleware skip sepenuhnya (no session lookup, no sync).
- [ ] Background sync fire-and-forget (tidak block `next()`).
- [ ] Background sync error tidak propagate (caught + log warning).
- [ ] Blocking sync timeout (2s) → log warning + `next()` (use stale cache).
- [ ] Blocking sync error → log warning + `next()` (use stale cache).
- [ ] Lock acquired bila pertama kali (`acquireLock` return true) → `doSync` dipanggil.
- [ ] Lock held oleh process lain (`acquireLock` return false) → `doSync` tidak dipanggil, log debug.
- [ ] `doSync` selalu release lock di `finally` block (meski sync error).
- [ ] `AuthSyncService.syncSession` memanggil:
  - `OAuthClientService.fetchPermissions(accessToken)`.
  - `CacheRepository.upsertCachedUser({ user_id, username, email, name, is_super_admin })`.
  - `SessionStore.updateSync(sid, permissionCodes, Date.now())`.
- [ ] `withTimeout(promise, ms)` race Promise vs setTimeout, clear timer di finally.
- [ ] TTL configurable via env: `SYNC_FRESH_TTL_MS`, `SYNC_STALE_TTL_MS`, `SYNC_MAX_STALE_TTL_MS`, `SYNC_BLOCKING_TIMEOUT_MS`, `SYNC_LOCK_TTL_SEC`.
- [ ] Unit test (`lazy-sync.middleware.spec.ts`, `auth-sync.service.spec.ts`, `sync-lock.service.spec.ts`) lulus.
- [ ] `pnpm --filter @retry-failure/security typecheck` + `lint` lulus.

## Useful commands

```bash
# Typecheck
cd  && pnpm --filter @retry-failure/security typecheck

# Lint
cd  && pnpm --filter @retry-failure/security lint

# Run sync tests
cd  && pnpm --filter @retry-failure/security test -- --testPathPattern="(lazy-sync|auth-sync|sync-lock)"

# Run all security tests
cd  && pnpm --filter @retry-failure/security test

# Verify withTimeout helper
node -e "
const { withTimeout } = require('./packages/security/src/sync/with-timeout.util.ts');
(async () => {
  const slow = new Promise(resolve => setTimeout(() => resolve('done'), 3000));
  try {
    const result = await withTimeout(slow, 500, 'test');
    console.log('Result:', result);
  } catch (err) {
    console.log('Caught:', err.message); // Expected: test timeout after 500ms
  }
})();
"

# Integration test manual (butuh payment-api with SecurityModule + auth-mock running)
# 1. Login via BFF → session created with lastSyncAt = now
# 2. Wait 6 minutes (or manually update session.lastSyncAt = now - 6 min in Redis)
# 3. Hit /payments → background sync triggered (check logs: "Acquired lock sid=... ttl=10s" + "Synced session sid=...")
# 4. Wait 31 minutes (or update session.lastSyncAt = now - 31 min)
# 5. Hit /payments → blocking sync, response time ~100ms (sync time)
# 6. Stop auth-mock, hit /payments → blocking sync timeout (2s), response time ~2000ms + warning log
# 7. Wait 2h+ (or update lastSyncAt = now - 3h)
# 8. Hit /payments → session deleted, 401 Unauthorized

# Force session stale untuk testing (manual Redis)
# redis-cli SET session:<sid> "$(redis-cli GET session:<sid> | jq '.lastSyncAt = $(($(date +%s) * 1000 - 31 * 60 * 1000))' -c)" PX 28800000
# Atau pakai Memory store + manual edit Map (test environment)
```

## Notes

- **Plan2 section 8.2 alur**:
  - `< FRESH_TTL (5 menit)` → fresh, no sync.
  - `FRESH_TTL ≤ age < STALE_TTL (30 menit)` → background sync (SWR).
  - `≥ STALE_TTL (30 menit)` → blocking sync (timeout 2s).
- **Plan2 section 8.7 grace period**:
  - Auth down → pakai cache sampai `STALE_TTL` (30 menit).
  - Setelah itu → blocking sync; kalau gagal, tetap pakai cache dengan warning.
  - Batas `MAX_STALE_TTL` (2 jam) → sesi invalid (force re-login).
- **Plan2 section 8.3 lock per sesi**:
  - Lock key: `sync:lock:<sid>`.
  - Redis: `SET NX EX 10` (atomic).
  - Memory: `Map<string, number>` (expiresAt timestamp).
  - Tujuan: cegah multiple concurrent request trigger sync yang sama (hemat beban auth).
- **Plan2 section 8.4 middleware vs guard**:
  - Middleware: CSRF, cookie, trace, helmet, lazy-sync (cross-cutting).
  - Guard: SessionGuard → MenuAccessGuard (auth-specific).
  - Handler: business logic.
  - Lazy-sync di middleware supaya jalan **sebelum** guard. Bila sync berhasil, session.permissionCodes up-to-date saat MenuAccessGuard check.
- **Background sync fire-and-forget**:
  - `setImmediate(async () => { ... })` — non-blocking.
  - Catch error di dalam setImmediate — tidak propagate ke middleware.
  - Tujuan: user tidak nunggu sync (response cepat), sync terjadi paralel.
- **Blocking sync timeout**:
  - `withTimeout(syncPromise, 2000)` — race vs setTimeout.
  - Bila timeout → reject → catch di middleware → log warning → `next()` (use stale cache).
  - Tujuan: auth down tidak boleh block user lebih dari 2s.
- **`MAX_STALE_TTL` (2 jam) → invalidate session**:
  - Bila session sudah very stale > 2 jam → kemungkinan user lama tidak aktif, atau auth down lama.
  - Force re-login → lebih aman (user pasti dapat fresh permissions).
  - Alternatif: tetap pakai cache + warning — tapi plan2 section 8.7 spesifik "Batas maksimal: MAX_STALE_TTL (2 jam)" → invalidate.
- **Order of operations**:
  1. Cookie sid? Tidak → next.
  2. Session ada? Tidak → next (SessionGuard 401).
  3. age ≥ MAX_STALE_TTL? Ya → delete session, next (SessionGuard 401).
  4. age < FRESH_TTL? Ya → next (fresh).
  5. age < STALE_TTL? Ya → background sync + next.
  6. (else) → blocking sync (timeout 2s) + next.
- **Auth sync metrics** (plan2 section 13.2):
  - `auth_sync_total{result, reason}` — counter.
  - `auth_sync_duration_seconds{reason}` — histogram.
  - Tidak diimplement di task ini — di-task terpisah (observability).
- Setelah task ini selesai, **Plan 2 Fase 1 (Monorepo Retry)** selesai dari sisi `packages/security`. Selanjutnya: payment-api integration (BFF controller, payments migration, FE Vue, observability, docker, contract test).
