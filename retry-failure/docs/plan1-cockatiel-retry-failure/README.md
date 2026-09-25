# Plan 1 — Cockatiel Retry/Failure Scenario

> Payment retry/failure handling demo menggunakan Cockatiel v4 (retry + circuit breaker + timeout),
> idempotency anti double-charge, durable retry scheduler, dan full observability (pino + prom-client + OTel).

## Source of Truth

| File | Description |
|---|---|
| [PLAN1_Cockatiel_Retry_Failure_Scenario.md](./PLAN1_Cockatiel_Retry_Failure_Scenario.md) | Original plan (23 sections) — domain logic source of truth |

## Business Documentation (TASK-15)

| File | Description |
|---|---|
| [DEMO_SCENARIOS.md](./DEMO_SCENARIOS.md) | 5 demo A-E dengan business impact + curl steps + E2E evidence |
| [PRODUCTION_CAVEATS.md](./PRODUCTION_CAVEATS.md) | Production caveats (4 plan + 11 sandbox + 10 out-of-scope) + sample PromQL |
| [ADAPTATION_NOTES.md](./ADAPTATION_NOTES.md) | Plan vs implementation comparison (8 preserved + 22 adapted) |
| [e2e-results.md](./e2e-results.md) | E2E test results (7 scenarios PASS, 25 bug history, IS_OTEL toggle scenarios) |

## Architecture & Reference Docs

| File | Description |
|---|---|
| [DATABASE_ERD.md](./DATABASE_ERD.md) | ERD narasi + cara pakai di dbdiagram.io |
| [DATABASE_ERD.dbml](./DATABASE_ERD.dbml) | DBML format — copy-paste ke https://dbdiagram.io/d |
| [GATEWAY_MOCK_MODES.md](./GATEWAY_MOCK_MODES.md) | 8 failure modes detail + arsitektur timeout 3 layer |
| [ESM_CJS_MODULE_RESOLUTION_NOTES.md](./ESM_CJS_MODULE_RESOLUTION_NOTES.md) | ESM/CJS module resolution notes (cockatiel v4 ESM + Jest CJS) |
| [TASK-test-sync-failures.md](./tasks/TASK-test-sync-failures.md) | Bug analysis 7 test failures + cross-check ke PLAN1 |

## Task Files

[→ `tasks/README.md`](./tasks/README.md) — task index (TASK-01 sampai TASK-16 + post-plan)

## Test Scenario Diagrams (TASK-16)

[→ `skenario/README.md`](./skenario/README.md) — 25 Mermaid diagrams untuk test yang kompleks (retry-scheduler, idempotency, resilient-adapter, composition)

## Cross-Plan Docs (di root docs/)

| File | Description |
|---|---|
| [../SANDBOX_NOTES.md](../SANDBOX_NOTES.md) | Environment notes (local vs sandbox) |
| [../TECHNICAL_DEBT.md](../TECHNICAL_DEBT.md) | Technical debt issues (8 issues) |
| [../TEST_MAINTENANCE_RULES.md](../TEST_MAINTENANCE_RULES.md) | Rule test maintenance + decision framework |
