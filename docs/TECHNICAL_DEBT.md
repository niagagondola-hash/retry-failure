# Technical Debt — Catatan untuk Refactor Mendatang

> **Tujuan**: Catatan technical debt yang ditemukan selama development, dengan rekomendasi refactor.
> **Bukan bug fatal** — code tetap berjalan dan lulus test. Tapi melanggar best practice SOLID/clean code.
> **Source**: Analisa dari code review observability module (2026-09-20).
> **Plan reference**: [PLAN1 section 13 (Observability)](./PLAN1_Cockatiel_Retry_Failure_Scenario.md) + [section 19 (Hal yang Sengaja Tidak Diimplementasikan)](./PLAN1_Cockatiel_Retry_Failure_Scenario.md)

---

## 📋 TL;DR — Daftar Technical Debt

| # | Issue | Severity | Effort | SOLID Principle Violated |
|---|---|---|---|---|
| 1 | `metrics/metrics.service.ts` legacy stub (dead code) | Low | S (5 menit) | Clean code — naming conflict + dead code |
| 2 | Module boundary unclear (`metrics/` vs `observability/`) | Medium | M (30 menit) | Clean code — folder structure |
| 3 | `MetricsService` fat interface (8 method publik) | Medium | M (1-2 jam) | I — Interface Segregation |
| 4 | Controller depend concrete class, bukan interface | Low | M (1 jam) | D — Dependency Inversion |
| 5 | `MetricsService` 3 responsibility (setup + record + expose) | Low | M (1-2 jam) | S — Single Responsibility |
| 6 | `src/data-source.ts` legacy orphan (duplicate dengan `database/data-source.ts`) | Low | S (5 menit) | Clean code — dead code + duplicate |
| 7 | `src/config/configuration.ts` legacy orphan (typed config tidak dipakai) | Low | S (5 menit) | Clean code — dead code |
| 8 | `src/config/env.ts` legacy orphan (class-validator tidak dipakai, Joi yang aktif) | Low | S (5 menit) | Clean code — dead code + duplicate validation |
| 9 | AUTH-02: Missing unit tests `keypair.spec.ts` + `jwks.controller.spec.ts` | Medium | S (30 menit) | Test coverage — acceptance criteria tidak terpenuhi |
| 10 | AUTH-23: Docker/env/scripts tidak terimplementasi | High | M (1 jam) | Acceptance criteria tidak terpenuhi — docker-compose, package.json, .env files |
| 11 | AUTH-03: `/health` endpoint hilang setelah controller prefix berubah | Low | S (5 menit) | Regression — `@Controller('oauth')` menghilangkan route `/health` yang sebelumnya `@Controller()` |
| 12 | Plan2: OAuthClientService tight coupling ke axios (direct import) | Low | M (30 menit) | D — Dependency Inversion (axios di-import langsung, bukan via DI token) |

**Total estimasi**: ~4-6 jam kalau semua di-refactor. Tapi bisa incremental. Issues 1, 6, 7, 8 adalah quick wins (masing-masing 5 menit delete dead code).

---

## 📖 Detail per Issue

### Issue 1: Legacy Stub `metrics/metrics.service.ts` (Dead Code)

**Severity**: Low
**Effort**: S (5 menit)
**Plan reference**: TASK-09 (created stub) vs TASK-11 (real implementation di `observability/`)

#### Deskripsi

Ada 2 file `metrics.service.ts` di folder berbeda:

```
apps/payment-api/src/modules/
├── metrics/
│   └── metrics.service.ts        ← LEGACY STUB (TIDAK dipakai)
└── observability/
    └── metrics.service.ts        ← REAL IMPLEMENTATION (DIPAKAI)
```

**`metrics/metrics.service.ts`** (legacy):
```typescript
@Injectable()
export class MetricsService {
  readonly registry: Registry;
  readonly httpRequestsTotal: Counter<string>;  // ← dummy metric

  async metrics(): Promise<string> {
    return this.registry.metrics();
  }
}
```

**`observability/metrics.service.ts`** (active, 7 metrics):
```typescript
@Injectable()
export class MetricsService implements OnModuleInit {
  readonly registry: Registry;
  readonly gatewayRequestsTotal: Counter<string>;
  readonly retryAttemptsTotal: Counter<string>;
  // ... 7 metrics + 8 methods
}
```

