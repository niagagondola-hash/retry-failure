# AUTH-28 — Documentation (SANDBOX_NOTES update + README + AUTH_CONTRACT update + auth-openapi.json)

> **Task ID**: AUTH-28
> **Plan**: Plan 2 — Auth Integration (v1.2.2)
> **Depends on**: AUTH-26
> **Estimated effort**: M (~2 jam)
> **Plan reference**: Section 19.1 step 12 (Documentation), Section 20.1 (DoD docs), Section 18.6 (Files involved: AUTH_CONTRACT.md + auth-openapi.json), Section 14 (Docker env vars)

---

## Goal

Update semua dokumentasi Plan2 Fase 1 setelah implementation selesai:
1. `docs/SANDBOX_NOTES.md` — tambah auth-mock port 4001, `AUTH_MODE` env vars, `SESSION_STORE=memory` untuk sandbox.
2. `docs/plan2-auth-integration/README.md` — link ke `tasks/` + status implementation.
3. `docs/plan2-auth-integration/AUTH_CONTRACT.md` — update bila ada perubahan selama implementation.
4. `docs/plan2-auth-integration/auth-openapi.json` — generate dari auth-mock endpoints.
5. `docs/plan2-auth-integration/tasks/README.md` — mark task statuses (done/pending).
6. Root `README.md` — add auth-mock ke services table + quick start.

## Scope

**In scope**:
- **`docs/SANDBOX_NOTES.md`** — UPDATE:
  - Section "Pre-flight Check" — tambah deteksi port 4001 (auth-mock) + 5173 (FE Vue).
  - Section "Command Matrix" — tambah commands: `pnpm docker:up`, `pnpm docker:up:sandbox`, `pnpm --filter auth-mock start:dev`, `pnpm --filter frontend-vue dev`.
  - Section "Auth env vars" (NEW) — document `AUTH_MODE`, `AUTH_BASE_URL`, `SESSION_STORE`, `AUTH_DISABLED_*`, dll.
  - Section "Sandbox vs Dev" — jelaskan profile differences (sandbox: no Redis/Jaeger, dev: full).
  - Section "Troubleshooting" — tambah:
    - Auth-mock not responding → check port 4001 + start with `pnpm --filter auth-mock start:dev`.
    - OAuth flow stuck at callback → check `OAUTH_REDIRECT_URI` env match between payment-api + auth-mock client registration.
    - CSRF 403 on POST → check `XSRF-TOKEN` cookie + `X-CSRF-Token` header match.
    - Session lost after restart (sandbox) → `SESSION_STORE=memory` tidak persist, expect ini.
- **`docs/plan2-auth-integration/README.md`** — UPDATE:
  - "Tasks" section — link ke `tasks/README.md` (currently placeholder "Folder `tasks/` akan dibuat saat implementasi plan2 dimulai.").
  - "Implementation status" (NEW) — checklist per AUTH-XX task (done/pending).
  - "Quick start" (NEW) — `pnpm docker:up:sandbox` + open `http://localhost:5173`.
- **`docs/plan2-auth-integration/AUTH_CONTRACT.md`** — UPDATE (bila perlu):
  - Review seluruh contract selama implementation.
  - Update bila ada perubahan (e.g., new optional claim, additional endpoint, error format tweak).
  - Bump version (PATCH untuk typo, MINOR untuk addition, MAJOR untuk breaking).
  - Update `Last updated` date.
  - Add changelog entry di `CHANGELOG-AUTH.md`.
