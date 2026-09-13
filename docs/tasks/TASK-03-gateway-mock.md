# TASK-03 — Payment Gateway Mock (NestJS app, port 3002)

> **Task ID**: 2-b
> **Depends on**: 1 (scaffolding)
> **Can run in parallel with**: TASK-02, TASK-04
> **Estimated effort**: M (~2 jam)
> **Plan reference**: Section 8 (Payment Gateway Mock), Section 9 (Idempotency), Section 17 (Demo)

---

## Goal

Membangun `payment-gateway-mock` sebagai NestJS app terpisah di `apps/payment-gateway-mock/`, berjalan di port **3002**. Service ini mensimulasikan payment gateway dengan 8 failure modes yang dapat diatur saat runtime (tanpa restart), plus in-memory idempotency store untuk replay.

## Scope

**In scope**:
- NestJS app bootstrap di port 3002.
- Modules: `ChargesModule` (POST /v1/charges), `AdminModule` (GET/PUT /admin/config, GET /admin/stats), `MetricsModule` (GET /metrics).
- 8 failure modes (plan section 8.2): `always-success`, `fail-first-n`, `server-error`, `always-timeout`, `client-error`, `random`, `succeed-but-drop-response`, `rate-limited`.
- In-memory idempotency store: `Map<key, ChargeResult>` untuk replay.
- Runtime config (mutable tanpa restart): `MockConfig { mode, n, probability, retryAfterSeconds, timeoutMs }`.
- Stats: total requests, success count, failure count, replay count, actualCharges count.
- `/metrics` expose Prometheus format sederhana (prom-client).
- Hot reload via `nest start --watch`.

**Out of scope**:
- Cockatiel di gateway mock (gateway adalah dependency eksternal, tidak perlu resilience).
- Database persistence (in-memory OK; reset saat restart acceptable untuk demo).
- OTel instrumentation (bisa plug di TASK-11 opsional).

## Adaptation notes

- Plan section 8 mensyaratkan gateway di port terpisah. Kita pakai **3002** (karena 3000 dipakai Next.js sandbox, 3001 dipakai payment-api).
- Akses dari Next.js sandbox (port 3000) → via Caddy: `/?XTransformPort=3002`.
- Akses dari Vue frontend (port 5173) → CORS-enabled, langsung `http://localhost:3002/admin/config`.
- Akses dari payment-api backend (port 3001) → langsung `http://localhost:3002` (server-to-server, tidak via Caddy).
- Idempotency: plan section 9 menyebut `Idempotency-Key: <payment.id>`. Mock menyimpan by key.

## Files to create

- `/home/z/my-project/retry-failure/apps/payment-gateway-mock/src/main.ts` — bootstrap port 3002, CORS, Swagger optional.
- `/home/z/my-project/retry-failure/apps/payment-gateway-mock/src/app.module.ts`
- `/home/z/my-project/retry-failure/apps/payment-gateway-mock/src/modules/charges/charges.module.ts`
- `/home/z/my-project/retry-failure/apps/payment-gateway-mock/src/modules/charges/charges.controller.ts` — POST /v1/charges
- `/home/z/my-project/retry-failure/apps/payment-gateway-mock/src/modules/charges/charges.service.ts` — apply mode + idempotency
- `/home/z/my-project/retry-failure/apps/payment-gateway-mock/src/modules/charges/dto/charge-request.dto.ts` — class-validator
- `/home/z/my-project/retry-failure/apps/payment-gateway-mock/src/modules/charges/dto/charge-response.dto.ts`
- `/home/z/my-project/retry-failure/apps/payment-gateway-mock/src/modules/admin/admin.module.ts`
- `/home/z/my-project/retry-failure/apps/payment-gateway-mock/src/modules/admin/admin.controller.ts` — GET/PUT /admin/config, GET /admin/stats
- `/home/z/my-project/retry-failure/apps/payment-gateway-mock/src/modules/admin/admin.service.ts`
- `/home/z/my-project/retry-failure/apps/payment-gateway-mock/src/modules/admin/dto/mock-config.dto.ts`
- `/home/z/my-project/retry-failure/apps/payment-gateway-mock/src/modules/metrics/metrics.module.ts`
- `/home/z/my-project/retry-failure/apps/payment-gateway-mock/src/modules/metrics/metrics.controller.ts` — GET /metrics
- `/home/z/my-project/retry-failure/apps/payment-gateway-mock/src/modules/metrics/metrics.service.ts` — prom-client registry
- `/home/z/my-project/retry-failure/apps/payment-gateway-mock/src/shared/state/mock-state.ts` — runtime config singleton
- `/home/z/my-project/retry-failure/apps/payment-gateway-mock/src/shared/idempotency/idempotency-store.ts` — in-memory store
- `/home/z/my-project/retry-failure/apps/payment-gateway-mock/src/shared/modes/mode-handler.ts` — switch per mode
- `/home/z/my-project/retry-failure/apps/payment-gateway-mock/src/shared/modes/index.ts`

