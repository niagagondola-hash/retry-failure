# Technical Plan - Auth Integration (External Service + Shared Secret + Mock Strategy)

> **Status**: Draft untuk implementasi (rev 2 - berdasarkan `openapi.json` aktual)
> **Created**: 2026-09-19
> **Last updated**: 2026-09-19 - menyesuaikan dengan kontrak auth aktual (HS256, stateless, two-step login)
> **Baseline**: Lanjutan dari `PLAN1_Cockatiel_Retry_Failure_Scenario.md` (rev 2)
> **Purpose**: Mengintegrasikan auth service dari repo terpisah ke dalam `payment-api` tanpa menggabungkan monorepo, tanpa coupling dependency, dan tetap bisa dikembangkan mandiri.
> **Sumber kontrak**: `openapi.json` dari repo auth, versi `0.1.0`, judul *Login & Management Access API*.
>
> **Changelog rev 2**:
> - Section 5: `AUTH_MODE` disesuaikan (HS256 shared secret, tanpa JWKS).
> - Section 6: `packages/security` ganti `JwksVerifier` → `SharedSecretVerifier`.
> - Section 8: Tidak ada refresh token, klaim `sub` mapping TBD.
> - Section 9: Frontend login flow dua langkah; 401 → redirect login (bukan refresh).
> - Section 10: Metrics JWKS dihapus.
> - Section 12: Contract test fokus ke klaim JWT, bukan JWKS.
> - Section 14: Env disesuaikan (`JWT_SECRET` ganti `AUTH_JWKS_URL`).
> - Section 18: Caveat HS256 dan key rotation manual.
> - Section 21 (baru): Temuan penting dari kontrak aktual.

---

## 1. Tujuan

Plan ini menjelaskan bagaimana `payment-api` di monorepo Retry berintegrasi dengan **auth service eksternal** yang:

1. Berada di repo terpisah.
2. Memiliki cadence update dependency/Node yang lebih cepat (karena security).
3. Sudah punya NestJS 11, PostgreSQL, JWT (HS256), pnpm, TypeORM 0.3.x.
4. Menyediakan flow login dua langkah (single-role / multi-role) + manajemen user/role/menu.
5. Menggunakan **stateless logout** (tanpa refresh token).
6. Menggunakan **HS256 shared secret** (tanpa JWKS).

Fokus integrasi:

1. **Boundary jelas**: auth adalah service, bukan library.
2. **Kontrak-first**: HTTP + JWT claims, bukan shared code.
3. **Mock-first development**: dev tidak bergantung auth service hidup.
4. **Verifikasi token** di `payment-api` via shared secret.
5. **`user_id` di payment** sebagai UUID opaque dari klaim `sub`.
6. **Observability lintas service** dengan propagasi trace.
7. **Contract test** agar mock tidak drift dari auth asli.

---

## 2. Prinsip Arsitektur

> **Auth adalah external dependency. Payment-api hanya terikat pada kontrak HTTP + format JWT, bukan pada kode auth.**

### 2.1 Responsibility boundary

| Concern | Owner |
|---|---|
| User store, password, roles, menus | Auth service (repo auth) |
| Login, select-role, logout | Auth service |
| Terbitkan JWT (HS256) | Auth service |
| Manajemen user/role/menu | Auth service |
| Verifikasi JWT | Payment-api (`packages/security`) |
| `user_id` di payment | Payment-api |
| RBAC di payment | Payment-api |
| Token storage di frontend | Frontend (Next.js / Vue) |
| Mock auth untuk dev | Monorepo Retry (`apps/auth-mock`) |

### 2.2 Target dependency flow