- **`docs/plan2-auth-integration/auth-openapi.json`** — NEW (generate):
  - OpenAPI 3.1 spec dari auth-mock endpoints (7 endpoints):
    - `GET /oauth/authorize` (302 redirect).
    - `POST /oauth/token` (return TokenSet).
    - `POST /oauth/revoke` (return 200).
    - `GET /.well-known/jwks.json` (return JWKS).
    - `GET /.well-known/openid-configuration` (return OIDC discovery).
    - `GET /api/v1/me/permissions` (return user + role + permissionCodes).
    - `POST /api/v1/auth/switch-role` (return new TokenSet).
  - Schemas: JWT payload, TokenSet, JWKS, Permissions response, Error responses.
  - `info.version` match `AUTH_CONTRACT.md` version (1.0.0).
  - Bisa di-generate via `@nestjs/swagger` (SwaggerModule.createDocument) di auth-mock, atau tulis manual.
- **`docs/plan2-auth-integration/tasks/README.md`** — UPDATE:
  - "Execution Order & Task IDs" table — add column "Status" (done/pending/blocked).
  - Mark AUTH-01 to AUTH-28 statuses.
  - Update "Recommended execution batches" bila ada perubahan urutan.
  - "DoD plan2 Fase 1" checklist — mark items as `[x]` bila implemented.
- **`docs/plan2-auth-integration/CHANGELOG-AUTH.md`** — UPDATE:
  - Add entry untuk kontrak changes during implementation (bila ada).
  - Format: SemVer + date + breaking/non-breaking + description.
- **Root `README.md`** — UPDATE:
  - "Services" table — add `auth-mock` (port 4001) + link ke `docs/plan2-auth-integration/`.
  - "Quick Start" — add `pnpm docker:up:sandbox` step.
  - "Project Structure" — add `apps/auth-mock/` + `packages/security/` + `docs/plan2-auth-integration/`.
- **`docs/README.md`** (global docs index) — UPDATE:
  - Add link ke `docs/plan2-auth-integration/` (Plan 2 — Auth Integration).
- **`CONTRIBUTING.md`** (root) — UPDATE (opsional):
  - Add note tentang auth-mock + packages/security — how to run tests, how to add new endpoints.

**Out of scope**:
- User-facing documentation (tutorial, getting started guide) → di luar scope.
- API documentation for FE Vue (Component Story Format) → di luar scope.
- Video tutorial → di luar scope.
- Translation (English ↔ Indonesian) → di luar scope.
- Migration guide dari Plan1 → di luar scope (Plan1 + Plan2 coexist di monorepo).

## Files to create/modify

- `docs/SANDBOX_NOTES.md` — UPDATE
- `docs/plan2-auth-integration/README.md` — UPDATE
- `docs/plan2-auth-integration/AUTH_CONTRACT.md` — UPDATE (bila perlu)
- `docs/plan2-auth-integration/CHANGELOG-AUTH.md` — UPDATE
- `docs/plan2-auth-integration/auth-openapi.json` — NEW
- `docs/plan2-auth-integration/tasks/README.md` — UPDATE (mark statuses)
- `README.md` (root) — UPDATE
- `docs/README.md` — UPDATE (global index)
- `CONTRIBUTING.md` (root) — UPDATE (opsional)
- `apps/auth-mock/src/swagger.ts` — NEW (opsional, untuk generate OpenAPI via @nestjs/swagger)

## Implementation steps

1. **`docs/SANDBOX_NOTES.md`** — UPDATE (per AUTH-23 docker setup):
   - Add section "Auth Service (auth-mock)":
     - Port: 4001 (via env `AUTH_MOCK_PORT`).
     - Start: `pnpm --filter auth-mock start:dev` or `pnpm docker:up:sandbox`.
     - Healthcheck: `curl http://localhost:4001/.well-known/openid-configuration`.
   - Add section "Auth env vars" (table dari plan2 section 16):
     - `AUTH_MODE` (oauth/mock/disabled) — default per profile.
     - `AUTH_BASE_URL` — auth service URL.
     - `SESSION_STORE` (redis/memory) — sandbox uses memory.
     - `AUTH_DISABLED_*` — fake user untuk `AUTH_MODE=disabled`.
   - Update "Pre-flight Check":
     - Check port 4001 (auth-mock) + 5173 (FE Vue).
     - Check `.env` has `AUTH_MODE` + `SESSION_STORE` set.
   - Update "Command Matrix":
     - `pnpm docker:up` (dev profile with Redis/Jaeger).
     - `pnpm docker:up:sandbox` (sandbox profile without Redis/Jaeger).
     - `pnpm --filter auth-mock start:dev` (manual auth-mock).
     - `pnpm --filter frontend-vue dev` (manual FE Vue).
   - Add "Troubleshooting" subsections:
     - "OAuth callback fails with 400" → check `OAUTH_REDIRECT_URI` env.
     - "CSRF 403 on POST" → check `XSRF-TOKEN` cookie + `X-CSRF-Token` header.
     - "Session lost after restart" → `SESSION_STORE=memory` doesn't persist.

