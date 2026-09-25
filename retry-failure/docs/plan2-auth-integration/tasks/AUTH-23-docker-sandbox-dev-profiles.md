# AUTH-23 — Docker (Redis + auth-mock + sandbox/dev profiles + docker-compose update)

> **Task ID**: AUTH-23
> **Plan**: Plan 2 — Auth Integration (v1.2.2)
> **Depends on**: AUTH-01
> **Estimated effort**: S (~1-1.5 jam)
> **Plan reference**: Section 14 (Docker & Dev Workflow), Section 14.1 (Profile), Section 14.2 (Services), Section 14.3 (Root scripts), Section 14.4 (Env dev), Section 14.5 (Env sandbox), Section 14.6 (Env minimal AUTH_MODE=disabled), Section 16 (env vars)

---

## Goal

Setup Docker Compose untuk Plan 2:
1. Update `docker-compose.yml` — tambah `auth-mock` + `redis` services (untuk profile `dev` + `full`).
2. Create `docker-compose.sandbox.yml` — tanpa Redis/Jaeger/Prometheus/Grafana (profile `sandbox`).
3. Add root `package.json` scripts: `dev`, `dev:sandbox`, `docker:up`, `docker:up:sandbox`.
4. Update `.env.example` + `.env.sandbox.example` dengan auth env vars.

## Scope

**In scope**:
- `docker-compose.yml` (root) — UPDATE:
  - Tambah service `auth-mock`:
    - Build dari `apps/auth-mock` (or use image).
    - Port `4001:4001` (env `AUTH_MOCK_PORT`).
    - Env: `AUTH_MOCK_PORT=4001`, `NODE_ENV=development`.
    - Depends on: `postgres` (untuk dev — auth-mock pakai sqlite sebenarnya, no DB dep needed; tapi pakai postgres bila perlu audit).
    - Volumes: `./apps/auth-mock:/app` (dev hot-reload), `/app/node_modules` (anonymous).
    - Command: `pnpm start:dev` (NestJS watch mode).
    - Networks: `default`.
  - Tambah service `redis`:
    - Image: `redis:7-alpine`.
    - Port `6379:6379`.
    - Volumes: `redis-data:/data`.
    - Command: `redis-server --appendonly yes --maxmemory 256mb --maxmemory-policy allkeys-lru`.
    - Healthcheck: `redis-cli ping`.
  - Tambah service `frontend-vue` (bila belum ada di Plan1):
    - Build dari `apps/frontend-vue`.
    - Port `5173:5173` (Vite dev).
    - Env: `VITE_API_URL=http://localhost:3001`.
    - Volumes: `./apps/frontend-vue:/app`, `/app/node_modules`.
    - Command: `pnpm dev`.
  - Update `payment-api` service:
    - Tambah env: `AUTH_MODE=mock`, `AUTH_BASE_URL=http://auth-mock:4001`, `AUTH_ISSUER=http://auth-mock:4001`, `JWT_AUDIENCE=payment-api`, `OAUTH_CLIENT_ID=payment-api`, `OAUTH_CLIENT_SECRET=dev-client-secret`, `OAUTH_REDIRECT_URI=http://localhost:3001/auth/callback`, `OAUTH_SCOPES=openid profile`, `SESSION_STORE=redis`, `REDIS_URL=redis://redis:6379`, `SESSION_SECRET=<random 32 char>`, `CORS_ORIGIN=http://localhost:5173`, `CSRF_ENABLED=true`.
    - Depends on: `postgres` (healthy), `redis` (healthy), `auth-mock` (started).
    - Volumes: `./apps/payment-api:/app`, `/app/node_modules`.
  - Profile-based activation:
    - Default profile (no `--profile`): sandbox + dev services (postgres, payment-api, payment-gateway-mock, auth-mock, frontend-vue, redis — for full dev experience).
    - `dev` profile: tambah `prometheus`, `grafana`, `jaeger`.
    - `sandbox` profile (handled via separate compose file `docker-compose.sandbox.yml`).
- `docker-compose.sandbox.yml` — NEW (per plan2 section 14.1):
  - Services: `postgres`, `payment-api`, `payment-gateway-mock`, `auth-mock`, `frontend-vue`.
  - NO `redis`, `jaeger`, `prometheus`, `grafana`.
  - `payment-api` env: `SESSION_STORE=memory` (no Redis), `AUTH_MODE=mock` (atau `disabled`), `CSRF_ENABLED=false` (opsional, sandbox convenience).
  - Lightweight — untuk sandbox tanpa Docker Redis.