#### Pelanggaran

- ❌ **Dead code** — `metrics/metrics.service.ts` tidak di-import siapapun
- ❌ **Naming conflict** — 2 file dengan nama sama bikin bingung developer
- ❌ **Confusion** — developer baru tidak tahu yang mana dipakai

#### Bukti Tidak Dipakai

```bash
# Search import di seluruh codebase
grep -rn "from.*metrics/metrics.service" apps/payment-api/src/
# Expected: kosong (tidak ada yang import dari folder metrics/)

# Controller import dari observability/, bukan metrics/
grep -n "MetricsService" apps/payment-api/src/modules/metrics/metrics.controller.ts
# Line 3: import { MetricsService } from '../observability/metrics.service';
#                                                          ↑ dari observability/
```

#### Rekomendasi Refactor

```bash
# Delete legacy file
rm apps/payment-api/src/modules/metrics/metrics.service.ts

# Update index.ts (hapus export legacy)
# apps/payment-api/src/modules/metrics/index.ts
```

**Verify**: `pnpm typecheck` + `pnpm test` tetap PASS setelah delete.

---

### Issue 2: Module Boundary Unclear (`metrics/` vs `observability/`)

**Severity**: Medium
**Effort**: M (30 menit)
**Plan reference**: PLAN1 section 13 (Observability) — seharusnya 1 pilar, 1 module

#### Deskripsi

Struktur folder saat ini:

```
modules/
├── metrics/                    ← Folder "metrics" — tapi isinya cuma controller
│   ├── metrics.controller.ts
│   ├── metrics.module.ts
│   └── index.ts
│
└── observability/              ← Folder "observability" — tapi ada metrics.service.ts!
    ├── metrics.service.ts     ← KENAPA metrics.service ada di sini?
    ├── trace-context.ts
    ├── logger.module.ts
    └── observability.module.ts
```

**Confusion**:
- Folder `metrics/` expected berisi metrics service, tapi cuma ada controller
- Folder `observability/` expected berisi observability stuff, tapi ada `metrics.service.ts`
- Cross-reference: `metrics.controller.ts` import dari `observability/metrics.service.ts` (cross-module)
- Module boundary tidak jelas — metrics service ada di observability, tapi controller ada di metrics

#### Pelanggaran Clean Code

- ❌ **Module cohesion** — metrics-related code terpisah di 2 folder
- ❌ **Cross-module dependency** — `metrics/` import dari `observability/` (harusnya 1 module)
- ❌ **Naming inconsistency** — nama folder tidak reflect isi

#### Rekomendasi Refactor

**Opsi A** (gabung jadi 1 module — recommended):

```
modules/
└── observability/
    ├── metrics/
    │   ├── metrics.service.ts
    │   ├── metrics.controller.ts
    │   └── metrics.module.ts
    ├── trace/
    │   └── trace-context.ts
    ├── logger/
    │   └── logger.module.ts
    └── observability.module.ts  ← root module, import sub-modules
```

**Opsi B** (pisah berdasarkan concern — pure SOLID):

```
modules/
├── metrics/                    ← semua metrics-related
│   ├── metrics.service.ts
│   ├── metrics.controller.ts
│   └── metrics.module.ts
├── tracing/
│   └── trace-context.ts
└── logging/
    └── logger.module.ts
```

**Plus Opsi A**: 1 module observability, sub-folder untuk organization. Common di NestJS.
**Plus Opsi B**: Pure separation, tiap concern 1 module. Tapi cross-module import lebih banyak.

---

### Issue 3: `MetricsService` Fat Interface (8 Method Publik)

**Severity**: Medium
**Effort**: M (1-2 jam)
**SOLID**: **I — Interface Segregation Principle**

#### Deskripsi

`MetricsService` expose 8 method publik + 2 properties, padahal client berbeda butuh subset berbeda:

```typescript
class MetricsService {
  // 8 method publik yang di-expose ke seluruh app:
  incGatewayRequest(outcome, httpStatus)        // dipakai http-adapter
  observeGatewayDuration(durationMs)            // dipakai http-adapter
  incReplay()                                   // dipakai http-adapter
  incRetryAttempt(outcome, paymentStatus)        // dipakai payments.service
  setBreakerState(state)                        // dipakai resilient-adapter
  incPaymentStatus(status)                      // dipakai payments.service
  decPaymentStatus(status)                      // dipakai payments.service
  observeProcessingDuration(durationMs)          // dipakai payments.service
  metrics()                                     // dipakai metrics.controller
  get contentType                                // dipakai metrics.controller
}
```

