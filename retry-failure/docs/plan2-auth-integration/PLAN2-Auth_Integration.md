# PLAN 2 — Auth Integration (OAuth 2.0 + PKCE + BFF + Lazy Sync)

> **File**: `docs/plan2-auth-integration/PLAN-Auth_Integration.md`
> **Version**: 1.2.2
> **Status**: FINAL
> **Created**: 2026-09-20
> **Last updated**: 2026-09-24
> **Baseline**: `docs/plan1-cockatiel-retry-failure-scenario/PLAN1_Cockatiel_Retry_Failure_Scenario.md`
> **Frontend**: Vue 3 + PrimeVue

## Changelog

| Version | Tanggal | Perubahan |
|---|---|---|
| 1.2.2 | 2026-09-24 | Fix: payment-api port 3001 (bukan 3000), `payments.user_id` nullable (tidak NOT NULL). |
| 1.2.1 | 2026-09-24 | Sandbox readiness: `SESSION_STORE=memory`, definisi `AUTH_MODE=disabled`, `openid-client` v5, `auth-mock` login UI (HTML server-rendered). |
| 1.2.0 | 2026-09-24 | Roadmap OAuth2 Server di repo auth. |
| 1.1.0 | 2026-09-24 | Simplifikasi konfigurasi: `AUTH_BASE_URL` + konstanta path. |
| 1.0.0 | 2026-09-23 | Final. Struktur folder per-plan, versioning 4 level. |
| 0.4.0 | 2026-09-20 | Vue-only frontend. |
| 0.3.0 | 2026-09-20 | OAuth2 + PKCE + BFF, JWT tipis + `roleId`, lazy sync (SWR), cache 2 tabel. |
| 0.2.0 | 2026-09-19 | Menyesuaikan kontrak auth aktual. |
| 0.1.0 | 2026-09-19 | Draft awal. |

---

## 1. Tujuan

Plan ini menjelaskan bagaimana `payment-api` di monorepo Retry berintegrasi dengan **auth service eksternal** yang:

1. Berada di repo terpisah.
2. Memiliki cadence update dependency/Node yang lebih cepat (karena security).
3. **Akan dibangun menjadi OAuth 2.0 Authorization Server penuh.**
4. Menyediakan admin panel untuk manajemen user/role/menu.

Fokus integrasi:

1. **Boundary jelas**: auth adalah service, bukan library.
2. **Kontrak-first**: HTTP + JWT claims, bukan shared code.
3. **Mock-first development**: `auth-mock` sebagai referensi OAuth2 lengkap.
4. **Verifikasi token** via JWKS (RS256).
5. **JWT tipis**: identitas + active role saja.
6. **Otorisasi berbasis menu** dari cache lokal.
7. **Lazy sync (stale-while-revalidate)** menggantikan background refresh.
8. **Observability lintas service**.
9. **Versioning kontrak** agar auth update tidak memecah payment.
10. **Konfigurasi minimal**: env hanya untuk yang berubah antar environment.
11. **Sandbox-friendly**: bisa jalan tanpa Redis, tanpa auth server.

### 1.1 Strategi Transisi

```text
FASE 1 (sekarang)
  payment-api  --OAuth2-->  auth-mock (referensi OAuth2 lengkap)
  auth asli    : masih custom (login API + JWT HS256)
  pembangunan OAuth2 server di auth asli: paralel

FASE 2 (auth asli siap)
  payment-api  --OAuth2-->  auth asli
  auth-mock    : tetap ada untuk dev & E2E
  auth asli    : OAuth2 server penuh, RS256 + JWKS
```

Detail roadmap OAuth2 server ada di **Section 25**.

---

## 2. Prinsip

> **Token tidak pernah menyentuh browser. JWT hanya identitas + active role. Otorisasi dibaca dari cache lokal. Auth service adalah Authorization Server.**

### 2.1 Responsibility boundary

| Concern | Owner |
|---|---|
| Authorization Server | Auth service |
| Admin panel (user/role/menu) | Auth service |
| Terbitkan token (RS256) | Auth service |
| JWKS endpoint | Auth service |
| Endpoint data otorisasi | Auth service |
| OAuth2 Client + PKCE | BE payment |
| Session store | BE payment |
| Cookie `HttpOnly` | BE payment |
| Cache user + permission | Payment-api |
| Menu-based authorization | Payment-api |
| Refresh token rotation | BE payment |
| Revoke token | Auth service |
| Lazy sync | BE payment (middleware) |

### 2.2 Dependency flow

```text
┌─────────────────────┐         ┌────────────────────────────────────┐
│  repo auth          │         │  repo Retry (monorepo)             │
│                     │         │                                    │
│  auth-service       │◄──OAuth2┤  payment-api (BFF + Resource)      │
│  (target: OAuth2 AS)│◄──JWKS──┤   ├─ /auth/*      (BFF)            │
│  - /oauth/*         │◄──sync──┤   ├─ /payments/*  (resource)       │
│  - /api/users/*     │         │   ├─ packages/security             │
│  - /api/roles/*     │         │   ├─ cache: cached_users, sessions │
│  - /api/menus/*     │         │   └─ session store (Redis/memory)  │
│  - /.well-known/    │         │                                    │
│      jwks.json      │         │  apps/auth-mock    (OAuth2 ref)    │
│                     │         │  apps/frontend-vue                 │
│  DB: auth           │         │                                    │
└─────────────────────┘         └────────────────────────────────────┘
```

### 2.3 Stack Teknologi

**Backend (`payment-api` + `packages/security`)**

| Kategori | Package | Fungsi |
|---|---|---|
| Framework | `@nestjs/common`, `@nestjs/core`, `@nestjs/platform-express` (v11) | Dasar NestJS |
| Config | `@nestjs/config` | Env + validasi |
| HTTP Client | `@nestjs/axios`, `axios` | Panggil auth service |
| OAuth2 Client | `openid-client` (**v5**) | Authorization Code + PKCE, token exchange, refresh, revoke |
| JWT / JWKS | `jose` (v5) | Verifikasi RS256 + JWKS |
| Session Store | `ioredis` + `lru-cache` | Redis (prod) + memory (sandbox) |
| Cookie | `cookie-parser` | Parsing cookie sesi |
| CSRF | `csrf-csrf` | Double-submit cookie |
| Security Headers | `helmet` | HSTS, CSP, X-Frame-Options |
| Rate Limit | `@nestjs/throttler` | Throttle login/callback |
| Scheduler | `@nestjs/schedule` | Cleanup sesi expired |
| ORM | `typeorm` (v0.3) + `pg` | Cache tables + payments |
| Validation | `class-validator`, `class-transformer` | DTO |
| Logging | `nestjs-pino`, `pino` | Structured logging |
| Metrics | `prom-client` | Prometheus |
| Tracing | `@opentelemetry/sdk-node`, `@opentelemetry/auto-instrumentations-node` | OTel |
| Testing | `jest`, `supertest`, `nock` | Unit + integration |
| Crypto | `crypto` (builtin) | Random state, `jti` |

> **Catatan `openid-client`**: v6 adalah penulisan ulang total (ESM-only, API berbeda, dokumentasi minim). Plan ini memakai **v5** untuk stabilitas. Migrasi ke v6 direncanakan di fase terpisah setelah `auth-mock` stabil dan contract test jalan.

**`apps/auth-mock` (OAuth2 reference)**

| Package | Fungsi |
|---|---|
| `@nestjs/common`, `@nestjs/core` (v11) | Framework |
| `@nestjs/platform-express` | HTTP server |
| `ejs` | Template engine untuk login page |
| `jose` (v5) | Sign RS256 + expose JWKS |
| `uuid` | Generate `jti`, `code`, `sid` |
| `class-validator`, `class-transformer` | DTO |
| `@nestjs/throttler` | Rate limit login |
| `ioredis` + `lru-cache` | Session + authorization code store |

**Repo auth (target: OAuth2 Server)** — lihat Section 25.

**Frontend (`apps/frontend-vue`)**

| Package | Fungsi |
|---|---|
| `vue` (v3.5+) | Framework |
| `vite` (v6) | Build tool |
| `vue-router` (v4) | Routing + guard |
| `pinia` (v3) | State management |
| `primevue` (v4) + `@primevue/themes` | UI components |
| `primeicons` | Icon |
| `axios` | HTTP client + interceptor |
| `typescript` (v5.8+) | Type safety |
| `vue-tsc` | Type check |

**Infrastruktur**

| Komponen | Image / Versi | Wajib? |
|---|---|---|
| Node.js | `20.19.0` (pin) | Ya |
| PostgreSQL | `16` | Ya |
| Redis | `7-alpine` | Opsional (sandbox) |
| Nginx | `alpine` | Production FE |
| Jaeger | `1.x` | Opsional |
| Prometheus | `v2.x` | Opsional |
| Grafana | `v11.x` | Opsional |
| Docker Compose | `v2` | Ya |

---

## 3. Struktur Monorepo

```text
retry-failure/
├── apps/
│   ├── payment-api/              # BFF + Resource Server
│   ├── payment-gateway-mock/
│   ├── auth-mock/                # OAuth2 reference
│   └── frontend-vue/             # Vue 3 + PrimeVue
├── packages/
│   ├── resilience/
│   └── security/                 # OAuth client, guard, cache, sync
├── docker/
│   ├── postgres/
│   ├── prometheus/
│   └── grafana/
├── docs/
│   ├── README.md
│   ├── SANDBOX_NOTES.md
│   ├── plan1-cockatiel-retry-failure-scenario/
│   │   ├── tasks/
│   │   ├── README.md
│   │   └── PLAN1_Cockatiel_Retry_Failure_Scenario.md
│   └── plan2-auth-integration/
│       ├── tasks/
│       ├── README.md
│       ├── PLAN2-Auth_Integration.md
│       ├── AUTH_CONTRACT.md
│       ├── auth-openapi.json
│       └── CHANGELOG-AUTH.md
├── docker-compose.yml
├── docker-compose.sandbox.yml    # tanpa Redis/Jaeger
├── pnpm-workspace.yaml
├── tsconfig.base.json
├── .env.example
├── .env.sandbox.example
└── README.md
```

