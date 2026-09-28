# AUTH-11a — SessionStore write-through (Redis + DB audit)

> **Task ID**: AUTH-11a
> **Plan**: Plan 2 — Auth Integration
> **Depends on**: AUTH-11 (SessionStore interface), AUTH-12 (SessionService + entity), AUTH-16 (DB migration)
> **Estimated effort**: L (~4 jam)

---

## Goal

Implement write-through session store pattern:
- `SESSION_STORE=redis` → Redis sebagai primary storage (fast)
- `SESSION_AUDIT=true` → DB `sessions` table sebagai persistent + audit trail
- Redis down → fallback baca dari DB (resilient)
- Restart → session tetap ada di DB

---

## Scope

**In scope**:
- `WriteThroughSessionStore` — wrapper yang dual-write (Redis + DB) + read fallback
- `PostgresSessionStore` — implement `SessionStore` interface dengan TypeORM Repository
- Update `SecurityOptions` — tambah `sessionAudit?: boolean`
- Update `SecurityModule` — factory: pilih WriteThrough saat `SESSION_AUDIT=true`
- Register `SessionEntity` di TypeORM entities (db-config.ts)
- Fix entity cross-database types (PostgreSQL `timestamp` + SQLite `datetime`)
- Update Joi schema — tambah `SESSION_AUDIT`
- Update `.env.example` — dokumentasi `SESSION_AUDIT`
- Unit tests

**Out of scope**:
- Redis cluster / sentinel (single Redis instance cukup)
- Session encryption at rest (future task)
- Session cleanup cron (future task — Redis TTL handles expiry)

---

## Architecture

```
                    ┌──────────────────────┐
  SessionService ──► │ WriteThroughStore    │
                    └──────┬───────────────┘
                           │
                    ┌──────▼──────┐
                    │ 1. Redis    │ ◄── primary (fast, 0.1ms)
                    │    (primary)│
                    └──────┬──────┘
                           │
                    ┌──────▼──────┐
                    │ 2. DB       │ ◄── audit + persistence (write-through)
                    │    sessions  │
                    │    table    │
                    └─────────────┘

Read flow:
  1. Redis GET → hit? return session
  2. Redis miss / down → DB SELECT → found? cache to Redis → return
  3. Both miss → return null

Write flow (create/update/delete):
  1. Redis SET/DEL (primary)
  2. DB INSERT/UPDATE/DELETE (audit)
  3. If Redis fails → log warning, DB still written (resilient)
```

---

## Files to create/modify

### New files:
- `packages/security/src/session-store/write-through.store.ts` — wrapper
- `packages/security/src/session-store/postgres.store.ts` — DB implementation
- `packages/security/src/cache/db-types.helper.ts` — cross-database type helper (self-contained)
- `packages/security/tests/write-through.store.spec.ts` — unit tests
- `packages/security/tests/postgres.store.spec.ts` — unit tests

### Modified files:
- `packages/security/src/cache/cached-user.entity.ts` — use `getTimestampColumnType()` + `getUuidColumnType()`
- `packages/security/src/cache/session.entity.ts` — same
- `packages/security/src/security.module.ts` — add `sessionAudit` option + factory
- `apps/payment-api/src/database/db-config.ts` — add `SessionEntity` to entitiesList
- `apps/payment-api/src/config/validation.schema.ts` — add `SESSION_AUDIT` Joi rule
- `.env.example` — add `SESSION_AUDIT=true` documentation

---

## Implementation steps

### 1. Fix entity cross-database types

`packages/security/src/cache/db-types.helper.ts`:
```ts
import type { ColumnType } from 'typeorm';

export function getUuidColumnType(): ColumnType {
  return process.env.DB_TYPE === 'sqlite' ? 'varchar' : 'uuid';
}

export function getTimestampColumnType(): ColumnType {
  return process.env.DB_TYPE === 'sqlite' ? 'datetime' : 'timestamp';
}
```

**Timing**: `loadEnv()` di `otel.ts` (main.ts line 1) sets `process.env.DB_TYPE`
SEBELUM entity decorators evaluate (main.ts line 2: `import { AppModule }`).
Jadi `getTimestampColumnType()` akan return type yang benar.

Entity usage:
```ts
@Column({ type: getTimestampColumnType(), name: 'last_sync_at' })
```

### 2. PostgresSessionStore

Implement `SessionStore` interface menggunakan TypeORM `Repository<SessionEntity>`:
- `get(sid)` → `SELECT * FROM sessions WHERE sid = ?`
- `set(sid, session, ttlMs)` → `INSERT ... ON CONFLICT DO UPDATE`
- `delete(sid)` → `DELETE FROM sessions WHERE sid = ?`
- `touch(sid)` → `UPDATE sessions SET last_seen_at = NOW() WHERE sid = ?`
- `updateSync(sid, codes, lastSyncAt)` → `UPDATE sessions SET permission_codes = ?, last_sync_at = ?`
- `listActive()` → `SELECT * FROM sessions WHERE refresh_expires_at > NOW()`
- `acquireLock(key, ttlSec)` → `pg_advisory_lock` atau in-memory fallback
- `releaseLock(key)` → `pg_advisory_unlock` atau in-memory fallback