**Client dan method yang dipakai**:

| Client | Method yang dipakai | Method tidak dipakai |
|---|---|---|
| `http-adapter.ts` | `incGatewayRequest`, `observeGatewayDuration`, `incReplay` | 6 lainnya |
| `resilient-adapter.ts` | `setBreakerState` | 7 lainnya |
| `payments.service.ts` | `incPaymentStatus`, `decPaymentStatus`, `observeProcessingDuration`, `incRetryAttempt` | 4 lainnya |
| `metrics.controller.ts` | `metrics()`, `contentType` | 8 lainnya |

**Pelanggaran ISP**: Setiap client dipaksa depend ke semua 10 method, padahal cuma butuh 1-4 method.

#### Rekomendasi Refactor — Interface Segregation

Pisah jadi interface per concern:

```typescript
// apps/payment-api/src/modules/observability/metrics/ports.ts

export interface GatewayMetricsPort {
  incGatewayRequest(outcome: 'success' | 'failure', httpStatus: string | number): void;
  observeGatewayDuration(durationMs: number): void;
  incReplay(): void;
}

export interface BreakerMetricsPort {
  setBreakerState(state: 'closed' | 'open' | 'half_open'): void;
}

export interface PaymentMetricsPort {
  incPaymentStatus(status: string): void;
  decPaymentStatus(status: string): void;
  observeProcessingDuration(durationMs: number): void;
  incRetryAttempt(outcome: 'success' | 'failure', paymentStatus: string): void;
}

export interface MetricsExpositionPort {
  metrics(): Promise<string>;
  contentType: string;
}
```

```typescript
// MetricsService implement semua interface:
class MetricsService implements
  GatewayMetricsPort,
  BreakerMetricsPort,
  PaymentMetricsPort,
  MetricsExpositionPort,
  OnModuleInit {
  // ... existing implementation
}
```

```typescript
// Client depend ke interface spesifik, bukan MetricsService:
// http-adapter.ts
constructor(@Inject('GatewayMetricsPort') private metrics: GatewayMetricsPort) {}

// payments.service.ts
constructor(@Inject('PaymentMetricsPort') private metrics: PaymentMetricsPort) {}

// metrics.controller.ts
constructor(@Inject('MetricsExpositionPort') private metrics: MetricsExpositionPort) {}
```

**Plus**: Pure ISP — client cuma depend method yang dia butuh
**Minus**: Verbose — 4 interface baru + injection token setup. Trade-off dengan simplicity.

---

### Issue 4: Controller Depend Concrete Class, Bukan Abstraction

**Severity**: Low
**Effort**: M (1 jam)
**SOLID**: **D — Dependency Inversion Principle**

#### Deskripsi

```typescript
// apps/payment-api/src/modules/metrics/metrics.controller.ts line 3
import { MetricsService } from '../observability/metrics.service';
//                       ↑ concrete class, bukan interface

@Controller('metrics')
export class MetricsController {
  constructor(private readonly metricsService: MetricsService) {}
  //                                ↑ depend ke concrete class
}
```

**Pelanggaran DIP**:
- High-level module (Controller) depend ke low-level module (concrete `MetricsService`)
- Seharusnya depend ke abstraction (interface)

#### Rekomendasi Refactor

```typescript
// Define interface (lihat Issue 3)
export interface MetricsExpositionPort {
  metrics(): Promise<string>;
  contentType: string;
}

// Module provide interface → concrete binding
@Module({
  providers: [
    MetricsService,
    { provide: 'MetricsExpositionPort', useExisting: MetricsService },
  ],
  exports: ['MetricsExpositionPort'],
})
export class ObservabilityModule {}

// Controller depend ke abstraction
@Controller('metrics')
export class MetricsController {
  constructor(
    @Inject('MetricsExpositionPort') private metrics: MetricsExpositionPort
  ) {}
}
```

**Plus**: Pure DIP — depend ke abstraction
**Minus**: Verbose — injection token + module binding. Trade-off dengan simplicity.

---

### Issue 5: `MetricsService` 3 Responsibility (Setup + Record + Expose)