```text
┌──────────────────────────┐        ┌──────────────────────────────┐
│  repo auth               │        │  repo Retry (monorepo)       │
│                          │        │                              │
│  auth-api                │◄──JWT──┤  payment-api                 │
│  - /api/auth/*           │        │   ├─ packages/security       │
│  - /api/users/*          │        │   │   ├─ JwtAuthGuard        │
│  - /api/roles/*          │        │   │   ├─ SharedSecretVerifier│
│  - /api/menus/*          │        │   │   ├─ @CurrentUser()     │
│  - /api/health           │        │   │   └─ RolesGuard         │
│                          │        │   ├─ modules/payments        │
│  DB: auth                │        │   └─ modules/...             │
│                          │        │                              │
│                          │        │  apps/auth-mock   (dev/E2E)  │
│                          │        │  apps/frontend-vue           │
│                          │        │  apps/frontend-next          │
└──────────────────────────┘        └──────────────────────────────┘
```

Business layer payment **tidak** meng-import Cockatiel maupun kode auth. Yang dikonsumsi hanya:

- HTTP endpoint auth (untuk frontend).
- Shared secret (untuk verifikasi token).
- Klaim JWT (untuk identitas user).

---

## 3. Keputusan Arsitektur

### 3.1 Dua service terpisah

- **Auth** tetap di repo sendiri.
- **Payment** tetap di monorepo Retry.
- Tidak ada `workspace:*` lintas repo.
- Tidak ada submodule atau git URL untuk runtime dependency.
- Sinkronisasi hanya lewat **kontrak**.

### 3.2 Alasan

| Masalah | Solusi dengan pemisahan |
|---|---|
| Auth bump Node/dependency | Tidak menyentuh lockfile payment |
| Security patch auth | Cukup deploy auth |
| Auth refactor endpoint | Dilindungi versioning + contract test |
| CI auth dan payment | Berjalan independen |
| Rollback auth | Tidak menyentuh payment |

### 3.3 Yang bergerak bersama (coupling minimal)

- Format JWT (klaim wajib).
- Algoritma signing (**HS256**).
- Shared secret management.
- Format error HTTP (untuk konsumsi frontend).
- Versioning API auth.

Semuanya disepakati sebagai kontrak, bukan sebagai kode.

---

## 4. Kontrak Auth

> **Sumber**: `openapi.json` dari repo auth, versi `0.1.0`, judul *Login & Management Access API*.

### 4.1 Daftar Endpoint

**Base URL**: `/api` (semua endpoint di bawah prefix ini)

**Health**

| Method | Path | Auth | Fungsi |
|---|---|---|---|
| GET | `/api/health` | publik | cek app + DB |

**Auth**

| Method | Path | Auth | Fungsi |
|---|---|---|---|
| POST | `/api/auth/login` | publik | login username/password |
| POST | `/api/auth/select-role` | publik | pilih role (multi-role) → JWT |
| GET | `/api/auth/me` | bearer | profil sesi aktif |
| POST | `/api/auth/logout` | bearer | stateless logout |

**Users** (admin, bearer)

| Method | Path | Fungsi |
|---|---|---|
| GET | `/api/users` | list |
| POST | `/api/users` | create |
| GET | `/api/users/{id}` | detail |
| PUT | `/api/users/{id}` | update |
| DELETE | `/api/users/{id}` | delete |
| PUT | `/api/users/{id}/password` | reset password |

**Roles** (admin, bearer)

| Method | Path | Fungsi |
|---|---|---|
| GET | `/api/roles` | list |
| POST | `/api/roles` | create |
| GET | `/api/roles/{id}` | detail |
| PUT | `/api/roles/{id}` | update |
| DELETE | `/api/roles/{id}` | delete |
| GET | `/api/roles/{id}/menus` | tree menu + akses |
| PUT | `/api/roles/{id}/menus` | set hak akses |

**Menus** (admin, bearer)

| Method | Path | Fungsi |
|---|---|---|
| GET | `/api/menus/me` | tree menu role aktif |
| GET | `/api/menus` | tree semua menu |
| POST | `/api/menus` | create |
| GET | `/api/menus/{id}` | detail |
| PUT | `/api/menus/{id}` | update |
| DELETE | `/api/menus/{id}` | delete |