## Implementation steps

1. `shared/state/mock-state.ts`:
   - `class MockState` dengan `config: MockConfig`, `requestCount`, `successCount`, `failureCount`, `replayCount`, `actualChargesCount`.
   - Default config: `{ mode: 'always-success', n: 0, probability: 0.5, retryAfterSeconds: 10, timeoutMs: 5000 }`.
   - `update(partial: Partial<MockConfig>)` untuk merge.
   - Export singleton instance (atau pakai NestJS provider `@Injectable()` dengan scope DEFAULT).
2. `shared/idempotency/idempotency-store.ts`:
   - `Map<string, ChargeSuccess>` where `ChargeSuccess = { gatewayReference, capturedAt }`.
   - `get(key)`, `set(key, result)`, `has(key)`, `stats()` → `actualChargesCount`.
   - Setiap successful charge (yang benar-benar capture, bukan replay) → `actualChargesCount++`.
3. `shared/modes/mode-handler.ts`:
   - `interface ModeResult { status: number; body?: unknown; headers?: Record<string,string>; shouldDropResponse?: boolean; delayMs?: number; }`
   - `applyMode(mode: Mode, ctx: { idempotencyKey: string; state: MockState }): ModeResult`.
   - Setiap mode:
     - `always-success`: return 200 + `{ gateway_reference, replayed: false }`.
     - `fail-first-n`: counter per `Idempotency-Key`. Bila belum ada di idempotency store & counter < n → 500; bila >= n → 200 + save to store.
     - `server-error`: selalu 500.
     - `always-timeout`: `await sleep(timeoutMs)` (default 5000ms) lalu return 503 — client akan timeout duluan karena `GATEWAY_TIMEOUT_MS=2000`.
     - `client-error`: 400 `{ error_code: 'invalid_card', message: 'Card number invalid' }`.
     - `random`: `Math.random() < probability` ? 200 : 500.
     - `succeed-but-drop-response`: save to idempotency store (actual charge happens) → `shouldDropResponse: true` (don't send response, client will timeout). Next call with same key → replay.
     - `rate-limited`: 429 + header `Retry-After: <retryAfterSeconds>`.
4. `charges.controller.ts`:
   ```ts
   @Controller('v1/charges')
   export class ChargesController {
     constructor(private chargesService: ChargesService) {}
     @Post()
     async charge(@Headers('idempotency-key') key: string, @Body() body: ChargeRequestDto) {
       return this.chargesService.charge(key ?? crypto.randomUUID(), body);
     }
   }
   ```
5. `charges.service.ts`:
   ```ts
   async charge(key: string, body: ChargeRequestDto) {
     // 1. Replay check
     if (this.idempotencyStore.has(key)) {
       this.state.replayCount++;
       const existing = this.idempotencyStore.get(key);
       return { status: 'succeeded', gateway_reference: existing.gatewayReference, replayed: true };
     }
     // 2. Apply mode
     const result = applyMode(this.state.config.mode, { idempotencyKey: key, state: this.state });
     // 3. Sleep bila delay (always-timeout mode)
     if (result.delayMs) await sleep(result.delayMs);
     // 4. Bila success, save to idempotency store
     if (result.status === 200 && !result.shouldDropResponse) {
       const ref = (result.body as any).gateway_reference;
       this.idempotencyStore.set(key, { gatewayReference: ref, capturedAt: new Date() });
       this.state.actualChargesCount++;
     }
     // 5. Bila shouldDropResponse (succeed-but-drop-response): charge already saved, but don't return response
     if (result.shouldDropResponse) {
       // simulate dropped response — hang then abort (but charge already captured)
       await sleep(10000); // long enough for client timeout
       throw new ServiceUnavailableException('response dropped (simulated)');
     }
     // 6. Set headers (Retry-After bila ada)
     // 7. Return appropriate HTTP status
   }
   ```
   Note: NestJS doesn't easily support setting HTTP status + headers from service. Better to return a structured result and let controller map to `@HttpCode()` or `res.status()`. Use `@Res()` injection for full control.
6. `admin.controller.ts`:
   - `@Get('config')` → return current state config.
   - `@Put('config')` → merge body, return new state.
   - `@Get('stats')` → return counts.
7. `metrics.controller.ts`:
   - Pakai prom-client `Registry` instance.
   - Counters: `payment_gateway_mock_requests_total`, `payment_gateway_mock_replays_total`, `payment_gateway_mock_actual_charges_total`.
   - `@Get('metrics')` → return `register.metrics()` with `Content-Type: register.contentType`.
8. `main.ts`:
   ```ts
   async function bootstrap() {
     const app = await NestFactory.create(AppModule);
     app.enableCors({ origin: '*' });
     app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
     await app.listen(3002);
     logger.log('payment-gateway-mock listening on :3002');
   }
   bootstrap();
   ```

## Acceptance criteria

> **PENTING — curl command wajib pakai `-H 'Content-Type: application/json'` untuk PUT/POST yang kirim JSON body.** Tanpa header ini, curl default pakai `application/x-www-form-urlencoded` → NestJS parse body sebagai form, bukan JSON → DTO kosong → silent failure (config tidak berubah, no error). Sudah diverifikasi di sandbox.

- [ ] `cd apps/payment-gateway-mock && pnpm start:dev` jalan tanpa crash.
- [ ] `curl http://localhost:3002/admin/config` returns current config.
- [ ] `curl -X PUT -H 'Content-Type: application/json' http://localhost:3002/admin/config -d '{"mode":"fail-first-n","n":2}'` mengubah state. ← WAJIB `-H 'Content-Type: application/json'`
- [ ] `curl -X POST -H 'Idempotency-Key: test-1' -H 'Content-Type: application/json' http://localhost:3002/v1/charges -d '{"amount":100,"currency":"IDR"}'` returns 200 (mode always-success).
- [ ] Mode `fail-first-n=2`: 2 call pertama return 500, call ke-3 return 200 + `replayed: false` (fresh charge). Same-key call ke-4 → 200 + `replayed: true`.
- [ ] Mode `rate-limited`: return 429 + header `Retry-After: <n>`.
- [ ] Mode `client-error`: return 400 `{ error_code: 'invalid_card' }`.
- [ ] Mode `succeed-but-drop-response`: call pertama hang → client timeout; call kedua dengan same key → return 200 + `replayed: true`.
- [ ] `GET /admin/stats` returns `{ requestCount, successCount, failureCount, replayCount, actualChargesCount }`.
- [ ] `GET /metrics` returns Prometheus text format.
- [ ] `pnpm typecheck` & `pnpm lint` lulus.

## Useful commands (run after completing this task)

### Pre-flight Check

> **WAJIB BACA**: sebelum menjalankan command di bawah, cek kondisi lingkungan Anda via [`SANDBOX_NOTES.md`](./SANDBOX_NOTES.md) section 1 (Pre-flight Check).
>
> Ringkasan keyword:
> - `pnpm --version` ada → KONDISI LOCAL. Tidak ada → KONDISI SANDBOX → jalankan `corepack enable pnpm && corepack prepare pnpm@9.12.0 --activate` dulu.
> - `curl -s http://localhost:3000` sibuk → KONDISI SANDBOX → gateway-mock di PORT=3002 (payment-api di 3001). Bebas → KONDISI LOCAL → gateway-mock di PORT=3001 (payment-api di 3000).
>
> Command di bawah ditulis dengan dua varian bila perlu (LOCAL / SANDBOX). Pilih salah satu sesuai kondisi.

---

```bash
# 1. Start gateway mock
# KONDISI LOCAL (port 3001 bebas):
cd /home/z/my-project/retry-failure/apps/payment-gateway-mock
PORT=3001 pnpm start:dev > /tmp/gateway-mock.log 2>&1 &
sleep 5
tail -n 20 /tmp/gateway-mock.log

# KONDISI SANDBOX (port 3001 dipakai payment-api; port 3000 dipakai Next.js preview):
cd /home/z/my-project/retry-failure/apps/payment-gateway-mock
PORT=3002 pnpm start:dev > /tmp/gateway-mock.log 2>&1 &
sleep 5
tail -n 20 /tmp/gateway-mock.log

# Catatan: bila ingin port-agnostic, bisa pakai env variable:
#   GW_PORT="${GW_PORT:-3001}"  # default 3001 LOCAL; set GW_PORT=3002 untuk SANDBOX
#   PORT=$GW_PORT pnpm start:dev

# 2. Test endpoints — deteksi port gateway mock via env
GW_PORT="${GW_PORT:-3001}"  # default 3001 LOCAL; export GW_PORT=3002 untuk SANDBOX
curl -s http://localhost:$GW_PORT/admin/config | jq .
curl -s -X PUT http://localhost:$GW_PORT/admin/config \
  -H 'Content-Type: application/json' \
  -d '{"mode":"fail-first-n","n":2}' | jq .

# Atau tulis dua varian explicit bila lebih jelas:
# KONDISI LOCAL:
#   curl -s http://localhost:3001/admin/config | jq .
# KONDISI SANDBOX:
#   curl -s http://localhost:3002/admin/config | jq .

# 3. Test charge (always-success)
curl -s -X PUT http://localhost:$GW_PORT/admin/config -H 'Content-Type: application/json' -d '{"mode":"always-success"}'
curl -s -X POST http://localhost:$GW_PORT/v1/charges \
  -H 'Idempotency-Key: test-001' \
  -H 'Content-Type: application/json' \
  -d '{"amount":100,"currency":"IDR"}' | jq .

# 4. Test replay
curl -s -X POST http://localhost:$GW_PORT/v1/charges \
  -H 'Idempotency-Key: test-001' \
  -H 'Content-Type: application/json' \
  -d '{"amount":100,"currency":"IDR"}' | jq .  # harus ada replayed:true

# 5. Test rate-limited
curl -s -X PUT http://localhost:$GW_PORT/admin/config -H 'Content-Type: application/json' -d '{"mode":"rate-limited","retryAfterSeconds":2}'
curl -i -X POST http://localhost:$GW_PORT/v1/charges \
  -H 'Idempotency-Key: test-002' \
  -H 'Content-Type: application/json' \
  -d '{"amount":100}'

# 6. Stats & metrics
curl -s http://localhost:$GW_PORT/admin/stats | jq .
curl -s http://localhost:$GW_PORT/metrics

# 7. Test via Caddy dari Next.js sandbox (port 3000)
# Hanya relevan di KONDISI SANDBOX (Next.js preview di port 3000).
# Di KONDISI LOCAL, skip command ini — Next.js tidak berjalan otomatis di port 3000.
# Asumsi Next.js dev sudah jalan (SANDBOX); ini akan dipakai di TASK-12.
curl -s "http://localhost:3000/admin/config?XTransformPort=3002" | jq .
# Note: XTransformPort=3002 sesuai port gateway-mock di SANDBOX.

# 8. Lint & typecheck — sama kedua kondisi
cd /home/z/my-project/retry-failure
pnpm --filter payment-gateway-mock lint
pnpm --filter payment-gateway-mock typecheck

# 9. Cleanup — sama kedua kondisi
pkill -f "nest start" 2>/dev/null
```

## Notes

- **Idempotency-Key uniqueness**: plan section 9 menyebut key = `payment.id`. Mock hanya menyimpan successful charges; failures tidak disimpan.
- **Counter untuk `fail-first-n`**: gunakan `Map<idempotencyKey, attemptCount>`. Replays tidak mengkonsumsi counter (karena replay langsung sukses tanpa apply mode).
- **`succeed-but-drop-response`**: implementasinya — simpan charge ke idempotency store (sukses), tapi **jangan kirim response** (delay lalu abort/throw). Client akan timeout → retry → kena replay.
- **CORS**: enable `origin: '*'` agar Vue frontend (port 5173) bisa fetch langsung.
- **No persistence**: state in-memory. Restart service = reset config + counters + idempotency store. Acceptable untuk demo; catat di TASK-15.
- **NestJS HTTP status control**: bila perlu set custom status + headers (mis. 429 + Retry-After), inject `@Res() res: Response` di controller dan panggil `res.status(429).set('Retry-After', '10').json({...})`. Setelah `res.send()` dipanggil, NestJS tidak akan melakukan handling tambahan.
- Setelah task ini selesai, TASK-06 (gateway adapter) bisa diuji end-to-end.