2. **`docs/plan2-auth-integration/README.md`** — UPDATE:
   - Replace "Tasks" section placeholder dengan:
     ```md
     ## Tasks

     Detailed task files (28 tasks: AUTH-01 to AUTH-28) tersedia di:
     - [`tasks/README.md`](./tasks/README.md) — index + execution order + dependency graph.
     - [`tasks/AUTH-XX-*.md`](./tasks/) — individual task files dengan scope, steps, acceptance criteria, useful commands.
     ```
   - Add "Implementation status" section (NEW):
     ```md
     ## Implementation status (Plan2 Fase 1)

     | Task | Title | Status |
     |---|---|---|
     | AUTH-01..07 | auth-mock (OAuth2 reference) | ✅ Done |
     | AUTH-08..14 | packages/security | ✅ Done |
     | AUTH-15 | CSRF + helmet + throttler | ✅ Done |
     | AUTH-16 | DB migrations | ✅ Done |
     | AUTH-17 | payment-api BFF integration | ✅ Done |
     | AUTH-18 | Existing endpoints @RequireMenu | ✅ Done |
     | AUTH-19 | Observability | ✅ Done |
     | AUTH-20..22 | FE Vue auth flow + router + menu | ✅ Done |
     | AUTH-23 | Docker profiles | ✅ Done |
     | AUTH-24..26 | Tests (unit + integration + E2E) | ✅ Done |
     | AUTH-27 | Contract tests | ✅ Done |
     | AUTH-28 | Documentation | ✅ Done |
     ```
   - Add "Quick start" section:
     ```md
     ## Quick start

     ```bash
     # Clone repo, install deps
     pnpm install

     # Start sandbox profile (no Redis, fastest)
     pnpm docker:up:sandbox

     # Run DB migration
     pnpm db:migrate

     # Open FE Vue
     open http://localhost:5173

     # Login with dev credentials:
     # Username: budi_santoso
     # Password: ChangeMe_123!
     ```
     ```

3. **`docs/plan2-auth-integration/AUTH_CONTRACT.md`** — UPDATE:
   - Review seluruh content selama implementation (post-mortem).
   - Bila ada perubahan (e.g., additional optional claim, new endpoint added, error format tweak):
     - Update content.
     - Bump version (header `> **Version**: X.Y.Z`).
     - Update `Last updated` date.
     - Add changelog entry.
   - Bila tidak ada perubahan: leave as-is, just verify version 1.0.0 still accurate.
   - Update `redirect_uri` example dari `http://localhost:3000/auth/callback` ke `http://localhost:3001/auth/callback` (per plan2 v1.2.2 port fix).

4. **`docs/plan2-auth-integration/CHANGELOG-AUTH.md`** — UPDATE:
   - Add entry untuk kontrak changes during implementation (bila ada):
     ```md
     ## [1.0.1] - 2026-XX-XX

     ### Changed
     - Updated `redirect_uri` example dari `localhost:3000` ke `localhost:3001` (per plan2 v1.2.2 fix).
     - Clarified `permissionCodes` response format: array of strings, non-empty.

     ### Added
     - Documented `kid` rotation behavior (Section 5 — dual-key period).
     ```
   - Bila no changes: add minimal entry "No changes during implementation — contract stable."