**Severity**: Low
**Effort**: M (1-2 jam)
**SOLID**: **S — Single Responsibility Principle**

#### Deskripsi

`MetricsService` punya 3 responsibility berbeda:

```typescript
class MetricsService {
  // Responsibility 1: Registry setup
  readonly registry: Registry;
  constructor() {
    this.registry = new Registry();
    // ... register 7 metrics
  }
  onModuleInit() { collectDefaultMetrics({ register: this.registry }); }

  // Responsibility 2: Metric recording
  incGatewayRequest() { ... }
  incReplay() { ... }
  setBreakerState() { ... }
  // ... 8 methods

  // Responsibility 3: Metric exposition
  async metrics() { return this.registry.metrics(); }
  get contentType() { return this.registry.contentType; }
}
```

**Pelanggaran SRP**: 1 class punya 3 alasan untuk berubah:
1. Kalau ada metric baru → modify constructor (Responsibility 1)
2. Kalau logic recording berubah → modify inc/observe/set (Responsibility 2)
3. Kalau exposition format berubah → modify metrics()/contentType (Responsibility 3)

#### Rekomendasi Refactor — Pisah Jadi 3 Class

```typescript
// Responsibility 1: Registry setup
class MetricsRegistry implements OnModuleInit {
  readonly registry: Registry;
  constructor() { /* setup 7 metrics */ }
  onModuleInit() { collectDefaultMetrics({ register: this.registry }); }
}

// Responsibility 2: Metric recording
class MetricsRecorder {
  constructor(private registry: Registry) {}
  incGatewayRequest() { this.gatewayRequestsTotal.inc(...); }
  // ... 8 methods
}

// Responsibility 3: Metric exposition
class MetricsExporter {
  constructor(private registry: Registry) {}
  async metrics() { return this.registry.metrics(); }
  get contentType() { return this.registry.contentType; }
}
```

**Plus**: Pure SRP — tiap class 1 responsibility
**Minus**: 3 class + 2 dependencies antar class. Trade-off dengan simplicity.

---

### Issue 6: `src/data-source.ts` Legacy Orphan (Dead Code)

**Severity**: Low
**Effort**: S (5 menit)
**Clean code violation**: Dead code + duplicate

#### Deskripsi

Ada **2 file `data-source.ts`** di folder berbeda:

```
apps/payment-api/src/
├── data-source.ts                    ← LEGACY ORPHAN (TIDAK DIPAKAI)
│   - Hardcoded type: 'postgres'
│   - Tidak ada dual-driver support (DB_TYPE=sqlite)
│   - Tidak pakai buildDbConfig() factory
│
└── database/
    └── data-source.ts                ← ACTIVE (DIPAKAI)
        - Pakai buildDbConfig() dari db-config.ts (TASK-14b dual env)
        - Support DB_TYPE=postgres + DB_TYPE=sqlite
```

#### Bukti Tidak Dipakai

```bash
# Search import di seluruh codebase
grep -rn "import.*data-source" apps/payment-api/src/
# Expected: kosong (tidak ada yang import dari src/data-source.ts)

# package.json scripts pakai yang di database/ folder:
grep "data-source" apps/payment-api/package.json
# "db:migrate": "... migration:run -d src/database/data-source.ts"
# "db:migrate:revert": "... migration:revert -d src/database/data-source.ts"
# "db:migration:generate": "... migration:generate -d src/database/data-source.ts"
#                                                                    ↑ folder database/
```

#### Pelanggaran

- ❌ **Dead code** — `src/data-source.ts` tidak di-import siapapun
- ❌ **Duplicate** — 2 file dengan nama sama, logic berbeda (legacy hardcoded postgres vs active dual-driver)
- ❌ **Confusion** — developer baru tidak tahu yang mana dipakai

#### Rekomendasi Refactor

```bash
# Delete legacy orphan
rm apps/payment-api/src/data-source.ts
```

**Verify**: `pnpm typecheck` + `pnpm test` tetap PASS setelah delete (tidak ada yang reference file ini).

---

### Issue 7: `src/config/configuration.ts` Legacy Orphan (Dead Code)

**Severity**: Low
**Effort**: S (5 menit)
**Clean code violation**: Dead code + naming conflict potential

#### Deskripsi

