# Plan 2 — Auth Integration Subtask Index

> **Source plan**: [`../PLAN2-Auth_Integration.md`](../PLAN2-Auth_Integration.md) (v1.2.2, 2369 lines, 25 sections)
> **Execution model**: paralel batch + sequential dependency (lihat dependency graph di bawah)
> **Stack target**: NestJS 11 + TypeORM 0.3 + PostgreSQL 16 + openid-client v5 + jose v5 + ioredis + lru-cache + Vue 3 + PrimeVue
> **Monorepo root**: `/home/z/my-project/retry-failure/`
> **Tasks folder**: `/home/z/my-project/retry-failure/docs/plan2-auth-integration/tasks/`

---

## 0. WAJIB BACA Sebelum Mulai Task

**Sebelum menjalankan task apapun, baca**:
- [`../../../SANDBOX_NOTES.md`](../../../SANDBOX_NOTES.md) — Pre-flight Check untuk deteksi local vs sandbox (pnpm/docker/port).
- [`../AUTH_CONTRACT.md`](../AUTH_CONTRACT.md) — Contract OAuth2 + JWT claims + RS256 signing + scopes (v1.0.0).
- [`../CHANGELOG-AUTH.md`](../CHANGELOG-AUTH.md) — Riwayat perubahan kontrak auth.
- [`../PLAN2-Auth_Integration.md`](../PLAN2-Auth_Integration.md) — Plan lengkap (25 sections, v1.2.2).

Setiap task file (`AUTH-XX-*.md`) punya section "Useful commands" yang berisi command `pnpm install`, `pnpm test`, `pnpm typecheck`, `pnpm lint`, serta curl/langkah verifikasi end-to-end. Jalankan setelah task selesai untuk verify acceptance criteria.

---

## 1. Ringkasan Eksekusi

Plan 2 (v1.2.2) mengintegrasikan `payment-api` dengan **auth service eksternal** menggunakan:

- **BFF pattern** — token tidak menyentuh browser.
- **OAuth 2.0 + PKCE (S256)** — Authorization Code flow per RFC 6749 + RFC 7636 + RFC 9700.
- **JWT tipis + `roleId`** — hanya `sub`, `username`, `roleId` (tidak ada permission di JWT).
- **JWKS verify (RS256)** — payment-api tidak bisa forge token.
- **Cache 2 tabel** — `cached_users` (info stabil) + `sessions` (permissionCodes snapshot).
- **Lazy sync (SWR)** — Fresh 5min → background sync → blocking 30min → grace 2h.
- **`apps/auth-mock`** — implementasi referensi OAuth2 lengkap untuk dev + E2E.
- **`packages/security`** — OAuth client + session store + guards + lazy sync (dipakai payment-api).
- **`AUTH_MODE`** — `oauth` (production) | `mock` (dev pakai auth-mock) | `disabled` (sandbox/unit test, skip guard).
- **`SESSION_STORE`** — `redis` (production) | `memory` (sandbox, no Redis required).

Adaptasi lingkungan spesifik (port conflict, Docker availability, Redis availability) TIDAK ditulis di task files. Lihat `SANDBOX_NOTES.md` untuk strategi per kondisi.

---

## 2. Execution Order & Task IDs