5. **`docs/plan2-auth-integration/auth-openapi.json`** — NEW (OpenAPI 3.1 spec):
   ```json
   {
     "openapi": "3.1.0",
     "info": {
       "title": "Auth Service API",
       "version": "1.0.0",
       "description": "OAuth2 + OIDC + internal endpoints per AUTH_CONTRACT.md v1.0.0",
       "contact": { "name": "Auth Team" }
     },
     "servers": [
       { "url": "http://localhost:4001", "description": "Dev (auth-mock)" },
       { "url": "https://staging.auth.example.com", "description": "Staging (auth asli)" }
     ],
     "paths": {
       "/oauth/authorize": {
         "get": {
           "summary": "Authorization endpoint",
           "parameters": [
             { "name": "response_type", "in": "query", "required": true, "schema": { "type": "string", "enum": ["code"] } },
             { "name": "client_id", "in": "query", "required": true, "schema": { "type": "string" } },
             { "name": "redirect_uri", "in": "query", "required": true, "schema": { "type": "string", "format": "uri" } },
             { "name": "scope", "in": "query", "required": false, "schema": { "type": "string" } },
             { "name": "state", "in": "query", "required": true, "schema": { "type": "string" } },
             { "name": "code_challenge", "in": "query", "required": true, "schema": { "type": "string" } },
             { "name": "code_challenge_method", "in": "query", "required": true, "schema": { "type": "string", "enum": ["S256"] } }
           ],
           "responses": {
             "302": { "description": "Redirect to callback URL with code+state" },
             "400": { "$ref": "#/components/responses/BadRequest" }
           }
         }
       },
       "/oauth/token": {
         "post": {
           "summary": "Token endpoint",
           "requestBody": { "required": true, "content": { "application/x-www-form-urlencoded": { "schema": { "$ref": "#/components/schemas/TokenRequest" } } } },
           "responses": {
             "200": { "description": "TokenSet", "content": { "application/json": { "schema": { "$ref": "#/components/schemas/TokenSet" } } } },
             "400": { "$ref": "#/components/responses/BadRequest" },
             "401": { "$ref": "#/components/responses/Unauthorized" }
           }
         }
       },
       "/oauth/revoke": {
         "post": {
           "summary": "Token revocation (RFC 7009)",
           "requestBody": { "required": true, "content": { "application/x-www-form-urlencoded": { "schema": { "$ref": "#/components/schemas/RevokeRequest" } } } },
           "responses": { "200": { "description": "OK" } }
         }
       },
       "/.well-known/jwks.json": {
         "get": {
           "summary": "JWKS endpoint (RFC 7517)",
           "responses": {
             "200": { "description": "JWKS", "content": { "application/json": { "schema": { "$ref": "#/components/schemas/Jwks" } } } }
           }
         }
       },
       "/.well-known/openid-configuration": {
         "get": {
           "summary": "OIDC Discovery (OIDC Discovery 1.0)",
           "responses": { "200": { "description": "Discovery document", "content": { "application/json": { "schema": { "$ref": "#/components/schemas/DiscoveryDocument" } } } } }
         }
       },
       "/api/v1/me/permissions": {
         "get": {
           "summary": "Get user + role + permissionCodes",
           "security": [{ "bearerAuth": [] }],
           "responses": {
             "200": { "description": "Permissions", "content": { "application/json": { "schema": { "$ref": "#/components/schemas/PermissionsResponse" } } } },
             "401": { "$ref": "#/components/responses/Unauthorized" }
           }
         }
       },
       "/api/v1/auth/switch-role": {
         "post": {
           "summary": "Switch active role",
           "security": [{ "bearerAuth": [] }],
           "requestBody": { "required": true, "content": { "application/json": { "schema": { "$ref": "#/components/schemas/SwitchRoleRequest" } } } },
           "responses": {
             "200": { "description": "New TokenSet", "content": { "application/json": { "schema": { "$ref": "#/components/schemas/TokenSet" } } } },
             "401": { "$ref": "#/components/responses/Unauthorized" },
             "403": { "$ref": "#/components/responses/Forbidden" }
           }
         }
       }
     },
     "components": {
       "securitySchemes": { "bearerAuth": { "type": "http", "scheme": "bearer", "bearerFormat": "JWT" } },
       "responses": {
         "BadRequest": { "description": "Bad Request", "content": { "application/json": { "schema": { "$ref": "#/components/schemas/Error" } } } },
         "Unauthorized": { "description": "Unauthorized", "content": { "application/json": { "schema": { "$ref": "#/components/schemas/Error" } } } },
         "Forbidden": { "description": "Forbidden", "content": { "application/json": { "schema": { "$ref": "#/components/schemas/Error" } } } }
       },
       "schemas": {
         "TokenRequest": { "type": "object", "required": ["grant_type"], "properties": {
           "grant_type": { "type": "string", "enum": ["authorization_code", "refresh_token"] },
           "code": { "type": "string" },
           "redirect_uri": { "type": "string", "format": "uri" },
           "client_id": { "type": "string" },
           "client_secret": { "type": "string" },
           "code_verifier": { "type": "string" },
           "refresh_token": { "type": "string" }
         } },
         "TokenSet": { "type": "object", "required": ["access_token", "token_type"], "properties": {
           "access_token": { "type": "string" },
           "token_type": { "type": "string", "enum": ["Bearer"] },
           "expires_in": { "type": "integer" },
           "refresh_token": { "type": "string" },
           "id_token": { "type": "string" }
         } },
         "Jwks": { "type": "object", "required": ["keys"], "properties": {
           "keys": { "type": "array", "items": { "$ref": "#/components/schemas/Jwk" } }
         } },
         "Jwk": { "type": "object", "required": ["kty", "use", "alg", "kid", "n", "e"], "properties": {
           "kty": { "type": "string", "enum": ["RSA"] },
           "use": { "type": "string", "enum": ["sig"] },
           "alg": { "type": "string", "enum": ["RS256"] },
           "kid": { "type": "string" },
           "n": { "type": "string" },
           "e": { "type": "string" }
         } },
         "PermissionsResponse": { "type": "object", "required": ["success", "data"], "properties": {
           "success": { "type": "boolean" },
           "data": { "type": "object", "required": ["user", "role", "permissionCodes"], "properties": {
             "user": { "$ref": "#/components/schemas/User" },
             "role": { "$ref": "#/components/schemas/Role" },
             "permissionCodes": { "type": "array", "items": { "type": "string" } }
           } }
         } },
         "User": { "type": "object", "required": ["id", "username", "name", "isSuperAdmin"], "properties": {
           "id": { "type": "string", "format": "uuid" },
           "username": { "type": "string" },
           "email": { "type": "string", "format": "email", "nullable": true },
           "name": { "type": "string" },
           "isSuperAdmin": { "type": "boolean" }
         } },
         "Role": { "type": "object", "required": ["id", "name"], "properties": {
           "id": { "type": "string", "format": "uuid" },
           "name": { "type": "string" }
         } },
         "SwitchRoleRequest": { "type": "object", "required": ["roleId"], "properties": {
           "roleId": { "type": "string", "format": "uuid" }
         } },
         "Error": { "type": "object", "required": ["statusCode", "message"], "properties": {
           "statusCode": { "type": "integer" },
           "message": { "type": "string" },
           "retryAfter": { "type": "integer", "description": "Seconds to wait before retry (only for 429)" }
         } }
       }
     }
   }
   ```

