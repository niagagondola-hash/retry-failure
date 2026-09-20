# Technical Plan - Auth Integration (OAuth 2.0 + PKCE + BFF + Lazy Sync)

> **Status**: FINAL
> **Created**: 2026-09-20
> **Baseline**: `PLAN1_Cockatiel_Retry_Failure_Scenario.md` (rev 2)
> **Purpose**: Integrasi auth service eksternal ke `payment-api` dengan standar keamanan OAuth 2.0 terkini — JWT tipis, otorisasi berbasis menu, token tidak menyentuh browser, sinkronisasi lazy per-sesi.
> **Frontend**: Vue 3 + PrimeVue (satu-satunya FE).

---

## 1. Keputusan Arsitektur Utama

| Aspek | Keputusan |
|---|---|
| Alur login | OAuth 2.0 Authorization Code + **PKCE (S256)** |
| OAuth2 Client | **Backend payment** (confidential client) |
| Pola | **BFF (Backend-for-Frontend)** |
| Token di browser | **Tidak ada** — hanya cookie sesi `HttpOnly; Secure; SameSite=Lax` |
| Signing JWT | **RS256 + JWKS** |
| Payload JWT | Tipis: `sub`, `username`, **`roleId`**, `iss`, `aud`, `exp`, `iat`, `jti` |
| Refresh token | Ya — **rotation** + absolute expiration |
| Otorisasi | **Berbasis menu code**, dievaluasi dari cache lokal di payment-api |
| Data cache | **2 tabel**: `cached_users` + `sessions` (dengan `permission_codes` jsonb) |
| Sinkronisasi | **Initial (login)** + **Lazy (stale-while-revalidate di middleware)** + **Webhook (opsional)** |
| Middleware vs Guard | Middleware: sync + cross-cutting. Guard: otorisasi. |
| CSRF | Double-submit cookie + `SameSite=Lax` |
| Rate limit | Di auth (login & token); FE punya halaman 429 |
| Secret rotation | Dual-secret period + JWKS `kid` rotation |
| Session store | Redis (produksi) / Postgres (alternatif) / memory (dev) |
| Frontend | Vue 3 + PrimeVue + Pinia + Vue Router + Vite |

---

## 2. Prinsip

> **Token tidak pernah menyentuh browser. JWT hanya identitas + active role. Otorisasi dibaca dari cache lokal. Auth service adalah Authorization Server.**

### 2.1 Responsibility boundary

