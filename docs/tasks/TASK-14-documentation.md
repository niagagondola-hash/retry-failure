# TASK-14 — Documentation, Demo Guide & Production Caveats

> **Task ID**: 11
> **Depends on**: 10 (E2E results)
> **Estimated effort**: S (~1 jam)
> **Plan reference**: Section 17 (Demonstration Scenarios), Section 19 (Out-of-scope), Section 20 (Production Caveats), Section 22 (Definition of Done)

---

## Goal

Menyusun dokumentasi final yang menjelaskan: cara menjalankan project, demo scenario A–E, production caveats, dan catatan adaptasi dari plan asli (NestJS+MySQL → Next.js+Prisma+SQLite). Dokumentasi ini menjadi single source of truth untuk handover.

## Scope

**In scope**:
- Update root `README.md` (append "Payment Retry Demo" section di atas konten existing).
- `docs/DEMO_SCENARIOS.md` — narrative untuk scenario A–E + business impact.
- `docs/PRODUCTION_CAVEATS.md` — semua caveat dari plan section 20 + tambahan adaptasi.
- `docs/ADAPTATION_NOTES.md` — perbedaan stack & apa yang dipertahankan vs diadaptasi.
- Cross-link dari `docs/tasks/README.md` index.

**Out of scope**:
- Mengubah implementation code.
- Grafana dashboard JSON (out-of-scope untuk env ini — provide sample queries text saja).
- OpenTelemetry / Jaeger setup guide (simplified; mention as future evolution).

## Files to create / modify

- `/home/z/my-project/README.md` — append section di atas (after any existing content).
- `/home/z/my-project/docs/DEMO_SCENARIOS.md`
- `/home/z/my-project/docs/PRODUCTION_CAVEATS.md`
- `/home/z/my-project/docs/ADAPTATION_NOTES.md`

## Implementation steps

1. **`README.md`** — tambah section "## Payment Retry Demo (Plan 1 — Cockatiel Edition)" dengan:
   - One-paragraph overview.
   - Quick start: `bun install && bun run db:push && bun run dev` + 2 mini-services.
   - Link ke `docs/DEMO_SCENARIOS.md`, `docs/PRODUCTION_CAVEATS.md`, `docs/ADAPTATION_NOTES.md`, `docs/tasks/README.md`.
   - Link ke hasil E2E: `docs/e2e-results.md`.

2. **`docs/DEMO_SCENARIOS.md`** — narrative per scenario (A–E dari plan section 17):
   - Setup (gateway mode).
   - Steps (via dashboard button atau curl).
   - Expected business outcome.
   - Why this matters (business impact).
   - Link ke e2e-results row.

3. **`docs/PRODUCTION_CAVEATS.md`**:
   - Section 20.1 Circuit breaker state (in-memory, per-instance).
   - Section 20.2 Scheduler (single-instance, no distributed lock).
   - Section 20.3 Payment retry safety (only safe because idempotency key).
   - Section 20.4 Observability (DB is source of truth, metrics/logs are signals).
   - **Tambahan adaptasi**:
     - SQLite vs MySQL: no native ENUM, no ms-precision datetime. Production: pakai PostgreSQL/MySQL.
     - In-memory idempotency store di gateway mock: production butuh persistent store (Redis/DB).
     - No distributed lock: production butuh `FOR UPDATE SKIP LOCKED` (PostgreSQL) atau Redis-based.
     - No OTel/Jaeger: trace ID di `payment_attempts.trace_id` cukup untuk demo; production pakai OTel SDK.
     - No auth: production butuh NextAuth/middleware.
     - No rate limiting on `/api/payments`: production butuh.

4. **`docs/ADAPTATION_NOTES.md`**:
   - Table: plan asli → adaptasi kita, untuk setiap section plan.
   - Yang dipertahankan utuh: Cockatiel sebagai engine, error classification, idempotency, durable retry loop, audit trail, metrics, payment lifecycle.
   - Yang diadaptasi:
     - NestJS → Next.js App Router + lib modules.
     - TypeORM+MySQL → Prisma+SQLite.
     - pnpm workspaces → single project + mini-services (Bun).
     - @nestjs/schedule → mini-service poller.
     - OTel+Jaeger → trace_id in DB + structured log (simplified).
     - Docker compose → dev server + mini-services (env provided).
     - class-validator → zod.
   - Justifikasi: kenapa adaptasi ini acceptable untuk demo & tidak mengurangi value arsitektur.