---

## 4. Alur OAuth 2.0 + PKCE via BFF

### 4.1 Diagram

```text
User          FE Vue              BE Payment (BFF)          Auth Service
 |                 |                     |                       |
 |--buka app------>|                     |                       |
 |                 |--GET /auth/session->|                       |
 |                 |<--401 no session----|                       |
 |                 |--redirect /auth/login->|                    |
 |                 |                     |--generate PKCE------->|
 |                 |<--302 /oauth/authorize?...----------------->|
 |--login di auth------------------------->|                     |
 |                 |                     |                       |<--login
 |                 |                     |                       |<--select-role
 |                 |<--302 /auth/callback?code=...&state=...-----|
 |                 |                     |--POST /oauth/token--->|
 |                 |                     |<--access+refresh------|
 |                 |                     |--GET /api/v1/me/permissions->|
 |                 |                     |<--user+role+perms-----|
 |                 |<--Set-Cookie: sid---|                       |
 |<--redirect app--|                     |                       |
 |                 |--GET /payments----->|                       |
 |                 |  (cookie sid)       |                       |
 |                 |<--data--------------|                       |
```

### 4.2 Endpoint BFF di payment-api

| Method | Path | Fungsi |
|---|---|---|
| GET | `/auth/session` | Cek sesi, return user ringkas |
| GET | `/auth/login` | Mulai OAuth2 flow (PKCE + state) |
| GET | `/auth/callback` | Terima `code`, tukar token, buat sesi |
| POST | `/auth/logout` | Hapus sesi + revoke token |
| POST | `/auth/refresh` | Refresh access token (internal) |
| POST | `/auth/switch-role` | Ganti active role (proxy ke auth) |
| GET | `/auth/csrf` | Ambil CSRF token |

`/auth/*` publik dari sisi JWT, dilindungi cookie sesi.

### 4.3 PKCE

- `code_verifier`: 43–128 karakter random.
- `code_challenge`: `BASE64URL(SHA256(verifier))`.
- `code_challenge_method`: `S256`.
- `state`: random, disimpan di cookie sesi sementara, diverifikasi di callback.
- PKCE wajib meski client confidential (RFC 9700 §2.1.1).

### 4.4 Session store

Dua implementasi didukung:

| Store | Kapan dipakai | Konsekuensi |
|---|---|---|
| Redis | Production, staging, multi-instance | Persistence, scaling |
| Memory | Sandbox, dev, unit test | Hilang saat restart, single instance |

Pemilihan via env `SESSION_STORE=redis|memory`.

Cookie hanya berisi `sid`.

---

## 5. Token Strategy

### 5.1 Signing

- Algoritma: **RS256**.
- Private key hanya di auth service.
- Public key di-expose via JWKS.
- Payment-api verifikasi via JWKS dengan cache.
- `kid` wajib untuk rotasi.

### 5.2 Payload JWT (tipis + `roleId`)

```json
{
  "sub": "user-uuid",
  "username": "budi_santoso",
  "roleId": "role-uuid",
  "iss": "https://auth.example.com",
  "aud": "payment-api",
  "exp": 1730000000,
  "iat": 1729999100,
  "jti": "unique-token-id"
}
```

**Tidak masuk JWT**: `roles[]`, `isSuperAdmin`, `menuCodes[]`, `permissions[]`. Semua di cache lokal.

### 5.3 Expiry

- Access token: 15 menit.
- Refresh token: 8 jam (absolute).
- Session cookie: mengikuti refresh token.

### 5.4 Refresh rotation

- Setiap `grant_type=refresh_token` → refresh baru, refresh lama di-revoke.
- Refresh lama dipakai lagi → indikasi theft → revoke seluruh sesi user.

### 5.5 Revoke

- Logout: BE payment panggil `/oauth/revoke`.
- User deaktivasi: auth revoke semua token.
- Webhook → BE payment invalidate session.

### 5.6 Ganti active role

```text
1. User klik "Ganti Role" di FE Vue
2. FE panggil POST /auth/switch-role { roleId } ke BE payment
3. BE payment proxy ke auth: POST /api/v1/auth/switch-role
4. Auth terbitkan JWT baru dengan roleId baru
5. BE payment verifikasi JWT baru, update session (roleId + permission_codes)
6. FE refresh /auth/session
```

---

## 6. Otorisasi Berbasis Menu

### 6.1 Menu code

Setiap menu di auth punya **code stabil**:

```text
id: 1  code: "dashboard"        name: "Dashboard"
id: 2  code: "payment.read"     name: "Lihat Payment"
id: 3  code: "payment.write"    name: "Buat Payment"
id: 4  code: "payment.retry"    name: "Retry Payment"
id: 5  code: "payment.admin"    name: "Admin Payment"
```

### 6.2 Mapping endpoint → menu

| Endpoint | Menu Code |
|---|---|
| `POST /payments` | `payment.write` |
| `GET /payments` | `payment.read` |
| `GET /payments/:id` | `payment.read` |
| `POST /payments/:id/retry` | `payment.retry` |
| `GET /admin/gateway-config` | `payment.admin` |
| `GET /health` | publik |
| `GET /metrics` | publik (internal) |
| `GET /docs` | publik (dev) |
| `/auth/*` | publik (cookie session) |

```ts
@RequireMenu('payment.write')
@Post('/payments')
createPayment(...) {}
```

### 6.3 Super admin

- `is_super_admin = true` → bypass semua cek menu.
- Dari `cached_users`.

### 6.4 MenuAccessGuard

```text
request
  |
  v
SessionGuard (cookie sid -> req.user {userId, roleId})
  |
  v
MenuAccessGuard (baca @RequireMenu + permission dari session)
  |
  +-- is_super_admin -> allow
  +-- permission_codes contains required code -> allow
  +-- else -> 403
```

Guard **tidak** memanggil auth service.

---

## 7. Data Model Cache (2 Tabel)

### 7.1 `cached_users`

| Column | Type | Notes |
|---|---|---|
| `user_id` | uuid PK | dari auth |
| `username` | varchar(64) | |
| `email` | varchar(128) | nullable |
| `name` | varchar(128) | |
| `is_super_admin` | boolean | default false |
| `last_sync_at` | timestamp(3) | |

### 7.2 `sessions`

| Column | Type | Notes |
|---|---|---|
| `sid` | varchar(64) PK | |
| `user_id` | uuid FK → cached_users | |
| `role_id` | uuid | dari JWT |
| `permission_codes` | jsonb | snapshot saat login |
| `access_token` | text | encrypted at rest |
| `refresh_token` | text | encrypted at rest |
| `access_expires_at` | timestamp(3) | |
| `refresh_expires_at` | timestamp(3) | |
| `created_at` | timestamp(3) | |
| `last_seen_at` | timestamp(3) | |
| `last_sync_at` | timestamp(3) | untuk lazy sync |

> **Catatan**: tabel `sessions` **hanya dipakai** kalau `SESSION_STORE=redis` (sebagai audit) atau `SESSION_STORE=postgres`. Kalau `SESSION_STORE=memory`, tabel ini tidak dibuat.

Index:
- `idx_sessions_user_id`
- `idx_sessions_last_sync_at`
- `idx_sessions_refresh_expires_at`

### 7.3 `payments` (perubahan)

- Tambah `user_id uuid` FK → `cached_users.user_id`.
- **Nullable** (tidak NOT NULL untuk demo/sandbox — existing payments dari Plan1 tidak punya user).
- `ON DELETE SET NULL`.
- Index `idx_payments_user_id`.

### 7.4 Kenapa hanya 2 tabel

- **`cached_users`**: info user stabil, lintas sesi.
- **`sessions`**: permission snapshot saat login.

Tidak dibuat: `cached_roles`, `cached_user_roles`, `cached_menus`, `cached_role_menus`, `cached_sessions_permissions`.

### 7.5 Batasan `jsonb`

- Batas per nilai: 255 MB (jauh cukup).
- Permission codes: 10–100 string pendek → beberapa KB.
- Query: `WHERE permission_codes @> '["payment.write"]'::jsonb` didukung GIN index.

---

## 8. Strategi Sinkronisasi (Lazy Sync)

### 8.1 Tiga pemicu

| Pemicu | Kapan | Data |
|---|---|---|
| Initial sync | Setelah OAuth callback | User + role + permission |
| Lazy sync (SWR) | Middleware, saat `last_sync_at` stale | Update `permission_codes` |
| Webhook (opsional) | Auth kirim event | Entitas yang berubah |

### 8.2 Alur Lazy Sync

```text
Request masuk
  |
  v
Middleware lazy-sync
  |
  +-- ambil session (cookie sid)
  +-- age = now - session.last_sync_at
  |
  +-- age < FRESH_TTL (5 menit)         -> lanjut
  +-- FRESH_TTL <= age < STALE_TTL      -> lanjut + sync background
  +-- age >= STALE_TTL (30 menit)       -> blocking sync (timeout 2s)
```

Implementasi pseudo-code:

```ts
async function lazySyncMiddleware(req, res, next) {
  const session = await getSession(req.cookies.sid);
  if (!session) return next();

  const age = Date.now() - session.last_sync_at.getTime();
  const FRESH_TTL = 5 * 60 * 1000;
  const STALE_TTL = 30 * 60 * 1000;

  if (age < FRESH_TTL) return next();

  if (age < STALE_TTL) {
    refreshInBackground(session); // non-blocking
    return next();
  }

  try {
    await withTimeout(refreshSession(session), 2000);
  } catch (err) {
    logger.warn('sync timeout, using stale cache');
  }
  return next();
}
```

### 8.3 Lock per sesi