- Root `package.json` scripts — UPDATE (per plan2 section 14.3):
  - `dev` → `docker compose up -d --build` (full dev profile).
  - `dev:sandbox` → `docker compose -f docker-compose.sandbox.yml up -d --build`.
  - `docker:up` → alias `dev`.
  - `docker:up:sandbox` → alias `dev:sandbox`.
  - `docker:down` → `docker compose down`.
  - `docker:logs` → `docker compose logs -f`.
  - `docker:ps` → `docker compose ps`.
- `.env.example` (root) — UPDATE dengan auth env vars per plan2 section 14.4 + 16:
  - All auth-related env vars: `AUTH_MODE`, `AUTH_BASE_URL`, `AUTH_ISSUER`, `JWT_AUDIENCE`, `OAUTH_*`, `SESSION_*`, `SYNC_*`, `CSRF_*`, `RATE_LIMIT_*`, `THROTTLER_DISABLED`, `REDIS_URL`, `CORS_ORIGIN`.
- `.env.sandbox.example` — NEW:
  - `AUTH_MODE=mock` (atau `disabled`), `SESSION_STORE=memory`, no `REDIS_URL`.
  - Simplified untuk sandbox.
- Verify:
  - `pnpm docker:up` → semua services up + healthy.
  - `pnpm docker:up:sandbox` → sandbox services up (no redis/jaeger/etc).
  - Manual: `curl http://localhost:4001/.well-known/openid-configuration` → return JSON.
  - Manual: `curl http://localhost:3001/health` → return `{ status: 'ok' }`.

**Out of scope**:
- Docker production image (multi-stage build) — di luar scope, fokus dev.
- Kubernetes manifests — di luar scope.
- Docker secrets (Swarm) — di luar scope.
- Traefik / Nginx reverse proxy — di luar scope (FE + BE same-host via Vite proxy).
- TLS termination di Docker — skip, dev pakai HTTP.
- `full` profile (auth-service image dari repo auth) — di luar Plan2 Fase 1, akan di Plan2 Fase 3.

## Files to create/modify

- `docker-compose.yml` — UPDATE (add auth-mock + redis + frontend-vue + payment-api env)
- `docker-compose.sandbox.yml` — NEW
- `package.json` (root) — UPDATE (scripts: dev, dev:sandbox, docker:up, docker:up:sandbox, etc.)
- `.env.example` (root) — UPDATE (auth env vars)
- `.env.sandbox.example` (root) — NEW
- `apps/auth-mock/Dockerfile` — VERIFY (created in AUTH-01, plan2 section 10.8)
- `apps/payment-api/Dockerfile` — VERIFY (existing from Plan1)
- `apps/frontend-vue/Dockerfile` — NEW (if not exists)

## Implementation steps

