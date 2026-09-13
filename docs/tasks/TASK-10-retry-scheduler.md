# TASK-10 — Durable Retry Scheduler (mini-service port 3002)

> **Task ID**: 7
> **Depends on**: 6-b (API routes — needed for `POST /api/payments/:id/retry`)
> **Estimated effort**: M (~1.5 jam)
> **Plan reference**: Section 7 (Durable Retry), Section 12 (Scheduler), Section 15 (Configuration)

---

## Goal

Membuat `retry-scheduler` mini-service Bun di port **3002** yang:
1. Polling DB setiap `SCHEDULER_INTERVAL_MS` untuk payment dengan `status='scheduled_for_retry'` dan `next_retry_at <= NOW()`.
2. Untuk setiap due payment: panggil `POST http://localhost:3000/api/payments/:id/retry` (internal HTTP call ke payment-api).
3. Respect `MAX_TOTAL_RETRIES` — bila sudah mencapai batas, payment harus sudah `failed` (di-handle oleh payment-api service, bukan scheduler).

## Scope

**In scope**:
- Project terpisah di `mini-services/retry-scheduler/` dengan `package.json` sendiri.
- Entry `index.ts` dengan `setInterval` poller (atau `setTimeout` recursive).
- Poller:
  - Query DB via Prisma (connect ke SQLite yang sama: `DATABASE_URL=file:../db/custom.db` relative).
  - For each due payment → call HTTP retry endpoint.
- Configuration via env: `SCHEDULER_INTERVAL_MS=5000`, `MAX_TOTAL_RETRIES=5`, `PAYMENT_API_URL=http://localhost:3000`.
- Health endpoint `GET /` → `{ status: 'running', lastPollAt, processedCount }`.
- Auto-restart on file change (`bun --hot`).

**Out of scope**:
- Distributed lock (out-of-scope per plan section 19).
- Kafka/RabbitMQ (out-of-scope).
- Concurrency cap / bulkhead (out-of-scope).

## Adaptation notes

- **Single-instance demo**: plan section 12 mengizinkan single-instance untuk demo. Concurrency semantics didokumentasikan.
- **DB sharing**: scheduler & payment-api share SQLite file via Prisma. Karena SQLite, write concurrent aman (file lock) tapi bisa contention. Untuk demo OK.
- **HTTP call** ke payment-api: gunakan `fetch` built-in (Bun). Tidak perlu axios.
- **No XTransformPort** di sini (server-to-server, langsung `http://localhost:3000`).

## Files to create

- `/home/z/my-project/mini-services/retry-scheduler/package.json`
- `/home/z/my-project/mini-services/retry-scheduler/tsconfig.json`
- `/home/z/my-project/mini-services/retry-scheduler/index.ts` — entry: HTTP server + poller loop.
- `/home/z/my-project/mini-services/retry-scheduler/src/poller.ts` — `pollOnce()`.
- `/home/z/my-project/mini-services/retry-scheduler/src/executor.ts` — `executeRetry(payment)`.
- `/home/z/my-project/mini-services/retry-scheduler/src/state.ts` — runtime stats (lastPollAt, processedCount, errors).
- `/home/z/my-project/mini-services/retry-scheduler/src/db.ts` — Prisma client (separate instance from payment-api).
- `/home/z/my-project/mini-services/retry-scheduler/README.md`.

## Implementation steps

1. `package.json`:
   ```json
   {
     "name": "retry-scheduler",
     "private": true,
     "scripts": { "dev": "bun --hot index.ts" },
     "dependencies": {
       "@prisma/client": "^6.11.1"
     }
   }
   ```
   (Prisma client di-share generate dari root; scheduler pakai `@prisma/client` yang sama — bisa pakai `node_modules` dari root kalau path di-resolve, atau install sendiri.)