### 4.2 Login Flow (dua langkah)

```text
POST /api/auth/login  { username, password }
   |
   +-- 200, data.kind = "authenticated"
   |     -> accessToken langsung tersedia
   |
   +-- 200, data.kind = "role-selection-required"
         -> user harus pilih role
         -> POST /api/auth/select-role { userId, roleId }
         -> 200 -> accessToken
```

Response `authenticated`:

```json
{
  "success": true,
  "data": {
    "kind": "authenticated",
    "accessToken": "eyJ...",
    "user": {
      "id": "uuid",
      "username": "superadmin",
      "name": "Super Administrator",
      "email": "admin@perusahaan.com",
      "activeRole": {
        "id": "uuid",
        "name": "Super Admin",
        "description": "...",
        "isSuperAdmin": true
      },
      "roles": [ /* ... */ ]
    }
  }
}
```

Response `role-selection-required`:

```json
{
  "success": true,
  "data": {
    "kind": "role-selection-required",
    "user": {
      "id": "uuid",
      "username": "budi_santoso",
      "activeRole": null,
      "roles": [ /* ... */ ]
    }
  }
}
```

`select-role` request:

```json
{ "userId": "uuid", "roleId": "uuid" }
```

`select-role` response: sama seperti `authenticated` di atas.

### 4.3 Klaim JWT (TBD — perlu konfirmasi tim auth)

| Klaim | Tipe | Wajib | Sumber | Dipakai untuk |
|---|---|---|---|---|
| `iss` | string | TBD | TBD | verifikasi issuer |
| `aud` | string | TBD | TBD | verifikasi audience |
| `sub` | string (uuid) | TBD | `user.id`? | `payments.user_id` |
| `exp` | number | ya | JWT standar | expiry |
| `iat` | number | ya | JWT standar | audit |
| `roles` | string[] | TBD | nama role? id role? | RBAC |
| `roleId` | string (uuid) | TBD | `activeRole.id`? | RBAC |
| `isSuperAdmin` | boolean | TBD | `activeRole.isSuperAdmin`? | bypass |

**Wajib dikonfirmasi sebelum implementasi `packages/security`.**

Cara cepat: decode token asli.

```bash
curl -s -X POST http://localhost:3000/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"username":"superadmin","password":"..."}' \
  | jq -r '.data.accessToken' \
  | cut -d. -f2 \
  | base64 -d 2>/dev/null \
  | jq
```

### 4.4 Algoritma & Key

- **Algoritma**: HS256 (shared secret).
- **JWKS**: tidak tersedia.
- **Distribusi secret**: via env `JWT_SECRET` di payment-api, harus sama dengan auth.
- **Rotasi secret**: manual, koordinasi kedua repo.

> **Risiko**: HS256 berarti payment-api bisa membuat token palsu. Untuk demo internal ini dapat diterima. Untuk production, pertimbangkan migrasi ke RS256 + JWKS.

### 4.5 Error Taxonomy

| HTTP | Bentuk | Arti | Aksi konsumen |
|---|---|---|---|
| 400 | `{statusCode, message}` | validasi gagal | tampilkan |
| 401 | `{statusCode, message}` | login salah / token invalid | redirect login |
| 403 | `{statusCode, message}` | role tidak punya izin | tampilkan |
| 404 | `{statusCode, message}` | resource tidak ada | tampilkan |

Catatan: format error **berbeda** dari format sukses (`success`/`data`). Frontend harus handle dua bentuk.

### 4.6 Yang Tidak Ada di Auth

- **Refresh token**: tidak ada. Logout stateless.
- **Register publik**: tidak ada. User dibuat admin.
- **JWKS**: tidak ada. HS256 shared secret.
- **Password reset via email**: tidak ada. Reset oleh admin.

Implikasi:
- Frontend tidak bisa silent refresh. Pada 401 → redirect login.
- `AUTH_MODE=jwks` tidak dipakai.
- `AUTH_JWKS_URL` dihapus dari env.