`configuration.ts` define `AppConfig` interface + `loadConfig()` function, tapi **tidak di-import siapapun**:

```typescript
// apps/payment-api/src/config/configuration.ts
export interface AppConfig {
  nodeEnv: string;
  port: number;
  gatewayUrl: string;
  // ... 14 fields typed
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  // ... typed config loader
}
```

**Yang dipakai**:
- `config.module.ts` → `ConfigModule.forRoot({ validationSchema })` (Joi schema, bukan typed config)
- `validation.schema.ts` — Joi validation (yang sebenarnya dipakai)

#### Bukti Tidak Dipakai

```bash
# Search import di seluruh codebase
grep -rn "from.*config/configuration\|AppConfig\|loadConfig" apps/payment-api/src/
# Expected: kosong (tidak ada yang import dari configuration.ts)
# Hanya self-reference di configuration.ts sendiri
```

#### Pelanggaran

- ❌ **Dead code** — `configuration.ts` tidak di-import siapapun
- ❌ **Naming conflict potential** — `AppConfig` interface bisa conflict dengan future code
- ❌ **Confusion** — developer mungkin pakai typed config dari sini, padahal yang aktif Joi schema

#### Rekomendasi Refactor

**Opsi A** (delete — recommended):
```bash
rm apps/payment-api/src/config/configuration.ts
```

**Opsi B** (integrate — kalau mau typed config):
- Update `config.module.ts` untuk pakai `loadConfig()` sebagai `load: loadConfig`
- Tapi ini butuh refactor + test sync

**Recommended**: Delete (Opsi A) — Joi schema di `validation.schema.ts` sudah cukup untuk validation, dan ConfigService.get<T>() sudah provide type safety di runtime.

---

### Issue 8: `src/config/env.ts` Legacy Orphan (Dead Code)

**Severity**: Low
**Effort**: S (5 menit)
**Clean code violation**: Dead code + duplicate validation logic

#### Deskripsi

`env.ts` define `EnvironmentVariables` class dengan class-validator decorators, tapi **tidak di-integrate ke ConfigModule**:

```typescript
// apps/payment-api/src/config/env.ts
class EnvironmentVariables {
  @IsString() @IsOptional()
  NODE_ENV: string = 'development';

  @IsInt() @Min(1) @Max(65535)
  @Type(() => Number)
  PORT: number = 3001;

  // ... 18 fields dengan class-validator decorators
}
```

**Yang dipakai**:
- `config.module.ts` → `ConfigModule.forRoot({ validationSchema })` (Joi schema)
- `validation.schema.ts` — Joi validation (yang sebenarnya dipakai)

#### Bukti Tidak Dipakai

```bash
# Search import di seluruh codebase
grep -rn "from.*config/env\|EnvironmentVariables" apps/payment-api/src/
# Expected: kosong (tidak ada yang import dari env.ts)
# Hanya self-reference di env.ts sendiri
```

#### Pelanggaran

- ❌ **Dead code** — `env.ts` tidak di-import siapapun
- ❌ **Duplicate validation logic** — 2 validation system (Joi di validation.schema.ts + class-validator di env.ts)
- ❌ **Confusion** — developer tidak tahu validation yang mana yang dipakai (answer: Joi)

#### Rekomendasi Refactor

**Opsi A** (delete — recommended):
```bash
rm apps/payment-api/src/config/env.ts
```

**Opsi B** (migrate dari Joi ke class-validator — kalau mau pure typed config):
- Replace `validation.schema.ts` (Joi) dengan `env.ts` (class-validator)
- Update `config.module.ts` untuk pakai `validateSync` dari env.ts
- Tapi ini butuh refactor + test sync, dan Joi sudah work fine

**Recommended**: Delete (Opsi A) — Joi schema di `validation.schema.ts` sudah work, dan class-validator approach duplikat.

---

### Issue 9: AUTH-02 — Missing Unit Tests `keypair.spec.ts` + `jwks.controller.spec.ts`

**Task**: AUTH-02 (Plan 2 — auth-mock RS256 keypair + JWKS endpoint)
**Severity**: Medium
**Effort**: S (30 menit)
**Plan reference**: [Plan2 Section 5.1 (Signing)](./plan2-auth-integration/PLAN2-Auth_Integration.md) + [AUTH-02 task file](./plan2-auth-integration/tasks/AUTH-02-rs256-jwks.md)