| Concern | Owner |
|---|---|
| Authorization Server | Auth service |
| User / role / menu store | Auth service |
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
│  - /oauth/*         │◄──JWKS──┤   ├─ /auth/*      (BFF)            │
│  - /api/users/*     │◄──sync──┤   ├─ /payments/*  (resource)       │
│  - /api/roles/*     │         │   ├─ packages/security             │
│  - /api/menus/*     │         │   ├─ cache: cached_users, sessions │
│  - /.well-known/    │         │   └─ session store (Redis)         │
│      jwks.json      │         │                                    │
│                     │         │  apps/auth-mock    (OAuth2 ref)    │
│  DB: auth           │         │  apps/frontend-vue                 │
│                     │         │                                    │
└─────────────────────┘         └────────────────────────────────────┘
```

### 2.3 Yang melewati boundary

OAuth2 endpoints, JWKS, klaim JWT minimal, endpoint sync otorisasi, webhook opsional. Tidak ada shared code, shared lockfile, atau shared Node version.

### 2.4 Stack Teknologi

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
| CSRF | `csrf-csrf` | Double-submit cookie (pengganti `csurf`) |
| Security Headers | `helmet` | HSTS, CSP, X-Frame-Options |
| Rate Limit | `@nestjs/throttler` | Throttle login/callback |
| Scheduler | `@nestjs/schedule` | Opsional, untuk fallback |
| ORM | `typeorm` (v0.3) + `pg` | Cache tables + payments |
| Validation | `class-validator`, `class-transformer` | DTO |
| Logging | `nestjs-pino`, `pino` | Structured logging |
| Metrics | `prom-client` | Prometheus |
| Tracing | `@opentelemetry/sdk-node`, `@opentelemetry/auto-instrumentations-node` | OTel |
| Testing | `jest`, `supertest`, `nock` | Unit + integration |
| Crypto | `crypto` (builtin) | Random state, `jti` |

**`apps/auth-mock`**

| Package | Fungsi |
|---|---|
| `@nestjs/common`, `@nestjs/core` (v11) | Framework |
| `jose` (v5) | Sign RS256 + expose JWKS + verify |
| `uuid` | Generate `jti`, `code`, `sid` |
| `class-validator`, `class-transformer` | DTO |
| `@nestjs/throttler` | Rate limit login |

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

| Komponen | Image / Versi |
|---|---|
| Node.js | `20.19.0` (pin) |
| PostgreSQL | `16` |
| Redis | `7-alpine` |
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
│   ├── PLAN1_Cockatiel_Retry_Failure_Scenario.md
│   ├── PLAN2-Auth_Integration.md
│   └── tasks/
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
 |                 |                     |--GET /api/me/permissions->|
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

**Yang tetap TIDAK masuk JWT**: `roles[]`, `isSuperAdmin`, `menuCodes[]`, `permissions[]`. Semua itu di cache lokal.

**Alasan `roleId` masuk JWT**: `roleId` adalah properti sesi (active role), nilainya tunggal, ukurannya tetap (UUID 36 byte), dan payment-api membutuhkannya untuk lookup permission yang diizinkan di cache.

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
3. BE payment proxy ke auth: POST /api/auth/switch-role
4. Auth terbitkan JWT baru dengan roleId baru
5. BE payment verifikasi JWT baru, update session (roleId + permission_codes)
6. FE refresh /auth/session
```

---

## 6. Otorisasi Berbasis Menu

### 6.1 Menu code

Setiap menu di auth punya **code stabil** (bukan URL):

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

Diterapkan lewat decorator:

```ts
@RequireMenu('payment.write')
@Post('/payments')
createPayment(...) {}
```

### 6.3 Super admin

- `is_super_admin = true` → bypass semua cek menu.
- Diambil dari `cached_users`.

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

Guard **tidak** memanggil auth service. Guard hanya baca cache lokal.

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
- `idx_sessions_user_id` (user_id)
- `idx_sessions_last_sync_at` (last_sync_at)
- `idx_sessions_refresh_expires_at` (refresh_expires_at) — untuk cleanup

### 7.3 `payments` (perubahan)

- Tambah `user_id uuid` FK → `cached_users.user_id`.
- Backfill dulu (nullable), lalu `NOT NULL`.
- `ON DELETE SET NULL` (payment tetap ada bila user dihapus).
- Index `idx_payments_user_id`.

### 7.4 Kenapa hanya 2 tabel

- **`cached_users`**: info user yang stabil, dipakai lintas sesi.
- **`sessions`**: permission di-snapshot saat login. Kalau role berganti, snapshot di-replace. Tidak perlu tabel role/menu terpisah karena permission sudah berbentuk flat array.

Tabel yang **tidak dibuat**: `cached_roles`, `cached_user_roles`, `cached_menus`, `cached_role_menus`, `cached_sessions_permissions`.

### 7.5 Batasan `jsonb`

- Batas per nilai: 255 MB (jauh lebih dari cukup).
- Permission codes biasanya 10–100 string pendek → beberapa KB.
- Query: `WHERE permission_codes @> '["payment.write"]'::jsonb` didukung GIN index.

---

## 8. Strategi Sinkronisasi (Lazy Sync)

### 8.1 Tiga pemicu

| Pemicu | Kapan | Data |
|---|---|---|
| **Initial sync** | Setelah OAuth callback | User + role + permission user tersebut |
| **Lazy sync (SWR)** | Middleware, saat `last_sync_at` stale | Update `permission_codes` di sesi |
| **Webhook (opsional)** | Auth kirim event | Entitas yang berubah |

### 8.2 Alur Lazy Sync (Stale-While-Revalidate)

```text
Request masuk
  |
  v
Middleware lazy-sync
  |
  +-- ambil session (cookie sid)
  |
  +-- age = now - session.last_sync_at
  |
  +-- age < FRESH_TTL (5 menit)
  |     -> lanjut
  |
  +-- FRESH_TTL <= age < STALE_TTL (30 menit)
  |     -> lanjut
  |     -> trigger sync background (non-blocking, dengan lock Redis)
  |
  +-- age >= STALE_TTL
        -> blocking sync dengan timeout 2 detik
        -> kalau gagal: pakai cache lama + warning
        -> lanjut
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

Gunakan Redis `SET NX EX`:

```ts
const lockKey = `sync:lock:${session.sid}`;
const acquired = await redis.set(lockKey, '1', 'NX', 'EX', 10);
if (!acquired) return; // sudah ada yang sync

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
              -> MenuAccessGuard (permission check dari req.user)
  Handler     -> business logic
```

- **Middleware**: cross-cutting + sinkronisasi data.
- **Guard**: otorisasi murni. Baca permission dari `req.user` (yang di-set `SessionGuard` dari session).

### 8.5 Webhook (opsional)

Event yang dikirim auth:

```json
{ "event": "user.updated", "user_id": "...", "occurred_at": "..." }
{ "event": "role.permissions.updated", "role_id": "...", "occurred_at": "..." }
{ "event": "user.deleted", "user_id": "...", "occurred_at": "..." }
```

BE payment: validasi signature, update `cached_users`, invalidate sesi terkait.

**Untuk demo, webhook tidak wajib.** Lazy sync saja cukup.

### 8.6 Skenario user delete / rename

- **Rename**: webhook atau lazy sync update `cached_users.name`.
- **Delete**: webhook hapus row `cached_users`, set `payments.user_id = NULL`, revoke sesi.
- **Tanpa webhook**: lazy sync tidak bisa deteksi delete — perlu scheduled job harian.

### 8.7 Grace period

- Auth down: pakai cache sampai `STALE_TTL` (30 menit).
- Setelah itu: blocking sync; kalau gagal, tetap pakai cache dengan warning.
- Batas maksimal: `MAX_STALE_TTL` (2 jam) — setelah itu, sesi dianggap invalid.

---

## 9. `packages/security` di Monorepo Retry

```text
packages/security/
├── src/
│   ├── oauth/
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

### 9.1 `req.user` shape

```ts
interface AuthUser {
  userId: string;         // dari JWT sub
  username: string;       // dari JWT username
  roleId: string;         // dari JWT roleId
  isSuperAdmin: boolean;  // dari cached_users
  permissionCodes: string[]; // dari sessions.permission_codes
}
```

### 9.2 `AUTH_MODE`

| Mode | Deskripsi |
|---|---|
| `oauth` | OAuth2 + PKCE + JWKS (produksi) |
| `mock` | Pakai `apps/auth-mock` |
| `disabled` | Skip (unit test) |

`AUTH_MODE=mock` menolak start jika `NODE_ENV=production`.

---

## 10. `apps/auth-mock` (OAuth2 Reference)

### 10.1 Scope

Authorization Server referensi:

| Endpoint | Fungsi |
|---|---|
| `GET /oauth/authorize` | Authorization endpoint |
| `POST /oauth/token` | Token endpoint (code + refresh) |
| `POST /oauth/revoke` | Revoke |
| `GET /oauth/userinfo` | OIDC user info (opsional) |
| `GET /.well-known/jwks.json` | JWKS |
| `GET /.well-known/openid-configuration` | OIDC discovery |
| `GET /api/me/permissions` | Data otorisasi untuk sync |
| `POST /api/auth/switch-role` | Ganti role aktif |
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

### 10.6 Response `/api/me/permissions`

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

- Vue 3 (Composition API)
- Vite
- PrimeVue + `@primevue/themes` + `primeicons`
- Pinia (state)
- Vue Router
- Axios

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
- Setelah callback, panggil `/auth/session`.
- Logout: `POST /auth/logout`, redirect ke login.
- 401 → redirect `/auth/login`.
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
    if (err.response?.status === 401) {
      window.location.href = '/auth/login';
    }
    if (err.response?.status === 403) {
      router.push('/forbidden');
    }
    if (err.response?.status === 429) {
      router.push('/too-many-requests');
    }
    return Promise.reject(err);
  },
);
```

### 11.5 Route guard

```ts
router.beforeEach(async (to) => {
  if (to.meta.public) return true;

  const auth = useAuthStore();
  if (!auth.user) {
    await auth.fetchSession(); // GET /auth/session
  }

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

### 11.6 Menu

- FE ambil menu dari `GET /api/menus/me` atau dari `permissionCodes` di `/auth/session`.
- Menu store simpan `menuCodes`.
- `AppMenu.vue` render berdasarkan `menuCodes`.
- Guard FE hanya UX; otorisasi sebenarnya di BE.

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

- Hanya origin FE Vue yang diizinkan.
- `Access-Control-Allow-Credentials: true`.
- `Access-Control-Allow-Origin`: eksplisit, bukan `*`.

### 12.3 CSRF

- Double-submit cookie: cookie `XSRF-TOKEN` + header `X-CSRF-Token`.
- Middleware cek kecocokan.
- Dikecualikan untuk `GET`, `HEAD`, `OPTIONS`, `/auth/callback`.

### 12.4 Security headers (Helmet)

- `Strict-Transport-Security`
- `X-Content-Type-Options: nosniff`
- `X-Frame-Options: DENY`
- `Referrer-Policy: strict-origin-when-cross-origin`
- `Content-Security-Policy` di FE
- `Permissions-Policy`

### 12.5 Rate limiting

- Auth: throttle login & token (10/menit/IP, 5/menit/username).
- BE payment: throttle `/auth/login` & `/auth/callback`.
- Response: `429` + `Retry-After`.
- FE: halaman khusus 429 dengan tombol "coba lagi nanti".

---

## 13. Observability

### 13.1 Logging

- OAuth flow: start, callback, token exchange success/failure.
- Session: created, expired, revoked.
- Lazy sync: triggered, success, failure, stale warning.
- Authorization: deny (403).
- JWT verify failure.

Redaction wajib: token, refresh token, client secret, PII.

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

Hindari label high-cardinality.

### 13.3 Tracing

- Propagate `traceparent` FE → BE → auth.
- Span untuk OAuth callback, token exchange, lazy sync, guard.
- Auth service diinstrument OTel.

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
AUTH_ISSUER=http://localhost:4001
AUTH_AUTHORIZE_URL=http://localhost:4001/oauth/authorize
AUTH_TOKEN_URL=http://localhost:4001/oauth/token
AUTH_REVOKE_URL=http://localhost:4001/oauth/revoke
AUTH_JWKS_URL=http://localhost:4001/.well-known/jwks.json
AUTH_PERMISSIONS_URL=http://localhost:4001/api/me/permissions
OAUTH_CLIENT_ID=payment-api
OAUTH_CLIENT_SECRET=dev-client-secret
OAUTH_REDIRECT_URI=http://localhost:3000/auth/callback
JWT_ISSUER=http://localhost:4001
JWT_AUDIENCE=payment-api
SESSION_SECRET=dev-session-secret
SESSION_TTL_SEC=28800
REDIS_URL=redis://localhost:6379
VITE_API_URL=http://localhost:3000
```

---

## 15. Testing Strategy

### 15.1 Unit

- PKCE: verifier/challenge, S256.
- OAuth client: token exchange, refresh, revoke, switch-role.
- JWKS verifier: cache, rotation, invalid signature.
- Session guard: valid, expired, revoked.
- MenuAccessGuard: super admin, allowed, denied.
- Lazy sync middleware: fresh, stale (background), very stale (blocking), timeout, lock.
- CSRF middleware.

### 15.2 Integration (payment-api)

- `/auth/login` → redirect dengan PKCE.
- `/auth/callback` → cookie, session dibuat.
- `/auth/session` → user.
- Protected: 401 tanpa cookie, 200 dengan cookie valid.
- Protected: 403 jika permission tidak dimiliki.
- Super admin: akses semua.
- Logout: session dihapus, token direvoke.
- Switch-role: session diupdate.

### 15.3 E2E lintas service

- Dengan `auth-mock`: full OAuth2 flow.
- Dengan auth asli: full OAuth2 flow.
- Skenario: single-role, multi-role, super admin, user tanpa akses.

### 15.4 FE Vue

- Redirect ke `/auth/login` saat belum login.
- Setelah callback, session terisi.
- Guard route: 403 halaman.
- 429 halaman.
- Logout menghapus session.

### 15.5 Contract test

- JWT sesuai klaim minimal (termasuk `roleId`).
- JWKS auth bisa dibaca payment-api.
- `/api/me/permissions` struktur benar.
- Format error sesuai kontrak.
- Contract test jadi alarm ketika auth update.

---

## 16. Configuration

```text
# Server
PORT=3000
NODE_ENV=development

# OAuth2
AUTH_MODE=oauth
AUTH_ISSUER=
AUTH_AUTHORIZE_URL=
AUTH_TOKEN_URL=
AUTH_REVOKE_URL=
AUTH_JWKS_URL=
AUTH_PERMISSIONS_URL=
AUTH_SWITCH_ROLE_URL=
OAUTH_CLIENT_ID=payment-api
OAUTH_CLIENT_SECRET=
OAUTH_REDIRECT_URI=
OAUTH_SCOPES=openid profile

# JWT
JWT_ISSUER=
JWT_AUDIENCE=payment-api
JWT_CLOCK_TOLERANCE_SEC=5
JWKS_CACHE_TTL_SEC=300

# Session
SESSION_STORE=redis
SESSION_SECRET=
SESSION_TTL_SEC=28800
SESSION_COOKIE_NAME=sid
SESSION_COOKIE_SAMESITE=Lax

# Lazy sync
SYNC_FRESH_TTL_MS=300000       # 5 menit
SYNC_STALE_TTL_MS=1800000      # 30 menit
SYNC_MAX_STALE_TTL_MS=7200000  # 2 jam
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

## 17. Urutan Implementasi

1. **Kontrak OAuth2 & klaim JWT** — sepakati dengan tim auth (termasuk `roleId`).
2. **Auth service** — tambah `/oauth/*`, JWKS, `/api/me/permissions`, `/api/auth/switch-role`, kolom `code` di menu.
3. **`apps/auth-mock`** — implementasi referensi OAuth2.
4. **`packages/security`** — OAuth client, session, guard, cache, lazy sync middleware.
5. **Migrasi DB payment** — `cached_users`, `sessions` (dengan `permission_codes`), `payments.user_id`.
6. **Integrasi guard + middleware** di payment-api.
7. **Lazy sync** — middleware + lock + timeout.
8. **FE Vue** — redirect flow, session store, router guard, halaman 403/429.
9. **CSRF, security headers, rate limit**.
10. **Observability**.
11. **Docker profile**.
12. **Contract test + E2E**.
13. **Dokumentasi** — `AUTH_CONTRACT.md`, `SANDBOX_NOTES.md`.

---

## 18. Definition of Done

- [ ] Auth punya `/oauth/authorize`, `/oauth/token`, `/oauth/revoke`, JWKS.
- [ ] Auth expose `/api/me/permissions`.
- [ ] Auth expose `/api/auth/switch-role`.
- [ ] Auth punya kolom `code` di menu.
- [ ] JWT payload menyertakan `roleId`.
- [ ] `apps/auth-mock` implementasi OAuth2 + PKCE.
- [ ] `packages/security` lengkap.
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
- [ ] Contract test lulus.
- [ ] E2E lulus (mock + auth asli).
- [ ] Observability: log, metrics, trace.
- [ ] Docker `dev` & `full`.
- [ ] Dokumentasi kontrak & sandbox.

---

## 19. Production Caveats

### 19.1 Auth down

- Lazy sync: pakai cache sampai `STALE_TTL` (30 menit).
- Setelah itu: blocking sync; kalau gagal, tetap pakai cache dengan warning.
- Batas maksimal `MAX_STALE_TTL` (2 jam) → sesi dianggap invalid.

### 19.2 Key rotation

- JWKS mendukung multiple `kid`.
- Payment-api refresh JWKS saat `kid` tidak dikenal.
- Contract test cover rotasi.

### 19.3 Session store

- Redis wajib di produksi.
- Redis down → sesi hilang → login ulang.
- Persistence + replica.

### 19.4 Refresh token bocor

- Rotation setiap kali pakai.
- Reuse detection → revoke semua sesi user.
- Log `refresh_reuse_detected`.

### 19.5 Client secret bocor

- Rotasi dual-secret.
- Auth terima dua secret selama periode rotasi.
- Alert jika ada percobaan dengan secret lama.

### 19.6 Deployment order

- Auth dulu (endpoint baru, backward compatible).
- Payment-api kemudian.
- Rollback: payment-api fallback ke mode lama sementara.

### 19.7 Menu code

- Jika auth belum punya `code`, pakai `url` sebagai fallback.
- Migrasi ke `code` tanpa breaking.

### 19.8 PII

- Redaction di log & trace.
- Cookie tidak mengandung PII.
- Session store terenkripsi at rest.

### 19.9 Cleanup sesi expired

- Scheduled job harian: hapus sesi dengan `refresh_expires_at < now()`.
- Jangan andalkan Redis TTL saja (kalau pakai Postgres).

---

## 20. Referensi

- RFC 6749 — OAuth 2.0
- RFC 7636 — PKCE
- RFC 9700 — OAuth 2.0 Security Best Current Practice
- RFC 7517 — JWK
- RFC 8725 — JWT Best Current Practices
- OWASP ASVS — Authentication & Session Management
- IETF draft — OAuth 2.0 for Browser-Based Apps
- Plan Retry: `docs/PLAN1_Cockatiel_Retry_Failure_Scenario.md`

---

## 21. Decision Log

| # | Keputusan | Alasan |
|---|---|---|
| 1 | BFF pattern | Token tidak menyentuh browser; aman dari XSS |
| 2 | PKCE S256 | Standar RFC 9700 untuk browser-based |
| 3 | RS256 + JWKS | Payment-api tidak bisa forge token |
| 4 | JWT tipis + `roleId` | `roleId` properti sesi; `roles[]`/`permissions[]` di cache |
| 5 | Cache 2 tabel | `cached_users` + `sessions` (permission jsonb) |
| 6 | Lazy sync (SWR) | Tidak perlu scheduled job; beban auth terkontrol |
| 7 | Middleware untuk sync | Cross-cutting; guard tetap untuk otorisasi |
| 8 | Lock + timeout di lazy sync | Cegah race condition & blocking |
| 9 | Cookie HttpOnly + CSRF | Aman dari XSS, dilindungi CSRF |
| 10 | Refresh rotation | Mitigasi token theft |
| 11 | Dual-secret rotation | Zero-downtime secret rotation |
| 12 | `auth-mock` sebagai referensi OAuth2 | Standar bisa diterapkan bertahap di auth asli |
| 13 | Webhook opsional | Bisa ditambah nanti tanpa breaking |
| 14 | Vue-only FE | Satu FE, satu stack, fokus |

---

## 22. Ringkasan

```text
DEV
  FE Vue  --cookie-->  BE payment (BFF)  --OAuth2-->  auth-mock
                              |
                              +--> cached_users
                              +--> sessions (permission_codes jsonb)
                              +--> lazy sync (SWR)

PROD
  FE Vue  --cookie-->  BE payment (BFF)  --OAuth2-->  auth-service
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
- Lazy sync (stale-while-revalidate) menggantikan background refresh.
- OAuth 2.0 + PKCE sesuai standar keamanan terkini.
- Auth update cadence tinggi tidak mengganggu payment-api.