2. `src/db.ts`:
   ```ts
   import { PrismaClient } from '@prisma/client';
   export const db = new PrismaClient({
     datasources: { db: { url: process.env.DATABASE_URL ?? 'file:../../db/custom.db' } },
   });
   ```
3. `src/state.ts`:
   - `lastPollAt: Date | null`, `processedCount`, `errorCount`, `lastError`.
4. `src/executor.ts`:
   ```ts
   export async function executeRetry(payment: { id: string }): Promise<{ ok: boolean; status?: string; error?: string }> {
     const url = `${process.env.PAYMENT_API_URL ?? 'http://localhost:3000'}/api/payments/${payment.id}/retry`;
     try {
       const res = await fetch(url, { method: 'POST', signal: AbortSignal.timeout(30_000) });
       const body = await res.json();
       if (!res.ok) return { ok: false, error: body?.message ?? body?.error ?? `http ${res.status}` };
       return { ok: true, status: body?.payment?.status };
     } catch (err) {
       return { ok: false, error: String(err) };
     }
   }
   ```
5. `src/poller.ts`:
   ```ts
   import { db } from './db';
   import { executeRetry } from './executor';
   import { state } from './state';

   export async function pollOnce(): Promise<{ found: number; processed: number; failed: number }> {
     state.lastPollAt = new Date();
     const duePayments = await db.payment.findMany({
       where: { status: 'scheduled_for_retry', nextRetryAt: { lte: new Date() } },
       take: 50,
       orderBy: { nextRetryAt: 'asc' },
     });

     let processed = 0, failed = 0;
     for (const p of duePayments) {
       const r = await executeRetry(p);
       if (r.ok) { processed++; state.processedCount++; }
       else { failed++; state.errorCount++; state.lastError = r.error ?? 'unknown'; console.error('retry failed', p.id, r.error); }
     }
     return { found: duePayments.length, processed, failed };
   }
   ```
6. `index.ts`:
   ```ts
   import { pollOnce } from './src/poller';
   import { state } from './src/state';

   const INTERVAL = Number(process.env.SCHEDULER_INTERVAL_MS ?? 5000);
   console.log(`[retry-scheduler] starting, interval=${INTERVAL}ms`);

   async function tick() {
     try {
       const r = await pollOnce();
       if (r.found > 0) console.log(`[poll] found=${r.found} processed=${r.processed} failed=${r.failed}`);
     } catch (err) {
       console.error('[poll] error', err);
     }
   }

   setInterval(tick, INTERVAL);
   tick();

   // Health endpoint
   Bun.serve({
     port: 3002,
     fetch: () => new Response(JSON.stringify({ status: 'running', ...state, now: new Date() }), {
       headers: { 'Content-Type': 'application/json' },
     }),
   });
   console.log('[retry-scheduler] health on :3002');
   ```
7. Run & test.

## Acceptance criteria

- [ ] `cd mini-services/retry-scheduler && bun run dev` jalan di background tanpa crash.
- [ ] `curl http://localhost:3002/` returns `{ status: 'running', lastPollAt: ..., processedCount: 0 }`.
- [ ] Saat ada payment `status='scheduled_for_retry'` dengan `next_retry_at <= now`, scheduler akan call `POST /api/payments/:id/retry` dalam ≤ `INTERVAL + 2s`.
- [ ] Setelah retry sukses → payment status menjadi `succeeded` (atau `failed` / `scheduled_for_retry` lagi).
- [ ] `total_retry_count` increment sesuai jumlah scheduler cycles.
- [ ] Bila `MAX_TOTAL_RETRIES` tercapai → payment-api set status `failed` (scheduler tidak perlu tahu — payment-api yang guard).
- [ ] Auto-restart saat file change (`bun --hot`).
- [ ] File log `/tmp/scheduler.log` menunjukkan poll activity.

## Useful commands (run after completing this task)