```ts
const lockKey = `sync:lock:${session.sid}`;
const acquired = await redis.set(lockKey, '1', 'NX', 'EX', 10);
if (!acquired) return;

try {
  await doSync(session);
} finally {
  await redis.del(lockKey);
}
```

> **Catatan sandbox**: kalau `SESSION_STORE=memory`, lock pakai in-process `Map` dengan TTL. Tetap valid selama single-instance.

### 8.4 Middleware vs Guard

```text
Request flow:
  Middleware  -> CSRF, cookie, trace, helmet, lazy-sync
  Guard       -> SessionGuard (cookie -> req.user)
              -> MenuAccessGuard (permission check)
  Handler     -> business logic
```

### 8.5 Webhook (opsional)

```json
{ "event": "user.updated", "user_id": "...", "occurred_at": "..." }
{ "event": "role.permissions.updated", "role_id": "...", "occurred_at": "..." }
{ "event": "user.deleted", "user_id": "...", "occurred_at": "..." }
```

### 8.6 Skenario user delete / rename

- **Rename**: webhook atau lazy sync update `cached_users.name`.
- **Delete**: webhook hapus row `cached_users`, set `payments.user_id = NULL`, revoke sesi.

### 8.7 Grace period

- Auth down: pakai cache sampai `STALE_TTL` (30 menit).
- Setelah itu: blocking sync; kalau gagal, tetap pakai cache dengan warning.
- Batas maksimal: `MAX_STALE_TTL` (2 jam).

---

## 9. `packages/security`

```text
packages/security/
├── src/
│   ├── oauth/
│   │   ├── endpoints.ts
│   │   ├── oauth-client.service.ts
│   │   ├── oauth.controller.ts
│   │   └── session.service.ts
│   ├── session-store/
│   │   ├── session-store.interface.ts
│   │   ├── redis-session.store.ts
│   │   └── memory-session.store.ts
│   ├── middleware/
│   │   ├── lazy-sync.middleware.ts
│   │   ├── csrf.middleware.ts
│   │   └── trace.middleware.ts
│   ├── guards/
│   │   ├── session.guard.ts
│   │   ├── jwt-auth.guard.ts
│   │   └── menu-access.guard.ts
│   ├── decorators/
│   │   ├── public.decorator.ts
│   │   ├── current-user.decorator.ts
│   │   └── require-menu.decorator.ts
│   ├── verifiers/
│   │   ├── jwks-verifier.ts
│   │   └── mock-verifier.ts
│   ├── sync/
│   │   ├── auth-sync.service.ts
│   │   └── sync-lock.service.ts
│   ├── cache/
│   │   ├── cached-user.entity.ts
│   │   ├── session.entity.ts
│   │   └── cache.repository.ts
│   ├── types/
│   │   └── auth-user.ts
│   ├── security.module.ts
│   └── index.ts
└── test/
```

### 9.1 `endpoints.ts` — konstanta path

```ts
// packages/security/src/oauth/endpoints.ts
export const OAUTH_PATHS = {
  authorize:   '/oauth/authorize',
  token:       '/oauth/token',
  revoke:      '/oauth/revoke',
  jwks:        '/.well-known/jwks.json',
  discovery:   '/.well-known/openid-configuration',
  permissions: '/api/v1/me/permissions',
  switchRole:  '/api/v1/auth/switch-role',
} as const;

export type OAuthPath = keyof typeof OAUTH_PATHS;
```

### 9.2 `req.user` shape

```ts
interface AuthUser {
  userId: string;
  username: string;
  roleId: string;
  isSuperAdmin: boolean;
  permissionCodes: string[];
}
```

### 9.3 `AUTH_MODE` — definisi lengkap

| Mode | Deskripsi | Guard | Sync | `/auth/*` |
|---|---|---|---|---|
| `oauth` | OAuth2 + PKCE + JWKS | Aktif | Aktif | Berfungsi |
| `mock` | Pakai `apps/auth-mock` | Aktif | Aktif | Berfungsi |
| `disabled` | **Semua guard di-skip** | Skip | Skip | Return 501 |

#### 9.3.1 Behavior `AUTH_MODE=disabled`

| Komponen | Behavior |
|---|---|
| `SessionGuard` | Skip. Set `req.user` dari env. |
| `JwtAuthGuard` | Skip. |
| `MenuAccessGuard` | Skip. Semua endpoint diizinkan. |
| `LazySyncMiddleware` | Tidak jalan. |
| `@Public()` | Diabaikan (semua endpoint sudah publik). |
| `@RequireMenu()` | Diabaikan. |
| `/auth/login`, `/auth/callback` | Return `501 Not Implemented`. |
| `/auth/session` | Return user palsu dari env. |
| `/auth/logout` | Return `200 OK` (no-op). |

User palsu dari env:

```text
AUTH_DISABLED_USER_ID=00000000-0000-0000-0000-000000000001
AUTH_DISABLED_USERNAME=disabled-user
AUTH_DISABLED_ROLE_ID=00000000-0000-0000-0000-000000000002
AUTH_DISABLED_IS_SUPER_ADMIN=true
AUTH_DISABLED_PERMISSION_CODES=*
```

Kalau `AUTH_DISABLED_PERMISSION_CODES=*` → semua endpoint diizinkan.
Kalau diisi spesifik (`payment.read,payment.write`) → hanya endpoint dengan menu code itu.

#### 9.3.2 Guard production

```ts
if (NODE_ENV === 'production') {
  if (AUTH_MODE === 'mock')     throw new Error('AUTH_MODE=mock tidak boleh di production');
  if (AUTH_MODE === 'disabled') throw new Error('AUTH_MODE=disabled tidak boleh di production');
}
```

### 9.4 SessionStore — interface & implementasi

#### 9.4.1 Interface

```ts
// packages/security/src/session-store/session-store.interface.ts
export interface Session {
  sid: string;
  userId: string;
  username: string;
  roleId: string;
  permissionCodes: string[];
  accessToken: string;
  refreshToken: string;
  accessExpiresAt: number;
  refreshExpiresAt: number;
  createdAt: number;
  lastSeenAt: number;
  lastSyncAt: number;
}

export interface SessionStore {
  get(sid: string): Promise<Session | null>;
  set(sid: string, session: Session, ttlMs: number): Promise<void>;
  delete(sid: string): Promise<void>;
  touch(sid: string): Promise<void>;
  updateSync(sid: string, permissionCodes: string[], lastSyncAt: number): Promise<void>;
  listActive(): Promise<Session[]>;
  acquireLock(key: string, ttlSec: number): Promise<boolean>;
  releaseLock(key: string): Promise<void>;
}
```

#### 9.4.2 Redis implementation

```ts
// packages/security/src/session-store/redis-session.store.ts
import { Injectable } from '@nestjs/common';
import Redis from 'ioredis';
import { Session, SessionStore } from './session-store.interface';

@Injectable()
export class RedisSessionStore implements SessionStore {
  private readonly redis: Redis;
  private readonly prefix = 'session:';
  private readonly lockPrefix = 'lock:';

  constructor(redisUrl: string) {
    this.redis = new Redis(redisUrl);
  }

  private key(sid: string) {
    return `${this.prefix}${sid}`;
  }

  async get(sid: string): Promise<Session | null> {
    const raw = await this.redis.get(this.key(sid));
    return raw ? JSON.parse(raw) : null;
  }

  async set(sid: string, session: Session, ttlMs: number): Promise<void> {
    await this.redis.set(
      this.key(sid),
      JSON.stringify(session),
      'PX',
      ttlMs,
    );
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
    const keys = await this.redis.keys(`${this.prefix}*`);
    if (keys.length === 0) return [];
    const values = await this.redis.mget(...keys);
    return values
      .filter((v): v is string => v !== null)
      .map((v) => JSON.parse(v));
  }

  async acquireLock(key: string, ttlSec: number): Promise<boolean> {
    const result = await this.redis.set(
      `${this.lockPrefix}${key}`,
      '1',
      'NX',
      'EX',
      ttlSec,
    );
    return result === 'OK';
  }

  async releaseLock(key: string): Promise<void> {
    await this.redis.del(`${this.lockPrefix}${key}`);
  }
}
```

#### 9.4.3 Memory implementation (sandbox)

```ts
// packages/security/src/session-store/memory-session.store.ts
import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { LRUCache } from 'lru-cache';
import { Session, SessionStore } from './session-store.interface';

@Injectable()
export class MemorySessionStore implements SessionStore, OnModuleDestroy {
  private readonly sessions: LRUCache<string, Session>;
  private readonly locks = new Map<string, number>();
  private readonly cleanupTimer: NodeJS.Timeout;

  constructor(max = 1000, defaultTtlMs = 8 * 60 * 60 * 1000) {
    this.sessions = new LRUCache<string, Session>({
      max,
      ttl: defaultTtlMs,
      updateAgeOnGet: false,
    });

    // Bersihkan lock expired setiap 30 detik
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
    if (existing && existing > now) return false;
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
#### 9.4.4 Pemilihan store

```ts
// packages/security/src/security.module.ts
@Module({})
export class SecurityModule {
  static forRoot(options: SecurityOptions): DynamicModule {
    const sessionStoreProvider = {
      provide: 'SESSION_STORE',
      useFactory: () => {
        if (options.sessionStore === 'memory') {
          return new MemorySessionStore();
        }
        return new RedisSessionStore(options.redisUrl);
      },
    };

    return {
      module: SecurityModule,
      providers: [sessionStoreProvider, /* ... */],
      exports: [sessionStoreProvider],
    };
  }
}
```

---

## 10. `apps/auth-mock` (OAuth2 Reference)

### 10.1 Scope

`auth-mock` adalah **implementasi referensi OAuth2 lengkap**.

| Endpoint | Fungsi |
|---|---|
| `GET /oauth/authorize` | Authorization endpoint (menampilkan login page) |
| `POST /oauth/authorize` | Submit login + role |
| `POST /oauth/token` | Token endpoint (code + refresh) |
| `POST /oauth/revoke` | Revoke |
| `GET /oauth/userinfo` | OIDC user info (opsional) |
| `GET /.well-known/jwks.json` | JWKS |
| `GET /.well-known/openid-configuration` | OIDC discovery |
| `GET /api/v1/me/permissions` | Data otorisasi untuk sync |
| `POST /api/v1/auth/switch-role` | Ganti role aktif |
| `POST /dev/token` | Dev shortcut |

### 10.2 Client registration

- `client_id`: `payment-api`
- `client_secret`: dari env
- `redirect_uri`: `http://localhost:3001/auth/callback`
- `grant_types`: `authorization_code`, `refresh_token`
- `scopes`: `openid profile payment.read payment.write`