1. **`docker-compose.yml`** — full dev profile:
   ```yaml
   version: '3.9'

   services:
     postgres:
       image: postgres:16-alpine
       environment:
         POSTGRES_USER: retry_failure
         POSTGRES_PASSWORD: retry_failure
         POSTGRES_DB: retry_failure
       ports: ['5432:5432']
       volumes:
         - postgres-data:/var/lib/postgresql/data
       healthcheck:
         test: ['CMD-SHELL', 'pg_isready -U retry_failure']
         interval: 5s
         timeout: 5s
         retries: 5

     redis:
       image: redis:7-alpine
       ports: ['6379:6379']
       volumes:
         - redis-data:/data
       command: redis-server --appendonly yes --maxmemory 256mb --maxmemory-policy allkeys-lru
       healthcheck:
         test: ['CMD', 'redis-cli', 'ping']
         interval: 5s
         timeout: 3s
         retries: 5

     auth-mock:
       build:
         context: ./apps/auth-mock
         dockerfile: Dockerfile
       ports: ['4001:4001']
       environment:
         AUTH_MOCK_PORT: '4001'
         NODE_ENV: development
       volumes:
         - ./apps/auth-mock:/app
         - /app/node_modules
       command: pnpm start:dev
       depends_on:
         postgres:
           condition: service_healthy
       networks: [default]

     payment-api:
       build:
         context: .
         dockerfile: apps/payment-api/Dockerfile
       ports: ['3001:3001']
       env_file: .env
       environment:
         PORT: '3001'
         NODE_ENV: development
         DB_HOST: postgres
         DB_PORT: '5432'
         DB_USER: retry_failure
         DB_PASS: retry_failure
         DB_NAME: retry_failure
         AUTH_MODE: mock
         AUTH_BASE_URL: http://auth-mock:4001
         AUTH_ISSUER: http://auth-mock:4001
         JWT_AUDIENCE: payment-api
         OAUTH_CLIENT_ID: payment-api
         OAUTH_CLIENT_SECRET: dev-client-secret
         OAUTH_REDIRECT_URI: http://localhost:3001/auth/callback
         OAUTH_SCOPES: 'openid profile'
         SESSION_STORE: redis
         REDIS_URL: redis://redis:6379
         SESSION_SECRET: ${SESSION_SECRET:-dev-session-secret-change-me-32-chars-min}
         CORS_ORIGIN: http://localhost:5173
         CSRF_ENABLED: 'true'
         THROTTLER_DISABLED: 'false'
         OTEL_EXPORTER_OTLP_ENDPOINT: http://jaeger:4318
       volumes:
         - ./:/app
         - /app/node_modules
       command: pnpm --filter payment-api start:dev
       depends_on:
         postgres:
           condition: service_healthy
         redis:
           condition: service_healthy
         auth-mock:
           condition: service_started

     payment-gateway-mock:
       build:
         context: .
         dockerfile: apps/payment-gateway-mock/Dockerfile
       ports: ['3002:3002']
       environment:
         PORT: '3002'
         NODE_ENV: development
       volumes:
         - ./:/app
         - /app/node_modules
       command: pnpm --filter payment-gateway-mock start:dev

     frontend-vue:
       build:
         context: ./apps/frontend-vue
         dockerfile: Dockerfile
       ports: ['5173:5173']
       environment:
         VITE_API_URL: http://localhost:3001
       volumes:
         - ./apps/frontend-vue:/app
         - /app/node_modules
       command: pnpm dev -- --host 0.0.0.0
       depends_on:
         - payment-api

     # dev-only services (jaeger + prometheus + grafana)
     jaeger:
       image: jaegertracing/all-in-one:1.55
       ports:
         - '16686:16686'  # UI
         - '4318:4318'    # OTLP HTTP
       environment:
         COLLECTOR_OTLP_ENABLED: 'true'
       profiles: [dev, full]

     prometheus:
       image: prom/prometheus:v2.50.0
       ports: ['9090:9090']
       volumes:
         - ./infra/prometheus/prometheus.yml:/etc/prometheus/prometheus.yml
       profiles: [dev, full]

     grafana:
       image: grafana/grafana:10.3.0
       ports: ['3003:3000']  # 3003 host to avoid clash with 3000
       environment:
         GF_SECURITY_ADMIN_PASSWORD: admin
       volumes:
         - grafana-data:/var/lib/grafana
       profiles: [dev, full]

   volumes:
     postgres-data:
     redis-data:
     grafana-data:

   networks:
     default:
   ```

