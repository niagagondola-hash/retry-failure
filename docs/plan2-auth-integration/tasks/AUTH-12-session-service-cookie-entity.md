# AUTH-12 — security — Session service + cookie + entity

> **Task ID**: AUTH-12
> **Plan**: Plan 2 — Auth Integration (v1.2.2)
> **Depends on**: AUTH-11
> **Estimated effort**: M (~2 jam)
> **Plan reference**: Section 4.4 (Session store), Section 12.1 (Cookie sesi), Section 7.2 (sessions table), Section 7.1 (cached_users table), Section 5.3 (Expiry — access 15m, refresh 8h, cookie ikut refresh), Section 9.4.1 (Session interface)

---

## Goal

Implementasi `SessionService` di `packages/security` — orchestrator yang pakai `SessionStore` (AUTH-11) + Cookie helper + TypeORM entities (`CachedUser` + `SessionEntity` dari AUTH-08). Method: `create`, `get`, `delete`, `touch`, `updateSync`, `updateOnSwitchRole`. Cookie helper set `sid` HttpOnly + Secure + SameSite=Lax + Max-Age.

## Scope

**In scope**:
- `SessionService` (`packages/security/src/oauth/session.service.ts`):
  - `create(userId, username, roleId, tokens, permissionCodes)` → generate `sid` (random 32 byte hex), build `Session` object, `set` di `SessionStore`, return sid + session.
  - `get(sid)` → delegate to `SessionStore.get(sid)`.
  - `delete(sid)` → delegate to `SessionStore.delete(sid)`.
  - `touch(sid)` → delegate (update lastSeenAt + refresh TTL).
  - `updateSync(sid, permissionCodes)` → delegate (update permissionCodes + lastSyncAt).
  - `updateOnSwitchRole(sid, newRoleId, newTokens, newPermissionCodes)` → update session in-place (roleId, accessToken, refreshToken, accessExpiresAt, refreshExpiresAt, permissionCodes, lastSyncAt).
- Cookie helper (`packages/security/src/oauth/cookie.util.ts`):
  - `buildSessionCookie(sid, maxAgeMs, opts)` → return `Set-Cookie` string.
  - `parseSessionCookie(req)` → return sid from cookie (via `cookie-parser`).
  - Cookie attributes per plan2 section 12.1: `HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=<seconds>`.
  - Configurable SameSite via env `SESSION_COOKIE_SAMESITE` (default Lax, opsional None untuk cross-site).
- `CacheRepository` (`packages/security/src/cache/cache.repository.ts`):
  - `findCachedUser(userId)` → `CachedUser | null` (TypeORM findOne).
  - `upsertCachedUser(user)` → INSERT ... ON CONFLICT UPDATE (last_sync_at, name, email, is_super_admin).
  - Optional: `SessionEntity` repository untuk audit (hanya kalau `SESSION_STORE=postgres` — tidak diimplement di task ini, stub saja).
- Wire `SessionService` di `SecurityModule.forRoot` providers.
- Update `CachedUser` + `SessionEntity` (sudah ada di AUTH-08 stub — verify + finalize).

**Out of scope**:
- SessionGuard + MenuAccessGuard → AUTH-13.
- Lazy sync middleware → AUTH-14.
- Token encryption at rest → production concern (TODO).
- Session cleanup scheduler (cron) → tidak (LRU + Redis TTL handle auto-expire).
- Refresh token rotation logic → AUTH-09 (OAuthClientService.refresh).
- Database migration untuk `cached_users` + `sessions` table → payment-api migration (separate task).

## Files to create/modify

- `packages/security/src/oauth/session.service.ts` — full implementation
- `packages/security/src/oauth/cookie.util.ts` — cookie helper
- `packages/security/src/cache/cache.repository.ts` — full implementation (TypeORM Repository pattern)
- `packages/security/src/cache/cached-user.entity.ts` — verify (sudah dari AUTH-08)
- `packages/security/src/cache/session.entity.ts` — verify (sudah dari AUTH-08)
- `packages/security/src/security.module.ts` — wire `SessionService` + `CacheRepository`
- `packages/security/test/session.service.spec.ts` — unit test (mock SessionStore)
- `packages/security/test/cookie.util.spec.ts` — test cookie build + parse
- `packages/security/test/cache.repository.spec.ts` — unit test (mock TypeORM Repository)

