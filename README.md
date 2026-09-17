# Retry Failure - Cockatiel Edition

Production-like demo of payment processing failure handling using Cockatiel as resilience engine.

> Source plan: [`upload/PLAN1_Cockatiel_Retry_Failure_Scenario.md`](../upload/PLAN1_Cockatiel_Retry_Failure_Scenario.md)
> Subtask index: [`docs/tasks/README.md`](docs/tasks/README.md)
> Sandbox notes: [`docs/tasks/SANDBOX_NOTES.md`](docs/tasks/SANDBOX_NOTES.md)

## Quick start

```bash
# 1. Enable pnpm (sandbox only - local users may already have pnpm)
corepack enable pnpm
corepack prepare pnpm@9.12.0 --activate

# 2. Install dependencies (monorepo root)
pnpm install

# 3. Setup env file - copy one of the example files:
#    KONDISI LOCAL (Docker available):
cp .env.example apps/payment-api/.env
#    KONDISI SANDBOX (Docker NOT available, port 3000 used by Next.js preview):
cp .env.sandbox.example apps/payment-api/.env

# 4. Start PostgreSQL (LOCAL only - Docker required):
docker compose up -d postgres

# 5. Run DB migrations
pnpm db:migrate

# 6. Start all dev servers
pnpm dev
```

## Services

| Service | Port (LOCAL default) | Port (SANDBOX) | Path |
| --- | --- | --- | --- |
| `payment-api` (NestJS) | 3000 | 3001 | `apps/payment-api/` |
| `payment-gateway-mock` (NestJS) | 3001 | 3002 | `apps/payment-gateway-mock/` |
| `frontend-vue` (Vite) | 5173 | 5173 | `apps/frontend-vue/` |
| `@retry-failure/resilience` | - | - | `packages/resilience/` |
| PostgreSQL | 5432 | - | docker-compose |
| Prometheus | 9090 | - | docker-compose |
| Grafana | 3003 | - | docker-compose |
| Jaeger UI | 16686 | - | docker-compose |
| OTel OTLP | 4318 | - | docker-compose |

## Documentation

- [Plan document](../upload/PLAN1_Cockatiel_Retry_Failure_Scenario.md)
- [Task index](docs/tasks/README.md)
- [Sandbox notes (environment adaptation)](docs/tasks/SANDBOX_NOTES.md)

## Stack

- **Runtime**: Node.js >= 20
- **Backend**: NestJS 11
- **Database**: PostgreSQL 16
- **ORM**: TypeORM 0.3 + driver `pg`
- **Resilience**: Cockatiel 4
- **Scheduler**: `@nestjs/schedule`
- **Logging**: `nestjs-pino`
- **Metrics**: `prom-client`
- **Tracing**: OpenTelemetry SDK + Jaeger
- **Testing**: Jest + supertest
- **Validation**: class-validator + class-transformer
- **Container**: Docker multi-stage + docker-compose
- **Frontend**: Next.js (sandbox preview) + Vue 3 + PrimeVue (full dashboard)

## Useful command
```bash
#type check
pnpm typecheck

#lint check
pnpm lint

#Run development mode single
cd apps/payment-api && pnpm start:dev
cd apps/payment-gateway-mock && pnpm start:dev
cd apps/frontend-vue && pnpm dev

#run test single file
pnpm --filter payment-api test tests\modules\retry-scheduler\retry-scheduler.service.spec.ts
```