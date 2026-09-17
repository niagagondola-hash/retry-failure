# TASK-14b — Dual Environment Support (SQLite untuk Sandbox + PostgreSQL untuk Lokal)

> **Parent**: [TASK-14a-e2e-verification.md](./TASK-14a-e2e-verification.md)
> **Depends on**: TASK-14a (7 E2E specs + helpers + docs) — semua scenario PASS di lokal
> **Estimated effort**: M (2-3 jam, ~9 files)
> **Plan reference**: Section 14.2 (E2E scenarios) + Section 11 (Persistence)

---

## 1. Konteks & Masalah

Saat ini, e2e test hanya bisa berjalan di environment yang punya PostgreSQL (lokal user). Sandbox tidak punya PostgreSQL atau Docker, sehingga saya (AI assistant) tidak bisa run test di sandbox untuk verifikasi.

**Goal**: Memungkinkan e2e test berjalan di 2 environment berbeda:

| Environment | Database | Status | Tujuan |
|---|---|---|---|
| **Sandbox** | SQLite (in-memory) | Belum ada | Saya bisa run e2e test di sandbox |
| **Lokal user** | PostgreSQL | Sudah jalan | User tetap pakai PostgreSQL seperti sekarang |

**Constraint**: Behavior test harus sama di kedua environment — tidak boleh ada test yang pass di satu tapi fail di environment lain.

---

## 2. Tantangan Utama

1. **TypeORM dual-driver**: config harus support `postgres` dan `sqlite`
2. **Schema differences**: PostgreSQL native enum vs SQLite TEXT + CHECK constraint
3. **Test helpers**: sekarang pakai `pg.Client` langsung — harus refactor ke TypeORM DataSource (driver-agnostic)
4. **Migration vs synchronize**: PostgreSQL pakai migration, SQLite pakai `synchronize: true` (auto-create)
5. **Entity compatibility**: cek decorator SQLite compatibility

---

## 3. Langkah-Langkah Implementasi

### Step 1: Audit Current State (read-only)

**Tujuan**: Identifikasi semua tempat yang hardcode PostgreSQL atau pakai `pg.Client` langsung.

**Files to audit**:

| File | Yang dicari | Issue |
|---|---|---|
| `src/database/database.module.ts` | `type: 'postgres'` hardcode | Perlu conditional |
| `src/database/data-source.ts` | `type: 'postgres'` hardcode | Perlu conditional |
| `src/config/validation.schema.ts` | `DB_TYPE` tidak ada | Tambah schema |
| `tests/e2e/helpers/setup.ts` | `import { Client } from 'pg'` | Refactor ke DataSource |
| `tests/e2e/helpers/db.ts` | `pgClient.query()` | Refactor ke DataSource.query() |
| `src/database/entities/*.ts` | `type: 'enum'`, `type: 'uuid'` | Cek SQLite compatibility |
| `src/database/migrations/0001_init.ts` | `CREATE TYPE ... AS ENUM` | SQLite tidak support |
| `src/database/migrations/0002_trace_id_varchar.ts` | `ALTER COLUMN ... TYPE` | SQLite syntax beda |

**Output**: Daftar lengkap file yang perlu diubah + estimate effort.

---

### Step 2: Tambah `DB_TYPE` Environment Variable

**Files to modify**:
- `.env.example` — tambah `DB_TYPE=postgres` (default) + comment
- `apps/payment-api/.env` (sandbox) — set `DB_TYPE=sqlite`
- `src/config/validation.schema.ts` — tambah Joi schema

**Joi schema**:
```typescript
DB_TYPE: Joi.string().valid('postgres', 'sqlite').default('postgres'),
```

**Behavior**:
- `DB_TYPE=postgres` (default): pakai PostgreSQL, `synchronize: false`, pakai migrations
- `DB_TYPE=sqlite`: pakai SQLite in-memory, `synchronize: true`, skip migrations

---

### Step 3: Refactor `database.module.ts` untuk Dual Driver