6. **`docs/plan2-auth-integration/tasks/README.md`** — UPDATE:
   - Add column "Status" di "Execution Order & Task IDs" table:
     ```md
     | Task ID | File | Title | Depends on | Est. | Status |
     |---|---|---|---|---|---|
     | AUTH-01 | ... | Scaffold apps/auth-mock | - | S | ✅ |
     | AUTH-02 | ... | RS256 keypair + JWKS | AUTH-01 | M | ✅ |
     | ... |
     | AUTH-15 | ... | CSRF + helmet + throttler | AUTH-13 | M | ✅ |
     | ... |
     | AUTH-28 | ... | Documentation | AUTH-26 | M | ✅ |
     ```
   - Update "Definition of Done (Fase 1)" checklist — mark items as `[x]` bila implemented.

7. **Root `README.md`** — UPDATE:
   - "Services" table — add `auth-mock` (port 4001) + link ke `docs/plan2-auth-integration/`.
   - "Quick Start" — add `pnpm docker:up:sandbox` step (after `pnpm install`).
   - "Project Structure" — add `apps/auth-mock/`, `packages/security/`, `docs/plan2-auth-integration/`.

8. **`docs/README.md`** (global docs index) — UPDATE:
   - Add entry for `docs/plan2-auth-integration/`:
     ```md
     - [Plan 2 — Auth Integration](./plan2-auth-integration/README.md) — OAuth2 + PKCE + RS256 + session cache (v1.2.2)
     ```