| Task ID | File | Title | Depends on | Est. |
|---|---|---|---|---|
| AUTH-01 | [`AUTH-01-scaffold-auth-mock.md`](./AUTH-01-scaffold-auth-mock.md) | Scaffold `apps/auth-mock` (NestJS + EJS + package.json) | - | S |
| AUTH-02 | [`AUTH-02-rs256-jwks.md`](./AUTH-02-rs256-jwks.md) | auth-mock RS256 keypair + JWKS endpoint | AUTH-01 | M |
| AUTH-03 | [`AUTH-03-oauth2-endpoints.md`](./AUTH-03-oauth2-endpoints.md) | auth-mock OAuth2 endpoints (authorize + token + revoke + PKCE) | AUTH-01, AUTH-02 | L |
| AUTH-04 | [`AUTH-04-login-ui-ejs.md`](./AUTH-04-login-ui-ejs.md) | auth-mock login UI + role selection (EJS) | AUTH-03 | M |
| AUTH-05 | [`AUTH-05-internal-endpoints.md`](./AUTH-05-internal-endpoints.md) | auth-mock internal endpoints (permissions + switch-role + dev/token) | AUTH-03 | M |
| AUTH-06 | [`AUTH-06-fixtures-users-roles.md`](./AUTH-06-fixtures-users-roles.md) | auth-mock fixture users + roles + permissions | AUTH-03 | S |
| AUTH-07 | [`AUTH-07-oidc-discovery.md`](./AUTH-07-oidc-discovery.md) | auth-mock OIDC discovery endpoint | AUTH-02 | S |
| AUTH-08 | [`AUTH-08-scaffold-security.md`](./AUTH-08-scaffold-security.md) | Scaffold `packages/security` (structure + types + module) | - | S |
| AUTH-09 | [`AUTH-09-oauth-client.md`](./AUTH-09-oauth-client.md) | security — OAuth client (openid-client v5 + PKCE + token exchange) | AUTH-08 | L |
| AUTH-10 | [`AUTH-10-jwks-verifier.md`](./AUTH-10-jwks-verifier.md) | security — JWKS verifier (jose v5 + createRemoteJWKSet + cache) | AUTH-08 | M |
| AUTH-11 | [`AUTH-11-session-store.md`](./AUTH-11-session-store.md) | security — SessionStore interface + Redis + Memory implementations | AUTH-08 | M |
| AUTH-12 | [`AUTH-12-session-service-cookie-entity.md`](./AUTH-12-session-service-cookie-entity.md) | security — Session service + cookie + entity | AUTH-11 | M |
| AUTH-13 | [`AUTH-13-guards-decorators.md`](./AUTH-13-guards-decorators.md) | security — Guards (SessionGuard + MenuAccessGuard + decorators) | AUTH-12 | M |
| AUTH-14 | [`AUTH-14-lazy-sync-middleware.md`](./AUTH-14-lazy-sync-middleware.md) | security — Lazy sync middleware (SWR + lock + timeout) | AUTH-13 | L |
| AUTH-15 | [`AUTH-15-csrf-security-headers.md`](./AUTH-15-csrf-security-headers.md) | security — CSRF middleware + Helmet + Throttler | AUTH-13 | M |
| AUTH-16 | [`AUTH-16-db-migration.md`](./AUTH-16-db-migration.md) | DB migration (cached_users + sessions + payments.user_id nullable) | - | M |
| AUTH-17 | [`AUTH-17-payment-api-integration.md`](./AUTH-17-payment-api-integration.md) | payment-api — BFF AuthController + middleware wiring + config | AUTH-09, AUTH-12, AUTH-13, AUTH-14, AUTH-15, AUTH-16 | L |
| AUTH-18 | [`AUTH-18-payment-api-existing-endpoints.md`](./AUTH-18-payment-api-existing-endpoints.md) | payment-api — @RequireMenu on existing endpoints + AUTH_MODE=disabled | AUTH-13, AUTH-17 | M |
| AUTH-19 | [`AUTH-19-payment-api-observability.md`](./AUTH-19-payment-api-observability.md) | payment-api — auth metrics + tracing + logging (redaction) | AUTH-17 | M |
| AUTH-20 | [`AUTH-20-fe-vue-auth-flow.md`](./AUTH-20-fe-vue-auth-flow.md) | FE Vue — axios interceptor + auth store + CSRF | AUTH-17 | M |
| AUTH-21 | [`AUTH-21-fe-vue-router-guards-pages.md`](./AUTH-21-fe-vue-router-guards-pages.md) | FE Vue — router guards + LoginRedirect + Callback + Forbidden + 429 | AUTH-20 | M |
| AUTH-22 | [`AUTH-22-fe-vue-menu-component.md`](./AUTH-22-fe-vue-menu-component.md) | FE Vue — dynamic menu component (AppMenu.vue + menuStore) | AUTH-20 | S |
| AUTH-23 | [`AUTH-23-docker-sandbox-dev-profiles.md`](./AUTH-23-docker-sandbox-dev-profiles.md) | Docker — auth-mock + redis + sandbox/dev profiles + scripts | AUTH-01 | S |
| AUTH-24 | [`AUTH-24-unit-tests-security.md`](./AUTH-24-unit-tests-security.md) | Unit tests — PKCE + OAuth + JWKS + guards + lazy sync + parity + disabled | AUTH-14, AUTH-15 | L |
| AUTH-25 | [`AUTH-25-integration-tests-payment-api.md`](./AUTH-25-integration-tests-payment-api.md) | Integration tests — OAuth flow + session + protected + switch-role + disabled | AUTH-17, AUTH-18 | L |
| AUTH-26 | [`AUTH-26-e2e-with-auth-mock.md`](./AUTH-26-e2e-with-auth-mock.md) | E2E with auth-mock — full OAuth + multi-role + super admin + sandbox | AUTH-25 | L |
| AUTH-27 | [`AUTH-27-contract-tests.md`](./AUTH-27-contract-tests.md) | Contract tests — JWT claims + JWKS + permissions + error format | AUTH-07, AUTH-17 | M |
| AUTH-28 | [`AUTH-28-documentation.md`](./AUTH-28-documentation.md) | Documentation — SANDBOX_NOTES + README + AUTH_CONTRACT + openapi.json | AUTH-26 | M |

### Dependency graph

