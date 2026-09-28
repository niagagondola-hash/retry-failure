# AUTH-11a — SessionStore write-through + database fallback

> **Task ID**: AUTH-11a
> **Plan**: Plan 2 — Auth Integration
> **Depends on**: AUTH-11 (SessionStore interface), AUTH-12 (SessionService + entity), AUTH-16 (DB migration)
> **Estimated effort**: L (~5 jam)

---

## Goal

Implement 3 mode session storage yang fleksibel untuk berbagai stage tim:

- `SESSION_STORE=memory` → Memory only (sandbox/dev, no Redis, no DB persistence)
- `SESSION_STORE=database` → DB only (tim baru, no Redis, persistent via DB)
- `SESSION_STORE=redis` → Redis primary + DB audit (production, `SESSION_AUDIT=true`)

**Use case per mode**:

| Mode | Kapan dipakai | Redis? | DB sessions table? | Persistent? |
|---|---|---|---|---|
| `memory` | Sandbox, unit test, dev cepat | ❌ | ❌ | ❌ (hilang saat restart) |
| `database` | Tim baru, belum punya Redis, single-instance | ❌ | ✅ | ✅ (survive restart) |
| `redis` | Production, multi-instance | ✅ | ✅ (if `SESSION_AUDIT=true`) | ✅ |

---

## Scope

**In scope**:
- `PostgresSessionStore` — implement `SessionStore` interface dengan TypeORM Repository (DB only)
- `WriteThroughSessionStore` — wrapper yang dual-write (Redis + DB) + read fallback
- Update `SecurityOptions` — tambah `sessionAudit?: boolean`, sessionStore: `'memory' | 'database' | 'redis'`
- Update `SecurityModule` — factory: pilih store berdasarkan `SESSION_STORE` + `SESSION_AUDIT`
- Register `SessionEntity` di TypeORM entities (db-config.ts)
- Fix entity cross-database types (PostgreSQL `timestamp` + SQLite `datetime`)
- Update Joi schema — tambah `SESSION_AUDIT`, `SESSION_STORE` valid values
- Update `.env.example` — dokumentasi semua opsi
- Unit tests

**Out of scope**:
- Redis cluster / sentinel (single Redis instance cukup)
- Session encryption at rest (future task)
- Session cleanup cron (future task — DB perlu cron, Redis auto-expire via TTL)

---

## Architecture

### Mode 1: `SESSION_STORE=memory` (existing, unchanged)

```
SessionService → MemorySessionStore (in-memory Map)
  - No Redis, no DB table
  - Fastest, but sessions lost on restart
```

### Mode 2: `SESSION_STORE=database` (NEW — for teams without Redis)

```
SessionService → PostgresSessionStore (DB only)
  - No Redis required
  - Sessions persistent in `sessions` table
  - Survives restart
  - Slower than Redis (DB query ~5-10ms vs Redis ~0.1ms)
  - Suitable for: small team, single-instance, early stage
  - Lock: in-process Map with TTL (same as MemorySessionStore)
```

### Mode 3: `SESSION_STORE=redis` + `SESSION_AUDIT=true` (production)

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
- `packages/security/src/session-store/postgres.store.ts` — DB implementation (mode 2 + 3)
- `packages/security/src/session-store/write-through.store.ts` — wrapper (mode 3)
- `packages/security/src/cache/db-types.helper.ts` — cross-database type helper (self-contained)
- `packages/security/tests/postgres.store.spec.ts` — unit tests
- `packages/security/tests/write-through.store.spec.ts` — unit tests

### Modified files:
- `packages/security/src/cache/cached-user.entity.ts` — use `getTimestampColumnType()` + `getUuidColumnType()`
- `packages/security/src/cache/session.entity.ts` — same
- `packages/security/src/security.module.ts` — add `sessionAudit` option + factory for 3 modes
- `packages/security/src/session-store/session-store.interface.ts` — no change (interface stable)
- `apps/payment-api/src/database/db-config.ts` — add `SessionEntity` to entitiesList
- `apps/payment-api/src/config/validation.schema.ts` — add `SESSION_AUDIT`, update `SESSION_STORE` valid values
- `apps/payment-api/src/auth/auth.module.ts` — add `sessionAudit` to forRootAsync factory
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