### 4.7 Artefak Kontrak

- `openapi.json` dari repo auth (artefak rilis, versioned).
- `docs/external/AUTH_CONTRACT.md` di repo Retry (salinan + bagian non-HTTP).
- `docs/external/CHANGELOG-AUTH.md` (riwayat versi kontrak).

### 4.8 Versioning

- Versi spec saat ini: `0.1.0`.
- Prefix: `/api` (bukan `/v1`).
- Breaking change policy: **belum didefinisikan**.
- **Rekomendasi**: sepakati sebelum produksi, tambahkan prefix `/api/v1` bila perlu.

---

## 5. AUTH_MODE & Runtime Configuration

`payment-api` mendukung mode operasional berikut:

| Mode | Deskripsi | Kapan dipakai |
|---|---|---|
| `shared-secret` | Verifikasi HS256 dengan `JWT_SECRET` | Production / staging |
| `mock` | Pakai dev secret + `/dev/token` | Dev harian |
| `disabled` | Skip guard (unit test tertentu) | Test terisolasi |

Aturan:

- `AUTH_MODE=mock` **wajib menolak start** kalau `NODE_ENV=production`.
- Default untuk dev: `mock`.
- Default untuk staging/production: `shared-secret`.
- Semua mode diverifikasi dengan set test yang sama.

Env yang dibutuhkan:

```text
AUTH_MODE=shared-secret
JWT_SECRET=                    # wajib diisi, sama dengan auth
JWT_ISSUER=                    # opsional, kalau auth mengisi iss
JWT_AUDIENCE=payment-api       # opsional, kalau auth mengisi aud
JWT_CLOCK_TOLERANCE_SEC=5
```

---

## 6. `packages/security` di Monorepo Retry

Kode milik payment-api, bukan diimpor dari auth.

```text
packages/security/
├── src/
│   ├── guards/
│   │   ├── jwt-auth.guard.ts
│   │   └── roles.guard.ts
│   ├── decorators/
│   │   ├── public.decorator.ts
│   │   ├── current-user.decorator.ts
│   │   └── roles.decorator.ts
│   ├── verifiers/
│   │   ├── shared-secret-verifier.ts
│   │   └── mock-verifier.ts
│   ├── types/
│   │   └── auth-user.ts
│   ├── security.module.ts
│   └── index.ts
└── test/
```

### 6.1 Tanggung jawab

| Komponen | Tugas |
|---|---|
| `JwtAuthGuard` | Ambil bearer, verifikasi, set `req.user` |
| `RolesGuard` | Cek `roles` dari `req.user` |
| `@Public()` | Bypass guard untuk endpoint publik |
| `@CurrentUser()` | Ambil user dari request |
| `SharedSecretVerifier` | Verifikasi HS256 dengan `JWT_SECRET` |
| `MockVerifier` | Verifikasi pakai dev secret |
| `SecurityModule` | Pilih verifier berdasarkan `AUTH_MODE` |

### 6.2 Endpoint publik (bypass guard)

- `GET /health`
- `GET /metrics`
- `GET /docs`
- `POST /dev/token` (hanya `AUTH_MODE=mock`)

Semua endpoint lain memerlukan token.

### 6.3 `req.user` shape

```ts
interface AuthUser {
  userId: string;        // dari klaim `sub`
  roles: string[];       // dari klaim `roles`
  roleId?: string;       // dari klaim `roleId`
  isSuperAdmin?: boolean;
  email?: string;        // opsional, dari klaim atau /auth/me
  raw: Record<string, unknown>;
}
```

Shape ini adalah turunan langsung dari kontrak JWT (section 4.3). **Final setelah klaim dikonfirmasi.**

---

## 7. `apps/auth-mock` (Dev & E2E)

Mock service kecil yang mengimplementasikan kontrak auth (section 4) secara identik.

### 7.1 Scope