```text
AUTH-01 (scaffold auth-mock)
├── AUTH-02 (RS256 keypair + JWKS)
│   ├── AUTH-03 (OAuth2 endpoints)
│   │   ├── AUTH-04 (login UI EJS)
│   │   ├── AUTH-05 (internal endpoints)
│   │   └── AUTH-06 (fixture users + roles)
│   └── AUTH-07 (OIDC discovery)
│
└── AUTH-23 (Docker sandbox/dev profiles) — bisa paralel setelah AUTH-01

AUTH-08 (scaffold packages/security) ── paralel dengan AUTH-01..07
├── AUTH-09 (OAuth client openid-client v5)
├── AUTH-10 (JWKS verifier jose v5)
└── AUTH-11 (SessionStore Redis + Memory)
    └── AUTH-12 (Session service + cookie + entity)
        └── AUTH-13 (SessionGuard + MenuAccessGuard + decorators)
            ├── AUTH-14 (Lazy sync middleware SWR + lock + timeout)
            └── AUTH-15 (CSRF + Helmet + Throttler)

AUTH-16 (DB migration cached_users + sessions + payments.user_id) ── paralel

AUTH-09 + AUTH-12 + AUTH-13 + AUTH-14 + AUTH-15 + AUTH-16
└── AUTH-17 (payment-api BFF integration — AuthController + middleware + config)

AUTH-13 + AUTH-17
└── AUTH-18 (payment-api @RequireMenu on existing endpoints + AUTH_MODE=disabled)

AUTH-17
├── AUTH-19 (payment-api observability — metrics + tracing + logging)
├── AUTH-20 (FE Vue axios + auth store + CSRF)
│   ├── AUTH-21 (FE Vue router guards + auth pages — LoginRedirect + Callback + Forbidden + 429)
│   └── AUTH-22 (FE Vue menu component)
├── AUTH-24 (Unit tests security) — depends on AUTH-14 + AUTH-15
└── AUTH-07 + AUTH-17
    └── AUTH-27 (Contract tests) — JWT + JWKS + permissions + errors

AUTH-17 + AUTH-18
└── AUTH-25 (Integration tests payment-api)

AUTH-25
└── AUTH-26 (E2E with auth-mock — full OAuth flow)

AUTH-26
└── AUTH-28 (Documentation final)
```

### Recommended execution batches

> **Batch mapping disesuaikan dengan eksekusi aktual sandbox.**
> Batch 1 dan 2 sudah selesai dieksekusi (7/28 tasks done).

- **Batch 1** (parallel, 2 agents): `AUTH-01` (auth-mock scaffold) + `AUTH-08` (security scaffold). ✅ DONE
- **Batch 2** (parallel, 3 subagents / 5 tasks): `AUTH-02` (RS256+JWKS) + `AUTH-09` (OAuth client) + `AUTH-11` (SessionStore Redis+Memory) + `AUTH-16` (DB migration) + `AUTH-23` (Docker profiles). ✅ DONE
- **Batch 3** (parallel, 2 agents): `AUTH-03` (OAuth2 endpoints — depends AUTH-02) + `AUTH-10` (JWKS verifier — depends AUTH-08).
- **Batch 4** (parallel, 4 agents): `AUTH-04` (login UI EJS) + `AUTH-05` (internal endpoints) + `AUTH-06` (fixtures) + `AUTH-07` (OIDC discovery).
  - Semua depends pada `AUTH-03` (atau `AUTH-02` untuk `AUTH-07`).
- **Batch 5** (sequential): `AUTH-12` (Session service) → `AUTH-13` (Guards) → `AUTH-14` (Lazy sync) → `AUTH-15` (CSRF + Helmet + Throttler).
- **Batch 6** (sequential, single agent): `AUTH-17` (payment-api BFF integration) — butuh semua security tasks + AUTH-15 + AUTH-16 ready. Large task.
- **Batch 7** (parallel, 4 agents): `AUTH-18` (@RequireMenu existing endpoints) + `AUTH-19` (observability) + `AUTH-20` (FE Vue axios) + `AUTH-27` (contract tests) — semua depends on AUTH-17.
- **Batch 8** (parallel, 2 agents): `AUTH-21` (router guards + pages) + `AUTH-22` (menu component) — keduanya depends on AUTH-20.
- **Batch 9** (sequential): `AUTH-24` (unit tests) → `AUTH-25` (integration tests) → `AUTH-26` (E2E) — testing chain.
- **Batch 10** (final): `AUTH-28` (documentation) — setelah semua implementation done. Single agent.

#### Eksekusi aktual (sandbox)