#### Deskripsi

AUTH-02 acceptance criteria (line 242 task file) eksplisit mewajibkan:
- `Unit test (keypair.spec.ts) + integration test (jwks.controller.spec.ts) lulus.`

Subagent yang implement AUTH-02 **skip kedua test files** dengan alasan "manual curl verification cukup". Manual verify memang PASS (sign/verify roundtrip, JWKS endpoint, kid consistency), tapi tidak ada automated test yang bisa di-run di CI.

#### Yang Hilang

| File | Test Cases yang Harusnya Ada |
|---|---|
| `apps/auth-mock/test/keypair.spec.ts` (atau `src/modules/keypair/keypair.spec.ts`) | Sign + verify roundtrip; Invalid signature reject; Expired token reject (`expiresIn: '1s'` + sleep); Wrong audience reject; Wrong issuer reject; `kid` ada di JWT header |
| `apps/auth-mock/test/jwks.controller.spec.ts` (atau `src/modules/keypair/jwks.controller.spec.ts`) | `GET /.well-known/jwks.json` returns valid JWK set; `kid` di JWKS = `kid` di JWT header; `Cache-Control: max-age=300` header |

#### Impact

- ❌ Tidak ada regression protection untuk KeyPairService + JwtSignerService
- ❌ Kalau someone break sign/verify logic, tidak ada test yang catch
- ❌ Acceptance criteria AUTH-02 tidak terpenuhi (9/11 met)

#### Rekomendasi Fix

Buat 2 test files di `apps/auth-mock/src/modules/keypair/` (sesuai jest config `rootDir: 'src'`):
- `keypair.spec.ts` — test KeyPairService + JwtSignerService
- `jwks.controller.spec.ts` — test JwksController via supertest atau Nest testing module

**Estimasi**: 30 menit.

---

### Issue 10: AUTH-23 — Docker/Env/Scripts Tidak Terimplementasi

**Task**: AUTH-23 (Plan 2 — Docker sandbox/dev profiles)
**Severity**: High
**Effort**: M (1 jam)
**Plan reference**: [Plan2 Section 14 (Docker & Dev Workflow)](./plan2-auth-integration/PLAN2-Auth_Integration.md) + [AUTH-23 task file](./plan2-auth-integration/tasks/AUTH-23-docker-sandbox-dev-profiles.md)

#### Deskripsi

AUTH-23 acceptance criteria mewajibkan update docker-compose.yml, package.json scripts, dan .env files dengan auth integration env vars. Audit menemukan **6 dari 8 criteria FAIL**:

| # | Criteria | Status |
|---|---|---|
| 1 | `docker-compose.yml` has `auth-mock` (port 4001) | ❌ MISSING |
| 2 | `docker-compose.yml` has `redis` (port 6379) | ❌ MISSING |
| 3 | `docker-compose.sandbox.yml` minimal (postgres only) | ✅ Pre-existing |
| 4 | Root `package.json` has `dev:sandbox`, `docker:up:sandbox`, `docker:down:sandbox` | ❌ MISSING |
| 5 | `.env.example` has auth integration env vars | ✅ FIXED (2026-09-25) |
| 6 | `.env.sandbox.example` has auth sandbox env vars (`SESSION_STORE=memory`) | ✅ FIXED (2026-09-25) |
| 7 | Existing services + scripts preserved | ✅ |
| 8 | `pnpm install` lulus | ✅ |

#### Root Cause

Subagent AUTH-23 sempat implement di sandbox sebelum reset. Setelah sandbox reset + sync dari local upload, perubahan AUTH-23 tidak ter-include di upload (kemungkinan user upload dari versi lokal yang belum sync perubahan AUTH-23).

#### Impact

- ❌ `docker compose up -d` tidak menjalankan auth-mock + redis
- ❌ Tidak ada sandbox script (`dev:sandbox`)
- ❌ Developer tidak tahu env vars apa yang perlu di-set untuk auth integration
- ❌ AUTH-17 (payment-api integration) akan butuh env vars yang belum ada di .env files

#### Rekomendasi Fix