### 10.3 Signing

- RS256 dengan keypair dev.
- JWKS di `/.well-known/jwks.json`.
- Keypair disimpan di fixture.

### 10.4 Fixture user

- `superadmin` — single role, super admin.
- `budi_santoso` — multi role.
- Password dev: `ChangeMe_123!`.

### 10.5 Multi-role flow

Setelah login, jika multi-role: auth tampilkan halaman pilih role. Setelah dipilih, baru redirect ke `redirect_uri` dengan `code`. `roleId` masuk ke klaim JWT.

### 10.6 Response `/api/v1/me/permissions`

```json
{
  "success": true,
  "data": {
    "user": {
      "id": "uuid",
      "username": "budi_santoso",
      "email": "budi@perusahaan.com",
      "name": "Budi Santoso",
      "isSuperAdmin": false
    },
    "role": { "id": "role-uuid", "name": "HRD" },
    "permissionCodes": ["dashboard", "payment.read", "payment.write"]
  }
}
```

### 10.7 Halaman (UI)

`auth-mock` menggunakan **HTML server-rendered** dengan `ejs`. Tidak pakai Vue — mock harus sesederhana mungkin.

| Halaman | Fungsi | Prioritas |
|---|---|---|
| Login | Input username/password | Wajib |
| Pilih role | Muncul kalau user multi-role | Wajib |
| Consent | User setuju memberi akses | Opsional (skip untuk demo) |
| Error | Login gagal / client invalid | Wajib |

#### 10.7.1 Struktur folder

```text
apps/auth-mock/
├── views/
│   ├── layout.ejs
│   ├── login.ejs
│   ├── select-role.ejs
│   └── error.ejs
├── public/
│   └── style.css
└── src/
    └── modules/
        └── oauth/
            └── oauth.controller.ts
```

#### 10.7.2 Setup EJS di NestJS

```ts
// apps/auth-mock/src/main.ts
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { join } from 'node:path';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);

  app.useStaticAssets(join(__dirname, '..', 'public'));
  app.setBaseViewsDir(join(__dirname, '..', 'views'));
  app.setViewEngine('ejs');

  await app.listen(4001);
}
bootstrap();
```

#### 10.7.3 Controller: `oauth.controller.ts`

```ts
import { Controller, Get, Post, Query, Body, Res, Req, HttpStatus } from '@nestjs/common';
import { Response, Request } from 'express';
import { randomBytes, createHash } from 'node:crypto';
import { OAuthService } from './oauth.service';
import { ClientService } from '../client/client.service';
import { UserService } from '../user/user.service';

@Controller('oauth')
export class OAuthController {
  constructor(
    private readonly oauth: OAuthService,
    private readonly clients: ClientService,
    private readonly users: UserService,
  ) {}

  /**
   * Step 1: tampilkan login page
   */
  @Get('authorize')
  async authorize(
    @Query() query: Record<string, string>,
    @Res() res: Response,
  ) {
    const client = await this.clients.findById(query.client_id);
    if (!client) {
      return res.status(HttpStatus.BAD_REQUEST).render('error', {
        message: 'Invalid client_id',
      });
    }

    if (!client.redirectUris.includes(query.redirect_uri)) {
      return res.status(HttpStatus.BAD_REQUEST).render('error', {
        message: 'Invalid redirect_uri',
      });
    }

    // Validasi PKCE wajib
    if (!query.code_challenge || query.code_challenge_method !== 'S256') {
      return res.status(HttpStatus.BAD_REQUEST).render('error', {
        message: 'PKCE required (S256)',
      });
    }

    // Cek session auth (user mungkin sudah login)
    const authSession = await this.oauth.getAuthSession(req);

    if (authSession) {
      // Sudah login → langsung lanjut ke step role/consent
      return this.renderRoleOrRedirect(res, query, authSession);
    }

    // Belum login → render login page
    return res.render('login', {
      clientId: query.client_id,
      redirectUri: query.redirect_uri,
      state: query.state,
      codeChallenge: query.code_challenge,
      codeChallengeMethod: query.code_challenge_method,
      scope: query.scope ?? '',
      error: null,
    });
  }

  /**
   * Step 2: submit login
   */
  @Post('authorize')
  async submitLogin(
    @Body() body: Record<string, string>,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    const { username, password, client_id, redirect_uri, state, code_challenge, code_challenge_method, scope } = body;

    const user = await this.users.validateCredentials(username, password);
    if (!user) {
      return res.status(HttpStatus.UNAUTHORIZED).render('login', {
        clientId: client_id,
        redirectUri: redirect_uri,
        state,
        codeChallenge: code_challenge,
        codeChallengeMethod: code_challenge_method,
        scope,
        error: 'Username atau password salah',
      });
    }

    // Buat session auth (cookie)
    await this.oauth.createAuthSession(res, user);

    // Lanjut ke step role
    return this.renderRoleOrRedirect(
      res,
      { client_id, redirect_uri, state, code_challenge, code_challenge_method, scope },
      { user },
    );
  }

  /**
   * Step 3a: render pilih role (kalau multi-role)
   * Step 3b: atau langsung issue code (kalau single-role)
   */
  private async renderRoleOrRedirect(
    res: Response,
    query: Record<string, string>,
    authSession: { user: any },
  ) {
    const user = authSession.user;
    const roles = user.roles ?? [];

    if (roles.length === 1) {
      return this.issueCodeAndRedirect(res, query, user, roles[0].id);
    }

    // Multi-role → render halaman pilih role
    return res.render('select-role', {
      clientId: query.client_id,
      redirectUri: query.redirect_uri,
      state: query.state,
      codeChallenge: query.code_challenge,
      codeChallengeMethod: query.code_challenge_method,
      scope: query.scope,
      roles,
      userId: user.id,
    });
  }

  /**
   * Step 4: submit pilih role
   */
  @Post('select-role')
  async submitRole(
    @Body() body: Record<string, string>,
    @Res() res: Response,
  ) {
    const { user_id, role_id, client_id, redirect_uri, state, code_challenge, code_challenge_method, scope } = body;

    const user = await this.users.findById(user_id);
    if (!user) {
      return res.status(HttpStatus.BAD_REQUEST).render('error', {
        message: 'User tidak ditemukan',
      });
    }

    // Validasi role milik user
    const role = user.roles.find((r) => r.id === role_id);
    if (!role) {
      return res.status(HttpStatus.BAD_REQUEST).render('error', {
        message: 'Role tidak valid',
      });
    }

    return this.issueCodeAndRedirect(
      res,
      { client_id, redirect_uri, state, code_challenge, code_challenge_method, scope },
      user,
      role.id,
    );
  }

  /**
   * Step 5: issue authorization code + redirect
   */
  private async issueCodeAndRedirect(
    res: Response,
    query: Record<string, string>,
    user: any,
    roleId: string,
  ) {
    const code = randomBytes(32).toString('hex');

    await this.oauth.storeAuthorizationCode({
      code,
      clientId: query.client_id,
      userId: user.id,
      roleId,
      redirectUri: query.redirect_uri,
      codeChallenge: query.code_challenge,
      codeChallengeMethod: query.code_challenge_method,
      scope: query.scope,
      expiresAt: Date.now() + 60_000, // 1 menit
    });

    const url = new URL(query.redirect_uri);
    url.searchParams.set('code', code);
    if (query.state) url.searchParams.set('state', query.state);

    return res.redirect(url.toString());
  }
}
```

#### 10.7.4 `views/layout.ejs`

```html
<!DOCTYPE html>
<html lang="id">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title><%= title %> — Auth Mock</title>
  <link rel="stylesheet" href="/style.css">
</head>
<body>
  <main class="container">
    <header class="brand">
      <h1>Auth Mock</h1>
      <p class="subtitle">Development only — jangan dipakai di production</p>
    </header>
    <%- body %>
  </main>
</body>
</html>
```

#### 10.7.5 `views/login.ejs`

```html
<%- include('layout', { title: 'Login', body: `
  <h2>Login</h2>
  ${error ? `<p class="error">${error}</p>` : ''}

  <form method="POST" action="/oauth/authorize">
    <input type="hidden" name="client_id" value="${clientId}">
    <input type="hidden" name="redirect_uri" value="${redirectUri}">
    <input type="hidden" name="state" value="${state ?? ''}">
    <input type="hidden" name="code_challenge" value="${codeChallenge}">
    <input type="hidden" name="code_challenge_method" value="${codeChallengeMethod}">
    <input type="hidden" name="scope" value="${scope ?? ''}">

    <label>
      Username
      <input type="text" name="username" required autofocus autocomplete="username">
    </label>

    <label>
      Password
      <input type="password" name="password" required autocomplete="current-password">
    </label>

    <button type="submit">Login</button>
  </form>

  <aside class="hint">
    <strong>Fixture dev:</strong>
    <ul>
      <li><code>superadmin</code> / <code>ChangeMe_123!</code> — single role</li>
      <li><code>budi_santoso</code> / <code>ChangeMe_123!</code> — multi role</li>
    </ul>
  </aside>
` }) %>
```

> **Catatan**: `ejs` tidak mendukung template literal di dalam `include` seperti di atas secara native. Kalau memakai `ejs`, pisahkan layout atau pakai `<%- include('partials/header', {...}) %>`. Contoh di atas menunjukkan **struktur**, implementasi bisa pakai partial atau template engine lain seperti `nunjucks` yang lebih fleksibel.