| Batch | Tasks | Status | Date | Tests |
|---|---|---|---|---|
| Batch 1 | AUTH-01 + AUTH-08 (scaffold auth-mock + security) | ✅ DONE | 2026-09-24 | — |
| Batch 2 | AUTH-02, AUTH-09, AUTH-11, AUTH-16, AUTH-23 (RS256 + OAuth client + SessionStore + DB + Docker) | ✅ DONE | 2026-09-24 | — |
| Batch 3 | AUTH-03 + AUTH-10 (OAuth2 endpoints + JWKS verifier) | ✅ DONE | 2026-09-25 | 21 oauth + 16 verifier |
| Batch 4 | AUTH-04, AUTH-05, AUTH-06, AUTH-07 (login UI + internal + fixtures + OIDC discovery) | ✅ DONE | 2026-09-25 | 86 auth-mock |
| — | Coding Standards + Retrofit Batch 4 (TokenFactory + validateClient + status codes) | ✅ DONE | 2026-09-25 | — |
| Batch 5 | AUTH-12, AUTH-13, AUTH-14, AUTH-15 (session + guards + lazy sync + CSRF/helmet) | ✅ DONE | 2026-09-26 | 278 security |
| Batch 6 | AUTH-17 (payment-api BFF integration) | ⏳ NEXT | - | - |
| Batch 7 | AUTH-18, AUTH-19, AUTH-20, AUTH-27 | Pending | - | - |
| Batch 8 | AUTH-21, AUTH-22 | Pending | - | - |
| Batch 9 | AUTH-24 → AUTH-25 → AUTH-26 | Pending | - | - |
| Batch 10 | AUTH-28 (documentation) | Pending | - | - |

**Completed**: 18/28 tasks (64%) — Batch 1-5 + Coding Standards + Retrofit
**Tests**: 506 PASS total
- resilience: 58/58 (Plan 1)
- security: 278/278 (Plan 2 Batch 1-5: 104 existing + 174 new Batch 5)
- auth-mock: 86/86 (Plan 2 Batch 1-4)
- payment-api: 84/84 (Plan 1 + AUTH-15 throttler wiring)

**Quality gates** (per CODING_STANDARDS.md):
- typecheck: 0 errors (6 packages)
- lint: 0 errors, 30 warnings (pre-existing tech debt)
- jscpd duplication: 2.39% (17 clones — acceptable for codebase size)
- `pnpm check:all` ready: lint + check:duplication + typecheck + test