9. **`CONTRIBUTING.md`** — UPDATE (opsional):
   - Add section "Auth + Security":
     - How to run auth-mock: `pnpm --filter auth-mock start:dev`.
     - How to run security tests: `pnpm --filter @retry-failure/security test`.
     - How to add new menu code: update plan2 section 6.1 + AUTH_CONTRACT.md + auth-mock fixtures.

10. **Verify documentation accuracy**:
    - Cross-check `SANDBOX_NOTES.md` commands match actual scripts di `package.json`.
    - Cross-check `auth-openapi.json` schemas match `AUTH_CONTRACT.md` Section 4-7.
    - Cross-check `tasks/README.md` statuses match actual implementation (semua `✅` bila done).
    - Cross-check root `README.md` services table match actual services.

## Acceptance criteria

- [ ] `docs/SANDBOX_NOTES.md` updated dengan: auth-mock port 4001, AUTH_MODE env vars, SESSION_STORE=memory sandbox note, troubleshooting subsections.
- [ ] `docs/plan2-auth-integration/README.md` updated dengan: link ke `tasks/`, implementation status table (28 tasks), quick start guide.
- [ ] `docs/plan2-auth-integration/AUTH_CONTRACT.md` reviewed (update bila perlu, bump version + changelog bila ada changes).
- [ ] `docs/plan2-auth-integration/CHANGELOG-AUTH.md` updated dengan entry untuk implementation phase.
- [ ] `docs/plan2-auth-integration/auth-openapi.json` created — OpenAPI 3.1 spec dengan 7 endpoints + schemas (TokenRequest, TokenSet, Jwks, PermissionsResponse, Error, etc.) + `info.version` matches AUTH_CONTRACT version.
- [ ] `docs/plan2-auth-integration/tasks/README.md` updated dengan Status column (all 28 tasks marked ✅ bila implemented).
- [ ] Root `README.md` updated: auth-mock in services table, quick start with `pnpm docker:up:sandbox`, project structure with `apps/auth-mock/` + `packages/security/`.
- [ ] `docs/README.md` updated with link to `plan2-auth-integration/`.
- [ ] `CONTRIBUTING.md` updated (opsional) with auth + security section.
- [ ] All cross-references accurate (commands match scripts, schemas match contract, statuses match implementation).
- [ ] All files have correct version numbers (e.g., plan2 v1.2.2, AUTH_CONTRACT v1.0.0).
- [ ] All Markdown files lint clean (no broken links, valid headers).

## Useful commands