#### 10.7.6 `views/select-role.ejs`

```html
<h2>Pilih Role</h2>
<p>Akun Anda memiliki beberapa role. Pilih salah satu untuk melanjutkan.</p>

<form method="POST" action="/oauth/select-role">
  <input type="hidden" name="user_id" value="<%= userId %>">
  <input type="hidden" name="client_id" value="<%= clientId %>">
  <input type="hidden" name="redirect_uri" value="<%= redirectUri %>">
  <input type="hidden" name="state" value="<%= state ?? '' %>">
  <input type="hidden" name="code_challenge" value="<%= codeChallenge %>">
  <input type="hidden" name="code_challenge_method" value="<%= codeChallengeMethod %>">
  <input type="hidden" name="scope" value="<%= scope ?? '' %>">

  <div class="roles">
    <% roles.forEach(role => { %>
      <label class="role-card">
        <input type="radio" name="role_id" value="<%= role.id %>" required>
        <span class="role-name"><%= role.name %></span>
        <span class="role-desc"><%= role.description ?? '' %></span>
      </label>
    <% }) %>
  </div>

  <button type="submit">Lanjutkan</button>
</form>
```

#### 10.7.7 `views/error.ejs`

```html
<h2>Error</h2>
<p class="error"><%= message %></p>
<p><a href="/">Kembali</a></p>
```

#### 10.7.8 `public/style.css`

```css
:root { font-family: system-ui, -apple-system, sans-serif; }
body { margin: 0; background: #f5f5f5; color: #333; }
.container { max-width: 420px; margin: 60px auto; padding: 24px; background: #fff; border-radius: 8px; box-shadow: 0 2px 8px rgba(0,0,0,.08); }
.brand { text-align: center; margin-bottom: 24px; }
.brand h1 { margin: 0; font-size: 1.4rem; }
.subtitle { color: #888; font-size: .85rem; margin: 4px 0 0; }
label { display: block; margin-bottom: 12px; font-size: .9rem; }
input[type="text"], input[type="password"] { width: 100%; padding: 8px; margin-top: 4px; border: 1px solid #ccc; border-radius: 4px; box-sizing: border-box; }
button { width: 100%; padding: 10px; background: #1976d2; color: #fff; border: 0; border-radius: 4px; cursor: pointer; font-size: 1rem; }
button:hover { background: #1565c0; }
.error { color: #c62828; padding: 8px; background: #ffebee; border-radius: 4px; font-size: .9rem; }
.hint { margin-top: 20px; padding: 12px; background: #f0f0f0; border-radius: 4px; font-size: .85rem; }
.hint code { background: #e0e0e0; padding: 1px 4px; border-radius: 3px; }
.roles { display: grid; gap: 8px; margin-bottom: 12px; }
.role-card { display: flex; flex-direction: column; padding: 12px; border: 2px solid #e0e0e0; border-radius: 4px; cursor: pointer; }
.role-card:hover { border-color: #1976d2; }
.role-card input { margin-right: 8px; }
.role-name { font-weight: 600; }
.role-desc { color: #666; font-size: .85rem; }
```

#### 10.7.9 Session auth (untuk interaksi user dengan AS)

`auth-mock` punya session sendiri, terpisah dari session payment-api:

```ts
// auth-mock session store (in-memory atau Redis)
// Cookie: auth_sid, HttpOnly, Secure, SameSite=Lax
// TTL: 1 jam
```

Alur:
1. Login sukses → set cookie `auth_sid`.
2. Request berikutnya ke `/oauth/authorize` → cek cookie, skip login page.
3. Logout dari auth (kalau ada) → hapus cookie.

#### 10.7.10 Kenapa HTML, bukan Vue

| Alasan | Penjelasan |
|---|---|
| Sederhana | Tidak perlu build step FE di auth-mock |
| Cepat | Langsung render, tidak ada SPA hydration |
| Mudah debug | Lihat HTML source langsung |
| Sesuai peran | Mock = referensi alur, bukan produk |
| Tidak menambah dependency | Cukup `ejs` atau `nunjucks` |

Auth asli nanti bisa pakai Vue, Next.js, atau apa pun. Yang penting kontrak OAuth2 sama.

### 10.8 Dockerfile

```dockerfile
# apps/auth-mock/Dockerfile
FROM node:20.19.0-alpine AS build
WORKDIR /app
COPY . .
RUN corepack enable && pnpm install --frozen-lockfile
RUN pnpm --filter auth-mock build

FROM node:20.19.0-alpine
WORKDIR /app
COPY --from=build /app/apps/auth-mock/dist ./dist
COPY --from=build /app/apps/auth-mock/views ./views
COPY --from=build /app/apps/auth-mock/public ./public
COPY --from=build /app/node_modules ./node_modules
EXPOSE 4001
CMD ["node", "dist/main.js"]
```

---

## 11. Frontend: Vue 3 + PrimeVue

### 11.1 Stack

Vue 3 (Composition API) + Vite + PrimeVue + `@primevue/themes` + `primeicons` + Pinia + Vue Router + Axios.

### 11.2 Struktur

```text
apps/frontend-vue/
├── src/
│   ├── api/
│   │   ├── axios.ts
│   │   └── auth.ts
│   ├── stores/
│   │   ├── auth.store.ts
│   │   └── menu.store.ts
│   ├── router/
│   │   ├── index.ts
│   │   └── guards.ts
│   ├── views/
│   │   ├── LoginRedirect.vue
│   │   ├── Callback.vue
│   │   ├── Dashboard.vue
│   │   ├── PaymentsList.vue
│   │   ├── PaymentDetail.vue
│   │   ├── Forbidden.vue
│   │   └── TooManyRequests.vue
│   ├── components/
│   │   └── AppMenu.vue
│   ├── App.vue
│   └── main.ts
├── index.html
├── vite.config.ts
└── tsconfig.json
```

### 11.3 Aturan

- **Tidak menyimpan token.**
- Semua request: `withCredentials: true`.
- Login: redirect ke `/auth/login` (BE payment).
- Setelah callback: `GET /auth/session`.
- Logout: `POST /auth/logout`, redirect ke login.
- 401 → `/auth/login`.
- 403 → `/forbidden`.
- 429 → `/too-many-requests`.

### 11.4 Axios interceptor

```ts
const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL,
  withCredentials: true,
});

api.interceptors.request.use((config) => {
  const csrf = getCookie('XSRF-TOKEN');
  if (csrf && config.method !== 'get') {
    config.headers['X-CSRF-Token'] = csrf;
  }
  return config;
});

api.interceptors.response.use(
  (res) => res,
  (err) => {
    if (err.response?.status === 401) window.location.href = '/auth/login';
    if (err.response?.status === 403) router.push('/forbidden');
    if (err.response?.status === 429) router.push('/too-many-requests');
    return Promise.reject(err);
  },
);
```

### 11.5 Route guard

```ts
router.beforeEach(async (to) => {
  if (to.meta.public) return true;

  const auth = useAuthStore();
  if (!auth.user) await auth.fetchSession();

  if (!auth.user) {
    window.location.href = '/auth/login';
    return false;
  }

  if (to.meta.menu && !auth.hasMenu(to.meta.menu)) {
    return { name: 'forbidden' };
  }

  return true;
});
```

### 11.6 Build & Production

- **Dev**: `pnpm --filter frontend-vue dev` → Vite dev server (port 5173).
- **Build**: `pnpm --filter frontend-vue build` → `dist/`.
- **Production**: `dist/` disajikan via Nginx atau `ServeStaticModule` di payment-api.
- **Vite tidak berjalan di production.**

---

## 12. Cookie, CSRF, Security Headers

### 12.1 Cookie sesi

```text
Set-Cookie: sid=<opaque>;
  HttpOnly;
  Secure;
  SameSite=Lax;
  Path=/;
  Max-Age=28800
```

Jika FE dan BE beda domain: `SameSite=None; Secure` + CORS credentials.

### 12.2 CORS

- Hanya origin FE Vue.
- `Access-Control-Allow-Credentials: true`.
- `Access-Control-Allow-Origin`: eksplisit.

### 12.3 CSRF

- Double-submit cookie: `XSRF-TOKEN` (cookie) + `X-CSRF-Token` (header).
- Dikecualikan: `GET`, `HEAD`, `OPTIONS`, `/auth/callback`.

### 12.4 Security headers (Helmet)

`Strict-Transport-Security`, `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy`, CSP, `Permissions-Policy`.

### 12.5 Rate limiting

- Auth: 10/menit/IP, 5/menit/username.
- BE payment: throttle `/auth/login` & `/auth/callback`.
- Response: `429` + `Retry-After`.
- FE: halaman khusus 429.

---

## 13. Observability

### 13.1 Logging

OAuth flow, session lifecycle, lazy sync, authorization deny, JWT verify failure. Redaction: token, refresh token, client secret, PII.

### 13.2 Metrics

| Metric | Type | Labels |
|---|---|---|
| `oauth_token_exchange_total` | counter | result |
| `oauth_refresh_total` | counter | result |
| `session_active` | gauge | none |
| `auth_sync_total` | counter | result, reason |
| `auth_sync_duration_seconds` | histogram | reason |
| `jwt_verify_total` | counter | result |
| `menu_access_denied_total` | counter | menu_code |

### 13.3 Tracing

Propagate `traceparent` FE → BE → auth. Span untuk OAuth callback, token exchange, lazy sync, guard.

---

## 14. Docker & Dev Workflow

### 14.1 Profile

```text
profile: sandbox  ->  postgres, payment-api, auth-mock, frontend-vue   (tanpa Redis/Jaeger)
profile: dev      ->  postgres, redis, payment-api, auth-mock, gateway-mock, frontend-vue, jaeger, prometheus, grafana
profile: full     ->  tambah auth-service (image repo auth)
```