1. Update `docker-compose.yml` — tambah service `auth-mock` (port 4001) + `redis` (port 6379)
2. Update root `package.json` — tambah scripts: `dev:sandbox`, `docker:up:sandbox`, `docker:down:sandbox`
3. Update `.env.example` — append auth integration env vars (AUTH_MODE, AUTH_BASE_URL, OAUTH_*, SESSION_STORE, dll dari Plan2 Section 16)
4. Update `.env.sandbox.example` — append auth sandbox env vars (SESSION_STORE=memory, AUTH_MODE=mock)

**Estimasi**: 1 jam.

---

### Issue 11: AUTH-03 — `/health` Endpoint Hilang (Regression)

**Task**: AUTH-03 (Plan 2 — OAuth2 endpoints)
**Severity**: Low
**Effort**: S (5 menit)
**Plan reference**: [AUTH-03 task file](./plan2-auth-integration/tasks/AUTH-03-oauth2-endpoints.md)

#### Deskripsi

AUTH-01 (scaffold) membuat `OAuthController` dengan `@Controller()` (no prefix) yang punya route `GET /health`. AUTH-03 mengubah controller menjadi `@Controller('oauth')` untuk OAuth2 endpoints, yang menyebabkan route `/health` hilang (sekarang menjadi `/oauth/health` yang juga tidak ada).

#### Bukti

```bash
curl http://localhost:4001/health
# {"message":"Cannot GET /health","error":"Not Found","statusCode":404}

curl http://localhost:4001/oauth/health
# {"message":"Cannot GET /oauth/health","error":"Not Found","statusCode":404}
```

#### Impact

- ❌ Health check endpoint hilang — tidak ada cara verify auth-mock running selain curl JWKS
- ❌ Docker healthcheck (kalau ada) akan fail

#### Rekomendasi Fix

Tambahkan health route di controller terpisah (tanpa prefix) atau di `AppModule`:

```typescript
// apps/auth-mock/src/modules/health/health.controller.ts
@Controller()
export class HealthController {
  @Get('health')
  health() {
    return { status: 'ok', service: 'auth-mock', version: '0.1.0' };
  }
}
```

Atau pindahkan ke `main.ts` via `app.getHttpAdapter().get('/health', ...)`.

**Estimasi**: 5 menit.

---

### Issue 12: Plan2 — OAuthClientService Tight Coupling ke axios

**Task**: AUTH-09 (Plan 2 — OAuth client)
**Severity**: Low
**Effort**: M (30 menit)
**Plan reference**: [Plan2 Section 9 (packages/security)](./plan2-auth-integration/PLAN2-Auth_Integration.md)

#### Deskripsi

`OAuthClientService` di `packages/security/src/oauth/oauth-client.service.ts` langsung import dan instantiate `axios` di constructor:

```typescript
import axios from 'axios';

constructor(@Inject(SECURITY_OPTIONS) private readonly options: SecurityOptions) {
  this.httpClient = axios.create({ baseURL: options.authBaseUrl, timeout: 5000 });
}
```

Ini technically melanggar DIP — class depend ke concrete library (axios), bukan abstraction.

#### Impact

- ⚠️ Sulit mock axios di unit test (subagent pakai `jest.mock('axios')` yang work, tapi fragile)
- ⚠️ Kalau mau ganti ke `fetch` atau `undici`, harus modify class

#### Rekomendasi Fix

Inject `AxiosInstance` via DI token:

```typescript
constructor(
  @Inject('HTTP_CLIENT') private httpClient: AxiosInstance,
  @Inject(SECURITY_OPTIONS) private options: SecurityOptions,
) {}
```

Factory di SecurityModule:
```typescript
{ provide: 'HTTP_CLIENT', useFactory: () => axios.create({ timeout: 5000 }) }
```

**Estimasi**: 30 menit. Low priority — axios stable, jarang diganti.

---

## 📊 Analysis: Pure SOLID vs Pragmatic

| Approach | Plus | Minus |
|---|---|---|
| **Pure SOLID** (refactor semua) | ✅ Academically correct, easy to test, decoupled | ❌ Verbose — 4 interface + 3 class + injection token setup |
| **Pragmatic** (current — gabung) | ✅ Simpel, common di NestJS production, less boilerplate | ❌ Melanggar ISP + DIP, fat interface |
| **Hybrid** (refactor Issues 1-2 only) | ✅ Delete dead code + clear module boundary, minim risk | ⚠️ Masih fat interface (Issues 3-5 tetap) |

---