2. **`docker-compose.sandbox.yml`** — NEW (lightweight, no Redis/Jaeger/etc):
   ```yaml
   version: '3.9'

   services:
     postgres:
       image: postgres:16-alpine
       environment:
         POSTGRES_USER: retry_failure
         POSTGRES_PASSWORD: retry_failure
         POSTGRES_DB: retry_failure
       ports: ['5432:5432']
       volumes:
         - postgres-data:/var/lib/postgresql/data
       healthcheck:
         test: ['CMD-SHELL', 'pg_isready -U retry_failure']
         interval: 5s
         timeout: 5s
         retries: 5

     auth-mock:
       build:
         context: ./apps/auth-mock
         dockerfile: Dockerfile
       ports: ['4001:4001']
       environment:
         AUTH_MOCK_PORT: '4001'
         NODE_ENV: development
       volumes:
         - ./apps/auth-mock:/app
         - /app/node_modules
       command: pnpm start:dev

     payment-api:
       build:
         context: .
         dockerfile: apps/payment-api/Dockerfile
       ports: ['3001:3001']
       env_file: .env.sandbox
       environment:
         PORT: '3001'
         NODE_ENV: development
         DB_HOST: postgres
         DB_PORT: '5432'
         DB_USER: retry_failure
         DB_PASS: retry_failure
         DB_NAME: retry_failure
         AUTH_MODE: mock
         AUTH_BASE_URL: http://auth-mock:4001
         AUTH_ISSUER: http://auth-mock:4001
         JWT_AUDIENCE: payment-api
         OAUTH_CLIENT_ID: payment-api
         OAUTH_CLIENT_SECRET: dev-client-secret
         OAUTH_REDIRECT_URI: http://localhost:3001/auth/callback
         OAUTH_SCOPES: 'openid profile'
         SESSION_STORE: memory  # No Redis in sandbox
         SESSION_SECRET: ${SESSION_SECRET:-dev-session-secret-change-me-32-chars-min}
         CORS_ORIGIN: http://localhost:5173
         CSRF_ENABLED: 'true'
         THROTTLER_DISABLED: 'false'
       volumes:
         - ./:/app
         - /app/node_modules
       command: pnpm --filter payment-api start:dev
       depends_on:
         postgres:
           condition: service_healthy
         auth-mock:
           condition: service_started

     payment-gateway-mock:
       build:
         context: .
         dockerfile: apps/payment-gateway-mock/Dockerfile
       ports: ['3002:3002']
       environment:
         PORT: '3002'
         NODE_ENV: development
       volumes:
         - ./:/app
         - /app/node_modules
       command: pnpm --filter payment-gateway-mock start:dev

     frontend-vue:
       build:
         context: ./apps/frontend-vue
         dockerfile: Dockerfile
       ports: ['5173:5173']
       environment:
         VITE_API_URL: http://localhost:3001
       volumes:
         - ./apps/frontend-vue:/app
         - /app/node_modules
       command: pnpm dev -- --host 0.0.0.0
       depends_on:
         - payment-api

   volumes:
     postgres-data:
   ```

3. **Root `package.json` scripts** — UPDATE:
   ```json
   {
     "scripts": {
       "dev": "docker compose up -d --build",
       "dev:sandbox": "docker compose -f docker-compose.sandbox.yml up -d --build",
       "docker:up": "docker compose up -d --build",
       "docker:up:sandbox": "docker compose -f docker-compose.sandbox.yml up -d --build",
       "docker:down": "docker compose down",
       "docker:logs": "docker compose logs -f",
       "docker:ps": "docker compose ps",
       "docker:ps:sandbox": "docker compose -f docker-compose.sandbox.yml ps",
       "docker:down:sandbox": "docker compose -f docker-compose.sandbox.yml down",
       "build": "pnpm -r build",
       "test": "pnpm -r test",
       "test:e2e": "pnpm -r test:e2e",
       "lint": "pnpm -r lint",
       "db:migrate": "pnpm --filter payment-api migration:run",
       "db:migrate:revert": "pnpm --filter payment-api migration:revert",
       "frontend:vue:dev": "pnpm --filter frontend-vue dev",
       "frontend:vue:build": "pnpm --filter frontend-vue build"
     }
   }
   ```

4. **`.env.example`** (root) — UPDATE dengan full auth env vars per plan2 section 16:
   ```env
   # Server
   PORT=3001
   NODE_ENV=development

   # OAuth2
   AUTH_MODE=mock
   AUTH_BASE_URL=http://localhost:4001
   AUTH_ISSUER=http://localhost:4001
   JWT_AUDIENCE=payment-api
   OAUTH_CLIENT_ID=payment-api
   OAUTH_CLIENT_SECRET=dev-client-secret
   OAUTH_REDIRECT_URI=http://localhost:3001/auth/callback
   OAUTH_SCOPES=openid profile

   # JWT
   JWT_CLOCK_TOLERANCE_SEC=5
   JWKS_CACHE_TTL_SEC=300

   # Session
   SESSION_STORE=redis
   SESSION_SECRET=change-me-to-32-chars-or-more-aaaa
   SESSION_TTL_SEC=28800
   SESSION_COOKIE_NAME=sid
   SESSION_COOKIE_SAMESITE=Lax
   SESSION_ENCRYPTION_KEY=

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
   THROTTLER_DISABLED=false

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

   # Observability
   OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318
   LOG_LEVEL=info

   # FE Vue
   VITE_API_URL=http://localhost:3001
   ```