**Current** (hardcode postgres):
```typescript
TypeOrmModule.forRootAsync({
  useFactory: (config) => ({
    type: 'postgres',
    host: config.get('DB_HOST'),
    // ...
  }),
})
```

**Target** (conditional):
```typescript
TypeOrmModule.forRootAsync({
  useFactory: (config) => {
    const dbType = config.get<string>('DB_TYPE') ?? 'postgres';

    if (dbType === 'sqlite') {
      return {
        type: 'sqlite',
        database: ':memory:',
        synchronize: true,   // auto-create schema, skip migrations
        entities: [Payment, PaymentAttempt],
        dropSchema: true,    // clean start each restart
      };
    }

    return {
      type: 'postgres',
      host: config.get('DB_HOST'),
      port: config.get('DB_PORT'),
      username: config.get('DB_USER'),
      password: config.get('DB_PASS'),
      database: config.get('DB_NAME'),
      schema: config.get('DB_SCHEMA'),
      synchronize: false,
      migrations: [...],
      entities: [Payment, PaymentAttempt],
    };
  },
})
```

---

### Step 4: Refactor `data-source.ts` untuk CLI (migrations)

**Current**: hardcode `type: 'postgres'`

**Target**: conditional berdasarkan `DB_TYPE`

```typescript
const dbType = process.env.DB_TYPE ?? 'postgres';

export default new DataSource(
  dbType === 'sqlite'
    ? {
        type: 'sqlite',
        database: ':memory:',
        synchronize: true,
        entities: [Payment, PaymentAttempt],
      }
    : {
        type: 'postgres',
        host: process.env.DB_HOST,
        port: Number(process.env.DB_PORT),
        username: process.env.DB_USER,
        password: process.env.DB_PASS,
        database: process.env.DB_NAME,
        schema: process.env.DB_SCHEMA,
        entities: [Payment, PaymentAttempt],
        migrations: [__dirname + '/migrations/*.{ts,js}'],
        synchronize: false,
      }
);
```

---

### Step 5: Cek Entity Compatibility

**Files to audit**: `src/database/entities/payment.entity.ts`, `payment-attempt.entity.ts`

**Potential issues**:

| Decorator | PostgreSQL | SQLite | Fix needed? |
|---|---|---|---|
| `@PrimaryGeneratedColumn('uuid')` | native UUID | TEXT (TypeORM generate UUID) | ✅ OK |
| `@Column({ type: 'enum', enum: ... })` | native enum | TEXT + CHECK constraint | Mungkin perlu adjust |
| `@Column({ type: 'numeric', precision: 12, scale: 2 })` | numeric | NUMERIC affinity | ✅ OK |
| `@Column({ type: 'char', length: 3 })` | char(3) | TEXT | ✅ OK |
| `@Column({ type: 'varchar', length: 64 })` | varchar(64) | TEXT | ✅ OK |
| `@Column({ type: 'timestamp', precision: 3 })` | timestamp(3) | TEXT | ✅ OK |

**Strategy**: TypeORM handle most differences. Kalau `type: 'enum'` bermasalah di SQLite, pakai `type: 'varchar'` + validate di application layer.

---

### Step 6: Refactor Test Helpers

**File**: `tests/e2e/helpers/setup.ts`

**Current** (pg.Client):
```typescript
import { Client } from 'pg';
export const pgClient = new Client({ ... });
export async function cleanDb() {
  await pgClient.query('DELETE FROM payment_attempts');
  await pgClient.query('DELETE FROM payments');
}
```

**Target** (TypeORM DataSource):
```typescript
import { DataSource } from 'typeorm';
import { Payment } from '../../../src/database/entities/payment.entity';
import { PaymentAttempt } from '../../../src/database/entities/payment-attempt.entity';

let dataSource: DataSource | null = null;

export async function getTestDataSource(): Promise<DataSource> {
  if (!dataSource) {
    const dbType = process.env.DB_TYPE ?? 'postgres';
    dataSource = new DataSource(
      dbType === 'sqlite'
        ? { type: 'sqlite', database: ':memory:', synchronize: true, entities: [Payment, PaymentAttempt] }
        : { type: 'postgres', host: 'localhost', port: 5432, username: 'retry_failure', password: 'retry_failure', database: 'retry_failure', entities: [Payment, PaymentAttempt] }
    );
    await dataSource.initialize();
  }
  return dataSource;
}

export async function cleanDb(): Promise<void> {
  const ds = await getTestDataSource();
  await ds.query('DELETE FROM payment_attempts');
  await ds.query('DELETE FROM payments');
}
```