### 3. WriteThroughSessionStore

Wrapper yang mengkoordinasi Redis + DB:
- `get(sid)`: Redis first → miss → DB fallback → cache to Redis
- `set(sid, session, ttlMs)`: Redis SET + DB upsert
- `delete(sid)`: Redis DEL + DB DELETE
- `touch(sid)`: Redis touch + DB update
- `updateSync(sid, codes, lastSyncAt)`: Redis updateSync + DB updateSync
- `listActive()`: DB query (authoritative source)
- `acquireLock`/`releaseLock`: delegate to Redis (faster)

### 4. SecurityModule factory update

```ts
{
  provide: SESSION_STORE,
  inject: [SECURITY_OPTIONS],
  useFactory: (opts: SecurityOptions): SessionStore => {
    if (opts.sessionStore === 'memory') {
      return new MemorySessionStore();
    }
    if (opts.sessionStore === 'redis') {
      if (!opts.redisUrl) throw new Error('REDIS_URL required');
      const redis = new RedisSessionStore(opts.redisUrl);
      if (opts.sessionAudit) {
        // Write-through: Redis primary + DB audit
        return new WriteThroughSessionStore(redis, /* db store */);
      }
      return redis;
    }
  },
}
```

### 5. SecurityOptions update

```ts
export interface SecurityOptions {
  // ... existing
  sessionAudit?: boolean; // SESSION_AUDIT=true → write-through to DB
}
```

### 6. Joi schema update

```ts
SESSION_AUDIT: Joi.boolean().default(false),
```

### 7. forRootAsync factory (auth.module.ts)

```ts
useFactory: (cfg: ConfigService) => ({
  // ... existing
  sessionAudit: cfg.get<boolean>('SESSION_AUDIT') ?? false,
}),
```

---

## Acceptance criteria

- [ ] `SESSION_STORE=memory` → MemorySessionStore only (no DB write) — unchanged
- [ ] `SESSION_STORE=redis` + `SESSION_AUDIT=false` → RedisSessionStore only (no DB write)
- [ ] `SESSION_STORE=redis` + `SESSION_AUDIT=true` → WriteThroughSessionStore (Redis + DB)
- [ ] Write: create/update/delete → dual-write (Redis + DB)
- [ ] Read: Redis first → miss → DB fallback → cache to Redis
- [ ] Redis down → DB fallback works (session still accessible)
- [ ] Restart → sessions recovered from DB
- [ ] Entity types: `getTimestampColumnType()` returns correct type per DB_TYPE
- [ ] `getTimestampColumnType()` in `packages/security` (no import from `apps/*`)
- [ ] `SessionEntity` registered in `db-config.ts` entitiesList
- [ ] `cached_users` table populated on login (initial sync)
- [ ] `sessions` table populated on login (write-through)
- [ ] Unit tests pass
- [ ] `pnpm --filter @retry-failure/security typecheck` + `lint` pass

---

## Useful commands

```bash
# Test with memory (sandbox)
SESSION_STORE=memory pnpm --filter payment-api start

# Test with redis + audit (production)
SESSION_STORE=redis SESSION_AUDIT=true REDIS_URL=redis://localhost:6379 pnpm --filter payment-api start

# Run tests
pnpm --filter @retry-failure/security test -- --testPathPattern="write-through|postgres.store"

# Typecheck + lint
pnpm --filter @retry-failure/security typecheck
pnpm --filter @retry-failure/security lint
```

---

## Notes

- **PostgreSQL `datetime` issue**: PostgreSQL tidak punya tipe `DATETIME` (itu MySQL).
  PostgreSQL pakai `TIMESTAMP`. SQLite tidak support `TIMESTAMP` (pakai `DATETIME`).
  Solusi: `getTimestampColumnType()` reads `process.env.DB_TYPE` at runtime.
  `loadEnv()` di `otel.ts` (main.ts line 1) ensures env loaded BEFORE entity decorators.

- **UUID cross-database**: PostgreSQL native `uuid`, SQLite `varchar` (36 char).
  `getUuidColumnType()` handles this.

- **Lock mechanism**: Redis `SET NX EX` untuk distributed lock.
  PostgreSQL `pg_advisory_lock` sebagai fallback (butuh connection pool).

- **Cleanup**: Redis auto-expire via TTL. DB perlu cron job `DELETE WHERE refresh_expires_at < NOW()`.
  Cron deferred ke task terpisah.

- **Write-through vs write-behind**: Write-through (sync) dipilih karena:
  - Simpler (no queue/buffer)
  - Consistency guarantee (Redis + DB always in sync)
  - Audit trail reliable
  - Performance masih cepat (Redis hit 95%+ untuk reads)