## Implementation steps

1. **`cookie.util.ts`**:
   ```ts
   import { Request, Response } from 'express';

   export interface CookieOptions {
     name?: string; // default 'sid' (env SESSION_COOKIE_NAME)
     maxAgeMs: number;
     sameSite?: 'lax' | 'strict' | 'none'; // default 'lax' (env SESSION_COOKIE_SAMESITE)
     secure?: boolean; // default true in production
     path?: string; // default '/'
     domain?: string;
   }

   export function buildSessionCookie(sid: string, opts: CookieOptions): string {
     const name = opts.name ?? 'sid';
     const sameSite = (opts.sameSite ?? 'lax').charAt(0).toUpperCase() + (opts.sameSite ?? 'lax').slice(1);
     const maxAgeSec = Math.floor(opts.maxAgeMs / 1000);
     const parts = [
       `${name}=${sid}`,
       'HttpOnly',
       opts.secure === false ? '' : 'Secure',
       `SameSite=${sameSite}`,
       `Path=${opts.path ?? '/'}`,
       `Max-Age=${maxAgeSec}`,
     ].filter(Boolean);
     if (opts.domain) parts.push(`Domain=${opts.domain}`);
     return parts.join('; ');
   }

   export function setSessionCookie(res: Response, sid: string, opts: CookieOptions): void {
     res.setHeader('Set-Cookie', buildSessionCookie(sid, opts));
   }

   export function clearSessionCookie(res: Response, name = 'sid', path = '/'): void {
     res.setHeader('Set-Cookie', `${name}=; HttpOnly; Secure; SameSite=Lax; Path=${path}; Max-Age=0`);
   }

   export function parseSessionCookie(req: Request, name = 'sid'): string | null {
     const raw = req.headers.cookie ?? '';
     for (const part of raw.split(';')) {
       const [k, v] = part.trim().split('=');
       if (k === name && v) return v;
     }
     return null;
   }
   ```
   > Catatan: `cookie-parser` sudah parse `req.cookies` di middleware. `parseSessionCookie` di atas manual fallback bila middleware belum apply. Prefer `req.cookies?.[name]` bila ada.

2. **`session.service.ts`**:
   ```ts
   import { Injectable, Inject, Logger } from '@nestjs/common';
   import { randomBytes } from 'node:crypto';
   import { Session, SessionStore, SESSION_STORE } from '../session-store';
   import { TokenSet } from './oauth-client.types';

   export interface CreateSessionInput {
     userId: string;
     username: string;
     roleId: string;
     permissionCodes: string[];
     tokens: TokenSet;
   }

   @Injectable()
   export class SessionService {
     private readonly logger = new Logger('SessionService');

     constructor(@Inject(SESSION_STORE) private readonly store: SessionStore) {}

     async create(input: CreateSessionInput): Promise<{ sid: string; session: Session }> {
       const sid = randomBytes(32).toString('hex');
       const now = Date.now();
       const session: Session = {
         sid,
         userId: input.userId,
         username: input.username,
         roleId: input.roleId,
         permissionCodes: input.permissionCodes,
         accessToken: input.tokens.accessToken,
         refreshToken: input.tokens.refreshToken ?? '',
         accessExpiresAt: input.tokens.expiresAt * 1000, // convert s → ms
         refreshExpiresAt: now + 8 * 60 * 60 * 1000, // 8h absolute
         createdAt: now,
         lastSeenAt: now,
         lastSyncAt: now, // initial sync = now (just fetched)
       };
       const ttlMs = session.refreshExpiresAt - now;
       await this.store.set(sid, session, ttlMs);
       this.logger.log(`Created session sid=${sid.substring(0, 8)}... userId=${input.userId}`);
       return { sid, session };
     }

     async get(sid: string): Promise<Session | null> {
       return this.store.get(sid);
     }

     async delete(sid: string): Promise<void> {
       await this.store.delete(sid);
       this.logger.log(`Deleted session sid=${sid.substring(0, 8)}...`);
     }

     async touch(sid: string): Promise<void> {
       await this.store.touch(sid);
     }

     async updateSync(sid: string, permissionCodes: string[]): Promise<void> {
       await this.store.updateSync(sid, permissionCodes, Date.now());
     }

     async updateOnSwitchRole(
       sid: string,
       newRoleId: string,
       newTokens: TokenSet,
       newPermissionCodes: string[],
     ): Promise<Session | null> {
       const session = await this.store.get(sid);
       if (!session) return null;
       session.roleId = newRoleId;
       session.accessToken = newTokens.accessToken;
       session.refreshToken = newTokens.refreshToken ?? session.refreshToken;
       session.accessExpiresAt = newTokens.expiresAt * 1000;
       session.permissionCodes = newPermissionCodes;
       session.lastSyncAt = Date.now();
       const ttlMs = session.refreshExpiresAt - Date.now();
       if (ttlMs > 0) await this.store.set(sid, session, ttlMs);
       return session;
     }
   }
   ```