### 14.2 Services

| Service | sandbox | dev | full |
|---|---|---|---|
| postgres | ✅ | ✅ | ✅ |
| redis | ❌ | ✅ | ✅ |
| payment-api | ✅ | ✅ | ✅ |
| payment-gateway-mock | ✅ | ✅ | ✅ |
| auth-mock | ✅ | ✅ | ✅ |
| auth-service | ❌ | ❌ | ✅ |
| frontend-vue | ✅ | ✅ | ✅ |
| prometheus | ❌ | ✅ | ✅ |
| grafana | ❌ | ✅ | ✅ |
| jaeger | ❌ | ✅ | ✅ |

### 14.3 Root scripts

```text
dev
dev:sandbox
build
test
test:e2e
lint
db:migrate
db:migrate:revert
docker:up
docker:up:sandbox
docker:down
frontend:vue:dev
frontend:vue:build
```
### 14.4 Env dev

```text
AUTH_MODE=mock
AUTH_BASE_URL=http://localhost:4001
AUTH_ISSUER=http://localhost:4001
JWT_AUDIENCE=payment-api
OAUTH_CLIENT_ID=payment-api
OAUTH_CLIENT_SECRET=dev-client-secret
OAUTH_REDIRECT_URI=http://localhost:3001/auth/callback
OAUTH_SCOPES=openid profile
SESSION_STORE=redis
```

### 14.5 Env sandbox

```text
AUTH_MODE=mock
AUTH_BASE_URL=http://localhost:4001
AUTH_ISSUER=http://localhost:4001
JWT_AUDIENCE=payment-api
OAUTH_CLIENT_ID=payment-api
OAUTH_CLIENT_SECRET=dev-client-secret
OAUTH_REDIRECT_URI=http://localhost:3001/auth/callback
OAUTH_SCOPES=openid profile
SESSION_STORE=memory
```

### 14.6 Env minimal (AUTH_MODE=disabled)

```text
AUTH_MODE=disabled
AUTH_DISABLED_USER_ID=00000000-0000-0000-0000-000000000001
AUTH_DISABLED_USERNAME=disabled-user
AUTH_DISABLED_ROLE_ID=00000000-0000-0000-0000-000000000002
AUTH_DISABLED_IS_SUPER_ADMIN=true
AUTH_DISABLED_PERMISSION_CODES=*
SESSION_STORE=memory
```

---

## 15. Configuration Philosophy

Prinsip: **env hanya untuk yang berubah antar environment.** Sisanya konstanta di kode.

### 15.1 Klasifikasi

| Kategori | Contoh | Tempat |
|---|---|---|
| Berubah antar env | host, secret, client_id, redirect_uri | Env |
| Fixed oleh spec (RFC) | `/oauth/token`, `/.well-known/jwks.json` | Konstanta kode |
| Fixed oleh kontrak | `/api/v1/me/permissions` | Konstanta kode |

### 15.2 Kenapa path OAuth2 tidak jadi env

- Path OAuth2 **ditetapkan oleh RFC**.
- Typo tidak terdeteksi compiler.
- Update 7 tempat saat host pindah. Rawan lupa.

### 15.3 Yang tetap perlu env

| Env | Kenapa perlu |
|---|---|
| `AUTH_BASE_URL` | Host beda per environment |
| `AUTH_ISSUER` | Klaim `iss` JWT |
| `JWT_AUDIENCE` | Beda per resource server |
| `OAUTH_CLIENT_ID` | Beda per client |
| `OAUTH_CLIENT_SECRET` | Secret |
| `OAUTH_REDIRECT_URI` | Beda per environment |
| `OAUTH_SCOPES` | Kadang beda |
| `SESSION_STORE` | redis (prod) / memory (sandbox) |

### 15.4 Evolusi ke OIDC discovery

Kalau auth punya `/.well-known/openid-configuration`, env bisa dipangkas:

```text
AUTH_ISSUER=http://localhost:4001
JWT_AUDIENCE=payment-api
OAUTH_CLIENT_ID=payment-api
OAUTH_CLIENT_SECRET=dev-client-secret
OAUTH_REDIRECT_URI=http://localhost:3001/auth/callback
```

`openid-client` v5:

```ts
const issuer = await Issuer.discover(process.env.AUTH_ISSUER);
const client = new issuer.Client({ client_id, client_secret });
```

### 15.5 Aturan praktis

1. **Jangan jadikan env apa yang tidak berubah.**
2. **Satu base URL** lebih baik dari tujuh URL terpisah.
3. **Discovery** lebih baik dari base URL manual, kalau tersedia.
4. **Secret selalu env.**

---

## 16. Configuration

```text
# Server
PORT=3001
NODE_ENV=development

# OAuth2
AUTH_MODE=oauth                       # oauth | mock | disabled
AUTH_BASE_URL=
AUTH_ISSUER=
JWT_AUDIENCE=payment-api
OAUTH_CLIENT_ID=payment-api
OAUTH_CLIENT_SECRET=
OAUTH_REDIRECT_URI=
OAUTH_SCOPES=openid profile

# AUTH_MODE=disabled
AUTH_DISABLED_USER_ID=
AUTH_DISABLED_USERNAME=
AUTH_DISABLED_ROLE_ID=
AUTH_DISABLED_IS_SUPER_ADMIN=
AUTH_DISABLED_PERMISSION_CODES=

# JWT
JWT_CLOCK_TOLERANCE_SEC=5
JWKS_CACHE_TTL_SEC=300

# Session
SESSION_STORE=redis                   # redis | memory
SESSION_SECRET=
SESSION_TTL_SEC=28800
SESSION_COOKIE_NAME=sid
SESSION_COOKIE_SAMESITE=Lax

# Lazy sync
SYNC_FRESH_TTL_MS=300000
SYNC_STALE_TTL_MS=1800000
SYNC_MAX_STALE_TTL_MS=7200000
SYNC_BLOCKING_TIMEOUT_MS=2000
SYNC_LOCK_TTL_SEC=10

# CORS
CORS_ORIGIN=http://localhost:5173

# Rate limit
RATE_LIMIT_LOGIN_PER_MIN=10

# CSRF
CSRF_ENABLED=true

# Database
DB_HOST=localhost
DB_PORT=5432
DB_USER=retry_failure
DB_PASS=retry_failure
DB_NAME=retry_failure

# Redis (hanya kalau SESSION_STORE=redis)
REDIS_URL=redis://localhost:6379

# FE Vue
VITE_API_URL=http://localhost:3001
```

**Bootstrap validation**:

```ts
// payment-api/src/main.ts
function validateConfig() {
  const { NODE_ENV, AUTH_MODE, SESSION_STORE } = process.env;

  if (NODE_ENV === 'production') {
    if (AUTH_MODE === 'mock')     throw new Error('AUTH_MODE=mock tidak boleh di production');
    if (AUTH_MODE === 'disabled') throw new Error('AUTH_MODE=disabled tidak boleh di production');
    if (SESSION_STORE === 'memory') throw new Error('SESSION_STORE=memory tidak boleh di production');
  }

  if (SESSION_STORE === 'redis' && !process.env.REDIS_URL) {
    throw new Error('REDIS_URL wajib diisi kalau SESSION_STORE=redis');
  }
}
```

---

## 17. Testing Strategy

### 17.1 Unit

- PKCE: verifier/challenge, S256.
- OAuth client: token exchange, refresh, revoke, switch-role.
- JWKS verifier: cache, rotation, invalid signature.
- Session guard: valid, expired, revoked.
- MenuAccessGuard: super admin, allowed, denied.
- Lazy sync middleware: fresh, stale (background), very stale (blocking), timeout, lock.
- SessionStore: Redis + Memory (parity test).
- `AUTH_MODE=disabled`: skip guard, user palsu, guard production.

### 17.2 Integration

- `/auth/login` → redirect dengan PKCE.
- `/auth/callback` → cookie, session dibuat.
- `/auth/session` → user.
- Protected: 401 tanpa cookie, 200 dengan cookie valid.
- Protected: 403 jika permission tidak dimiliki.
- Super admin: akses semua.
- Logout: session dihapus, token direvoke.
- Switch-role: session diupdate.

### 17.3 E2E lintas service

- Dengan `auth-mock`: full OAuth2 flow.
- Dengan auth asli (setelah OAuth2 server selesai): full OAuth2 flow.
- Skenario: single-role, multi-role, super admin, user tanpa akses.

### 17.4 FE Vue

- Redirect ke `/auth/login` saat belum login.
- Setelah callback, session terisi.
- Guard route: 403 halaman.
- 429 halaman.
- Logout menghapus session.

### 17.5 Contract test

JWT claims, JWKS, `/api/v1/me/permissions`, error format. Alarm saat auth update.

### 17.6 Sandbox test

- `SESSION_STORE=memory`: login, akses, logout — tanpa Redis.
- `AUTH_MODE=disabled`: akses tanpa login, semua endpoint berfungsi.

---

## 18. Versioning

### 18.1 Level 1 — Plan Version

SemVer. File: header `> **Version**: X.Y.Z`.

| Perubahan | Naik |
|---|---|
| Breaking change arsitektur | MAJOR |
| Fitur baru non-breaking | MINOR |
| Perbaikan / typo | PATCH |

### 18.2 Level 2 — AUTH_CONTRACT Version

File: `docs/plan2-auth-integration/AUTH_CONTRACT.md`.

| Perubahan di auth | Naik di contract |
|---|---|
| Hapus / rename endpoint | MAJOR |
| Ubah klaim JWT | MAJOR |
| Ubah format response breaking | MAJOR |
| Tambah endpoint baru | MINOR |
| Tambah klaim opsional | MINOR |
| Perbaikan dokumentasi | PATCH |

### 18.3 Level 3 — API Versioning