- Endpoint: `/api/auth/login`, `/api/auth/select-role`, `/api/auth/me`, `/api/auth/logout`, `/api/health`.
- Endpoint dev: `POST /dev/token` (terbitkan token tanpa login).
- Menerbitkan JWT dengan **dev secret** (HS256).
- Menyimpan user in-memory (atau SQLite).
- Tidak untuk production.

### 7.2 Struktur

```text
apps/auth-mock/
├── src/
│   ├── modules/
│   │   ├── auth/
│   │   └── users/
│   ├── config/
│   ├── app.module.ts
│   └── main.ts
├── test/
└── package.json
```

### 7.3 Dev secret

- Di-set via env `JWT_SECRET` (dev value).
- Ditandai jelas: `DO NOT USE IN PRODUCTION`.
- Nilai default dev: `dev-secret-not-for-production`.

### 7.4 User fixture

- Minimal dua user:
  - `superadmin` — single role, langsung authenticated.
  - `budi_santoso` — multi role, trigger role-selection.
- Password dev: `ChangeMe_123!`.

### 7.5 Endpoint khusus dev

```http
POST /dev/token
Content-Type: application/json

{ "sub": "user-1", "roles": ["user"], "roleId": "role-1" }

200 OK
{ "accessToken": "eyJ..." }
```

Hanya aktif kalau `AUTH_MOCK_ALLOW_DEV_TOKEN=true`.

---

## 8. Database & `user_id`

### 8.1 Keputusan

- Auth DB **terpisah** dari payment DB (dua service).
- `payments.user_id` menyimpan UUID dari klaim `sub`.
- **Tidak ada FK lintas DB**.
- Tidak ada join lintas DB.

### 8.2 Migrasi

- Tambah kolom `user_id uuid` di `payments`.
- Tambah index `idx_payments_user_id`.
- Backfill data lama: nullable dulu, lalu NOT NULL.
- Update semua query list/detail agar filter by `user_id` (kecuali super admin).

### 8.3 Data user di payment

- Minimal: `user_id`.
- Opsional: cache `email` / `name` untuk tampilan (dari `/api/auth/me` atau klaim).
- Kalau butuh data user lengkap: panggil `GET /api/users/{id}` ke auth (opsional, dengan cache).

---

## 9. Frontend Integration

### 9.1 Login flow (dua langkah)

Kedua frontend harus handle:

```text
1. User submit username & password
2. POST /api/auth/login
3. Kalau data.kind = "authenticated"
     -> simpan accessToken, redirect ke dashboard
4. Kalau data.kind = "role-selection-required"
     -> tampilkan pilihan role
     -> POST /api/auth/select-role { userId, roleId }
     -> simpan accessToken, redirect ke dashboard
```

### 9.2 Next.js (`apps/frontend-next`)

- Login page dengan step: credentials → role selection (conditional).
- Token storage: **httpOnly cookie via route handler** (rekomendasi).
- Route protection: middleware Next.js.
- Fetch API: attach bearer otomatis.

### 9.3 Vue (`apps/frontend-vue`)

- Pinia store untuk auth state (`kind`, `user`, `accessToken`).
- Axios interceptor: attach bearer.
- Vue Router guard: redirect ke login kalau 401.
- PrimeVue Toast untuk error feedback.
- Halaman role-selection kalau `kind = "role-selection-required"`.

### 9.4 Aturan penyimpanan token

| Lokasi | Access token |
|---|---|
| Memory | ✅ aman |
| httpOnly cookie | ✅ aman |
| localStorage | ⚠️ risiko XSS |

Untuk demo, jika tetap pakai localStorage:

- Catat sebagai **technical debt** di `docs/tasks/SANDBOX_NOTES.md`.
- Tidak ada refresh token, jadi tidak ada risiko refresh token bocor.

### 9.5 Error handling frontend

Karena **tidak ada refresh token**:

- `401` → hapus token, redirect login.
- `403` → tampilkan pesan.
- `429` → backoff (kalau auth menerapkan rate limit).

Detail mapping error mengikuti section 4.5.