## 🎯 Rekomendasi Prioritas Refactor

### Priority 1: Quick Wins (do first)

**Issues 1, 6, 7, 8** (delete dead code) — **20 menit total, no risk**:
```bash
# Issue 1: delete legacy metrics stub
rm apps/payment-api/src/modules/metrics/metrics.service.ts
# Update apps/payment-api/src/modules/metrics/index.ts (hapus export legacy)

# Issue 6: delete legacy data-source orphan (duplicate dengan database/data-source.ts)
rm apps/payment-api/src/data-source.ts

# Issue 7: delete legacy configuration.ts (typed config tidak dipakai, Joi yang aktif)
rm apps/payment-api/src/config/configuration.ts

# Issue 8: delete legacy env.ts (class-validator tidak dipakai, Joi yang aktif)
rm apps/payment-api/src/config/env.ts

# Verify
pnpm typecheck  # Expected: PASS (tidak ada yang import file-file ini)
pnpm test       # Expected: PASS (142/142)
```

### Priority 2: Clean Code Improvement

**Issue 2** (module boundary) — **30 menit, low risk**:
- Pilih Opsi A (gabung observability) atau Opsi B (pisah per concern)
- Move file, update import paths
- Verify `pnpm typecheck` + `pnpm test` PASS

### Priority 3: SOLID Improvement (kalau mau pure)

**Issue 3** (interface segregation) — **1-2 jam, medium risk**:
- Define 4 interface (GatewayMetricsPort, BreakerMetricsPort, PaymentMetricsPort, MetricsExpositionPort)
- Update all clients to depend ke interface
- Verify all tests still PASS

**Issue 4** (DIP) — **1 jam, medium risk** (bundled with Issue 3):
- Injection token setup
- Module binding interface → concrete

**Issue 5** (SRP) — **1-2 jam, high risk** (paling kompleks):
- Pisah jadi 3 class (Registry, Recorder, Exporter)
- Update DI wiring
- Verify all tests still PASS

---

## 📚 Related Docs

- [PLAN1 section 13 — Observability](./PLAN1_Cockatiel_Retry_Failure_Scenario.md)
- [PLAN1 section 18 — SOLID dan Clean Architecture](./PLAN1_Cockatiel_Retry_Failure_Scenario.md)
- [TASK-11 — Observability (simplified ALS)](./tasks/TASK-11-observability.md)
- [TASK-11b — Full OTel SDK + Jaeger]((./tasks/TASK-11b-otel-sdk.md)
- [CONTRIBUTING.md — Development Rules](../CONTRIBUTING.md)
- [TEST_MAINTENANCE_RULES.md — Test maintenance rules](./TEST_MAINTENANCE_RULES.md)

---

## 📝 Update History

| Tanggal | Perubahan | Alasan |
|---|---|---|
| 2026-09-20 | Initial creation | Code review observability module — ditemukan 5 technical debt issues terkait SOLID + clean code |
| 2026-09-23 | Tambah Issues 6, 7, 8 | Code review config + data-source files — ditemukan 3 legacy orphan files (dead code): `src/data-source.ts` (duplicate dengan `database/data-source.ts`), `src/config/configuration.ts` (typed config tidak dipakai), `src/config/env.ts` (class-validator tidak dipakai, Joi yang aktif). Semua Low severity, S effort (delete dead code). |
| 2026-09-25 | Tambah Issues 9, 10, 11, 12 | Audit Batch 2 + Batch 3 Plan 2 — AUTH-02 missing test files (keypair.spec.ts + jwks.controller.spec.ts), AUTH-23 docker/env/scripts tidak terimplementasi (6/8 criteria fail), AUTH-03 /health endpoint regression, AUTH-09 OAuthClientService tight coupling ke axios. |

---

## 💡 Catatan

- Technical debt ini **bukan bug fatal** — code tetap berjalan dan lulus test (142/142 PASS)
- Refactor bisa **incremental** — mulai dari Priority 1 (quick win), lalu lanjut Priority 2-3 kalau ada waktu
- **Trade-off**: Pure SOLID = verbose tapi academically correct. Pragmatic = simpel tapi melanggar beberapa principle. Pilih sesuai konteks project.
- Untuk **demo project**, struktur saat ini acceptable. Untuk **production**, recommended refactor Priority 1 + 2 minimal.