**File**: `tests/e2e/helpers/db.ts`

**Current** (pg.Client):
```typescript
import { pgClient } from './setup';
export async function queryAttempts(paymentId: string) {
  const { rows } = await pgClient.query('SELECT ...');
  return rows;
}
```

**Target** (DataSource):
```typescript
import { getTestDataSource } from './setup';
export async function queryAttempts(paymentId: string) {
  const ds = await getTestDataSource();
  const rows = await ds.query('SELECT ...', [paymentId]);
  return rows;
}
```

---

### Step 7: Setup Sandbox untuk Run Test

**Sandbox needs**:
1. `DB_TYPE=sqlite` di `.env`
2. Tidak perlu PostgreSQL/Docker
3. Tidak perlu `pnpm db:migrate` (SQLite pakai `synchronize: true`)
4. Start payment-api + gateway-mock (services tetap butuh running)

**Sandbox limitations**:
- Sandbox tidak punya PostgreSQL — SQLite solve ini
- Sandbox tidak punya Docker — services (payment-api, gateway-mock) jalan sebagai Node process

---

### Step 8: Verify Dual Environment

**Test matrix**:

| Test | Sandbox (SQLite) | Lokal (PostgreSQL) |
|---|---|---|
| S1 transient | Run + verify | Already PASS |
| S2 permanent | Run + verify | Already PASS |
| S3 circuit-breaker | Run + verify | Already PASS |
| S4 idempotency | Run + verify | Already PASS |
| S5 retry-after | Run + verify | Already PASS |
| S6 durable-scheduler | Run + verify | Already PASS |
| S7 exhaustion | Run + verify | Already PASS |

**Behavior differences to watch**:

| Aspek | PostgreSQL | SQLite | Risk |
|---|---|---|---|
| Enum column | native enum | TEXT + CHECK | Low (TypeORM handle) |
| UUID generation | `gen_random_uuid()` | App generate | Low (TypeORM handle) |
| Timestamp precision | ms | s | Medium (test delta timing) |
| Case sensitivity | case-sensitive | case-insensitive | Low (no string compare in test) |
| Transaction isolation | MVCC | file lock | Medium (cleanDb race condition) |

---

### Step 9: Documentation

**Files to update**:
- `docs/tasks/TASK-14b-dual-environment.md` — task ini (dokumentasi)
- `.env.example` — comment tentang `DB_TYPE`
- `docs/tasks/SANDBOX_NOTES.md` — update dengan SQLite instruction
- `README.md` — section "Running Tests" dengan dual environment

---

## 4. Perkiraan File yang Berubah

| # | File | Perubahan | Effort |
|---|---|---|---|
| 1 | `.env.example` | Tambah `DB_TYPE` + comment | Kecil |
| 2 | `apps/payment-api/.env` (sandbox) | Set `DB_TYPE=sqlite` | Kecil |
| 3 | `src/config/validation.schema.ts` | Tambah Joi schema `DB_TYPE` | Kecil |
| 4 | `src/database/database.module.ts` | Conditional driver config | Sedang |
| 5 | `src/database/data-source.ts` | Conditional driver config | Sedang |
| 6 | `tests/e2e/helpers/setup.ts` | Refactor pg.Client → DataSource | Sedang |
| 7 | `tests/e2e/helpers/db.ts` | Refactor pgClient.query → DataSource.query | Sedang |
| 8 | `src/database/entities/*.ts` | Cek + adjust SQLite compatibility | Sedang |
| 9 | `docs/tasks/TASK-14b-dual-environment.md` | Dokumentasi task (file ini) | Sedang |

