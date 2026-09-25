# AUTH-11 — security — SessionStore interface + Redis + Memory implementations

> **Task ID**: AUTH-11
> **Plan**: Plan 2 — Auth Integration (v1.2.2)
> **Depends on**: AUTH-08
> **Estimated effort**: M (~2 jam)
> **Plan reference**: Section 9.4 (SessionStore), Section 9.4.1 (interface), Section 9.4.2 (Redis impl), Section 9.4.3 (Memory impl), Section 9.4.4 (pemilihan store), Section 8.3 (lock per sesi), Section 4.4 (Redis vs Memory)

---

## Goal

Implementasi `SessionStore` interface + 2 implementations (Redis untuk production, Memory LRU untuk sandbox/dev) per plan2 section 9.4. Pemilihan via env `SESSION_STORE=redis|memory` di `SecurityModule.forRoot`. Termasuk lock mechanism (acquireLock + releaseLock) untuk lazy sync anti-race.

## Scope

**In scope**:
- `Session` + `SessionStore` interface (sudah dibuat di AUTH-08 — verify + finalize).
- `RedisSessionStore` (`packages/security/src/session-store/redis-session.store.ts`) — full implementation per plan2 section 9.4.2:
  - `get(sid)` → GET key `session:<sid>`, parse JSON.
  - `set(sid, session, ttlMs)` → SET key + JSON.stringify + `PX ttlMs`.
  - `delete(sid)` → DEL key.
  - `touch(sid)` → GET + update lastSeenAt + SET dengan TTL refresh.
  - `updateSync(sid, permissionCodes, lastSyncAt)` → GET + update fields + SET.
  - `listActive()` → SCAN keys + MGET (use SCAN, not KEYS, untuk production-scale).
  - `acquireLock(key, ttlSec)` → `SET lock:<key> 1 NX EX ttlSec`, return true if `OK`.
  - `releaseLock(key)` → `DEL lock:<key>`.
- `MemorySessionStore` (`packages/security/src/session-store/memory-session.store.ts`) — full implementation per plan2 section 9.4.3:
  - Pakai `lru-cache` v11.
  - Lock via in-process `Map<string, number>` (key → expiresAt timestamp).
  - Cleanup timer 30s untuk purge expired locks.
  - `OnModuleDestroy` untuk clearInterval + clear cache.
- `SecurityModule.forRoot` factory selection (sudah dibuat stub di AUTH-08 — finalize per plan2 section 9.4.4).
- Parity test (Redis vs Memory) — verify both implementations produce same observable behavior.

**Out of scope**:
- `SessionService` (cookie + entity + cache.repository) → AUTH-12.
- Session entity TypeORM migration → payment-api migration.
- Encryption at rest untuk `access_token` + `refresh_token` → production concern, ditunda (catat TODO).
- Distributed lock via Redlock (multi-Redis) → tidak, single-Redis cukup untuk plan2.
- Session cleanup scheduler (cron) → tidak (LRU Memory + Redis TTL handle auto-expire).

## Files to create/modify

- `packages/security/src/session-store/session-store.interface.ts` — verify interface (sudah ada dari AUTH-08)
- `packages/security/src/session-store/redis-session.store.ts` — full implementation
- `packages/security/src/session-store/memory-session.store.ts` — full implementation
- `packages/security/src/session-store/tokens.ts` — `SESSION_STORE` DI token (sudah ada dari AUTH-08)
- `packages/security/src/session-store/index.ts` — barrel
- `packages/security/src/security.module.ts` — verify factory selection works
- `packages/security/test/redis-session.store.spec.ts` — unit test (mock ioredis)
- `packages/security/test/memory-session.store.spec.ts` — unit test (real LRU)
- `packages/security/test/session-store.parity.spec.ts` — parity test (same input → same output untuk Redis + Memory)

## Implementation steps

1. **Verify `Session` + `SessionStore` interface** (sudah ada di AUTH-08). Confirm match plan2 section 9.4.1 — 11 fields di `Session`, 8 methods di `SessionStore`.