3. **`cache.repository.ts`** (TypeORM Repository pattern, for `cached_users` table):
   ```ts
   import { Injectable } from '@nestjs/common';
   import { InjectRepository } from '@nestjs/typeorm';
   import { Repository } from 'typeorm';
   import { CachedUser } from './cached-user.entity';

   @Injectable()
   export class CacheRepository {
     constructor(
       @InjectRepository(CachedUser) private readonly userRepo: Repository<CachedUser>,
     ) {}

     async findCachedUser(userId: string): Promise<CachedUser | null> {
       return this.userRepo.findOne({ where: { user_id: userId } });
     }

     async upsertCachedUser(data: {
       user_id: string;
       username: string;
       email?: string;
       name: string;
       is_super_admin: boolean;
     }): Promise<CachedUser> {
       // TypeORM upsert (PostgreSQL ON CONFLICT)
       await this.userRepo.upsert(
         { ...data, last_sync_at: new Date() },
         { conflictPaths: ['user_id'], skipUpdateIfNoValuesChanged: true },
       );
       const saved = await this.findCachedUser(data.user_id);
       return saved!;
     }

     async deleteUser(userId: string): Promise<void> {
       await this.userRepo.delete({ user_id: userId });
     }
   }
   ```
   > Catatan: `SessionEntity` repository tidak dibuat — plan2 section 7.2 catatan: tabel `sessions` hanya dipakai kalau `SESSION_STORE=postgres`. Untuk plan2 v1.2.2, `SESSION_STORE=redis|memory`, jadi `SessionEntity` hanya stub. Repository SessionEntity skip.

4. **Verify entities** (`cached-user.entity.ts` + `session.entity.ts` dari AUTH-08):
   - Field names harus snake_case (`user_id`, `is_super_admin`, `last_sync_at`) match plan2 section 7.1.
   - `permission_codes` di `SessionEntity` harus `jsonb` (PostgreSQL native JSONB type).

5. **Wire `SessionService` + `CacheRepository`** di `SecurityModule.forRoot`:
   ```ts
   @Module({})
   export class SecurityModule {
     static forRoot(options: SecurityOptions): DynamicModule {
       // ... existing providers
       return {
         module: SecurityModule,
         imports: options.sessionStore === 'redis' || options.sessionStore === 'memory'
           ? [TypeOrmModule.forFeature([CachedUser])] // SessionEntity optional, skip
           : [],
         providers: [
           sessionStoreProvider,
           { provide: 'SECURITY_OPTIONS', useValue: options },
           SessionService,
           OAuthClientService,
           JwksVerifier,
           MockVerifier,
           AuthSyncService,
           SyncLockService,
           CacheRepository,
         ],
         exports: [
           sessionStoreProvider, SessionService, OAuthClientService,
           JwksVerifier, AuthSyncService, SyncLockService, CacheRepository,
         ],
       };
     }
   }
   ```
   > Catatan: `TypeOrmModule.forFeature` dipakai supaya `@InjectRepository(CachedUser)` work. Payment-api yang import `SecurityModule` harus sudah punya `TypeOrmModule` configured.

