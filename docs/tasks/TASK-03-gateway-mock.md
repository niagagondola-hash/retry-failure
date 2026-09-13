# TASK-03 — Payment Gateway Mock (mini-service port 3001)

> **Task ID**: 2-b
> **Depends on**: 1 (scaffolding)
> **Can run in parallel with**: TASK-02, TASK-04
> **Estimated effort**: M (~1.5 jam)
> **Plan reference**: Section 8 (Payment Gateway Mock), Section 9 (Idempotency), Section 17 (Demo)

---

## Goal

Membuat `payment-gateway-mock` sebagai mini-service Bun terpisah di port **3001**. Service ini mensimulasikan payment gateway dengan failure modes yang dapat diatur saat runtime (tanpa restart) dan menyimpan idempotency result untuk replay.

## Scope

**In scope**:
- Project terpisah di `mini-services/payment-gateway-mock/` dengan `package.json` sendiri.
- Server Bun (HTTP) dengan entry `index.ts`.
- Endpoint: `POST /v1/charges`, `GET /admin/config`, `PUT /admin/config`, `GET /admin/stats`, `GET /metrics`.
- 8 failure modes (section 8.2): `always-success`, `fail-first-n`, `server-error`, `always-timeout`, `client-error`, `random`, `succeed-but-drop-response`, `rate-limited`.
- In-memory idempotency store: simpan successful charge by `Idempotency-Key`, replay returns original result + `replayed: true`.
- Config runtime: mode, n (untuk fail-first-n), probability (untuk random), retry-after (untuk rate-limited), timeout-ms (untuk always-timeout).
- Stats: total requests, success count, failure count, replay count.
- `/metrics` expose Prometheus format sederhana.
- Auto-restart on file change (`bun --hot`).

**Out of scope**:
- Cockatiel di gateway mock (mock-nya gateway eksternal, tidak perlu resilience).
- Database persistence (in-memory OK; reset saat restart acceptable untuk demo).
- OTel instrumentation (bisa ditambah di TASK-11 opsional).

## Adaptation notes

- Plan section 8 mensyaratkan gateway di port terpisah. Kita pakai **3001**.
- Akses dari frontend Next.js → via Caddy: `/?XTransformPort=3001` (untuk admin config dari dashboard).
- Akses dari backend Next.js (server-side) → bisa langsung `http://localhost:3001` karena server-to-server (tidak melalui Caddy). Ini tidak melanggar rule XTransformPort (rule itu hanya untuk client-side fetch).
- Idempotency: plan section 9 menyebut `Idempotency-Key: <payment.id>`. Mock menyimpan by key.

## Files to create

- `/home/z/my-project/mini-services/payment-gateway-mock/package.json`
- `/home/z/my-project/mini-services/payment-gateway-mock/tsconfig.json`
- `/home/z/my-project/mini-services/payment-gateway-mock/index.ts` — entry server.
- `/home/z/my-project/mini-services/payment-gateway-mock/src/modes.ts` — failure mode implementations.
- `/home/z/my-project/mini-services/payment-gateway-mock/src/idempotency-store.ts` — in-memory store.
- `/home/z/my-project/mini-services/payment-gateway-mock/src/state.ts` — runtime config singleton.
- `/home/z/my-project/mini-services/payment-gateway-mock/src/handlers/charges.ts` — POST /v1/charges.
- `/home/z/my-project/mini-services/payment-gateway-mock/src/handlers/admin.ts` — GET/PUT /admin/config + /admin/stats.
- `/home/z/my-project/mini-services/payment-gateway-mock/src/handlers/metrics.ts` — GET /metrics.
- `/home/z/my-project/mini-services/payment-gateway-mock/README.md` — cara jalan + endpoint doc.

## Implementation steps

1. Buat `package.json`:
   ```json
   {
     "name": "payment-gateway-mock",
     "private": true,
     "scripts": { "dev": "bun --hot index.ts" },
     "dependencies": {}
   }
   ```
   (Tidak perlu deps eksternal; Bun punya `Bun.serve` built-in.)
2. Buat `tsconfig.json` (extends root kalau bisa, atau standalone strict).
3. Buat `src/state.ts`:
   - Interface `MockConfig { mode, n, probability, retryAfterSeconds, timeoutMs }`.
   - Default: `{ mode: 'always-success', n: 0, probability: 0.5, retryAfterSeconds: 10, timeoutMs: 5000 }`.
   - Export mutable `state` + `updateState(partial)`.
4. Buat `src/idempotency-store.ts`:
   - `Map<string, ChargeResult>` where `ChargeResult = { status: 200, gatewayReference, replayed?: boolean }`.
   - `get(key)`, `set(key, result)`, `has(key)`, `stats()` → count, replayCount.
5. Buat `src/modes.ts`:
   - Export `applyMode(config, ctx)` → returns `{ status, body, headers, shouldDropResponse, delayMs }`.
   - Implement setiap mode:
     - `always-success`: return 200 + gateway_reference.
     - `fail-first-n`: counter per `Idempotency-Key` (atau global? pilih global counter untuk demo) — 500 untuk first N, lalu 200.
     - `server-error`: selalu 500.
     - `always-timeout`: sleep `timeoutMs` (default 5000) lalu return 503 (client akan timeout duluan karena `GATEWAY_TIMEOUT_MS=2000`).
     - `client-error`: 400 `{ error_code: 'invalid_card', message: 'Card number invalid' }`.
     - `random`: pakai `probability` → success/fail 500.
     - `succeed-but-drop-response`: lakukan charge (simpan ke idempotency store) TAPI return timeout (tidak kirim response). Client akan retry → replay.
     - `rate-limited`: 429 + header `Retry-After: <retryAfterSeconds>`.