2. **`redis-session.store.ts`** (per plan2 section 9.4.2, dengan SCAN untuk `listActive`):
   ```ts
   import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
   import Redis from 'ioredis';
   import { Session, SessionStore } from './session-store.interface';

   @Injectable()
   export class RedisSessionStore implements SessionStore, OnModuleDestroy {
     private readonly logger = new Logger('RedisSessionStore');
     private readonly redis: Redis;
     private readonly prefix = 'session:';
     private readonly lockPrefix = 'lock:';

     constructor(redisUrl: string) {
       this.redis = new Redis(redisUrl, { lazyConnect: true });
       this.redis.on('error', (err) => this.logger.error(`Redis error: ${err.message}`));
     }

     private key(sid: string) { return `${this.prefix}${sid}`; }
     private lockKey(key: string) { return `${this.lockPrefix}${key}`; }

     async get(sid: string): Promise<Session | null> {
       const raw = await this.redis.get(this.key(sid));
       return raw ? (JSON.parse(raw) as Session) : null;
     }

     async set(sid: string, session: Session, ttlMs: number): Promise<void> {
       await this.redis.set(this.key(sid), JSON.stringify(session), 'PX', ttlMs);
     }

     async delete(sid: string): Promise<void> {
       await this.redis.del(this.key(sid));
     }

     async touch(sid: string): Promise<void> {
       const session = await this.get(sid);
       if (!session) return;
       session.lastSeenAt = Date.now();
       const ttl = session.refreshExpiresAt - Date.now();
       if (ttl > 0) await this.set(sid, session, ttl);
     }

     async updateSync(sid: string, permissionCodes: string[], lastSyncAt: number): Promise<void> {
       const session = await this.get(sid);
       if (!session) return;
       session.permissionCodes = permissionCodes;
       session.lastSyncAt = lastSyncAt;
       const ttl = session.refreshExpiresAt - Date.now();
       if (ttl > 0) await this.set(sid, session, ttl);
     }

     async listActive(): Promise<Session[]> {
       const sessions: Session[] = [];
       let cursor = '0';
       do {
         const [next, keys] = await this.redis.scan(
           cursor, 'MATCH', `${this.prefix}*`, 'COUNT', 100,
         );
         cursor = next;
         if (keys.length === 0) continue;
         const values = await this.redis.mget(...keys);
         for (const v of values) {
           if (v) sessions.push(JSON.parse(v));
         }
       } while (cursor !== '0');
       return sessions;
     }

     async acquireLock(key: string, ttlSec: number): Promise<boolean> {
       const result = await this.redis.set(
         this.lockKey(key), '1', 'NX', 'EX', ttlSec,
       );
       return result === 'OK';
     }

     async releaseLock(key: string): Promise<void> {
       await this.redis.del(this.lockKey(key));
     }

     async onModuleDestroy(): Promise<void> {
       await this.redis.quit();
     }
   }
   ```
   > Catatan: pakai `SCAN` (bukan `KEYS`) untuk production-scale. `KEYS` block Redis loop untuk big dataset.