5. **`.env.sandbox.example`** — NEW (lightweight):
   ```env
   # Sandbox profile — tanpa Redis, Jaeger, Prometheus, Grafana
   # Per plan2 section 14.5

   # Server
   PORT=3001
   NODE_ENV=development

   # OAuth2 (pakai auth-mock)
   AUTH_MODE=mock
   AUTH_BASE_URL=http://auth-mock:4001
   AUTH_ISSUER=http://auth-mock:4001
   JWT_AUDIENCE=payment-api
   OAUTH_CLIENT_ID=payment-api
   OAUTH_CLIENT_SECRET=dev-client-secret
   OAUTH_REDIRECT_URI=http://localhost:3001/auth/callback
   OAUTH_SCOPES=openid profile

   # Session (memory — no Redis)
   SESSION_STORE=memory
   SESSION_SECRET=change-me-to-32-chars-or-more-aaaa
   SESSION_TTL_SEC=28800
   SESSION_COOKIE_NAME=sid
   SESSION_COOKIE_SAMESITE=Lax

   # CSRF (enabled for completeness, can disable for convenience)
   CSRF_ENABLED=true
   THROTTLER_DISABLED=false

   # Database
   DB_HOST=postgres
   DB_PORT=5432
   DB_USER=retry_failure
   DB_PASS=retry_failure
   DB_NAME=retry_failure

   # No REDIS_URL (memory store)
   # No OTEL (no Jaeger in sandbox)

   # CORS
   CORS_ORIGIN=http://localhost:5173

   # FE Vue
   VITE_API_URL=http://localhost:3001
   ```

6. **Verify**:
   - `pnpm docker:up` → semua services up + healthy.
   - `docker compose ps` → semua services `Up (healthy)`.
   - `curl http://localhost:4001/.well-known/openid-configuration` → JSON.
   - `curl http://localhost:3001/health` → `{ status: 'ok' }`.
   - `curl http://localhost:5173` → HTML.
   - `pnpm docker:up:sandbox` → sandbox services up (no redis/jaeger/etc).
   - `docker compose -f docker-compose.sandbox.yml ps` → 5 services.
   - `pnpm docker:down` → semua services down + volumes tetap (data persist).

## Acceptance criteria

- [ ] `docker-compose.yml` punya service: `postgres`, `redis`, `auth-mock`, `payment-api`, `payment-gateway-mock`, `frontend-vue`, `jaeger`, `prometheus`, `grafana`.
- [ ] `docker-compose.sandbox.yml` punya service: `postgres`, `auth-mock`, `payment-api`, `payment-gateway-mock`, `frontend-vue` (NO redis, jaeger, prometheus, grafana).
- [ ] `auth-mock` service port 4001 exposed, env `AUTH_MOCK_PORT=4001`, build dari `apps/auth-mock/Dockerfile`.
- [ ] `redis` service pakai `redis:7-alpine`, port 6379, healthcheck `redis-cli ping`.
- [ ] `payment-api` env vars lengkap per plan2 section 14.4: `AUTH_MODE=mock`, `AUTH_BASE_URL=http://auth-mock:4001`, `SESSION_STORE=redis` (dev) / `memory` (sandbox).
- [ ] `payment-api` depends_on: `postgres` (healthy), `redis` (healthy, dev only), `auth-mock` (started).
- [ ] `frontend-vue` port 5173 exposed, env `VITE_API_URL=http://localhost:3001`.
- [ ] Profile `dev` activate jaeger + prometheus + grafana (default profile = sandbox + redis).
- [ ] Root `package.json` scripts: `dev`, `dev:sandbox`, `docker:up`, `docker:up:sandbox`, `docker:down`, `docker:down:sandbox`, `docker:logs`, `docker:ps`, `build`, `test`, `test:e2e`, `lint`, `db:migrate`, `db:migrate:revert`, `frontend:vue:dev`, `frontend:vue:build`.
- [ ] `.env.example` (root) berisi semua auth env vars per plan2 section 16.
- [ ] `.env.sandbox.example` (root) berisi `SESSION_STORE=memory`, no `REDIS_URL`.
- [ ] Volumes: `postgres-data`, `redis-data`, `grafana-data` (dev only).
- [ ] `pnpm docker:up` → semua services up + healthy dalam 60s.
- [ ] `pnpm docker:up:sandbox` → sandbox services up dalam 30s.
- [ ] Manual verify: `curl http://localhost:4001/.well-known/openid-configuration` → JSON.
- [ ] Manual verify: `curl http://localhost:3001/health` → `{ status: 'ok' }`.
- [ ] Manual verify: `curl http://localhost:5173` → HTML (Vite dev server).
- [ ] `pnpm docker:down` → semua services down (volumes tetap).
- [ ] Docker images: `redis:7-alpine`, `postgres:16-alpine`, `jaegertracing/all-in-one:1.55`, `prom/prometheus:v2.50.0`, `grafana/grafana:10.3.0`.

