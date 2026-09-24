# Documentation Index

> Global documentation index untuk semua plan (plan1, plan2, dst).

## Cross-Plan Docs (tidak terikat plan tertentu)

| File | Description |
|---|---|
| [SANDBOX_NOTES.md](./SANDBOX_NOTES.md) | Environment notes (local vs sandbox, port assignments, command matrix) |
| [TECHNICAL_DEBT.md](./TECHNICAL_DEBT.md) | Technical debt issues + refactor recommendations (8 issues) |
| [TEST_MAINTENANCE_RULES.md](./TEST_MAINTENANCE_RULES.md) | Rule test maintenance + decision framework saat source vs test conflict |
| [command/](./command/) | Command references (e2e test debug, sync local-to-sandbox) |

## Plan 1 — Cockatiel Retry/Failure Scenario

[→ `plan1-cockatiel-retry-failure/README.md`](./plan1-cockatiel-retry-failure/README.md)

Payment retry/failure handling demo menggunakan Cockatiel (retry + circuit breaker + timeout), idempotency anti double-charge, durable retry scheduler, dan full observability.

## Plan 2 — Auth Integration (future)

> Belum dibuat. Akan berisi: PLAN2-Auth_Integration.md, AUTH_CONTRACT.md, auth-openapi.json, CHANGELOG-AUTH.md, tasks/.

## Root Project Docs

| File | Description |
|---|---|
| [../README.md](../README.md) | Root project README (quick start, services, structure) |
| [../CONTRIBUTING.md](../CONTRIBUTING.md) | Development rules (5 rules + pre-commit checklist) |