6. **Unit test `session.service.spec.ts`**:
   - Mock `SessionStore` (provide mock di Test.createTestingModule).
   - Test:
     - `create` generate sid (64 char hex), session punya semua fields, `set` called dengan TTL = `refreshExpiresAt - now`.
     - `get` delegasi ke `store.get`.
     - `delete` delegasi + log.
     - `touch` delegasi.
     - `updateSync` delegasi dengan `Date.now()` sebagai lastSyncAt.
     - `updateOnSwitchRole` update session in-place + `set` called dengan TTL baru.
     - `updateOnSwitchRole` bila session tidak ada → return null.

7. **Unit test `cookie.util.spec.ts`**:
   - `buildSessionCookie` return string dengan semua attributes (`HttpOnly`, `Secure`, `SameSite=Lax`, `Path=/`, `Max-Age=<sec>`).
   - `buildSessionCookie` dengan `secure: false` → tidak ada `Secure` attribute.
   - `buildSessionCookie` dengan `sameSite: 'none'` → `SameSite=None`.
   - `clearSessionCookie` return `Max-Age=0`.
   - `parseSessionCookie` extract sid dari raw Cookie header.

8. **Unit test `cache.repository.spec.ts`**:
   - Mock TypeORM `Repository<CachedUser>` (jest mock `findOne`, `upsert`, `delete`).
   - Test:
     - `findCachedUser` call `findOne({ where: { user_id } })`.
     - `upsertCachedUser` call `upsert({ ...data, last_sync_at: Date })` + return saved entity.
     - `deleteUser` call `delete({ user_id })`.

## Acceptance criteria

- [ ] `SessionService.create(input)` generate `sid` (64 char hex) + return `{ sid, session }`.
- [ ] `Session` object punya 11 fields per plan2 section 9.4.1 (sid, userId, username, roleId, permissionCodes, accessToken, refreshToken, accessExpiresAt, refreshExpiresAt, createdAt, lastSeenAt, lastSyncAt).
- [ ] `accessExpiresAt` di-set dari `tokens.expiresAt * 1000` (convert seconds → ms).
- [ ] `refreshExpiresAt` di-set `now + 8h` (absolute, per plan2 section 5.3).
- [ ] TTL saat `set` = `refreshExpiresAt - now` (session expired saat refresh token expired).
- [ ] `SessionService.delete` delegasi ke `store.delete` + log.
- [ ] `SessionService.touch` delegasi ke `store.touch`.
- [ ] `SessionService.updateSync(sid, permissionCodes)` delegasi dengan `lastSyncAt = Date.now()`.
- [ ] `SessionService.updateOnSwitchRole` update session in-place + persist ke store.
- [ ] Cookie builder menghasilkan `HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=<sec>` per plan2 section 12.1.
- [ ] `clearSessionCookie` return `Max-Age=0` (browser hapus cookie).
- [ ] `parseSessionCookie` extract `sid` dari Cookie header.
- [ ] `CacheRepository.upsertCachedUser` pakai TypeORM `upsert` (PostgreSQL ON CONFLICT).
- [ ] `CachedUser` entity punya 6 fields per plan2 section 7.1 (`user_id`, `username`, `email`, `name`, `is_super_admin`, `last_sync_at`).
- [ ] `SessionEntity` punya 11 fields per plan2 section 7.2 (snake_case, `permission_codes` jsonb).
- [ ] `SecurityModule.forRoot` wire `SessionService` + `CacheRepository` di providers + exports.
- [ ] `TypeOrmModule.forFeature([CachedUser])` di-import supaya `@InjectRepository(CachedUser)` work.
- [ ] Unit test (`session.service.spec.ts`, `cookie.util.spec.ts`, `cache.repository.spec.ts`) lulus.
- [ ] `pnpm --filter @retry-failure/security typecheck` + `lint` lulus.

