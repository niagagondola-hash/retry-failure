# PLAN 2 — Auth Integration (OAuth 2.0 + PKCE + BFF + Lazy Sync)

> **File**: `docs/plan2-auth-integration/PLAN-Auth_Integration.md`
> **Version**: 1.2.0
> **Status**: FINAL
> **Created**: 2026-09-20
> **Last updated**: 2026-09-24
> **Baseline**: `docs/plan1-cockatiel-retry-failure-scenario/PLAN1_Cockatiel_Retry_Failure_Scenario.md`
> **Frontend**: Vue 3 + PrimeVue

## Changelog

| Version | Tanggal | Perubahan |
|---|---|---|
| 1.2.0 | 2026-09-24 | Tambah Section 25: Roadmap OAuth2 Server di repo auth. Update Section 1, 19, 20 untuk mencakup pekerjaan di repo auth. |
| 1.1.0 | 2026-09-24 | Simplifikasi konfigurasi: `AUTH_BASE_URL` + konstanta path; hapus env URL per-endpoint; tambah "Configuration Philosophy". |
| 1.0.0 | 2026-09-23 | Final. Struktur folder per-plan, versioning 4 level. |
| 0.4.0 | 2026-09-20 | Vue-only frontend. |
| 0.3.0 | 2026-09-20 | OAuth2 + PKCE + BFF, JWT tipis + `roleId`, lazy sync (SWR), cache 2 tabel. |
| 0.2.0 | 2026-09-19 | Menyesuaikan kontrak auth aktual (HS256, stateless, two-step login). |
| 0.1.0 | 2026-09-19 | Draft awal integrasi auth eksternal. |

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
│  - /api/menus/*     │         │   └─ session store (Redis)         │
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
| OAuth2 Client | `openid-client` (v6) | Authorization Code + PKCE, token exchange, refresh, revoke |
| JWT / JWKS | `jose` (v5) | Verifikasi RS256 + JWKS (`createRemoteJWKSet`) |
| Session Store | `ioredis` | Redis client |
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

**`apps/auth-mock` (OAuth2 reference — sudah OAuth2 penuh)**

| Package | Fungsi |
|---|---|
| `@nestjs/common`, `@nestjs/core` (v11) | Framework |
| `jose` (v5) | Sign RS256 + expose JWKS + verify |
| `uuid` | Generate `jti`, `code`, `sid` |
| `class-validator`, `class-transformer` | DTO |
| `@nestjs/throttler` | Rate limit login |
| `ioredis` | Session + authorization code store |

**Repo auth (target: OAuth2 Server)** — lihat Section 25 untuk detail.

**Frontend (`apps/frontend-vue`)**

| Package | Fungsi |
|---|---|
| `vue` (v3.5+) | Framework |
| `vite` (v6) | Build tool (dev + build, tidak di production) |
| `vue-router` (v4) | Routing + guard |
| `pinia` (v3) | State management |
| `primevue` (v4) + `@primevue/themes` | UI components |
| `primeicons` | Icon |
| `axios` | HTTP client + interceptor |
| `typescript` (v5.8+) | Type safety |
| `vue-tsc` | Type check |

**Infrastruktur**

| Komponen | Image / Versi |
|---|---|
| Node.js | `20.19.0` (pin) |
| PostgreSQL | `16` |
| Redis | `7-alpine` |
| Nginx | `alpine` (production FE) |
| Jaeger | `1.x` (all-in-one) |
| Prometheus | `v2.x` |
| Grafana | `v11.x` |
| Docker Compose | `v2` |

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
├── pnpm-workspace.yaml
├── tsconfig.base.json
├── .env.example
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

Rekomendasi produksi: **Redis**. Alternatif: tabel `sessions` di PostgreSQL. Dev: memory.

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

**Alasan `roleId` masuk JWT**: properti sesi, ukuran tetap (UUID 36 byte), dibutuhkan untuk lookup permission di cache.

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

Index:
- `idx_sessions_user_id`
- `idx_sessions_last_sync_at`
- `idx_sessions_refresh_expires_at` (untuk cleanup)

### 7.3 `payments` (perubahan)

- Tambah `user_id uuid` FK → `cached_users.user_id`.
- Backfill (nullable), lalu `NOT NULL`.
- `ON DELETE SET NULL`.
- Index `idx_payments_user_id`.

### 7.4 Kenapa hanya 2 tabel

- **`cached_users`**: info user stabil, lintas sesi.
- **`sessions`**: permission snapshot saat login. Ganti role = replace snapshot.

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

Validasi signature, update `cached_users`, invalidate sesi terkait.

### 8.6 Skenario user delete / rename

- **Rename**: webhook atau lazy sync update `cached_users.name`.
- **Delete**: webhook hapus row `cached_users`, set `payments.user_id = NULL`, revoke sesi.
- **Tanpa webhook**: scheduled job harian deteksi delete.

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
│   │   ├── endpoints.ts             # konstanta path (fixed)
│   │   ├── oauth-client.service.ts
│   │   ├── oauth.controller.ts
│   │   └── session.service.ts
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

Pemakaian:

```ts
const base = process.env.AUTH_BASE_URL;
const tokenUrl = `${base}${OAUTH_PATHS.token}`;
```

Path-path ini **fixed** oleh RFC (OAuth2) atau kontrak (internal), bukan konfigurasi.

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

### 9.3 `AUTH_MODE`

| Mode | Deskripsi |
|---|---|
| `oauth` | OAuth2 + PKCE + JWKS (produksi / staging) |
| `mock` | Pakai `apps/auth-mock` (dev) |
| `disabled` | Skip (unit test) |

`AUTH_MODE=mock` menolak start jika `NODE_ENV=production`.

---

## 10. `apps/auth-mock` (OAuth2 Reference)

### 10.1 Scope

`auth-mock` adalah **implementasi referensi OAuth2 lengkap**. Auth asli akan mengikuti standar yang sama.

| Endpoint | Fungsi |
|---|---|
| `GET /oauth/authorize` | Authorization endpoint |
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
- `redirect_uri`: `http://localhost:3000/auth/callback`
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
    "role": {
      "id": "role-uuid",
      "name": "HRD"
    },
    "permissionCodes": [
      "dashboard",
      "payment.read",
      "payment.write"
    ]
  }
}
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
- **Production**: `dist/` disajikan via Nginx (container) atau `ServeStaticModule` di payment-api.
- **Vite tidak berjalan di production.** `import.meta.env.VITE_*` di-substitute saat build.

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
profile: dev   ->  postgres, redis, payment-api, auth-mock, gateway-mock, frontend-vue, jaeger, prometheus, grafana
profile: full  ->  tambah auth-service (image repo auth)
```

### 14.2 Services

```text
postgres
redis
payment-api
payment-gateway-mock
auth-mock
frontend-vue
prometheus
grafana
jaeger
```

### 14.3 Root scripts

```text
dev
build
test
test:e2e
lint
db:migrate
db:migrate:revert
docker:up
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
OAUTH_REDIRECT_URI=http://localhost:3000/auth/callback
OAUTH_SCOPES=openid profile
```

Path OAuth2 (`/oauth/token`, dll) **tidak** jadi env. Lihat Section 9.1 (`endpoints.ts`).

---

## 15. Configuration Philosophy

Prinsip: **env hanya untuk yang berubah antar environment.** Sisanya konstanta di kode.

### 15.1 Klasifikasi

| Kategori | Contoh | Tempat | Alasan |
|---|---|---|---|
| Berubah antar env | host, secret, client_id, redirect_uri | Env | Beda dev/staging/prod |
| Fixed oleh spec (RFC) | `/oauth/token`, `/.well-known/jwks.json` | Konstanta kode | Tidak akan berubah |
| Fixed oleh kontrak | `/api/v1/me/permissions` | Konstanta kode | Bagian dari kesepakatan |

### 15.2 Kenapa path OAuth2 tidak jadi env

- Path `/oauth/authorize`, `/oauth/token`, `/oauth/revoke`, `/.well-known/jwks.json` **ditetapkan oleh RFC 6749 / RFC 7009 / RFC 7517**. Tidak ada alasan untuk mengubahnya.
- Kalau dijadikan env, ada risiko typo yang tidak terdeteksi compiler.
- Kalau dijadikan env, kamu harus update 7 tempat saat host pindah. Rawan lupa.

### 15.3 Yang tetap perlu env

| Env | Kenapa perlu |
|---|---|
| `AUTH_BASE_URL` | Host beda per environment |
| `AUTH_ISSUER` | Klaim `iss` JWT — kadang beda dari base URL |
| `JWT_AUDIENCE` | Beda per resource server |
| `OAUTH_CLIENT_ID` | Beda per client |
| `OAUTH_CLIENT_SECRET` | Secret, beda per environment |
| `OAUTH_REDIRECT_URI` | Beda per environment |
| `OAUTH_SCOPES` | Kadang beda |

Kalau `AUTH_ISSUER` sama dengan `AUTH_BASE_URL`, bisa disatukan.

### 15.4 Evolusi ke OIDC discovery

Kalau auth punya `/.well-known/openid-configuration`, env bisa dipangkas lagi:

```text
AUTH_ISSUER=http://localhost:4001
JWT_AUDIENCE=payment-api
OAUTH_CLIENT_ID=payment-api
OAUTH_CLIENT_SECRET=dev-client-secret
OAUTH_REDIRECT_URI=http://localhost:3000/auth/callback
```

`openid-client` auto-fetch semua URL dari discovery:

```ts
const issuer = await Issuer.discover(process.env.AUTH_ISSUER);
const client = new issuer.Client({ client_id, client_secret });
// client.authorizationUrl(), client.tokenUrl(), client.jwksUri
```

**Lima env.** Ini paling standar OAuth2/OIDC. Butuh auth punya discovery endpoint; `auth-mock` sudah menyediakan, auth asli menyusul (Section 25).

### 15.5 Aturan praktis

1. **Jangan jadikan env apa yang tidak berubah.** Path fixed → konstanta.
2. **Satu base URL** lebih baik dari tujuh URL terpisah.
3. **Discovery** lebih baik dari base URL manual, kalau tersedia.
4. **Secret selalu env.** Jangan pernah commit.

---

## 16. Configuration

```text
# Server
PORT=3000
NODE_ENV=development

# OAuth2
AUTH_MODE=oauth
AUTH_BASE_URL=
AUTH_ISSUER=
JWT_AUDIENCE=payment-api
OAUTH_CLIENT_ID=payment-api
OAUTH_CLIENT_SECRET=
OAUTH_REDIRECT_URI=
OAUTH_SCOPES=openid profile

# JWT
JWT_CLOCK_TOLERANCE_SEC=5
JWKS_CACHE_TTL_SEC=300

# Session
SESSION_STORE=redis
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

# Redis
REDIS_URL=redis://localhost:6379

# FE Vue
VITE_API_URL=http://localhost:3000
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
- CSRF middleware.

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

---

## 18. Versioning

Versioning berlaku di **empat level**. Masing-masing independen.

### 18.1 Level 1 — Plan Version

Plan ini menggunakan **SemVer** (`MAJOR.MINOR.PATCH`):

| Perubahan | Contoh | Naik |
|---|---|---|
| Breaking change arsitektur | Ganti BFF jadi non-BFF | MAJOR |
| Fitur baru non-breaking | Tambah webhook | MINOR |
| Perbaikan / typo / klarifikasi | Perbaiki path | PATCH |

- File: header `> **Version**: X.Y.Z`
- Changelog: di atas file ini.

### 18.2 Level 2 — AUTH_CONTRACT Version

Kontrak auth punya versioning sendiri, **independen dari plan**.

File: `docs/plan2-auth-integration/AUTH_CONTRACT.md`

```markdown
# AUTH CONTRACT
> **Version**: 1.0.0
> **Auth service version**: 0.1.0
> **Effective**: 2026-09-20
```

| Perubahan di auth | Naik di contract |
|---|---|
| Hapus / rename endpoint | MAJOR |
| Ubah klaim JWT (hapus / rename) | MAJOR |
| Ubah format response breaking | MAJOR |
| Tambah endpoint baru | MINOR |
| Tambah klaim JWT opsional | MINOR |
| Tambah field opsional di response | MINOR |
| Perbaikan dokumentasi | PATCH |

Setiap perubahan kontrak wajib:

1. Update `AUTH_CONTRACT.md`.
2. Catat di `CHANGELOG-AUTH.md`.
3. Jalankan contract test di repo payment.
4. Kalau MAJOR: koordinasi deployment order.

### 18.3 Level 3 — API Versioning (OAuth2 endpoints)

| Endpoint | Path |
|---|---|
| Authorize | `/oauth/authorize` |
| Token | `/oauth/token` |
| Revoke | `/oauth/revoke` |
| JWKS | `/.well-known/jwks.json` |
| Permissions | `/api/v1/me/permissions` |
| Switch role | `/api/v1/auth/switch-role` |

Aturan:

- Endpoint OAuth2 mengikuti **RFC 6749** (tidak ber-version, karena spec stabil).
- Endpoint internal auth (`/api/...`) memakai prefix `/v1`, `/v2` bila breaking.
- JWKS **tidak ber-version** (spec stabil), tapi `kid` dirotasi.
- Backward compatibility: minimal 1 siklus rilis sebelum hapus versi lama.

### 18.4 Level 4 — JWT Claims Versioning

Klaim JWT punya versioning implisit:

- Gunakan `iss` + `aud` sebagai namespace.
- Perubahan klaim = naik di AUTH_CONTRACT.
- Perubahan klaim **wajib** dikoordinasikan.

Contoh evolusi:

| Version | Klaim ditambahkan | Breaking? |
|---|---|---|
| 1.0.0 | `sub`, `username`, `roleId`, `iss`, `aud`, `exp`, `iat`, `jti` | — |
| 1.1.0 | + `email` (opsional) | Tidak |
| 2.0.0 | Ganti `username` → `preferred_username` | Ya |

### 18.5 Level 5 — Auth Service Version

Auth service punya versioning sendiri (semver). Dikaitkan dengan AUTH_CONTRACT:

| Auth service | AUTH_CONTRACT didukung |
|---|---|
| 0.1.x | 1.0.x |
| 0.2.x | 1.1.x |
| 1.0.x | 2.0.x |

Payment-api mendukung **rentang** versi kontrak, bukan satu versi.

### 18.6 File yang Terlibat

| File | Versioning |
|---|---|
| `PLAN-Auth_Integration.md` | SemVer di header |
| `AUTH_CONTRACT.md` | SemVer di header |
| `CHANGELOG-AUTH.md` | Riwayat semua versi kontrak |
| `auth-openapi.json` | Version di `info.version` |

### 18.7 Alur Update Kontrak

```text
1. Auth service rilis versi baru
2. Tim auth update AUTH_CONTRACT.md (naik version)
3. Tim auth catat di CHANGELOG-AUTH.md
4. Tim auth publish auth-openapi.json baru
5. Payment-api tarik kontrak baru
6. Jalankan contract test
7. Kalau lulus: selesai
8. Kalau gagal:
     - Kalau MINOR: update payment-api
     - Kalau MAJOR: koordinasi deployment order
```

### 18.8 Deployment Order untuk Breaking Change

```text
1. Deploy auth versi baru (mendukung kontrak N dan N-1)
2. Tunggu stabil
3. Deploy payment-api versi baru (mendukung N dan N-1)
4. Setelah semua payment-api di versi baru:
   - Auth bisa hapus dukungan N-1
   - Atau biarkan untuk rollback safety
```

---

## 19. Urutan Implementasi

### 19.1 Fase 1 — Fondasi (Monorepo Retry)

1. **Kontrak OAuth2 & klaim JWT** — sepakati dengan tim auth (termasuk `roleId`).
2. **`apps/auth-mock`** — implementasi referensi OAuth2 lengkap.
3. **`packages/security`** — OAuth client, session, guard, cache, lazy sync middleware.
4. **Migrasi DB payment** — `cached_users`, `sessions` (dengan `permission_codes`), `payments.user_id`.
5. **Integrasi guard + middleware** di payment-api.
6. **Lazy sync** — middleware + lock + timeout.
7. **FE Vue** — redirect flow, session store, router guard, halaman 403/429.
8. **CSRF, security headers, rate limit**.
9. **Observability**.
10. **Docker profile** (dev dengan auth-mock).
11. **Contract test + E2E** (mock).
12. **Dokumentasi** — `docs/plan2-auth-integration/AUTH_CONTRACT.md`, `docs/SANDBOX_NOTES.md`, `docs/plan2-auth-integration/CHANGELOG-AUTH.md`.

### 19.2 Fase 2 — OAuth2 Server di Repo Auth (Paralel)

Detail teknis di **Section 25**. Ringkas:

13. **Migrasi HS256 → RS256** di auth + expose JWKS.
14. **Endpoint `/oauth/authorize`** di auth.
15. **Endpoint `/oauth/token`** (code + refresh) di auth.
16. **Endpoint `/oauth/revoke`** di auth.
17. **PKCE support** (S256) di auth.
18. **Client registration** di auth.
19. **Consent screen + pilih role** di auth.
20. **Endpoint `/api/v1/me/permissions`** di auth.
21. **Endpoint `/api/v1/auth/switch-role`** di auth.
22. **Discovery endpoint** `/.well-known/openid-configuration` di auth.
23. **Kolom `code` di menu** auth.
24. **Session store** di auth (Redis) untuk interaksi user dengan AS.
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

- [ ] `apps/auth-mock` implementasi OAuth2 + PKCE lengkap.
- [ ] `packages/security` lengkap (termasuk `endpoints.ts`).
- [ ] Tabel `cached_users` + `sessions` (dengan `permission_codes`) dibuat.
- [ ] Migrasi `payments.user_id`.
- [ ] Cookie sesi `HttpOnly; Secure; SameSite=Lax`.
- [ ] CSRF aktif.
- [ ] Security headers aktif.
- [ ] Rate limit login aktif.
- [ ] `MenuAccessGuard` bekerja (super admin bypass, permission-based).
- [ ] `LazySyncMiddleware` bekerja (fresh, stale background, very stale blocking, timeout, lock).
- [ ] Logout revoke token.
- [ ] Switch-role mengupdate session.
- [ ] FE Vue: redirect flow, session store, router guard.
- [ ] Halaman 403 & 429 di FE Vue.
- [ ] Menu dinamis dari `permissionCodes`.
- [ ] Contract test lulus (mock).
- [ ] E2E lulus (mock).
- [ ] Observability: log, metrics, trace.
- [ ] Docker `dev` profile berjalan.
- [ ] Konfigurasi mengikuti "Configuration Philosophy" (Section 15).
- [ ] Dokumentasi: `AUTH_CONTRACT.md`, `CHANGELOG-AUTH.md`, `SANDBOX_NOTES.md`.
- [ ] Versioning terdokumentasi di semua file.

### 20.2 Repo Auth (Fase 2)

- [ ] Auth punya `/oauth/authorize`.
- [ ] Auth punya `/oauth/token` (code + refresh).
- [ ] Auth punya `/oauth/revoke`.
- [ ] Auth punya `/.well-known/jwks.json`.
- [ ] Auth punya `/.well-known/openid-configuration`.
- [ ] Auth pakai RS256 (bukan HS256).
- [ ] Auth support PKCE (S256).
- [ ] Auth punya client registration.
- [ ] Auth punya consent screen + pilih role.
- [ ] Auth expose `/api/v1/me/permissions`.
- [ ] Auth expose `/api/v1/auth/switch-role`.
- [ ] Auth punya kolom `code` di menu.
- [ ] JWT payload menyertakan `roleId`.
- [ ] Auth punya session store (Redis) untuk interaksi user.
- [ ] Auth punya rate limiting di login & token.
- [ ] Admin panel auth tetap berjalan (user/role/menu CRUD).

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
- Contract test cover rotasi.

### 21.3 Session store

- Redis wajib di produksi (baik di payment-api maupun di auth).
- Redis down → sesi hilang → login ulang.
- Persistence + replica.

### 21.4 Refresh token bocor

- Rotation tiap pakai.
- Reuse detection → revoke semua sesi user.
- Log `refresh_reuse_detected`.

### 21.5 Client secret bocor

- Rotasi dual-secret.
- Auth terima dua secret selama periode rotasi.
- Alert jika ada percobaan dengan secret lama.

### 21.6 Deployment order

- Auth dulu (endpoint baru, backward compatible).
- Payment-api kemudian.
- Rollback: payment-api fallback ke mode lama sementara.

### 21.7 Menu code

- Jika auth belum punya `code`, pakai `url` sebagai fallback.
- Migrasi ke `code` tanpa breaking.

### 21.8 PII

- Redaction di log & trace.
- Cookie tidak mengandung PII.
- Session store terenkripsi at rest.

### 21.9 Cleanup sesi expired

- Scheduled job harian: hapus sesi dengan `refresh_expires_at < now()`.
- Jangan andalkan Redis TTL saja (kalau pakai Postgres).

### 21.10 Versioning drift

- Kalau auth dan payment pakai versi kontrak berbeda, contract test gagal.
- Jangan skip contract test di CI.

### 21.11 Transisi auth-mock → auth asli

- `auth-mock` dan auth asli **harus** mengikuti kontrak yang sama.
- Contract test dijalankan terhadap **keduanya**.
- Jangan biarkan mock drift dari auth asli.

---

## 22. Referensi

- Plan 1: `docs/plan1-cockatiel-retry-failure-scenario/PLAN1_Cockatiel_Retry_Failure_Scenario.md`
- Plan 2 (index): `docs/plan2-auth-integration/README.md`
- Auth OpenAPI: `docs/plan2-auth-integration/auth-openapi.json`
- Auth contract: `docs/plan2-auth-integration/AUTH_CONTRACT.md`
- Changelog auth: `docs/plan2-auth-integration/CHANGELOG-AUTH.md`
- Sandbox notes: `docs/SANDBOX_NOTES.md`
- RFC 6749 — OAuth 2.0
- RFC 7009 — OAuth 2.0 Token Revocation
- RFC 7636 — PKCE
- RFC 9700 — OAuth 2.0 Security Best Current Practice
- RFC 7517 — JWK
- RFC 8725 — JWT Best Current Practices
- OIDC Discovery 1.0
- OWASP ASVS — Authentication & Session Management
- IETF draft — OAuth 2.0 for Browser-Based Apps
- SemVer — https://semver.org

---

## 23. Decision Log

| # | Keputusan | Alasan |
|---|---|---|
| 1 | BFF pattern | Token tidak menyentuh browser; aman dari XSS |
| 2 | PKCE S256 | Standar RFC 9700 |
| 3 | RS256 + JWKS | Payment-api tidak bisa forge token |
| 4 | JWT tipis + `roleId` | `roleId` properti sesi; `roles[]`/`permissions[]` di cache |
| 5 | Cache 2 tabel | `cached_users` + `sessions` (permission jsonb) |
| 6 | Lazy sync (SWR) | Tidak perlu scheduled job; beban auth terkontrol |
| 7 | Middleware untuk sync | Cross-cutting; guard tetap untuk otorisasi |
| 8 | Lock + timeout di lazy sync | Cegah race condition & blocking |
| 9 | Cookie HttpOnly + CSRF | Aman dari XSS, dilindungi CSRF |
| 10 | Refresh rotation | Mitigasi token theft |
| 11 | Dual-secret rotation | Zero-downtime secret rotation |
| 12 | `auth-mock` sebagai referensi OAuth2 | Standar bertahap di auth asli |
| 13 | Webhook opsional | Bisa ditambah nanti tanpa breaking |
| 14 | Vue-only FE | Satu FE, satu stack, fokus |
| 15 | Versioning 4 level | Plan, contract, API, auth service — independen |
| 16 | Folder per-plan | `docs/plan<N>-<slug>/` dengan `README.md` index |
| 17 | Konfigurasi minimal | Env hanya untuk yang berubah antar env; path OAuth2 fixed → konstanta kode |
| 18 | **Auth asli jadi OAuth2 Server penuh** | Standar, SSO-ready, menghindari custom auth jangka panjang |
| 19 | **Transisi bertahap: auth-mock dulu** | Payment-api tidak terblokir; auth asli menyusul |

---

## 24. Ringkasan

```text
FASE 1 (sekarang)
DEV
  FE Vue  --cookie-->  BE payment (BFF)  --OAuth2-->  auth-mock
                              |
                              +--> cached_users
                              +--> sessions (permission_codes jsonb)
                              +--> lazy sync (SWR)

FASE 2 (auth asli siap)
PROD
  FE Vue  --cookie-->  BE payment (BFF)  --OAuth2-->  auth-service (OAuth2 AS)
                              |
                              +--> cached_users
                              +--> sessions (permission_codes jsonb)
                              +--> lazy sync (SWR)
                              +--> JWKS verify
```

- Frontend hanya Vue 3 + PrimeVue.
- Browser hanya pegang cookie.
- JWT tipis + `roleId`, verifikasi via JWKS.
- Otorisasi dari permission snapshot di session.
- Lazy sync (SWR) menggantikan background refresh.
- OAuth 2.0 + PKCE sesuai standar keamanan terkini.
- Versioning 4 level agar auth update tidak memecah payment.
- Konfigurasi minimal: `AUTH_BASE_URL` + konstanta path.
- **Auth asli dibangun bertahap menjadi OAuth2 Server penuh.**
- **auth-mock adalah referensi dan tetap dipakai untuk dev & E2E.**
- Auth update cadence tinggi tidak mengganggu payment-api.

---

## 25. Roadmap OAuth2 Server di Repo Auth

Section ini menjelaskan **apa yang harus dibangun di repo auth** agar menjadi OAuth2 Authorization Server penuh. Ini pekerjaan **paralel** dengan Fase 1 (Monorepo Retry).

### 25.1 Kondisi Saat Ini

Repo auth saat ini:

| Aspek | Kondisi |
|---|---|
| Framework | NestJS 11 |
| Database | PostgreSQL |
| ORM | TypeORM 0.3.x |
| Signing | HS256 (shared secret) |
| Login | `POST /api/auth/login` (custom) |
| Multi-role | `POST /api/auth/select-role` (custom) |
| Logout | Stateless |
| Admin panel | ✅ user/role/menu CRUD |
| JWKS | ❌ |
| OAuth2 endpoints | ❌ |
| Discovery | ❌ |
| PKCE | ❌ |
| Client registration | ❌ |
| Session (untuk interaksi user dengan AS) | ❌ |

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
│  │ - /api/users     │  │ - halaman login  │                 │
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
│                                                               │
│  DB: auth (PostgreSQL)                                        │
└──────────────────────────────────────────────────────────────┘
```

### 25.3 Yang Harus Dibangun

#### A. Migrasi HS256 → RS256

| Task | Detail |
|---|---|
| Generate keypair | RSA 2048 atau EC P-256 |
| Simpan private key | Di secret manager atau file dengan permission ketat |
| Expose public key | Via `/.well-known/jwks.json` |
| `kid` support | Setiap key punya `kid` unik |
| Rotasi | Dual-key period |

#### B. Endpoint OAuth2

| Endpoint | Fungsi | RFC |
|---|---|---|
| `GET /oauth/authorize` | Terima request, redirect ke login/consent, kembalikan `code` | RFC 6749 §3.1 |
| `POST /oauth/token` | Tukar `code` jadi token; refresh token | RFC 6749 §3.2 |
| `POST /oauth/revoke` | Cabut token | RFC 7009 |

#### C. PKCE

- Simpan `code_challenge` + `code_challenge_method` saat authorize.
- Verifikasi `code_verifier` saat token exchange.
- Support `S256` (wajib), `plain` (opsional, tidak dianjurkan).
- Tolak request tanpa PKCE dari public client.

#### D. Client Registration

| Task | Detail |
|---|---|
| Tabel `oauth_clients` | `client_id`, `client_secret`, `redirect_uri`, `grant_types`, `scopes` |
| Registrasi | Manual (admin) atau UI |
| Rotasi secret | Dual-secret period |

#### E. Login & Consent

| Halaman | Fungsi |
|---|---|
| Login | User masuk (username/password) |
| Consent | User setuju memberi akses ke client |
| Pilih role | Untuk user multi-role |

Halaman ini **milik auth**, bukan payment. Setelah selesai, baru redirect ke `redirect_uri`.

#### F. Session di Auth

Untuk interaksi user dengan AS (login, consent, pilih role), auth butuh **session sendiri**:

- Cookie `HttpOnly` di domain auth.
- Session store (Redis).
- Berbeda dari token yang diterbitkan ke klien.

#### G. Endpoint Internal (Sync)

| Endpoint | Fungsi |
|---|---|
| `GET /api/v1/me/permissions` | User + role + permission codes |
| `POST /api/v1/auth/switch-role` | Ganti role aktif |

#### H. Discovery

`GET /.well-known/openid-configuration` yang mengembalikan:

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

Tambah kolom `code` di tabel menu:

```sql
ALTER TABLE menus ADD COLUMN code varchar(64) UNIQUE;
```

Isi dengan kode stabil (`payment.read`, `payment.write`, dll).

#### J. Rate Limiting

- Login: 10/menit/IP, 5/menit/username.
- Token: 20/menit/client.

#### K. Observability

- Log penerbitan token, revoke, login.
- Metrics: `oauth_token_issued_total`, `oauth_login_attempts_total`.
- Trace: propagate `traceparent`.

### 25.4 Referensi Implementasi

`apps/auth-mock` di monorepo Retry adalah **referensi implementasi**. Auth asli bisa:

1. **Melihat kode `auth-mock`** untuk pola.
2. **Mengikuti kontrak yang sama** (`AUTH_CONTRACT.md`).
3. **Menjalankan contract test** yang sama.

### 25.5 Library yang Bisa Dipakai di Auth

| Kategori | Package | Fungsi |
|---|---|---|
| OAuth2 Server | `@node-oauth/oauth2-server` | Implementasi OAuth2 server |
| JWT / JWKS | `jose` (v5) | Sign RS256, expose JWKS |
| Session | `ioredis` + `@nestjs/cache-manager` | Session store |
| Cookie | `cookie-parser` | Cookie parsing |
| Rate Limit | `@nestjs/throttler` | Throttle |
| Validation | `class-validator`, `class-transformer` | DTO |
| Crypto | `crypto` (builtin) | Random `code`, `state` |

**Catatan**: `@node-oauth/oauth2-server` adalah implementasi OAuth2 server yang matang untuk Node.js. Ia menangani banyak detail protokol (validasi request, PKCE, grant types). Auth bisa memakainya untuk mempercepat.

### 25.6 Urutan Pembangunan di Auth

1. **Migrasi HS256 → RS256** + JWKS.
2. **Tabel `oauth_clients`** + registrasi client.
3. **Session store** di auth.
4. **Login & consent page**.
5. **Endpoint `/oauth/authorize`**.
6. **Endpoint `/oauth/token`** (code + refresh).
7. **PKCE support**.
8. **Endpoint `/oauth/revoke`**.
9. **Endpoint `/api/v1/me/permissions`**.
10. **Endpoint `/api/v1/auth/switch-role`**.
11. **Kolom `code` di menu**.
12. **Discovery endpoint**.
13. **Rate limiting**.
14. **Observability**.

### 25.7 Contract Test

Setiap kali auth asli update, jalankan contract test terhadap payment-api:

- JWT claims sesuai.
- JWKS bisa dibaca.
- `/api/v1/me/permissions` struktur benar.
- OAuth2 flow lengkap.
- Error format sesuai.

### 25.8 Kompatibilitas dengan auth-mock

`auth-mock` dan auth asli **harus**:

- Mengikuti kontrak yang sama.
- Menghasilkan JWT dengan klaim yang sama.
- Menyediakan endpoint dengan path yang sama.
- Mengembalikan error format yang sama.

Perbedaan yang **diperbolehkan**:

- Implementasi internal (library berbeda).
- Skala (auth asli lebih production-ready).
- Fitur tambahan (auth asli bisa punya lebih banyak).

### 25.9 Migrasi Bertahap

```text
Tahap 1: auth-mock OAuth2 lengkap
         payment-api pakai auth-mock
         auth asli masih custom

Tahap 2: auth asli OAuth2 (paralel)
         auth-mock tetap dipakai dev
         contract test dijalankan ke keduanya

Tahap 3: staging pakai auth asli
         dev tetap pakai auth-mock

Tahap 4: production pakai auth asli
         auth-mock tetap ada untuk dev & E2E
```

### 25.10 Risiko & Mitigasi

| Risiko | Mitigasi |
|---|---|
| Auth asli drift dari kontrak | Contract test di CI |
| Auth asli belum siap saat payment-api butuh | auth-mock sebagai fallback |
| Migrasi HS256 → RS256 memecah klien lama | Dual-key period; JWT lama tetap valid sampai expired |
| Session store baru down | Redis cluster + replica |
| Consent screen tidak selesai | Pakai halaman minimal dulu, perbaiki UI nanti |

---