| Endpoint | Path |
|---|---|
| Authorize | `/oauth/authorize` |
| Token | `/oauth/token` |
| Revoke | `/oauth/revoke` |
| JWKS | `/.well-known/jwks.json` |
| Permissions | `/api/v1/me/permissions` |
| Switch role | `/api/v1/auth/switch-role` |

### 18.4 Level 4 — JWT Claims Versioning

Gunakan `iss` + `aud` sebagai namespace. Perubahan klaim = naik di AUTH_CONTRACT.

### 18.5 Level 5 — Auth Service Version

| Auth service | AUTH_CONTRACT didukung |
|---|---|
| 0.1.x | 1.0.x |
| 0.2.x | 1.1.x |
| 1.0.x | 2.0.x |

### 18.6 File yang Terlibat

| File | Versioning |
|---|---|
| `PLAN-Auth_Integration.md` | SemVer di header |
| `AUTH_CONTRACT.md` | SemVer di header |
| `CHANGELOG-AUTH.md` | Riwayat |
| `auth-openapi.json` | `info.version` |

### 18.7 Alur Update Kontrak

```text
1. Auth service rilis versi baru
2. Tim auth update AUTH_CONTRACT.md
3. Tim auth catat di CHANGELOG-AUTH.md
4. Tim auth publish auth-openapi.json baru
5. Payment-api tarik kontrak baru
6. Jalankan contract test
7. Lulus → selesai
8. Gagal → MINOR: update payment; MAJOR: koordinasi deploy
```

### 18.8 Deployment Order untuk Breaking Change

```text
1. Deploy auth versi baru (mendukung kontrak N dan N-1)
2. Tunggu stabil
3. Deploy payment-api versi baru (mendukung N dan N-1)
4. Setelah semua payment-api di versi baru:
   - Auth bisa hapus dukungan N-1
```

---

## 19. Urutan Implementasi

### 19.1 Fase 1 — Fondasi (Monorepo Retry)

1. **Kontrak OAuth2 & klaim JWT** — sepakati dengan tim auth.
2. **`apps/auth-mock`** — implementasi referensi OAuth2 + login page HTML.
3. **`packages/security`** — OAuth client, session, guard, cache, lazy sync, SessionStore (Redis + Memory).
4. **Migrasi DB payment** — `cached_users`, `sessions`, `payments.user_id`.
5. **Integrasi guard + middleware** di payment-api.
6. **Lazy sync** — middleware + lock + timeout.
7. **FE Vue** — redirect flow, session store, router guard, halaman 403/429.
8. **CSRF, security headers, rate limit**.
9. **Observability**.
10. **Docker profile** (sandbox + dev).
11. **Contract test + E2E** (mock).
12. **Dokumentasi** — `AUTH_CONTRACT.md`, `SANDBOX_NOTES.md`, `CHANGELOG-AUTH.md`.

### 19.2 Fase 2 — OAuth2 Server di Repo Auth (Paralel)

13. **Migrasi HS256 → RS256** + JWKS.
14. **Endpoint `/oauth/authorize`** + login page.
15. **Endpoint `/oauth/token`** (code + refresh).
16. **Endpoint `/oauth/revoke`**.
17. **PKCE support** (S256).
18. **Client registration**.
19. **Consent screen + pilih role**.
20. **Endpoint `/api/v1/me/permissions`**.
21. **Endpoint `/api/v1/auth/switch-role`**.
22. **Discovery endpoint** `/.well-known/openid-configuration`.
23. **Kolom `code` di menu**.
24. **Session store** di auth.
25. **Rate limiting** di auth.

### 19.3 Fase 3 — Integrasi Auth Asli

26. **Deploy auth OAuth2** ke staging.
27. **Contract test** payment-api ↔ auth asli.
28. **E2E lintas service** dengan auth asli.
29. **Migrasi bertahap**: dev pakai auth-mock, staging pakai auth asli.
30. **Dokumentasi**: update `AUTH_CONTRACT.md` + `CHANGELOG-AUTH.md`.

---

## 20. Definition of Done

### 20.1 Monorepo Retry (Fase 1)

- [ ] `apps/auth-mock` implementasi OAuth2 + PKCE lengkap (termasuk login page HTML).
- [ ] `packages/security` lengkap (termasuk `endpoints.ts` + `SessionStore` Redis & Memory).
- [ ] `AUTH_MODE=disabled` berfungsi: skip guard, user palsu dari env.
- [ ] Bootstrap menolak `mock`/`disabled`/`memory` di production.
- [ ] Tabel `cached_users` + `sessions` dibuat.
- [ ] Migrasi `payments.user_id`.
- [ ] Cookie sesi `HttpOnly; Secure; SameSite=Lax`.
- [ ] CSRF aktif.
- [ ] Security headers aktif.
- [ ] Rate limit login aktif.
- [ ] `MenuAccessGuard` bekerja.
- [ ] `LazySyncMiddleware` bekerja.
- [ ] Logout revoke token.
- [ ] Switch-role mengupdate session.
- [ ] FE Vue: redirect flow, session store, router guard.
- [ ] Halaman 403 & 429 di FE Vue.
- [ ] Menu dinamis dari `permissionCodes`.
- [ ] Contract test lulus (mock).
- [ ] E2E lulus (mock).
- [ ] Sandbox mode (`SESSION_STORE=memory`, tanpa Redis) berjalan.
- [ ] Observability: log, metrics, trace.
- [ ] Docker `sandbox` & `dev` profile berjalan.
- [ ] Dokumentasi: `AUTH_CONTRACT.md`, `CHANGELOG-AUTH.md`, `SANDBOX_NOTES.md`.

### 20.2 Repo Auth (Fase 2)

- [ ] Auth punya `/oauth/authorize`, `/oauth/token`, `/oauth/revoke`.
- [ ] Auth punya `/.well-known/jwks.json` + `/.well-known/openid-configuration`.
- [ ] Auth pakai RS256.
- [ ] Auth support PKCE (S256).
- [ ] Auth punya client registration.
- [ ] Auth punya consent screen + pilih role.
- [ ] Auth expose `/api/v1/me/permissions`, `/api/v1/auth/switch-role`.
- [ ] Auth punya kolom `code` di menu.
- [ ] JWT payload menyertakan `roleId`.
- [ ] Admin panel auth tetap berjalan.

### 20.3 Integrasi Penuh (Fase 3)

- [ ] `AUTH_MODE=oauth` dengan auth asli berhasil.
- [ ] Contract test payment-api ↔ auth asli lulus.
- [ ] E2E lintas service dengan auth asli lulus.
- [ ] Docker `full` profile berjalan.
- [ ] Deployment order terdokumentasi & diuji.

---

## 21. Production Caveats

### 21.1 Auth down

- Lazy sync: pakai cache sampai `STALE_TTL` (30 menit).
- Setelah itu: blocking sync; kalau gagal, tetap pakai cache dengan warning.
- Batas `MAX_STALE_TTL` (2 jam) → sesi invalid.

### 21.2 Key rotation

- JWKS multiple `kid`.
- Payment-api refresh JWKS saat `kid` baru.

### 21.3 Session store

- Redis wajib di production.
- Redis down → sesi hilang → login ulang.
- Persistence + replica.

### 21.4 Refresh token bocor

- Rotation tiap pakai.
- Reuse detection → revoke semua sesi user.

### 21.5 Client secret bocor

- Rotasi dual-secret.

### 21.6 Deployment order

- Auth dulu, payment-api kemudian.

### 21.7 Menu code

- Kalau auth belum punya `code`, pakai `url` sebagai fallback.

### 21.8 PII

- Redaction di log & trace.

### 21.9 Cleanup sesi expired

- Scheduled job harian untuk `SESSION_STORE=postgres`.
- Memory store: LRU TTL.

### 21.10 Versioning drift

- Jangan skip contract test di CI.

### 21.11 Transisi auth-mock → auth asli

- Contract test dijalankan terhadap **keduanya**.

### 21.12 Memory store di sandbox

- `SESSION_STORE=memory` **hanya** untuk sandbox/dev.
- Bootstrap menolak di production.
- Hilang saat restart. Single-instance.

### 21.13 `AUTH_MODE=disabled`

- **Hanya** untuk unit test & sandbox.
- Bootstrap menolak di production.
- Semua guard di-skip. Tidak ada otorisasi.
- Jangan pernah dipakai di staging yang bisa diakses publik.

---

## 22. Referensi

- Plan 1: `docs/plan1-cockatiel-retry-failure-scenario/PLAN1_Cockatiel_Retry_Failure_Scenario.md`
- Plan 2 (index): `docs/plan2-auth-integration/README.md`
- Auth OpenAPI: `docs/plan2-auth-integration/auth-openapi.json`
- Auth contract: `docs/plan2-auth-integration/AUTH_CONTRACT.md`
- Changelog auth: `docs/plan2-auth-integration/CHANGELOG-AUTH.md`
- Sandbox notes: `docs/SANDBOX_NOTES.md`
- RFC 6749 — OAuth 2.0
- RFC 7009 — Token Revocation
- RFC 7636 — PKCE
- RFC 9700 — OAuth 2.0 Security BCP
- RFC 7517 — JWK
- RFC 8725 — JWT BCP
- OIDC Discovery 1.0
- OWASP ASVS
- SemVer — https://semver.org

---

## 23. Decision Log