## Useful commands

```bash
# Typecheck
cd /home/z/my-project/retry-failure && pnpm --filter @retry-failure/security typecheck

# Lint
cd /home/z/my-project/retry-failure && pnpm --filter @retry-failure/security lint

# Run session + cookie + cache tests
cd /home/z/my-project/retry-failure && pnpm --filter @retry-failure/security test -- --testPathPattern="(session.service|cookie.util|cache.repository)"

# Run all security tests
cd /home/z/my-project/retry-failure && pnpm --filter @retry-failure/security test

# Verify cookie format manual
node -e "
const { buildSessionCookie, clearSessionCookie } = require('./packages/security/src/oauth/cookie.util.ts');
console.log('Session cookie:');
console.log(buildSessionCookie('abc123', { maxAgeMs: 8 * 60 * 60 * 1000 }));
console.log();
console.log('Cleared cookie:');
console.log(clearSessionCookie({})); // mock Response
"
# Expected session cookie output:
# sid=abc123;HttpOnly;Secure;SameSite=Lax;Path=/;Max-Age=28800

# Integration test manual (butuh Redis + payment-api with SecurityModule)
# - Login via BFF
# - Verify Set-Cookie header di response /auth/callback
# - Verify GET /auth/session mengembalikan user data
# - Verify GET /payments dengan cookie sid → 200
# - Verify tanpa cookie sid → 401
```

## Notes

- **Cookie attributes** (plan2 section 12.1):
  - `HttpOnly` — JavaScript browser tidak bisa akses cookie (anti-XSS token theft).
  - `Secure` — HTTPS only (skip bila `NODE_ENV=development` + localhost HTTP).
  - `SameSite=Lax` — default untuk same-site (FE Vue + BE payment-api di localhost berbeda port).
  - `SameSite=None; Secure` — wajib kalau FE + BE beda domain (cross-site).
  - `Path=/` — cookie berlaku untuk semua path.
  - `Max-Age=28800` — 8 jam, ikut refresh token TTL.
- **Session TTL** = `refreshExpiresAt - now` (bukan `accessExpiresAt`).
  - Access token expired 15 menit → pakai refresh untuk dapat access baru.
  - Refresh token expired 8 jam → session expired.
  - Saat refresh berhasil, `refreshExpiresAt` di-extend (rotation) → session TTL juga extend di `touch`.
- **`updateOnSwitchRole`** — saat user switch role (via `POST /auth/switch-role` BFF endpoint), session update in-place: roleId baru, access+refresh token baru, permissionCodes baru. Tidak recreate sid (cookie tetap valid).
- **`CacheRepository`** pakai TypeORM Repository pattern — `@InjectRepository(CachedUser)`. Di payment-api, `TypeOrmModule.forFeature([CachedUser])` harus sudah di-import (di SecurityModule.forRoot).
- **`SessionEntity`** tidak di-repository-kan — plan2 section 7.2 catatan: tabel `sessions` hanya dipakai kalau `SESSION_STORE=postgres`. Untuk v1.2.2 (`redis|memory`), tabel `sessions` tidak dibuat. Entity di-keep di package supaya siap bila nanti `SESSION_STORE=postgres` di-support.
- **`upsert` TypeORM 0.3** — method built-in (`repository.upsert(entity, { conflictPaths, skipUpdateIfNoValuesChanged })`). Pakai PostgreSQL ON CONFLICT. Performance OK untuk upsert per-record.
- **TODO: encryption at rest** untuk `accessToken` + `refreshToken` di Session object sebelum persist ke Redis. Production concern: AES-256-GCM dengan key dari env. Catat di `packages/security/README.md` atau TODO file.
- Setelah task ini selesai, AUTH-13 (guards + decorators) bisa mulai — SessionGuard pakai `SessionService` + cookie helper untuk inject `req.user`.