```bash
# Verify documentation cross-references
cd  && pnpm markdownlint docs/

# Generate auth-openapi.json via Swagger (opsional — bila pakai @nestjs/swagger di auth-mock)
cd  && pnpm --filter auth-mock start:dev &
sleep 5
curl -s http://localhost:4001/api-json -o docs/plan2-auth-integration/auth-openapi.json

# Or validate the manually-written OpenAPI spec
cd  && npx @redocly/cli@latest lint docs/plan2-auth-integration/auth-openapi.json

# Verify links in markdown files
cd  && npx markdown-link-check docs/plan2-auth-integration/README.md
cd  && npx markdown-link-check docs/SANDBOX_NOTES.md

# Typecheck (no code changes, just docs)
cd  && pnpm typecheck

# Lint
cd  && pnpm lint

# Final verify — open documentation:
# 1. docs/SANDBOX_NOTES.md — Pre-flight Check + Auth env vars + troubleshooting
# 2. docs/plan2-auth-integration/README.md — quick start + implementation status
# 3. docs/plan2-auth-integration/tasks/README.md — task statuses
# 4. docs/plan2-auth-integration/auth-openapi.json — OpenAPI spec (render via Swagger Editor)
# 5. Root README.md — services table + quick start
```

## Notes

- **Plan2 section 19.1 step 12** — Documentation: `AUTH_CONTRACT.md`, `SANDBOX_NOTES.md`, `CHANGELOG-AUTH.md`.
- **Plan2 section 20.1 DoD** — "Dokumentasi: `AUTH_CONTRACT.md`, `CHANGELOG-AUTH.md`, `SANDBOX_NOTES.md`".
- **Plan2 section 18.6 files yang terlibat**:
  - `PLAN-Auth_Integration.md` — SemVer di header (v1.2.2).
  - `AUTH_CONTRACT.md` — SemVer di header (v1.0.0).
  - `CHANGELOG-AUTH.md` — Riwayat.
  - `auth-openapi.json` — `info.version` (1.0.0, match AUTH_CONTRACT).
- **OpenAPI generation**:
  - Option A (manual): tulis `auth-openapi.json` manual based on AUTH_CONTRACT.md (controls content + examples).
  - Option B (auto): install `@nestjs/swagger` di auth-mock + SwaggerModule.createDocument() → generate JSON on startup. Then `curl http://localhost:4001/api-json > auth-openapi.json`.
  - Rekomendasi: Option A untuk contract-authoritative (spec is source of truth). Option B untuk generated (auto-sync with code).
- **Documentation lifecycle**:
  - Bila AUTH_CONTRACT.md updated (tim auth rilis versi baru) → regenerate auth-openapi.json + re-run contract tests.
  - Bila implementation menemukan kontrak ambigu → update AUTH_CONTRACT.md + bump version.
- **Markdown linting**:
  - `markdownlint` — style consistency.
  - `markdown-link-check` — verify all links valid.
  - Run di CI untuk catch broken links.
- **Implementation status table** di `tasks/README.md`:
  - Update saat task selesai (`✅`), in-progress (`🔄`), blocked (`⛔`), pending (`⬜`).
  - Setelah Plan2 Fase 1 done, semua 28 tasks harus `✅`.
- **Root README.md services table** — per plan2 v1.2.2 ports:
  | Service | Port | Profile |
  |---|---|---|
  | payment-api | 3001 | sandbox + dev + full |
  | payment-gateway-mock | 3002 | sandbox + dev + full |
  | auth-mock | 4001 | sandbox + dev + full |
  | frontend-vue | 5173 | sandbox + dev + full |
  | postgres | 5432 | sandbox + dev + full |
  | redis | 6379 | dev + full (NOT sandbox) |
  | jaeger | 16686 | dev + full |
  | prometheus | 9090 | dev + full |
  | grafana | 3003 | dev + full |
- Setelah task ini selesai, **Plan2 Fase 1 (Monorepo Retry)** selesai sepenuhnya — semua 12 langkah implementasi per plan2 section 19.1 done. Plan2 Fase 2 (OAuth2 Server di Repo Auth) + Fase 3 (Integrasi Auth Asli) dapat dimulai secara paralel/independen.