3. **`memory-session.store.ts`** (per plan2 section 9.4.3):
   ```ts
   import { Injectable, OnModuleDestroy, Logger } from '@nestjs/common';
   import { LRUCache } from 'lru-cache';
   import { Session, SessionStore } from './session-store.interface';

   @Injectable()
   export class MemorySessionStore implements SessionStore, OnModuleDestroy {
     private readonly logger = new Logger('MemorySessionStore');
     private readonly sessions: LRUCache<string, Session>;
     private readonly locks = new Map<string, number>(); // key → expiresAt (ms epoch)
     private readonly cleanupTimer: NodeJS.Timeout;

     constructor(max = 1000, defaultTtlMs = 8 * 60 * 60 * 1000) {
       this.sessions = new LRUCache<string, Session>({
         max,
         ttl: defaultTtlMs,
         updateAgeOnGet: false,
       });

       this.cleanupTimer = setInterval(() => {
         const now = Date.now();
         for (const [key, expiresAt] of this.locks.entries()) {
           if (expiresAt < now) this.locks.delete(key);
         }
       }, 30_000);
       this.cleanupTimer.unref?.();
     }

     async get(sid: string): Promise<Session | null> {
       return this.sessions.get(sid) ?? null;
     }

     async set(sid: string, session: Session, ttlMs: number): Promise<void> {
       this.sessions.set(sid, session, { ttl: ttlMs });
     }

     async delete(sid: string): Promise<void> {
       this.sessions.delete(sid);
     }

     async touch(sid: string): Promise<void> {
       const session = this.sessions.get(sid);
       if (!session) return;
       session.lastSeenAt = Date.now();
       const ttl = session.refreshExpiresAt - Date.now();
       if (ttl > 0) this.sessions.set(sid, session, { ttl });
     }

     async updateSync(sid: string, permissionCodes: string[], lastSyncAt: number): Promise<void> {
       const session = this.sessions.get(sid);
       if (!session) return;
       session.permissionCodes = permissionCodes;
       session.lastSyncAt = lastSyncAt;
       const ttl = session.refreshExpiresAt - Date.now();
       if (ttl > 0) this.sessions.set(sid, session, { ttl });
     }

     async listActive(): Promise<Session[]> {
       return Array.from(this.sessions.values());
     }

     async acquireLock(key: string, ttlSec: number): Promise<boolean> {
       const now = Date.now();
       const existing = this.locks.get(key);
       if (existing && existing > now) return false; // still held
       this.locks.set(key, now + ttlSec * 1000);
       return true;
     }

     async releaseLock(key: string): Promise<void> {
       this.locks.delete(key);
     }

     onModuleDestroy() {
       clearInterval(this.cleanupTimer);
       this.sessions.clear();
       this.locks.clear();
     }
   }
   ```

4. **Verify `SecurityModule.forRoot`** — factory selection (sudah ada di AUTH-08 stub):
   ```ts
   const sessionStoreProvider = {
     provide: SESSION_STORE,
     useFactory: (opts: SecurityOptions) => {
       if (opts.sessionStore === 'memory') return new MemorySessionStore();
       if (!opts.redisUrl) throw new Error('REDIS_URL wajib diisi kalau SESSION_STORE=redis');
       return new RedisSessionStore(opts.redisUrl);
     },
     inject: ['SECURITY_OPTIONS'],
   };
   ```

5. **Unit test Redis** (`packages/security/test/redis-session.store.spec.ts`):
   - Mock `ioredis` (mock class dengan `set`, `get`, `del`, `scan`, `mget`, `quit`).
   - Test:
     - `set` calls `redis.set(key, JSON, 'PX', ttlMs)`.
     - `get` returns parsed Session bila ada, null bila tidak.
     - `delete` calls `redis.del(key)`.
     - `touch` updates lastSeenAt + refresh TTL.
     - `updateSync` updates permissionCodes + lastSyncAt + refresh TTL.
     - `listActive` uses SCAN (handles pagination via cursor).
     - `acquireLock` returns true on first call, false on second (bila belum release).
     - `acquireLock` returns true again setelah TTL expired.
     - `releaseLock` calls `redis.del(lockKey)`.

6. **Unit test Memory** (`packages/security/test/memory-session.store.spec.ts`):
   - Test scenarios sama dengan Redis (parity).
   - Verify LRU eviction bila max reached (1000).
   - Verify TTL expired → `get` returns null.
   - Verify cleanup timer purges expired locks.

7. **Parity test** (`packages/security/test/session-store.parity.spec.ts`):
   - Run same sequence of operations di Redis + Memory.
   - Assert same observable behavior (get returns same Session, lock acquire returns same boolean).
   - Purpose: catch bug kalau salah satu impl drift dari interface.

## Acceptance criteria

- [ ] `SessionStore` interface memiliki 8 methods sesuai plan2 section 9.4.1 (`get`, `set`, `delete`, `touch`, `updateSync`, `listActive`, `acquireLock`, `releaseLock`).
- [ ] `Session` interface memiliki 11 fields sesuai plan2 section 9.4.1.
- [ ] `RedisSessionStore`:
  - `set` pakai `PX` (millisecond TTL) — per plan2.
  - `acquireLock` pakai `SET NX EX` (atomic) — per plan2 section 8.3.
  - `releaseLock` pakai `DEL`.
  - `listActive` pakai SCAN (bukan KEYS) — production-safe.
  - `onModuleDestroy` calls `redis.quit()` — graceful shutdown.
  - Handle Redis error events (log, jangan crash process).