## Useful commands

```bash
# Start full dev profile
cd  && pnpm docker:up
# atau: docker compose up -d --build

# Start sandbox profile
cd  && pnpm docker:up:sandbox
# atau: docker compose -f docker-compose.sandbox.yml up -d --build

# Check services status
cd  && docker compose ps
cd  && docker compose -f docker-compose.sandbox.yml ps

# View logs (all services)
cd  && docker compose logs -f
# Specific service:
docker compose logs -f payment-api
docker compose logs -f auth-mock

# Stop services (volumes persist)
cd  && pnpm docker:down

# Stop + remove volumes (full reset)
cd  && docker compose down -v
cd  && docker compose -f docker-compose.sandbox.yml down -v

# Rebuild specific service
cd  && docker compose build payment-api
cd  && docker compose up -d payment-api

# Run migration (after payment-api up)
cd  && docker compose exec payment-api pnpm migration:run

# Verify services healthy
curl -s http://localhost:4001/.well-known/openid-configuration | jq .
curl -s http://localhost:3001/health
curl -s http://localhost:5173 | head -5
curl -s http://localhost:3001/metrics | grep -E "(oauth_token_exchange_total|session_active)"

# Test OAuth flow end-to-end in Docker
# 1. Browser: http://localhost:5173
# 2. Should redirect to http://localhost:3001/auth/login → http://localhost:4001/oauth/authorize
# 3. Login at auth-mock: budi_santoso / ChangeMe_123!
# 4. Callback → redirect to http://localhost:5173/ (dashboard)
# 5. FE Vue: navigate menu (visible based on permissionCodes)
```

## Notes

- **Plan2 section 14.1 profiles**:
  - `sandbox` → postgres, payment-api, payment-gateway-mock, auth-mock, frontend-vue (NO Redis/Jaeger/Prometheus/Grafana).
  - `dev` → tambah redis, jaeger, prometheus, grafana.
  - `full` → tambah auth-service (image repo auth — Plan2 Fase 3, skip di Fase 1).
- **Plan2 section 14.2 services table**: 10 services total (postgres, redis, payment-api, payment-gateway-mock, auth-mock, auth-service, frontend-vue, prometheus, grafana, jaeger).
- **`SESSION_STORE=memory` di sandbox**: no Redis needed — plan2 section 21.12 explicit "Memory store di sandbox boleh, kalau single-instance". Untuk multi-instance sandbox (e.g., sandbox Kubernetes cluster), Redis wajib.
- **Port conflicts**:
  - `payment-api` 3001 (per plan2 v1.2.2 fix — was 3000).
  - `payment-gateway-mock` 3002.
  - `auth-mock` 4001 (range berbeda supaya clear).
  - `frontend-vue` 5173 (Vite default).
  - `grafana` 3003 (host) → 3000 (container) — bila 3000 host taken, pakai 3003.
- **Healthchecks**:
  - postgres: `pg_isready -U retry_failure`.
  - redis: `redis-cli ping`.
  - auth-mock: HTTP `GET /health` (per AUTH-01 plan2 section 10).
  - payment-api: HTTP `GET /health` (Plan1 existing).
  - frontend-vue: TCP port check (Vite tidak punya /health endpoint).
- **`depends_on` conditions**:
  - `service_started` (default) — container started but app might not be ready.
  - `service_healthy` — healthcheck passing.
  - Use `service_healthy` for postgres + redis (so payment-api waits).
  - `service_started` for auth-mock (NestJS watch mode + startup fast).
- **Volumes**:
  - `postgres-data` — DB persistence (dev + sandbox).
  - `redis-data` — Redis AOF persistence (dev only — sandbox skip).
  - `grafana-data` — dashboard config (dev only).
  - Anonymous `/app/node_modules` — prevent host node_modules override container's.
- **`.env` vs `env_file`**:
  - `env_file: .env` di compose service — load file ke container env.
  - `environment:` in compose — explicit override (higher priority than env_file).
  - Strategy: `.env` untuk general vars, `environment:` untuk service-specific + secrets.
- Setelah task ini selesai, developer bisa `pnpm docker:up` (atau `docker:up:sandbox`) untuk start semua services. Selanjutnya: AUTH-24 (unit tests), AUTH-25 (integration), AUTH-26 (E2E).
