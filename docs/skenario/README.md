# Test Scenario Diagrams

> Visual diagrams (Mermaid) untuk skenario test yang kompleks.
> Tujuan: memudahkan tim memahami flow test untuk maintenance dan onboarding.

## Available diagrams

| Module | Spec File | Scenario File | Diagrams | Complexity |
|---|---|---|---|---|
| retry-scheduler | `retry-scheduler.service.spec.ts` | [retry-scheduler-service-scenario.md](./retry-scheduler-service-scenario.md) | 4 | High |
| idempotency | `idempotency.spec.ts` | [idempotency-scenario.md](./idempotency-scenario.md) | 3 | Medium |
| resilient-adapter | `resilient-adapter.spec.ts` | [resilient-adapter-scenario.md](./resilient-adapter-scenario.md) | 5 | High |
| composition | `composition.spec.ts` | [composition-scenario.md](./composition-scenario.md) | 6 | High |

**Total**: 4 scenario files, ~18 Mermaid diagrams

## Future work (8 spec files lain — belum ada diagram)

Spec files yang belum punya diagram (low complexity, bisa tambah nanti kalau perlu):

- audit.service.spec.ts
- classifier.spec.ts (resilience pkg)
- http-adapter.spec.ts
- idempotency-key.spec.ts
- payments.controller.spec.ts
- payments.service.spec.ts
- retry-after.spec.ts (resilience pkg)
- state-machine.spec.ts

## Conventions

- **Format**: Mermaid (sequence + flowchart + state — mix sesuai konteks)
- **Level of detail**: Per describe block (1 diagram per describe, bukan per test case)
- **Narasi**: Lengkap (Setup + Flow + Key assertions + Common pitfalls + PLAN1 ref jika relevan)
- **File naming**: `<spec-name-without-.spec.ts>-scenario.md` (titik → dash)
- **PLAN1 reference**: Wajib jika test verify domain behavior, optional kalau pure implementation detail

## How to add new diagram

1. Identify spec file with complex scenarios
2. Read tests, identify describe blocks worth diagramming
3. Create `<spec-name>-scenario.md` using [template](#template) below
4. Add entry to this index table
5. Cross-link dari CONTRIBUTING.md + TEST_MAINTENANCE_RULES.md kalau diagram menambah rule baru

## Template

```markdown
# Scenario: <spec-file-name>

> Source: `<path-to-spec-file>`
> Tests: <N> tests, <M> describe blocks

## <describe-block-name>

### Setup
<mock configuration, initial state>

### Flow

```mermaid
<diagram>
```

### Key assertions
- <bullet 1>
- <bullet 2>

### Common pitfalls
- <gotcha 1>
- <gotcha 2>

### PLAN1 reference
- Section X.Y (line N-M): <description>
```

## Related docs

- [TEST_MAINTENANCE_RULES.md](../TEST_MAINTENANCE_RULES.md) — rule test maintenance + decision framework
- [TASK-test-sync-failures.md](../tasks/TASK-test-sync-failures.md) — bug analysis yang inspire diagrams ini
- [CONTRIBUTING.md](../../CONTRIBUTING.md) — development rules (Rule #5: update scenario diagram kalau ubah test)
- [TASK-16-test-scenario-diagrams.md](../tasks/TASK-16-test-scenario-diagrams.md) — task plan yang create scenario diagrams ini