### 2. PostgresSessionStore (DB only — mode 2)

Implement `SessionStore` interface menggunakan TypeORM `Repository<SessionEntity>`:
- `get(sid)` → `SELECT * FROM sessions WHERE sid = ?`
- `set(sid, session, ttlMs)` → `INSERT ... ON CONFLICT DO UPDATE`
- `delete(sid)` → `DELETE FROM sessions WHERE sid = ?`
- `touch(sid)` → `UPDATE sessions SET last_seen_at = NOW() WHERE sid = ?`
- `updateSync(sid, codes, lastSyncAt)` → `UPDATE sessions SET permission_codes = ?, last_sync_at = ?`
- `listActive()` → `SELECT * FROM sessions WHERE refresh_expires_at > NOW()`
- `acquireLock(key, ttlSec)` → in-process Map with TTL (same as MemorySessionStore)
- `releaseLock(key)` → in-process Map delete

**Note**: Lock mechanism di mode `database` pakai in-process Map (bukan `pg_advisory_lock`)
karena biasanya single-instance. Kalau multi-instance dengan DB only, lock tidak reliable —
tim disarankan upgrade ke Redis.

### 3. WriteThroughSessionStore (mode 3)

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
    // Mode 1: memory (sandbox/dev)
    if (opts.sessionStore === 'memory') {
      return new MemorySessionStore();
    }

    // Mode 2: database only (tim baru, no Redis)
    if (opts.sessionStore === 'database') {
      return new PostgresSessionStore(/* inject SessionEntity repository */);
    }

    // Mode 3: redis (+ optional audit)
    if (opts.sessionStore === 'redis') {
      if (!opts.redisUrl) throw new Error('REDIS_URL required');
      const redis = new RedisSessionStore(opts.redisUrl);

      if (opts.sessionAudit) {
        // Write-through: Redis primary + DB audit
        const db = new PostgresSessionStore(/* inject SessionEntity repository */);
        return new WriteThroughSessionStore(redis, db);
      }

      return redis; // Redis only, no DB audit
    }

    throw new Error(`Unknown SESSION_STORE: ${opts.sessionStore}`);
  },
}
```

### 5. SecurityOptions update

```ts
export interface SecurityOptions {
  // ... existing
  sessionStore: 'memory' | 'database' | 'redis';  // ← tambah 'database'
  sessionAudit?: boolean; // SESSION_AUDIT=true → write-through to DB
}
```

### 6. Joi schema update

```ts
SESSION_STORE: Joi.string()
  .valid('memory', 'database', 'redis')
  .default('memory'),