**Total**: ~9 files, estimasi effort medium (2-3 jam implementasi).

---

## 5. Risk Assessment

| Risk | Probability | Impact | Mitigation |
|---|---|---|---|
| Entity `type: 'enum'` tidak work di SQLite | Medium | Low | Test dulu, kalau fail pakai `type: 'varchar'` |
| Timestamp precision beda (s vs ms) | Medium | Medium | Cek `timestamp(3)` di SQLite, adjust kalau perlu |
| cleanDb race condition (SQLite file lock) | Low | Low | Pakai `:memory:` (tidak ada lock) |
| Behavior difference tidak terdeteksi | Medium | High | Run semua 7 e2e test di sandbox, compare dengan lokal |
| Test helper refactor break existing test | Medium | High | Refactor incrementally, test per file |

---

## 6. Compliance dengan PLAN1

### Yang TIDAK Berubah

- **PLAN1 section 11 (Persistence)**: Schema PostgreSQL tetap sama untuk production
- **PLAN1 section 14.2 (E2E scenarios)**: Test assertion tetap sama, hanya DB driver yang berbeda
- **PLAN1 section 15 (Configuration)**: Default tetap `postgres`, SQLite hanya untuk test env

### Yang Berubah

- **`DB_TYPE` env var**: Tambahan baru untuk switch driver
- **`synchronize`**: `true` untuk SQLite (test), `false` untuk PostgreSQL (production)
- **Test helpers**: dari `pg.Client` ke TypeORM DataSource (driver-agnostic)

### Justifikasi

PLAN1 section 11 mensyaratkan PostgreSQL-native types (uuid, enum, numeric). Ini tetap dipertahankan untuk production. SQLite hanya untuk test environment di sandbox, di mana PostgreSQL tidak tersedia. TypeORM handle perbedaan schema, jadi test assertion tetap valid di kedua environment.

---

## 7. Decision Points (Perlu Approval User)

Sebelum implementasi, mohon konfirmasi:

### Decision 1: SQLite storage mode

- **Opsi A**: `:memory:` (cepat, hilang saat restart) — cocok untuk test
- **Opsi B**: `./test.db` (persistent file) — untuk debug

**Rekomendasi**: Opsi A (`:memory:`) — cepat, tidak ada file lock, clean start setiap run.

### Decision 2: Entity `type: 'enum'` compatibility

Kalau `type: 'enum'` bermasalah di SQLite:

- **Opsi A**: Ubah ke `type: 'varchar'` + application-layer validation (di `payments.service.ts`)
- **Opsi B**: Keep `type: 'enum'` dan cari workaround (mungkin TypeORM version upgrade)

**Rekomendasi**: Opsi A — lebih simple, TypeORM handle validation, tidak break PostgreSQL.

### Decision 3: Test helpers refactor scope

- `helpers/setup.ts`: ganti `pg.Client` → TypeORM DataSource
- `helpers/db.ts`: ganti `pgClient.query()` → DataSource.query()
- `helpers/breaker.ts`: tetap HTTP-based (tidak perlu DB langsung)
- `helpers/payments.ts`, `gateway.ts`, `metrics.ts`: tetap HTTP-based

**Rekomendasi**: Hanya refactor `setup.ts` + `db.ts`. Lainnya tetap HTTP-based (tidak terdampak).

### Decision 4: Implementasi incremental vs sekaligus

- **Opsi A**: Kerjakan Step 1-4 dulu (config + module + data-source), lalu verify, baru lanjut Step 5-9
- **Opsi B**: Kerjakan semua sekaligus (Step 1-9)

**Rekomendasi**: Opsi A (incremental) — lebih aman, bisa verify per stage.

---

## 8. Definition of Done