6. Buat handler `charges.ts`:
   - Baca `Idempotency-Key` header. Jika ada di store → return replay.
   - Jika tidak, apply mode. Jika success, simpan ke idempotency store (kecuali `succeed-but-drop-response` mode yang simpan tapi drop response).
   - Return JSON + header yang sesuai.
7. Buat handler `admin.ts`:
   - GET /admin/config → return current state.
   - PUT /admin/config → merge body ke state, return new state.
   - GET /admin/stats → return request counts, success, failure, replay count.
8. Buat handler `metrics.ts`:
   - Prometheus format sederhana: `payment_gateway_mock_requests_total`, `payment_gateway_mock_replays_total`.
9. Buat `index.ts`:
   - `Bun.serve({ port: 3001, fetch(req) { route } })`.
   - Routing manual berdasarkan `new URL(req.url).pathname`.
   - CORS: izinkan origin `*` (karena diakses via Caddy).
   - Logging sederhana ke stdout: `${method} ${path} ${status}`.
10. Start service & test.

## Acceptance criteria

- [ ] `cd mini-services/payment-gateway-mock && bun run dev` berjalan di background tanpa crash.
- [ ] `curl http://localhost:3001/admin/config` returns current config.
- [ ] `curl -X PUT http://localhost:3001/admin/config -d '{"mode":"fail-first-n","n":2}'` mengubah state.
- [ ] `curl -X POST http://localhost:3001/v1/charges -H 'Idempotency-Key: test-1' -d '{"amount":100}'` returns 200 (mode always-success).
- [ ] Mode `fail-first-n=2`: 2 call pertama return 500, call ke-3 return 200.
- [ ] Mode `rate-limited`: return 429 + header `Retry-After: 10`.
- [ ] Mode `client-error`: return 400 `{ error_code: 'invalid_card' }`.
- [ ] Mode `succeed-but-drop-response`: call pertama return timeout (503 atau hang); call kedua dengan `Idempotency-Key` sama → return 200 + `replayed: true`.
- [ ] `GET /admin/stats` returns counts.
- [ ] `GET /metrics` returns Prometheus text format.
- [ ] File change → auto-restart (`bun --hot`).

## Useful commands (run after completing this task)

```bash
# 1. Start gateway mock di background
cd /home/z/my-project/mini-services/payment-gateway-mock && bun run dev > /tmp/gateway.log 2>&1 &
sleep 2
tail -n 20 /tmp/gateway.log

# 2. Test endpoints
curl -s http://localhost:3001/admin/config | jq .
curl -s -X PUT http://localhost:3001/admin/config \
  -H 'Content-Type: application/json' \
  -d '{"mode":"fail-first-n","n":2}' | jq .

# 3. Test charge (always-success mode)
curl -s -X PUT http://localhost:3001/admin/config -H 'Content-Type: application/json' -d '{"mode":"always-success"}'
curl -s -X POST http://localhost:3001/v1/charges \
  -H 'Idempotency-Key: test-001' \
  -H 'Content-Type: application/json' \
  -d '{"amount":100,"currency":"IDR"}' | jq .

# 4. Test replay (same key)
curl -s -X POST http://localhost:3001/v1/charges \
  -H 'Idempotency-Key: test-001' \
  -H 'Content-Type: application/json' \
  -d '{"amount":100,"currency":"IDR"}' | jq .  # harus ada replayed:true

# 5. Test rate-limited
curl -s -X PUT http://localhost:3001/admin/config -H 'Content-Type: application/json' -d '{"mode":"rate-limited"}'
curl -i -X POST http://localhost:3001/v1/charges \
  -H 'Idempotency-Key: test-002' \
  -H 'Content-Type: application/json' \
  -d '{"amount":100}'  # harus 429 + Retry-After header

# 6. Stats & metrics
curl -s http://localhost:3001/admin/stats | jq .
curl -s http://localhost:3001/metrics

# 7. Akses via Caddy dari browser/Next.js client (XTransformPort)
curl -s "http://localhost:3000/admin/config?XTransformPort=3001" | jq .

# 8. Matikan service saat tidak dipakai
kill %1  # atau pkill -f payment-gateway-mock
```

## Notes

- **Idempotency-Key uniqueness**: plan section 9 menyebut key = `payment.id`. Mock hanya menyimpan successful charges; failures tidak disimpan.
- **Counter untuk `fail-first-n`**: gunakan counter global per `Idempotency-Key` agar replays tidak mengkonsumsi counter (karena replay langsung sukses tanpa apply mode). Implementasi: `Map<idempotencyKey, attemptCount>`.
- **`succeed-but-drop-response`**: implementasinya — simpan charge ke idempotency store (sukses), tapi **jangan kirim response** (delay lalu abort). Client akan timeout → retry → kena replay.
- **No persistence**: state in-memory. Restart service = reset config + counters + idempotency store. Acceptable untuk demo; catat di production caveats (TASK-14).
- Setelah task ini selesai, TASK-06 (gateway adapter) bisa diuji end-to-end.