SESSION_AUDIT: Joi.boolean().default(false),
```

### 7. forRootAsync factory (auth.module.ts)

```ts
useFactory: (cfg: ConfigService) => ({
  // ... existing
  sessionStore: cfg.get<string>('SESSION_STORE') as SecurityOptions['sessionStore'],
  sessionAudit: cfg.get<boolean>('SESSION_AUDIT') ?? false,
}),
```

---

## Acceptance criteria

### Mode 1: memory
- [ ] `SESSION_STORE=memory` → MemorySessionStore only (no DB write) — unchanged
- [ ] Sessions lost on restart (expected)

### Mode 2: database (NEW)
- [ ] `SESSION_STORE=database` → PostgresSessionStore (DB only, no Redis)
- [ ] No Redis dependency required
- [ ] Sessions persistent in `sessions` table — survive restart
- [ ] `get(sid)` → SELECT from sessions table
- [ ] `set(sid, session, ttlMs)` → INSERT/UPDATE sessions table
- [ ] `delete(sid)` → DELETE from sessions table
- [ ] Lock: in-process Map with TTL (single-instance only)

### Mode 3: redis + audit
- [ ] `SESSION_STORE=redis` + `SESSION_AUDIT=false` → RedisSessionStore only (no DB write)
- [ ] `SESSION_STORE=redis` + `SESSION_AUDIT=true` → WriteThroughSessionStore (Redis + DB)
- [ ] Write: create/update/delete → dual-write (Redis + DB)
- [ ] Read: Redis first → miss → DB fallback → cache to Redis
- [ ] Redis down → DB fallback works (session still accessible)
- [ ] Restart → sessions recovered from DB

### Cross-cutting
- [ ] Entity types: `getTimestampColumnType()` returns correct type per DB_TYPE
- [ ] `getTimestampColumnType()` in `packages/security` (no import from `apps/*`)
- [ ] `SessionEntity` registered in `db-config.ts` entitiesList
- [ ] `cached_users` table populated on login (initial sync)
- [ ] `sessions` table populated on login (when mode=database or mode=redis+audit)
- [ ] Unit tests pass for all 3 modes
- [ ] `pnpm --filter @retry-failure/security typecheck` + `lint` pass

---

## Useful commands

```bash
# Mode 1: memory (sandbox)
SESSION_STORE=memory pnpm --filter payment-api start

# Mode 2: database (tim baru, no Redis)
SESSION_STORE=database pnpm --filter payment-api start

# Mode 3a: redis only (fast, no audit)
SESSION_STORE=redis REDIS_URL=redis://localhost:6379 pnpm --filter payment-api start

# Mode 3b: redis + audit (production)
SESSION_STORE=redis SESSION_AUDIT=true REDIS_URL=redis://localhost:6379 pnpm --filter payment-api start

# Run tests
pnpm --filter @retry-failure/security test -- --testPathPattern="postgres.store|write-through"

# Typecheck + lint
pnpm --filter @retry-failure/security typecheck
pnpm --filter @retry-failure/security lint
```

---

## .env.example additions

```bash
# === Session store (plan2 §9.4) ===
# memory   → sandbox/dev (in-memory Map, no persistence)
# database → tim baru (DB only, no Redis, persistent)
# redis    → production (Redis primary + optional DB audit)
SESSION_STORE=memory

# SESSION_AUDIT=true → write-through to sessions table (only when SESSION_STORE=redis)
# Ignored when SESSION_STORE=memory or SESSION_STORE=database
SESSION_AUDIT=false
```

---

## Migration guide untuk tim

### Stage 1: Mulai (no Redis)
```bash
SESSION_STORE=memory
```
- Cepat, simple, no dependencies
- Session hilang saat restart (OK untuk dev)

### Stage 2: Butuh persistence (no Redis)
```bash
SESSION_STORE=database
```
- Session survive restart
- No Redis needed
- Single-instance only (lock tidak distributed)

### Stage 3: Production (with Redis)
```bash
SESSION_STORE=redis
SESSION_AUDIT=true
REDIS_URL=redis://redis:6379
```
- Multi-instance ready
- Redis fast + DB audit trail
- Redis down → DB fallback

---

## Notes

- **PostgreSQL `datetime` issue**: PostgreSQL tidak punya tipe `DATETIME` (itu MySQL).
  PostgreSQL pakai `TIMESTAMP`. SQLite tidak support `TIMESTAMP` (pakai `DATETIME`).
  Solusi: `getTimestampColumnType()` reads `process.env.DB_TYPE` at runtime.
  `loadEnv()` di `otel.ts` (main.ts line 1) ensures env loaded BEFORE entity decorators.

- **UUID cross-database**: PostgreSQL native `uuid`, SQLite `varchar` (36 char).
  `getUuidColumnType()` handles this.

- **Lock mechanism**:
  - `memory` + `database`: in-process Map with TTL (single-instance)
  - `redis`: Redis `SET NX EX` (distributed, multi-instance)

- **Performance comparison**:
  | Mode | Read latency | Write latency | Persistent | Multi-instance |
  |---|---|---|---|---|
  | memory | ~0.01ms | ~0.01ms | ❌ | ❌ |
  | database | ~5-10ms | ~5-10ms | ✅ | ❌ (lock) |
  | redis+audit | ~0.1ms (hit) / ~5ms (miss) | ~0.5ms | ✅ | ✅ |

- **Cleanup**:
  - `memory`: auto (Map delete on timeout)
  - `database`: cron job `DELETE WHERE refresh_expires_at < NOW()`
  - `redis`: auto-expire via TTL + cron job for DB audit table