```
☐ Step 1: Audit selesai, daftar file lengkap
☐ Step 2: DB_TYPE env var + Joi schema ditambah
☐ Step 3: database.module.ts support dual driver
☐ Step 4: data-source.ts support dual driver
☐ Step 5: Entity compatibility verified (atau adjusted)
☐ Step 6: Test helpers refactored (setup.ts + db.ts)
☐ Step 7: Sandbox configured (DB_TYPE=sqlite)
☐ Step 8: Semua 7 e2e test PASS di sandbox (SQLite)
☐ Step 9: Semua 7 e2e test tetap PASS di lokal (PostgreSQL)
☐ Documentation updated (.env.example, SANDBOX_NOTES.md, README.md)
```

---

## 9. Algoritma Test Helper (Sebelum vs Sesudah)

### 9.1 Sebelum (pg.Client — PostgreSQL only)

```
helpers/setup.ts:
  import { Client } from 'pg'
  pgClient = new Client({ host, port, user, password, database })
  ensureDbConnected(): pgClient.connect()
  cleanDb(): pgClient.query('DELETE FROM payment_attempts'); pgClient.query('DELETE FROM payments')
  closeDb(): pgClient.end()

helpers/db.ts:
  queryAttempts(paymentId): pgClient.query('SELECT ... FROM payment_attempts WHERE payment_id=$1', [paymentId])
  queryPayment(paymentId): pgClient.query('SELECT ... FROM payments WHERE id=$1', [paymentId])
```

**Masalah**: `pg.Client` hanya support PostgreSQL. Tidak bisa connect ke SQLite.

### 9.2 Sesudah (TypeORM DataSource — driver-agnostic)

```
helpers/setup.ts:
  import { DataSource } from 'typeorm'
  getTestDataSource():
    if DB_TYPE=sqlite:
      return new DataSource({ type:'sqlite', database:':memory:', synchronize:true, entities:[...] })
    else:
      return new DataSource({ type:'postgres', host, port, ..., entities:[...] })
  ensureDbConnected(): dataSource.initialize()
  cleanDb(): dataSource.query('DELETE FROM payment_attempts'); dataSource.query('DELETE FROM payments')
  closeDb(): dataSource.destroy()

helpers/db.ts:
  queryAttempts(paymentId): dataSource.query('SELECT ... FROM payment_attempts WHERE payment_id=$1', [paymentId])
  queryPayment(paymentId): dataSource.query('SELECT ... FROM payments WHERE id=$1', [paymentId])
```

**Keuntungan**: DataSource driver-agnostic. Bisa connect ke PostgreSQL atau SQLite dengan config yang sama. SQL query tetap standard (works di kedua driver).

---

## 10. Catatan Edge Case

- **SQLite `:memory:` database**: Hilang saat process restart. Tidak ada persistent storage. OK untuk test, tidak untuk production.
- **SQLite concurrency**: SQLite pakai file-level lock. Dengan `:memory:`, tidak ada lock issue. Tapi kalau pakai `./test.db`, bisa ada race condition saat cleanDb + test jalan bersamaan.
- **TypeORM `synchronize: true`**: Auto-create/drop schema. Berisiko di production (bisa drop data). Hanya untuk test env. Production tetap pakai `synchronize: false` + migrations.
- **Enum di SQLite**: TypeORM v0.3 men-support `type: 'enum'` di SQLite dengan generate TEXT + CHECK constraint. Tapi behavior bisa beda — perlu verify.
- **Timestamp precision**: PostgreSQL `timestamp(3)` punya ms precision. SQLite `TEXT` timestamp hanya second precision. Test yang assert delta timing (S5 retry-after) mungkin perlu tolerance adjustment.
- **UUID generation**: PostgreSQL `gen_random_uuid()` vs TypeORM app-generated UUID. TypeORM handle ini secara otomatis dengan `@PrimaryGeneratedColumn('uuid')`.

---

## 11. Referensi

- [TypeORM SQLite documentation](https://typeorm.io/data-source-options#sqlite-data-source-options)
- [TypeORM PostgreSQL documentation](https://typeorm.io/data-source-options#postgres--cockroachdb-data-source-options)
- [PLAN1 section 11 (Persistence)](../PLAN1_Cockatiel_Retry_Failure_Scenario.md)
- [TASK-14a-e2e-verification.md](./TASK-14a-e2e-verification.md)