### 9.6 Logout

- Frontend panggil `POST /api/auth/logout` (opsional; stateless).
- Frontend hapus token dari storage.
- Redirect ke login.

Karena stateless, logout tetap harus dilakukan di client. Auth tidak mem-blacklist token.

---

## 10. Observability Lintas Service

### 10.1 Propagasi trace

- Frontend → payment-api: `traceparent` header.
- Payment-api → auth (kalau ada call): `traceparent` header.
- Auth service juga diinstrument OTel (kalau tersedia).
- Trace harus menggambarkan: login → token issued → payment request.

### 10.2 Logging

Event minimal auth-related di payment-api:

- token verification success / failure
- auth mode aktif saat boot
- klaim JWT yang dibaca (tanpa isi sensitif)

Jangan log token, secret, atau klaim yang mengandung PII.

### 10.3 Metrics

Metrics tambahan di payment-api:

| Metric | Type | Labels |
|---|---|---|
| `auth_token_verification_total` | counter | result (valid/invalid/expired), mode |

Hindari label `user_id` (high cardinality).

---

## 11. Docker & Dev Workflow

### 11.1 Compose profile

```text
profile: dev   ->  postgres, payment-api, auth-mock, gateway-mock, jaeger, prometheus, grafana
profile: full  ->  tambah auth-api (image dari repo auth)
```

### 11.2 Contoh

```bash
# dev dengan mock
docker compose --profile dev up

# full dengan auth asli
docker compose --profile full up
```

### 11.3 Dev tanpa Docker

```bash
pnpm dev          # payment-api + auth-mock + gateway-mock
pnpm dev:full     # kalau auth asli sudah running di lokal
```

### 11.4 Env dev

```text
AUTH_MODE=mock
JWT_SECRET=dev-secret-not-for-production
AUTH_MOCK_URL=http://localhost:4001
```

---

## 12. Testing Strategy

### 12.1 Unit test (`packages/security`)

- `JwtAuthGuard`: token valid/invalid/expired/wrong issuer/audience.
- `RolesGuard`: role cukup / kurang.
- `@Public()`: bypass.
- `SharedSecretVerifier`: verifikasi HS256, klaim wajib.
- `MockVerifier`: dev token.

### 12.2 Integration test (`payment-api`)

- Endpoint publik dapat diakses tanpa token.
- Endpoint protected menolak tanpa token (401).
- Endpoint protected menerima token valid.
- `payments.user_id` terisi dari `sub`.
- Filter by user bekerja.
- Super admin dapat melihat semua payment.

### 12.3 E2E lintas service

- **Dengan mock**: login ke `auth-mock` → create payment → list.
- **Dengan auth asli**: login ke auth service → create payment → list.
- Skenario role: single-role vs multi-role.
- Skenario select-role: multi-role user harus pilih role dulu.

### 12.4 Contract test (wajib)

Ini yang membuat mock tidak "bohong".

Test yang dijalankan terhadap **auth asli**:

1. Login single-role → dapat token → verifikasi klaim wajib.
2. Login multi-role → dapat `role-selection-required` → select-role → dapat token.
3. Verifikasi klaim JWT sesuai section 4.3.
4. Verifikasi `payment-api` menerima token asli.
5. Verifikasi format error auth sesuai section 4.5.
6. Verifikasi versioning sesuai section 4.8.

Dijalankan:

- Setiap rilis auth.
- Setiap rilis payment-api.
- Di CI kedua repo.

---

## 13. Contract Test Auth ↔ Payment

Lokasi: `test/contract/auth-payment.contract.spec.ts`.

Skenario minimal:

| Skenario | Ekspektasi |
|---|---|
| Token valid issuer | 200 |
| Token issuer salah | 401 |
| Token audience salah | 401 |
| Token expired | 401 |
| Token tanpa `sub` | 401 |
| Token valid + role user | akses endpoint user |
| Token valid + super admin | akses endpoint admin |
| Login multi-role flow | sampai dapat token |