| # | Keputusan | Alasan |
|---|---|---|
| 1 | BFF pattern | Token tidak menyentuh browser |
| 2 | PKCE S256 | RFC 9700 |
| 3 | RS256 + JWKS | Payment-api tidak bisa forge token |
| 4 | JWT tipis + `roleId` | `roleId` properti sesi |
| 5 | Cache 2 tabel | `cached_users` + `sessions` |
| 6 | Lazy sync (SWR) | Beban auth terkontrol |
| 7 | Middleware untuk sync | Cross-cutting |
| 8 | Lock + timeout di lazy sync | Cegah race & blocking |
| 9 | Cookie HttpOnly + CSRF | Aman dari XSS |
| 10 | Refresh rotation | Mitigasi theft |
| 11 | Dual-secret rotation | Zero-downtime |
| 12 | `auth-mock` sebagai referensi | Standar bertahap |
| 13 | Webhook opsional | Bisa ditambah nanti |
| 14 | Vue-only FE | Satu FE |
| 15 | Versioning 4 level | Independen |
| 16 | Folder per-plan | `docs/plan<N>-<slug>/` |
| 17 | Konfigurasi minimal | Env hanya untuk yang berubah |
| 18 | Auth asli jadi OAuth2 Server | Standar, SSO-ready |
| 19 | Transisi bertahap: auth-mock dulu | Payment tidak terblokir |
| 20 | **`SESSION_STORE=memory` untuk sandbox** | Bisa jalan tanpa Redis |
| 21 | **`AUTH_MODE=disabled` skip guard** | Unit test & sandbox |
| 22 | **`openid-client` v5** | Stabil; v6 ESM-only, dokumentasi minim |
| 23 | **`auth-mock` login UI: HTML server-rendered** | Mock harus sesederhana mungkin |

---

## 24. Ringkasan

```text
FASE 1 (sekarang)
DEV/SANDBOX
  FE Vue  --cookie-->  BE payment (BFF)  --OAuth2-->  auth-mock (HTML login)
                              |
                              +--> cached_users
                              +--> sessions (permission_codes jsonb)
                              +--> lazy sync (SWR)
                              +--> SessionStore: Redis (dev) / memory (sandbox)

FASE 2 (auth asli siap)
PROD
  FE Vue  --cookie-->  BE payment (BFF)  --OAuth2-->  auth-service (OAuth2 AS)
                              |
                              +--> cached_users
                              +--> sessions (permission_codes jsonb)
                              +--> lazy sync (SWR)
                              +--> JWKS verify
                              +--> SessionStore: Redis
```

- Frontend hanya Vue 3 + PrimeVue.
- Browser hanya pegang cookie.
- JWT tipis + `roleId`, verifikasi via JWKS.
- Otorisasi dari permission snapshot di session.
- Lazy sync (SWR) menggantikan background refresh.
- OAuth 2.0 + PKCE sesuai standar keamanan terkini.
- Versioning 4 level.
- Konfigurasi minimal.
- **Sandbox-friendly**: `SESSION_STORE=memory`, `AUTH_MODE=disabled`.
- **`openid-client` v5** untuk stabilitas.
- **`auth-mock` login UI**: HTML server-rendered.

---

## 25. Roadmap OAuth2 Server di Repo Auth

### 25.1 Kondisi Saat Ini

| Aspek | Kondisi |
|---|---|
| Framework | NestJS 11 |
| Database | PostgreSQL |
| ORM | TypeORM 0.3.x |
| Signing | HS256 |
| Login | `POST /api/auth/login` (custom) |
| Multi-role | `POST /api/auth/select-role` (custom) |
| Logout | Stateless |
| Admin panel | ✅ |
| JWKS | ❌ |
| OAuth2 endpoints | ❌ |
| Discovery | ❌ |
| PKCE | ❌ |
| Client registration | ❌ |

**Ini bukan OAuth2 Server.** Ini aplikasi auth custom dengan JWT.

### 25.2 Target Arsitektur

```text
┌──────────────────────────────────────────────────────────────┐
│  Repo Auth (target: OAuth2 Authorization Server)             │
│                                                               │
│  ┌──────────────────┐  ┌──────────────────┐                 │
│  │ OAuth2 Endpoints │  │ OIDC Endpoints   │                 │
│  │ - /oauth/authorize│  │ - /.well-known/  │                 │
│  │ - /oauth/token    │  │     openid-      │                 │
│  │ - /oauth/revoke   │  │     configuration│                 │
│  │                   │  │ - /.well-known/  │                 │
│  │                   │  │     jwks.json    │                 │
│  │                   │  │ - /oauth/userinfo│                 │
│  └──────────────────┘  └──────────────────┘                 │
│                                                               │
│  ┌──────────────────┐  ┌──────────────────┐                 │
│  │ Admin Panel      │  │ Login & Consent  │                 │
│  │ - /api/users     │  │ - login page     │                 │
│  │ - /api/roles     │  │ - consent screen │                 │
│  │ - /api/menus     │  │ - pilih role     │                 │
│  └──────────────────┘  └──────────────────┘                 │
│                                                               │
│  ┌──────────────────┐  ┌──────────────────┐                 │
│  │ Internal API     │  │ Session Store    │                 │
│  │ - /api/v1/me/    │  │ (Redis)          │                 │
│  │     permissions  │  │                  │                 │
│  │ - /api/v1/auth/  │  │                  │                 │
│  │     switch-role  │  │                  │                 │
│  └──────────────────┘  └──────────────────┘                 │
│                                                               │
│  ┌──────────────────────────────────────────┐               │
│  │ Key Management (RS256 + JWKS)             │               │
│  └──────────────────────────────────────────┘               │
└──────────────────────────────────────────────────────────────┘
```

### 25.3 Yang Harus Dibangun

#### A. Migrasi HS256 → RS256
- Generate keypair (RSA 2048 atau EC P-256).
- Simpan private key (secret manager / file ketat).
- Expose public key via `/.well-known/jwks.json`.
- `kid` support.
- Rotasi dual-key period.

#### B. Endpoint OAuth2

| Endpoint | Fungsi |
|---|---|
| `GET /oauth/authorize` | Tampilkan login/consent, kembalikan `code` |
| `POST /oauth/token` | Tukar `code`, refresh |
| `POST /oauth/revoke` | Cabut token |

#### C. PKCE
- Simpan `code_challenge` saat authorize.
- Verifikasi `code_verifier` saat token exchange.
- Support `S256`.

#### D. Client Registration
- Tabel `oauth_clients`.
- Registrasi manual / UI.
- Rotasi secret dual-secret.

#### E. Login & Consent
- Login page (HTML atau Vue).
- Consent screen (opsional).
- Pilih role (multi-role).

#### F. Session di Auth
- Cookie `HttpOnly` di domain auth.
- Session store (Redis).
- Terpisah dari token.

#### G. Endpoint Internal (Sync)

| Endpoint | Fungsi |
|---|---|
| `GET /api/v1/me/permissions` | User + role + permission codes |
| `POST /api/v1/auth/switch-role` | Ganti role aktif |

#### H. Discovery

```json
{
  "issuer": "https://auth.example.com",
  "authorization_endpoint": "https://auth.example.com/oauth/authorize",
  "token_endpoint": "https://auth.example.com/oauth/token",
  "revocation_endpoint": "https://auth.example.com/oauth/revoke",
  "jwks_uri": "https://auth.example.com/.well-known/jwks.json",
  "response_types_supported": ["code"],
  "grant_types_supported": ["authorization_code", "refresh_token"],
  "code_challenge_methods_supported": ["S256"],
  "scopes_supported": ["openid", "profile", "payment.read", "payment.write"],
  "token_endpoint_auth_methods_supported": ["client_secret_post", "client_secret_basic"]
}
```

#### I. Menu Code
```sql
ALTER TABLE menus ADD COLUMN code varchar(64) UNIQUE;
```

#### J. Rate Limiting
- Login: 10/menit/IP, 5/menit/username.
- Token: 20/menit/client.

#### K. Observability
- Log penerbitan token, revoke, login.
- Metrics.
- Trace.

### 25.4 Referensi Implementasi

`apps/auth-mock` adalah **referensi implementasi**. Auth asli bisa:
1. Melihat kode `auth-mock`.
2. Mengikuti kontrak yang sama.
3. Menjalankan contract test yang sama.

### 25.5 Library yang Bisa Dipakai di Auth

| Kategori | Package | Fungsi |
|---|---|---|
| OAuth2 Server | `@node-oauth/oauth2-server` | Implementasi OAuth2 server |
| JWT / JWKS | `jose` (v5) | Sign RS256, expose JWKS |
| Session | `ioredis` | Session store |
| Template | `ejs` / `nunjucks` | Login page |
| Cookie | `cookie-parser` | Cookie parsing |
| Rate Limit | `@nestjs/throttler` | Throttle |
| Validation | `class-validator`, `class-transformer` | DTO |

### 25.6 Urutan Pembangunan di Auth

1. Migrasi HS256 → RS256 + JWKS.
2. Tabel `oauth_clients` + registrasi.
3. Session store di auth.
4. Login & consent page.
5. `/oauth/authorize`.
6. `/oauth/token`.
7. PKCE support.
8. `/oauth/revoke`.
9. `/api/v1/me/permissions`.
10. `/api/v1/auth/switch-role`.
11. Kolom `code` di menu.
12. Discovery endpoint.
13. Rate limiting.
14. Observability.

### 25.7 Contract Test

Setiap auth update, jalankan contract test terhadap payment-api:
- JWT claims.
- JWKS.
- `/api/v1/me/permissions`.
- OAuth2 flow.
- Error format.

### 25.8 Kompatibilitas dengan auth-mock

`auth-mock` dan auth asli **harus**:
- Kontrak sama.
- JWT klaim sama.
- Path sama.
- Error format sama.

Perbedaan **diperbolehkan**: implementasi internal, skala, fitur tambahan.

### 25.9 Migrasi Bertahap

```text
Tahap 1: auth-mock OAuth2 lengkap, payment pakai auth-mock
Tahap 2: auth asli OAuth2 (paralel), contract test ke keduanya
Tahap 3: staging pakai auth asli, dev tetap auth-mock
Tahap 4: production pakai auth asli, auth-mock untuk dev & E2E
```

### 25.10 Risiko & Mitigasi

| Risiko | Mitigasi |
|---|---|
| Auth drift dari kontrak | Contract test di CI |
| Auth belum siap | auth-mock sebagai fallback |
| Migrasi HS256 → RS256 memecah klien | Dual-key period |
| Session store down | Redis cluster + replica |
| Consent screen tidak selesai | Pakai halaman minimal dulu |

---