```bash
# 0. Pastikan gateway mock + payment-api + db siap
cd /home/z/my-project/mini-services/payment-gateway-mock && bun run dev > /tmp/gateway.log 2>&1 &
sleep 1
bun run dev > /tmp/next-dev.log 2>&1 &
sleep 4
curl -s -X PUT http://localhost:3001/admin/config -H 'Content-Type: application/json' -d '{"mode":"server-error"}'

# 1. Start scheduler
cd /home/z/my-project/mini-services/retry-scheduler && bun run dev > /tmp/scheduler.log 2>&1 &
sleep 2
tail -n 20 /tmp/scheduler.log

# 2. Create a payment that will be scheduled_for_retry (mode server-error → exhausted → scheduled)
curl -s -X POST http://localhost:3000/api/payments \
  -H 'Content-Type: application/json' \
  -d '{"orderId":"SCHED-1","amount":300,"currency":"IDR"}' | jq .

# 3. Verify status scheduled_for_retry + next_retry_at set
PAYMENT_ID=$(curl -s "http://localhost:3000/api/payments?status=scheduled_for_retry" | jq -r '.payments[-1].id')
curl -s "http://localhost:3000/api/payments/$PAYMENT_ID" | jq '{ id, status, attemptCount, totalRetryCount, nextRetryAt }'

# 4. Switch gateway to always-success so the scheduler retry will succeed
curl -s -X PUT http://localhost:3001/admin/config -H 'Content-Type: application/json' -d '{"mode":"always-success"}'

# 5. Wait & watch scheduler pick it up
sleep 8
tail -n 30 /tmp/scheduler.log
curl -s "http://localhost:3000/api/payments/$PAYMENT_ID" | jq '{ id, status, attemptCount, totalRetryCount, nextRetryAt }'
# expected: status=succeeded, totalRetryCount=1

# 6. Check scheduler health
curl -s http://localhost:3002/ | jq .

# 7. Test MAX_TOTAL_RETRIES exhaustion (persistent failure across cycles)
curl -s -X PUT http://localhost:3001/admin/config -H 'Content-Type: application/json' -d '{"mode":"server-error"}'
curl -s -X POST http://localhost:3000/api/payments -H 'Content-Type: application/json' -d '{"orderId":"SCHED-2","amount":500}' | jq .
# wait ~40s for 5 cycles (interval 5s × ~5 cycles)
sleep 45
curl -s "http://localhost:3000/api/payments?status=failed" | jq '.payments | map({ id, orderId, totalRetryCount, failureReason })'
# expected: SCHED-2 with totalRetryCount >= MAX_TOTAL_RETRIES, status=failed

# 8. Reset
curl -s -X PUT http://localhost:3001/admin/config -H 'Content-Type: application/json' -d '{"mode":"always-success"}'
```

## Notes

- **Single-instance only**: plan section 12 explicit. Multi-instance butuh `FOR UPDATE SKIP LOCKED` (PostgreSQL) atau distributed lock — out-of-scope per plan section 19.
- **Scheduler calls HTTP** (not directly import service code) karena:
  1. Bersih separation antara processes.
  2. Cockatiel breaker singleton di payment-api terjaga.
  3. Scheduler tidak perlu import Next.js/React internals.
- **`MAX_TOTAL_RETRIES` check**: dilakukan di `PaymentsService.executePayment` (TASK-07), bukan scheduler. Scheduler hanya trigger retry; service yang decide apakah masih layak di-retry.
- **Backoff** untuk `next_retry_at`: setiap scheduler cycle, set `next_retry_at = now + (base_delay * 2^totalRetryCount)` agar exponential. Atau constant interval sesuai plan (tidak specify). **Default: constant `SCHEDULER_INTERVAL_MS × 2`** untuk demo.
- **Error handling di scheduler**: bila payment-api down, log error + lanjut poll berikutnya. Jangan crash scheduler.
- Setelah task ini selesai, durable retry loop berfungsi end-to-end. TASK-13 scenario 6 & 7 bisa diverifikasi.