Hasil test **wajib** masuk CI untuk mencegah regresi saat auth update.

---

## 14. Configuration / Env Baru

Tambahan di `.env.example`:

```text
# Auth
AUTH_MODE=shared-secret
JWT_SECRET=                    # wajib diisi, sama dengan auth
JWT_ISSUER=
JWT_AUDIENCE=payment-api
JWT_CLOCK_TOLERANCE_SEC=5

# Dev only
AUTH_MOCK_URL=http://localhost:4001
AUTH_MOCK_ALLOW_DEV_TOKEN=false

# Frontend
NEXT_PUBLIC_AUTH_URL=
VITE_AUTH_URL=
```

---

## 15. Urutan Implementasi

Task mengikuti dependency:

1. **Konfirmasi klaim JWT** ke tim auth (decode token asli).
2. **`AUTH_MODE`** — definisi + validasi bootstrap.
3. **`packages/security`** — guard, verifier, decorator, types.
4. **`apps/auth-mock`** — implementasi kontrak (termasuk two-step login).
5. **Integrasi guard** di `payment-api` (global + `@Public()`).
6. **Migrasi `user_id`** di `payments` + index + backfill.
7. **Filter payment** berdasarkan user.
8. **Frontend Next.js** — login/role-selection/guard.
9. **Frontend Vue** — Pinia auth + interceptor + guard + role-selection page.
10. **Observability** — log + metrics + trace propagation.
11. **Docker profile** `dev` dan `full`.
12. **Contract test** auth ↔ payment.
13. **E2E lintas service**.
14. **Dokumentasi** — `AUTH_CONTRACT.md`, `SANDBOX_NOTES.md`.

Setiap task harus punya acceptance criteria dan checkpoint commit.

---

## 16. Definition of Done

- [ ] Klaim JWT dikonfirmasi dan didokumentasikan.
- [ ] `AUTH_MODE` berfungsi untuk `shared-secret`, `mock`, `disabled`.
- [ ] `packages/security` tersedia dengan test unit.
- [ ] `JwtAuthGuard` + `RolesGuard` + `@Public()` + `@CurrentUser()` berjalan.
- [ ] `apps/auth-mock` mengimplementasikan kontrak (login + select-role).
- [ ] `payments.user_id` terisi dari klaim `sub`.
- [ ] Filter by user bekerja; super admin dapat melihat semua.
- [ ] Endpoint publik dapat diakses tanpa token.
- [ ] Endpoint protected menolak tanpa token (401).
- [ ] Contract test auth ↔ payment lulus.
- [ ] E2E lintas service (mock dan auth asli) lulus.
- [ ] Frontend Next.js dapat login (single & multi-role) + akses payment.
- [ ] Frontend Vue dapat login (single & multi-role) + akses payment.
- [ ] Observability: log + metrics + trace lintas service.
- [ ] Docker profile `dev` dan `full` berjalan.
- [ ] Dokumentasi kontrak & sandbox notes tersedia.

---

## 17. Yang Sengaja Tidak Dilakukan

- Menggabung auth ke monorepo Retry.
- `workspace:*` lintas repo.
- Submodule atau git URL untuk runtime dependency.
- Refresh token / silent refresh (karena auth tidak menyediakan).
- JWKS / RS256 (karena auth memakai HS256).
- SSO/OAuth.
- Multi-tenant auth.
- Distributed session store di payment.
- Rate limiting produksi penuh di payment-api.

---

## 18. Production Caveats

### 18.1 HS256 shared secret

- Payment-api bisa membuat token palsu.
- Mitigasi jangka panjang: migrasi ke RS256 + JWKS.
- Mitigasi jangka pendek:
  - Secret hanya di env, tidak di-commit.
  - Rotasi secret koordinasi kedua repo.
  - Audit akses env.

### 18.2 Tidak ada refresh token