- [ ] `MemorySessionStore`:
  - Pakai `lru-cache` v11.
  - Lock via `Map<string, number>` (expiresAt timestamp).
  - Cleanup timer 30s purge expired locks.
  - `cleanupTimer.unref?.()` — tidak block Node exit.
  - `onModuleDestroy` clearInterval + clear cache.
- [ ] `SecurityModule.forRoot` memilih implementation berdasarkan `SESSION_STORE` env:
  - `redis` → `RedisSessionStore(opts.redisUrl)`.
  - `memory` → `MemorySessionStore()`.
  - `redis` tanpa `REDIS_URL` → throw error jelas.
- [ ] Unit test Redis (`redis-session.store.spec.ts`) lulus (semua scenarios).
- [ ] Unit test Memory (`memory-session.store.spec.ts`) lulus (semua scenarios).
- [ ] Parity test (`session-store.parity.spec.ts`) lulus — same input → same observable output.
- [ ] `pnpm --filter @retry-failure/security typecheck` + `lint` lulus.

## Useful commands

```bash
# Typecheck
cd  && pnpm --filter @retry-failure/security typecheck

# Lint
cd  && pnpm --filter @retry-failure/security lint

# Run session-store tests
cd  && pnpm --filter @retry-failure/security test -- --testPathPattern=session-store

# Run all security tests
cd  && pnpm --filter @retry-failure/security test

# Manual Redis test (butuh docker compose up redis atau external Redis)
docker run --rm -d -p 6379:6379 redis:7-alpine
sleep 2
node -e "
const { RedisSessionStore } = require('./packages/security/src/session-store/redis-session.store.ts');
(async () => {
  const store = new RedisSessionStore('redis://localhost:6379');
  await store.set('sid-1', { sid: 'sid-1', userId: 'u1' }, 60000);
  const s = await store.get('sid-1');
  console.log('session:', s);
  const lock1 = await store.acquireLock('test', 5);
  const lock2 = await store.acquireLock('test', 5);
  console.log('lock1 (expected true):', lock1);
  console.log('lock2 (expected false):', lock2);
  await store.releaseLock('test');
  const lock3 = await store.acquireLock('test', 5);
  console.log('lock3 after release (expected true):', lock3);
})().catch(console.error);
"
docker stop $(docker ps -q --filter ancestor=redis:7-alpine) 2>/dev/null
```

## Notes

- **Redis vs Memory** (plan2 section 4.4):
  - Redis: production, staging, multi-instance. Persistence + scaling.
  - Memory: sandbox, dev, unit test. Hilang saat restart. Single-instance.
- **Lock atomicity** (plan2 section 8.3):
  - Redis: `SET lock:<key> 1 NX EX 10` — atomic, return `OK` bila acquired.
  - Memory: in-process `Map` — atomic via single-threaded JS event loop.
- **`SCAN` vs `KEYS`** di Redis:
  - `KEYS` block Redis event loop — production killer.
  - `SCAN` cursor-based, non-blocking.
  - `listActive` jarang dipakai (cleanup scheduler), tapi wajib production-safe.
- **`unref()`** di cleanup timer Memory — tidak block Node process exit. Tanpa `unref`, Node akan hang saat shutdown.
- **Encryption at rest** untuk `access_token` + `refresh_token` di `Session` — TIDAK diimplement di task ini. Plan2 section 7.2 mention "encrypted at rest" tapi tidak spesifik. Production concern: encrypt token dengan AES-256-GCM sebelum set ke Redis/Memory. Catat di TODO.
- **Refresh TTL** saat `touch` + `updateSync` — bila `refreshExpiresAt` lewat, jangan refresh TTL (biar expired). Kalkulasi: `ttl = refreshExpiresAt - Date.now()`. Bila `ttl <= 0`, skip set.
- **Parity test** — Redis + Memory harus observable same untuk caller. Implement internal beda, tapi API contract sama. Parity test catch bug drift.
- Setelah task ini selesai, AUTH-12 (SessionService + cookie + entity) bisa mulai — pakai `SessionStore` abstraction.