5. **Cross-link**:
   - `docs/tasks/README.md` → add link ke `docs/e2e-results.md`, `docs/DEMO_SCENARIOS.md`, dll.

## Acceptance criteria

- [ ] `README.md` berisi section "Payment Retry Demo" dengan quick start command yang bisa di-copy-paste.
- [ ] `docs/DEMO_SCENARIOS.md` menjelaskan 5 scenario A–E dengan business impact.
- [ ] `docs/PRODUCTION_CAVEATS.md` mencatat semua caveat dari plan section 20 + tambahan adaptasi (≥6 bullet).
- [ ] `docs/ADAPTATION_NOTES.md` punya table perbandingan plan asli → adaptasi (≥8 row).
- [ ] Semua link antar-doc valid (relative path, no dead link).
- [ ] `bun run lint` bersih (markdown tidak di-lint ESLint, tapi pastikan tidak ada broken file).
- [ ] DoD checklist di `docs/tasks/README.md` semua tercentang (atau ada note bila skip).

## Useful commands (run after completing this task)

```bash
# 1. Verify all docs exist
ls -la /home/z/my-project/docs/
ls -la /home/z/my-project/docs/tasks/

# 2. Verify README updated
head -n 50 /home/z/my-project/README.md

# 3. Quick link check (relative markdown links)
grep -rE '\]\(\./' /home/z/my-project/docs/ | head -20

# 4. Final lint (catch stray TypeScript issues if any doc imports code)
bun run lint

# 5. Final typecheck
bunx tsc --noEmit

# 6. Sanity: open the dashboard one last time via Agent Browser
#    - Verify all 5 demo buttons visible
#    - Verify footer sticky
#    - Verify mobile responsive (Agent Browser viewport resize)
# (Skill: agent-browser)

# 7. Final dev log check
tail -n 50 /home/z/my-project/dev.log | grep -iE 'error|warn' | head -10

# 8. Cleanup (optional) — kill background services bila tidak dipakai lagi
# pkill -f "bun run dev" 2>/dev/null
# pkill -f "payment-gateway-mock" 2>/dev/null
# pkill -f "retry-scheduler" 2>/dev/null
```

## Notes

- **No emoji** unless explicitly requested (per project rules). Pakai ASCII / plain text.
- **Markdown link**: pakai relative path (`./DEMO_SCENARIOS.md`) bukan absolute (`/home/z/.../DEMO_SCENARIOS.md`).
- **Quick start** harus self-contained: user bisa copy-paste 4–5 baris command dan langsung jalan.
- **Adaptation notes** jujur: sebutkan apa yang berkurang dari plan asli (OTel, distributed lock, ms-precision datetime, dll.) dan kenapa acceptable untuk demo.
- Setelah task ini selesai, seluruh plan selesai. DoD checklist di `docs/tasks/README.md` jadi verifikasi final.

## Final Definition of Done checklist (re-cap from `docs/tasks/README.md` section 5)

- [ ] Payment API (`POST /api/payments`) dapat membuat payment.
- [ ] Gateway mock dapat mengganti failure mode saat runtime via dashboard.
- [ ] Cockatiel menangani request-level retry (bukti di `payment_attempts`).
- [ ] Exponential backoff + jitter terkonfigurasi (config-driven).
- [ ] Circuit breaker dapat dibuktikan melalui E2E scenario 3.
- [ ] Permanent 4xx tidak di-retry (scenario 2).
- [ ] `Retry-After` dihormati (scenario 5).
- [ ] Exhausted execution cycle → `scheduled_for_retry`.
- [ ] Scheduler memproses due payment (scenario 6).
- [ ] `MAX_TOTAL_RETRIES` mengakhiri payment menjadi `failed` (scenario 7).
- [ ] Idempotency menjamin `actualCharges <= 1` walaupun `calls >= 2` (scenario 4 — hero).
- [ ] Audit attempt tersimpan di SQLite (`payment_attempts`).
- [ ] Metrics tersedia di `/api/metrics`.
- [ ] Trace ID tersimpan di `payment_attempts.trace_id` + terlihat di log.
- [ ] Mini-service gateway mock + scheduler berjalan.
- [ ] Unit test (lint + typecheck) lulus.
- [ ] Dashboard UI menjalankan semua scenario A–E.
- [ ] README menjelaskan failure scenarios + business impact.