- Access token harus berumur cukup panjang untuk UX.
- Trade-off: token lebih lama = risiko lebih tinggi jika bocor.
- Frontend harus handle 401 → redirect login.
- Tidak ada mekanisme revoke. Logout hanya hapus token di client.

### 18.3 Clock skew

- `JWT_CLOCK_TOLERANCE_SEC` untuk mengakomodasi perbedaan waktu.
- Jangan terlalu besar (≤ 60 detik).

### 18.4 Token di frontend

- localStorage berisiko XSS.
- httpOnly cookie lebih aman, tapi butuh CSRF protection.
- Pilihan disesuaikan dengan kebutuhan demo.

### 18.5 Coupling yang tak terhindarkan

- Format JWT.
- Semantik klaim.
- Shared secret.
- Versioning API auth.

Ini **tidak bisa dihilangkan**, hanya dikelola lewat kontrak + contract test.

### 18.6 Versioning belum didefinisikan

- Kontrak saat ini prefix `/api` tanpa versi.
- Breaking change pada auth = breaking change pada payment.
- Rekomendasi: sepakati versioning sebelum produksi.

---

## 19. Referensi

- Plan Retry: `docs/PLAN1_Cockatiel_Retry_Failure_Scenario.md`
- Auth OpenAPI: `docs/external/auth-openapi.json`
- Auth contract: `docs/external/AUTH_CONTRACT.md`
- Sandbox notes: `docs/tasks/SANDBOX_NOTES.md`
- NestJS JWT: https://docs.nestjs.com/security/authentication
- Passport JWT: https://www.passportjs.org/packages/passport-jwt/
- OpenAPI: https://spec.openapis.org/oas/v3.1.0

---

## 20. Yang Perlu Kamu Siapkan Berikutnya

1. **Konfirmasi klaim JWT** — decode satu token asli dari `superadmin` dan `budi_santoso`.
2. **Konfirmasi nilai `iss` dan `aud`** — kalau ada.
3. **Konfirmasi expiry access token**.
4. **Konfirmasi distribusi `JWT_SECRET`** — bagaimana payment-api mendapatkannya.
5. **Konfirmasi rencana versioning** — kalau ada.
6. **Konfirmasi rencana migrasi ke RS256/JWKS** — kalau ada.

Setelah itu, implementasi bisa langsung mulai dari Task 2 (`AUTH_MODE`) dan Task 3 (`packages/security`).

---

## 21. Temuan Penting dari Kontrak Aktual

Ringkasan hal yang **mengubah asumsi plan awal**:

| # | Temuan | Dampak |
|---|---|---|
| 1 | **HS256**, bukan RS256/JWKS | `AUTH_MODE=jwks` dihapus; ganti `shared-secret` |
| 2 | **Tidak ada refresh token** | Frontend tidak bisa silent refresh; 401 → login |
| 3 | **Login dua langkah** (single vs multi-role) | Frontend butuh flow + halaman role-selection |
| 4 | **Tidak ada register publik** | User dibuat admin; tidak ada halaman register |
| 5 | **Format error ≠ format sukses** | Frontend butuh dua handling |
| 6 | **Klaim JWT belum jelas** | `packages/security` menunggu konfirmasi |
| 7 | **Versioning belum ada** | Perlu disepakati sebelum produksi |
| 8 | **Base URL `/api`** | Sudah termasuk prefix; jangan dobel |
| 9 | **Super admin ada di response user** | RBAC bisa pakai `isSuperAdmin` |

---

## 22. Ringkas Alur Integrasi

```text
DEV
  frontend  ---> auth-mock (login/select-role)
            ---> payment-api (bearer token)
  payment-api verifikasi HS256 pakai dev secret

STAGING / PROD
  frontend  ---> auth-api (login/select-role)
            ---> payment-api (bearer token)
  payment-api verifikasi HS256 pakai JWT_SECRET
                |
                +---> DB payment (user_id dari klaim sub)
```

Semua integrasi **lewat kontrak**, bukan lewat kode yang dibagi.