**Recent commits**:
- `d5b1298` fix(auth-mock): add /health endpoint (TECHNICAL_DEBT issue #11)
- `1e26e5e` feat(security): Batch 5 — AUTH-12, 13, 14, 15
- `b642231` chore(sandbox-sync): eslint auto-fix + .env sqlite setup for sandbox
- `15563b7` feat: Batch 4 + Coding Standards + Retrofit
- `2228f69` feat: Batch 3 AUTH-03 + AUTH-10

---

## 3. Konvensi Penamaan File & Komando Umum

Setiap file task memakai template yang sama (per plan2 + plan1 convention):

1. **Header** — Task ID, Plan version, Dependencies, Effort, Plan reference.
2. **Goal** — 1-2 kalimat tujuan task.
3. **Scope** — In scope + Out of scope (bullet points).
4. **Files to create/modify** — path absolut (relatif ke `/home/z/my-project/retry-failure/`).
5. **Implementation steps** — urutan konkret dengan code snippets dari plan2.
6. **Acceptance criteria** — checklist.
7. **Useful commands** — command yang WAJIB dijalankan setelah task selesai (verify).
8. **Notes** — catatan penting, trade-offs, referensi ke task lain.

### Command umum (tersedia di seluruh task)

```bash
# Install dependencies monorepo (root)
cd /home/z/my-project/retry-failure && pnpm install

# Lint (root)
cd /home/z/my-project/retry-failure && pnpm lint

# Typecheck (root)
cd /home/z/my-project/retry-failure && pnpm typecheck

# Build all
cd /home/z/my-project/retry-failure && pnpm build

# Run all tests
cd /home/z/my-project/retry-failure && pnpm test

# Dev mode (semua apps)
cd /home/z/my-project/retry-failure && pnpm dev

# Dev mode per-app
cd /home/z/my-project/retry-failure && pnpm --filter auth-mock start:dev        # port 4001
cd /home/z/my-project/retry-failure && pnpm --filter payment-api start:dev      # port 3001
cd /home/z/my-project/retry-failure && pnpm --filter payment-gateway-mock start:dev  # port 3002 (sandbox)
cd /home/z/my-project/retry-failure && pnpm --filter frontend-vue dev            # port 5173

# Test specific package
cd /home/z/my-project/retry-failure && pnpm --filter @retry-failure/security test
cd /home/z/my-project/retry-failure && pnpm --filter auth-mock test

# Typecheck specific package
cd /home/z/my-project/retry-failure && pnpm --filter @retry-failure/security typecheck
cd /home/z/my-project/retry-failure && pnpm --filter auth-mock typecheck
```

### Port assignments (per plan2 v1.2.2)

| Service | Port default | Catatan |
|---|---|---|
| `payment-api` (NestJS) | 3001 | via env `PORT` (v1.2.2 fix: 3001, bukan 3000) |
| `payment-gateway-mock` (NestJS) | 3002 | sandbox |
| `auth-mock` (NestJS) | 4001 | via env `AUTH_MOCK_PORT` |
| `frontend-vue` (Vite dev) | 5173 | Vite default |
| PostgreSQL | 5432 | docker-compose |
| Redis | 6379 | docker-compose (opsional — `SESSION_STORE=memory` untuk sandbox tanpa Redis) |
| Prometheus | 9090 | docker-compose |
| Grafana | 3003 | default 3000 → 3003 bila konflik |
| Jaeger UI | 16686 | docker-compose |
| OTel OTLP | 4318 | docker-compose |

> Bila port default konflik di lingkungan Anda, lihat [`../../../SANDBOX_NOTES.md`](../../../SANDBOX_NOTES.md) untuk strategi per kondisi (Local vs Sandbox).

### Akses cross-service

- `payment-api` → `auth-mock`: via env `AUTH_BASE_URL=http://localhost:4001` (jangan hardcode).
- `payment-api` → `payment-gateway-mock`: via env `GATEWAY_URL` (sudah ada dari plan1).
- `frontend-vue` → `payment-api`: via env `VITE_API_URL=http://localhost:3001`.

---

## 4. Source of Truth Files

| File | Description |
|---|---|
| [`../PLAN2-Auth_Integration.md`](../PLAN2-Auth_Integration.md) | Plan lengkap v1.2.2 (25 sections) — arsitektur, alur OAuth2, token strategy, cache model, lazy sync, testing, versioning, roadmap OAuth2 server |
| [`../AUTH_CONTRACT.md`](../AUTH_CONTRACT.md) | Auth contract v1.0.0 — OAuth2 endpoints, JWT claims, RS256 signing, error taxonomy, scopes |
| [`../CHANGELOG-AUTH.md`](../CHANGELOG-AUTH.md) | Changelog kontrak auth (SemVer) |
| [`../README.md`](../README.md) | Plan 2 index (source of truth + contract + changelog + key architecture) |
| [`../../../SANDBOX_NOTES.md`](../../../SANDBOX_NOTES.md) | Environment notes (Local vs Sandbox) — Pre-flight Check + Command Matrix |
| [`../../../README.md`](../../../README.md) | Root project README (quick start + services + structure) |
| [`../../plan1-cockatiel-retry-failure/README.md`](../../plan1-cockatiel-retry-failure/README.md) | Plan 1 — Cockatiel Retry/Failure (baseline) |
| `/home/z/my-project/worklog.md` | Worklog cross-agent — setiap sub-agent WAJIB baca + append entry |

---

## 5. Definition of Done (dari plan2 section 20.1 — Fase 1: Monorepo Retry)

Setelah semua 28 task (AUTH-01 sampai AUTH-28) selesai, verify DoD plan2 Fase 1:

### Auth-mock (AUTH-01 sampai AUTH-07)

- [ ] `apps/auth-mock` implementasi OAuth2 + PKCE lengkap (termasuk login page HTML).
- [ ] `/.well-known/jwks.json` expose RS256 public key dengan `kid`.
- [ ] `/.well-known/openid-configuration` return OIDC discovery document.
- [ ] `/oauth/authorize` + `/oauth/token` + `/oauth/revoke` berfungsi end-to-end.
- [ ] PKCE S256 wajib (reject `plain`).
- [ ] Multi-role flow: `budi_santoso` → select-role page; `superadmin` → langsung issue code.
- [ ] Refresh token rotation + reuse detection.
- [ ] `/api/v1/me/permissions` return user + role + permissionCodes per AUTH_CONTRACT section 6.
- [ ] `/api/v1/auth/switch-role` issue JWT baru dengan roleId baru.
- [ ] `/dev/token` dev shortcut (reject di production).
- [ ] Fixture users: `superadmin` (single role, isSuperAdmin=true) + `budi_santoso` (multi-role HRD + Finance).
- [ ] Password dev: `ChangeMe_123!`.
- [ ] E2E flow: login → token exchange → /me/permissions → switch-role → /me/permissions (role changed).

### packages/security (AUTH-08 sampai AUTH-15)

- [ ] `packages/security` lengkap: OAuth client + session store + guards + lazy sync + CSRF + Helmet + Throttler.
- [ ] `OAUTH_PATHS` konstanta (7 paths) + `AuthUser` interface (5 fields) + `Session` interface (11 fields) + `SessionStore` interface (8 methods).
- [ ] `OAuthClientService` (openid-client v5): discovery + PKCE + exchange + refresh + revoke + switch-role proxy.
- [ ] `JwksVerifier` (jose v5 `createRemoteJWKSet`): verify RS256 + cache + kid rotation + clock tolerance 5s.
- [ ] `SessionStore` Redis (production) + Memory (sandbox) — parity behavior.
- [ ] `SessionService` orchestrate create/get/delete/touch/updateSync/updateOnSwitchRole.
- [ ] Cookie `sid` HttpOnly + Secure + SameSite=Lax + Max-Age=28800.
- [ ] `SessionGuard` (cookie sid → req.user) + `MenuAccessGuard` (permission check + super admin bypass).
- [ ] `@Public()`, `@CurrentUser()`, `@RequireMenu()` decorators.
- [ ] `AUTH_MODE=disabled` berfungsi: skip guard, user palsu dari env.
- [ ] Bootstrap menolak `mock`/`disabled`/`memory` di production.
- [ ] `LazySyncMiddleware`: Fresh 5min → background sync → blocking 30min → grace 2h.
- [ ] Lock per sesi (anti-race): Redis `SET NX EX 10` / Memory `Map<string, number>`.
- [ ] Blocking sync timeout 2s — bila timeout, use stale cache + warning.
- [ ] `CsrfMiddleware` (double-submit cookie `XSRF-TOKEN` + `X-CSRF-Token` header + exempt paths `/auth/callback` + safe methods).
- [ ] `HelmetMiddleware` (HSTS, X-Content-Type-Options, X-Frame-Options, CSP, Referrer-Policy, Permissions-Policy).
- [ ] `@nestjs/throttler` rate limit: `/auth/login` + `/auth/callback` 10/min/IP, global default 100/min/IP.
- [ ] Unit test lulus untuk semua components.

### payment-api Integration (AUTH-16 sampai AUTH-19)

- [ ] DB migration: `cached_users` + `sessions` tables + `payments.user_id` (nullable).
- [ ] payment-api integrate `SecurityModule.forRoot` + BFF controller `/auth/*` (7 endpoints: session, login, callback, logout, refresh, switch-role, csrf).
- [ ] `@RequireMenu` decorators pada existing endpoints (POST /payments → payment.write, GET /payments → payment.read, POST /payments/:id/retry → payment.retry, GET /admin/gateway-config → payment.admin).
- [ ] `@Public()` di /health, /metrics, /docs, /auth/*.
- [ ] `AUTH_MODE=disabled` behavior: skip guards + fake user from env.
- [ ] Bootstrap validation `validateConfig()`: reject mock/disabled/memory in production.
- [ ] Observability: 7 metrics (oauth_token_exchange_total, oauth_refresh_total, session_active, auth_sync_total, auth_sync_duration_seconds, jwt_verify_total, menu_access_denied_total).
- [ ] OTel tracing spans: auth.callback, oauth.exchange, jwks.verify, lazy.sync, guard.session, guard.menu-access.
- [ ] Pino logging dengan redaction (token, refresh_token, client_secret, PII).

### FE Vue Integration (AUTH-20 sampai AUTH-22)

- [ ] Axios instance `withCredentials: true` + CSRF header interceptor + 401/403/429 response interceptor.
- [ ] Pinia `useAuthStore` (user, fetchSession, logout, hasMenu).
- [ ] Router `beforeEach` guard (public check, fetch session, menu check).
- [ ] Views: LoginRedirect, Callback, Forbidden, TooManyRequests (PrimeVue Card + countdown).
- [ ] Dynamic menu component `AppMenu.vue` (filter by `auth.permissionCodes`).
- [ ] Pinia `useMenuStore` (5 menu items per plan2 section 6.1).

### Docker + Tests + Docs (AUTH-23 sampai AUTH-28)

- [ ] Docker `sandbox` profile (postgres, auth-mock, payment-api, payment-gateway-mock, frontend-vue — no Redis/Jaeger).
- [ ] Docker `dev` profile (sandbox + redis + jaeger + prometheus + grafana).
- [ ] Root `package.json` scripts: dev, dev:sandbox, docker:up, docker:up:sandbox, db:migrate, test:e2e, test:contract.
- [ ] Unit tests (AUTH-24): PKCE + OAuth + JWKS + guards + lazy sync + parity + AUTH_MODE=disabled.
- [ ] Integration tests (AUTH-25): 10 scenarios per plan2 section 17.2.
- [ ] E2E tests (AUTH-26): single-role + multi-role + super admin + 403 + sandbox + disabled mode.
- [ ] Contract tests (AUTH-27): JWT claims + JWKS + permissions + error format (run vs auth-mock + auth asli).
- [ ] Documentation (AUTH-28): SANDBOX_NOTES update + README update + AUTH_CONTRACT review + auth-openapi.json + tasks/README statuses.
- [ ] Sandbox mode (`SESSION_STORE=memory`, tanpa Redis) berjalan.
- [ ] E2E lulus (mock).
- [ ] Contract test lulus (mock).
- [ ] Docker `sandbox` & `dev` profile berjalan.

---

## 6. Task-to-Plan Reference Matrix

| Task | Plan2 Section | Description |
|---|---|---|
| AUTH-01 | 10 (apps/auth-mock), 2.3 (auth-mock stack), 10.7.1, 10.7.2 | Scaffold NestJS app + folder structure + main.ts bootstrap |
| AUTH-02 | 5.1 (Signing), 10.3 (Signing dev), 2.3 (jose v5), 9.1 (jwks path), 25.3.A | RS256 keypair generate + JWKS endpoint + `kid` thumbprint |
| AUTH-03 | 10.1 (scope), 4.1 (diagram), 4.3 (PKCE), 10.2 (client reg), 10.5 (multi-role), 5.1-5.5, 9.1 | OAuth2 endpoints: authorize + token + revoke + PKCE + refresh rotation |
| AUTH-04 | 10.7 (Halaman UI), 10.7.1-10.7.10 | EJS templates (login, select-role, error) + CSS + auth session cookie |
| AUTH-05 | 10.1 (scope), 10.6 (response), 5.6 (switch-role flow), 25.3.G, 9.1 | `/api/v1/me/permissions` + `/api/v1/auth/switch-role` + `/dev/token` |
| AUTH-06 | 10.4 (fixture), 6.1 (menu codes), 5.2 (JWT payload), 10.6, AUTH_CONTRACT 4+6 | Fixture users + roles + permissions (superadmin + budi_santoso) |
| AUTH-07 | 10.1 (scope), 25.3.H (discovery JSON), 9.1 (discovery path), 15.4 | OIDC discovery endpoint + discovery document JSON |
| AUTH-08 | 9 (packages/security structure), 9.1 (endpoints), 9.2 (AuthUser), 9.4.4 (forRoot) | Scaffold security package: folder + types + module factory |
| AUTH-09 | 9 (oauth-client), 4.3 (PKCE), 4.1 (diagram), 2.3 (openid-client v5), 5.4, 5.6, 15.4 | OAuthClientService: discovery + PKCE + exchange + refresh + revoke + switch-role proxy |
| AUTH-10 | 5.1 (Signing), 2.3 (jose v5), 9 (verifiers), 16 (env), 21.2 (rotation), 9.3 | JwksVerifier (createRemoteJWKSet + cache + kid rotation + clock tolerance) + MockVerifier |
| AUTH-11 | 9.4 (SessionStore), 9.4.1-9.4.4, 8.3 (lock), 4.4 | SessionStore interface + Redis impl (SCAN, SET NX EX) + Memory impl (LRU + Map lock) |
| AUTH-12 | 4.4 (session store), 12.1 (Cookie), 7.2 (sessions table), 7.1 (cached_users), 5.3 (expiry), 9.4.1 | SessionService (create/get/delete/touch/updateSync) + cookie helper + CacheRepository (TypeORM) |
| AUTH-13 | 6.4 (MenuAccessGuard), 9.3 (AUTH_MODE), 9.3.1 (disabled), 9.3.2 (production), 6.2 (mapping), 6.3 (super admin) | SessionGuard (cookie → req.user) + MenuAccessGuard (permission + super admin bypass) + decorators + AUTH_MODE=disabled |
| AUTH-14 | 8 (Lazy Sync), 8.1-8.7, 16 (env SYNC_*) | LazySyncMiddleware (SWR pattern: fresh 5min → background → blocking 30min → grace 2h) + SyncLockService + AuthSyncService + withTimeout |
| AUTH-15 | 12.3 (CSRF), 12.4 (Helmet), 12.5 (Rate limiting), 12.1 (Cookie), 12.2 (CORS), 16 (env) | CsrfMiddleware (double-submit cookie) + HelmetMiddleware (6 headers) + ThrottlerModule (10/min for /auth/login+callback) |
| AUTH-16 | 7.1 (cached_users), 7.2 (sessions), 7.3 (payments.user_id nullable), 7.4-7.5 (design) | DB migration 0003 (cached_users) + 0004 (sessions + 4 indexes + GIN) + 0005 (payments.user_id nullable + FK) |
| AUTH-17 | 4.2 (BFF endpoints), 4.3 (PKCE), 16 (Configuration), 9.3 (AUTH_MODE), 9.3.1-9.3.2 (disabled + production), 12.1 (Cookie) | payment-api AuthController (7 endpoints) + AuthService + middleware wiring + Joi validation + bootstrap validation + SecurityModule integration |
| AUTH-18 | 6.2 (Mapping endpoint → menu), 6.4 (MenuAccessGuard), 9.3 (AUTH_MODE), 9.3.1 (disabled behavior), 9.3.2 (production), 16 (bootstrap validation) | @RequireMenu decorators on existing endpoints + @Public() on /health,/metrics,/docs + AUTH_MODE=disabled behavior + bootstrap validation function |
| AUTH-19 | 13 (Observability), 13.1 (Logging redaction), 13.2 (7 metrics), 13.3 (Tracing spans) | 7 Prometheus metrics + OTel tracing spans + pino logging with redaction + otelSDK init in main.ts |
| AUTH-20 | 11.3 (Aturan), 11.4 (Axios interceptor), 11.2 (Struktur), 12.3 (CSRF), 12.1 (Cookie) | FE Vue axios instance + interceptors (CSRF header + 401/403/429) + Pinia auth store + authApi helpers + types |
| AUTH-21 | 11.5 (Route guard), 11.2 (Views), 11.3 (Aturan redirect) | FE Vue router beforeEach guard + LoginRedirect.vue + Callback.vue + Forbidden.vue + TooManyRequests.vue + router/index.ts update |
| AUTH-22 | 11.2 (components/AppMenu.vue), 6.1 (Menu codes), 6.2 (Mapping) | FE Vue AppMenu.vue (PrimeVue Menubar) + Pinia menuStore + 5 menu items per plan2 section 6.1 + filter by permissionCodes |
| AUTH-23 | 14 (Docker & Dev Workflow), 14.1-14.3 (Profiles + scripts), 14.4-14.6 (Env) | docker-compose.yml update (auth-mock + redis) + docker-compose.sandbox.yml (no Redis/Jaeger) + root package.json scripts + .env.example + .env.sandbox.example |
| AUTH-24 | 17.1 (Unit tests), 9.3 (AUTH_MODE), 9.4 (SessionStore) | Unit tests packages/security — PKCE (RFC 7636 vector) + OAuth client (mock openid-client) + JWKS verifier (mock keys + alg confusion attack) + guards + lazy sync + parity (Redis mock vs Memory) + AUTH_MODE=disabled + bootstrap validation |
| AUTH-25 | 17.2 (Integration tests), 4 (OAuth flow), 6 (MenuAccessGuard) | payment-api integration tests — 10 scenarios per plan2 section 17.2 (login redirect, callback, session, 401, 200, 403, super admin, logout, switch-role, AUTH_MODE=disabled) |
| AUTH-26 | 17.3 (E2E lintas service), 17.6 (Sandbox test), 10.5 (Multi-role) | E2E dengan real auth-mock — single-role login + multi-role + super admin + 403 + sandbox mode (memory store) + AUTH_MODE=disabled mode |
| AUTH-27 | 17.5 (Contract test), 25.7 (Contract test), 25.8 (Kompatibilitas) | Contract tests vs AUTH_CONTRACT.md v1.0.0 — JWT claims (8 claims + types) + JWKS endpoint + /api/v1/me/permissions response format + error format (400/401/403/429) + endpoint paths |
| AUTH-28 | 19.1 step 12 (Docs), 20.1 (DoD docs), 18.6 (Files involved) | SANDBOX_NOTES update + plan2 README update + AUTH_CONTRACT review + auth-openapi.json (OpenAPI 3.1) + tasks/README statuses + root README update |

---

## 7. Cross-Reference Documents

- [`../../README.md`](../../README.md) — Global docs index (Plan 1 + Plan 2 + cross-plan).
- [`../../SANDBOX_NOTES.md`](../../SANDBOX_NOTES.md) — Environment notes (Local vs Sandbox).
- [`../../plan1-cockatiel-retry-failure/tasks/README.md`](../../plan1-cockatiel-retry-failure/tasks/README.md) — Plan 1 task index (baseline).
- [`../../plan1-cockatiel-retry-failure/README.md`](../../plan1-cockatiel-retry-failure/README.md) — Plan 1 index.
- [`../../../CONTRIBUTING.md`](../../../CONTRIBUTING.md) — Contribution guide (lint, test, typecheck rules).

---

## 8. RFC References (per plan2 section 22)

| RFC | Title | Relevance |
|---|---|---|
| [RFC 6749](https://datatracker.ietf.org/doc/html/rfc6749) | OAuth 2.0 Framework | Authorization Code flow, token endpoint, error response |
| [RFC 7009](https://datatracker.ietf.org/doc/html/rfc7009) | OAuth 2.0 Token Revocation | `/oauth/revoke` endpoint behavior |
| [RFC 7636](https://datatracker.ietf.org/doc/html/rfc7636) | Proof Key for Code Exchange (PKCE) | `code_verifier` + `code_challenge` S256 |
| [RFC 9700](https://datatracker.ietf.org/doc/html/rfc9700) | OAuth 2.0 Security BCP | PKCE wajib meski confidential client |
| [RFC 7517](https://datatracker.ietf.org/doc/html/rfc7517) | JSON Web Key (JWK) | JWKS format + `kid` thumbprint |
| [RFC 8725](https://datatracker.ietf.org/doc/html/rfc8725) | JSON Web Token (JWT) BCP | JWT claims best practices |
| [OIDC Discovery 1.0](https://openid.net/specs/openid-connect-discovery-1_0.html) | OpenID Connect Discovery | `/.well-known/openid-configuration` |
| [OWASP ASVS](https://owasp.org/www-project-application-security-verification-standard/) | Application Security Verification Standard | Cookie, CSRF, security headers |
| [SemVer](https://semver.org/) | Semantic Versioning | Plan + contract + API + auth service versioning |
