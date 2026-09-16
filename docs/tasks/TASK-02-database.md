# TASK-02 — PostgreSQL 16 + TypeORM Entities + Migrations

> **Task ID**: 2-a
> **Depends on**: 1 (scaffolding)
> **Can run in parallel with**: TASK-03, TASK-04
> **Estimated effort**: M (~1.5 jam)
> **Plan reference**: Section 11 (Persistence rev 2 — PostgreSQL-native), Section 15 (Configuration)

---

## Goal

Mendefinisikan TypeORM entities `Payment` dan `PaymentAttempt` dengan native PostgreSQL types (`uuid`, `numeric`, `timestamp(3)`, native `ENUM`), plus migration script. Set up DataSource untuk TypeORM CLI.

## Scope

**In scope**:
- `apps/payment-api/src/database/entities/payment.entity.ts`
- `apps/payment-api/src/database/entities/payment-attempt.entity.ts`
- `apps/payment-api/src/database/entities/enums.ts` — PG enum definitions.
- `apps/payment-api/src/database/data-source.ts` — DataSource for CLI.
- `apps/payment-api/src/database/database.module.ts` — TypeOrmModule.forRootAsync (ConfigService inject).
- `apps/payment-api/src/database/migrations/0001_init.ts` — initial migration (create tables + enums + indexes).
- `docker/postgres/init.sql` — create extension pgcrypto (bila perlu), create database bila belum.
- Repository classes: `PaymentRepository`, `PaymentAttemptRepository` (TypeORM custom repositories).

**Out of scope**:
- Business logic service (TASK-07).
- Audit trail service (TASK-08).
- Mock repository untuk testing (di TASK-14 e2e).

## Entity design (plan section 11 rev 2)

### `payments` entity
- `id: string` (uuid PK, default `gen_random_uuid()`)
- `orderId: string` (varchar 64, unique)
- `amount: string` (numeric 12,2 — TypeORM `numeric` return as string untuk precision)
- `currency: string` (char 3, default `'IDR'`)
- `status: PaymentStatus` (enum)
- `gatewayReference: string | null` (varchar 64)
- `attemptCount: number` (int, default 0)
- `totalRetryCount: number` (int, default 0)
- `nextRetryAt: Date | null` (timestamp 3, nullable)
- `failureReason: string | null` (varchar 500)
- `createdAt: Date` (timestamp 3, default now)
- `updatedAt: Date` (timestamp 3, update on change)
- Index: `idx_payments_status`, `idx_payments_next_retry_at`

### `payment_attempts` entity
- `id: string` (uuid PK)
- `paymentId: string` (uuid FK -> payments.id, ON DELETE CASCADE)
- `attemptNumber: number` (int)
- `outcome: AttemptOutcome` (enum)
- `httpStatus: number | null` (int, nullable)
- `errorCode: string | null` (varchar, nullable)
- `errorMessage: string | null` (varchar, nullable)
- `delayBeforeNextMs: number | null` (int, nullable)
- `breakerState: string` (varchar 12)
- `durationMs: number` (int)
- `traceId: string | null` (char 32, nullable)
- `idempotencyKey: string` (varchar 64)
- `gatewayReference: string | null` (varchar 64, nullable)
- `createdAt: Date` (timestamp 3, default now)
- Index: `idx_payment_attempts_payment_id`, `idx_payment_attempts_idempotency_key`

## Files to create

- `/home/z/my-project/retry-failure/apps/payment-api/src/database/entities/enums.ts`
- `/home/z/my-project/retry-failure/apps/payment-api/src/database/entities/payment.entity.ts`
- `/home/z/my-project/retry-failure/apps/payment-api/src/database/entities/payment-attempt.entity.ts`
- `/home/z/my-project/retry-failure/apps/payment-api/src/database/entities/index.ts`
- `/home/z/my-project/retry-failure/apps/payment-api/src/database/data-source.ts`
- `/home/z/my-project/retry-failure/apps/payment-api/src/database/database.module.ts`
- `/home/z/my-project/retry-failure/apps/payment-api/src/database/repositories/payment.repository.ts`
- `/home/z/my-project/retry-failure/apps/payment-api/src/database/repositories/payment-attempt.repository.ts`
- `/home/z/my-project/retry-failure/apps/payment-api/src/database/migrations/0001_init.ts`
- `/home/z/my-project/retry-failure/apps/payment-api/src/database/index.ts`
- `/home/z/my-project/retry-failure/docker/postgres/init.sql`

## Implementation steps

1. `entities/enums.ts`:
   ```ts
   export enum PaymentStatus {
     PROCESSING = 'processing',
     SUCCEEDED = 'succeeded',
     FAILED = 'failed',
     SCHEDULED_FOR_RETRY = 'scheduled_for_retry',
   }
   export enum AttemptOutcome {
     SUCCESS = 'success',
     RETRYABLE_FAILURE = 'retryable_failure',
     PERMANENT_FAILURE = 'permanent_failure',
     TIMEOUT = 'timeout',
     CIRCUIT_OPEN = 'circuit_open',
   }
   ```
2. `entities/payment.entity.ts`:
   ```ts
   import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, Index, OneToMany, ManyToOne } from 'typeorm';
   import { PaymentStatus } from './enums';
   import { PaymentAttempt } from './payment-attempt.entity';

   @Entity('payments')
   @Index('idx_payments_status', ['status'])
   @Index('idx_payments_next_retry_at', ['nextRetryAt'])
   export class Payment {
     @PrimaryGeneratedColumn('uuid')
     id: string;

     @Column({ name: 'order_id', type: 'varchar', length: 64, unique: true })
     orderId: string;

     @Column({ type: 'numeric', precision: 12, scale: 2 })
     amount: string;  // numeric returns string to preserve precision

     @Column({ type: 'char', length: 3, default: 'IDR' })
     currency: string;

     @Column({ type: 'enum', enum: PaymentStatus, default: PaymentStatus.PROCESSING })
     status: PaymentStatus;

     @Column({ name: 'gateway_reference', type: 'varchar', length: 64, nullable: true })
     gatewayReference: string | null;

     @Column({ name: 'attempt_count', type: 'int', default: 0 })
     attemptCount: number;

     @Column({ name: 'total_retry_count', type: 'int', default: 0 })
     totalRetryCount: number;

     @Column({ name: 'next_retry_at', type: 'timestamp(3)', nullable: true })
     nextRetryAt: Date | null;

     @Column({ name: 'failure_reason', type: 'varchar', length: 500, nullable: true })
     failureReason: string | null;

     @CreateDateColumn({ name: 'created_at', type: 'timestamp(3)' })
     createdAt: Date;

     @UpdateDateColumn({ name: 'updated_at', type: 'timestamp(3)' })
     updatedAt: Date;

     @OneToMany(() => PaymentAttempt, (a) => a.payment)
     attempts: PaymentAttempt[];
   }
   ```
3. `entities/payment-attempt.entity.ts` — similar pattern, with `ManyToOne` to Payment.
4. `data-source.ts` (untuk TypeORM CLI):
   ```ts
   import 'dotenv/config';
   import { DataSource } from 'typeorm';
   import { Payment } from './entities/payment.entity';
   import { PaymentAttempt } from './entities/payment-attempt.entity';

   export default new DataSource({
     type: 'postgres',
     host: process.env.DB_HOST,
     port: Number(process.env.DB_PORT ?? 5432),
     username: process.env.DB_USER,
     password: process.env.DB_PASS,
     database: process.env.DB_NAME,
     schema: process.env.DB_SCHEMA ?? 'public',
     entities: [Payment, PaymentAttempt],
     migrations: [__dirname + '/migrations/*.{ts,js}'],
     synchronize: false,
     logging: ['error', 'warn'],
   });
   ```
5. `database.module.ts`:
   ```ts
   @Global() @Module({
     imports: [
       TypeOrmModule.forRootAsync({
         inject: [ConfigService],
         useFactory: (cfg: ConfigService) => ({
           type: 'postgres',
           host: cfg.get('DB_HOST'),
           port: cfg.get<number>('DB_PORT'),
           username: cfg.get('DB_USER'),
           password: cfg.get('DB_PASS'),
           database: cfg.get('DB_NAME'),
           schema: cfg.get('DB_SCHEMA'),
           entities: [Payment, PaymentAttempt],
           synchronize: false,
           logging: cfg.get('LOG_LEVEL') === 'debug' ? 'all' : ['error', 'warn'],
         }),
       }),
       TypeOrmModule.forFeature([Payment, PaymentAttempt]),
     ],
     exports: [TypeOrmModule],
   })
   export class DatabaseModule {}
   ```
6. Repositories — pakai custom repository pattern TypeORM 0.3:
   ```ts
   @Injectable()
   export class PaymentRepository {
     constructor(@InjectRepository(Payment) private repo: Repository<Payment>) {}
     async create(data: Partial<Payment>): Promise<Payment> { return this.repo.save(this.repo.create(data)); }
     async findById(id: string): Promise<Payment | null> { return this.repo.findOne({ where: { id } }); }
     async list(filter: { status?: PaymentStatus }): Promise<Payment[]> { return this.repo.find({ where: filter, order: { createdAt: 'DESC' }, take: 100 }); }
     async findDueRetries(now: Date, limit = 50): Promise<Payment[]> {
       return this.repo.createQueryBuilder('p')
         .where('p.status = :status', { status: PaymentStatus.SCHEDULED_FOR_RETRY })
         .andWhere('p.next_retry_at <= :now', { now })
         .orderBy('p.next_retry_at', 'ASC')
         .limit(limit)
         .getMany();
     }
     async atomicUpdateStatus(id: string, expectedFrom: PaymentStatus, patch: Partial<Payment>): Promise<boolean> {
       const r = await this.repo.update({ id, status: expectedFrom }, patch);
       return r.affected === 1;
     }
   }
   ```
7. Migration `0001_init.ts`:
   - Create enum types `payment_status_enum` dan `attempt_outcome_enum`.
   - Create tables `payments` dan `payment_attempts` dengan semua kolom.
   - Create indexes.
   - Down migration: drop tables lalu enum types.
8. `docker/postgres/init.sql`:
   ```sql
   -- Run once on container init
   CREATE EXTENSION IF NOT EXISTS "pgcrypto";
   ```
9. Wire `DatabaseModule` ke `AppModule`.
10. Run migration:
    ```bash
    cd apps/payment-api && pnpm db:migrate
    ```

## Acceptance criteria

- [ ] `pnpm db:migrate` di `apps/payment-api` berhasil (membutuhkan PostgreSQL jalan di port 5432 — start via `docker compose up -d postgres` atau connect ke external instance).
- [ ] Tabel `payments` dan `payment_attempts` ada di schema `public`.
- [ ] Native enum types `payment_status_enum` dan `attempt_outcome_enum` ada (`\dT` di psql).
- [ ] Index `idx_payments_status`, `idx_payments_next_retry_at`, `idx_payment_attempts_payment_id`, `idx_payment_attempts_idempotency_key` ada.
- [ ] `PaymentRepository.create()` & `findById()` bekerja (test via script atau jest).
- [ ] `findDueRetries()` return hanya payment `scheduled_for_retry` dengan `next_retry_at <= now`.
- [ ] `atomicUpdateStatus()` return `false` bila `status` tidak match `expectedFrom`.
- [ ] `pnpm typecheck` & `pnpm lint` lulus untuk `apps/payment-api`.

## Useful commands (run after completing this task)

### Pre-flight Check

> **WAJIB BACA**: sebelum menjalankan command di bawah, cek kondisi lingkungan Anda via [`SANDBOX_NOTES.md`](./SANDBOX_NOTES.md) section 1 (Pre-flight Check).
>
> Ringkasan keyword:
> - `pnpm --version` ada -> KONDISI LOCAL. Tidak ada -> KONDISI SANDBOX -> jalankan `corepack enable pnpm && corepack prepare pnpm@9.12.0 --activate` dulu.
> - `docker --version` ada -> KONDISI LOCAL -> `docker compose up -d postgres`. Tidak ada -> KONDISI SANDBOX -> butuh external PostgreSQL instance, atau skip migration + gunakan mock repository untuk dev.
> - `psql --version` ada -> verifikasi schema via psql CLI. Tidak ada -> verifikasi via Node script (`pg.Client`).
>
> Command di bawah ditulis dengan dua varian bila perlu (LOCAL / SANDBOX). Pilih salah satu sesuai kondisi.

---

```bash
# 0. Enable pnpm (bila belum)
# KONDISI LOCAL: pnpm sudah terinstall — skip, jalankan `pnpm --version` untuk verify.
# KONDISI SANDBOX:
corepack enable pnpm
corepack prepare pnpm@9.12.0 --activate

# 1. Start PostgreSQL
# KONDISI LOCAL (Docker tersedia):
cd /home/z/my-project/retry-failure
docker compose up -d postgres
sleep 5
docker compose ps postgres
# -> PostgreSQL di localhost:5432

# KONDISI SANDBOX (Docker tidak tersedia):
# Opsi A: connect ke external PostgreSQL instance (set DB_HOST, DB_PORT, DB_USER, DB_PASS, DB_NAME di .env)
# Opsi B: skip DB integration test, gunakan in-memory mock repository untuk dev
# Opsi C: install postgresql native via apt (butuh sudo, tidak ada di sandbox default)
# Lihat SANDBOX_NOTES.md section 2.5 untuk strategi alternatif.
# Document caveat environment di TASK-15 production caveats.

# 2. Copy env example ke .env (pilih salah satu sesuai kondisi)
cd /home/z/my-project/retry-failure/apps/payment-api

# KONDISI LOCAL (Docker tersedia):
cp ../../.env.example .env
# Default .env.example sudah set DB credentials untuk docker compose postgres service.
# Tidak perlu edit manual.

# KONDISI SANDBOX (Docker tidak tersedia):
cp ../../.env.sandbox.example .env
# .env.sandbox.example punya port shift (PORT=3001, GATEWAY_URL=http://localhost:3002).
# Bila ada external PostgreSQL -> edit DB_HOST/DB_USER/DB_PASS/DB_NAME sesuai instance.
# Bila TIDAK ada DB -> skip migration + gunakan mock repository.

# 3. Run migration — sama kedua kondisi (asalkan DB dapat diakses)
pnpm db:migrate

# Bila DB TIDAK bisa diakses di SANDBOX (tanpa external PostgreSQL):
# - Skip migration, gunakan mock repository untuk dev
# - Document caveat di TASK-15 production caveats
# - Unit test yang tidak butuh DB tetap bisa jalan (mock repository)

# 4. Verify schema
# KONDISI LOCAL (psql via docker exec):
docker compose -f /home/z/my-project/retry-failure/docker-compose.yml exec postgres \
  psql -U retry_failure -d retry_failure -c '\dt'

docker compose -f /home/z/my-project/retry-failure/docker-compose.yml exec postgres \
  psql -U retry_failure -d retry_failure -c '\dT'

docker compose -f /home/z/my-project/retry-failure/docker-compose.yml exec postgres \
  psql -U retry_failure -d retry_failure -c '\d payments'

# KONDISI SANDBOX (psql di host, bila tersedia):
psql -h localhost -U retry_failure -d retry_failure -c '\dt'
psql -h localhost -U retry_failure -d retry_failure -c '\dT'
psql -h localhost -U retry_failure -d retry_failure -c '\d payments'

# KONDISI SANDBOX (psql tidak tersedia -> verifikasi via Node script):
cd /home/z/my-project/retry-failure/apps/payment-api
pnpm exec ts-node -e "
import { Client } from 'pg';
const c = new Client({ host: 'localhost', port: 5432, user: 'retry_failure', password: 'retry_failure', database: 'retry_failure' });
await c.connect();
const t = await c.query(\"SELECT table_name FROM information_schema.tables WHERE table_schema='public'\");
console.log(t.rows);
const e = await c.query(\"SELECT typname FROM pg_type WHERE typtype='e'\");
console.log('enums:', e.rows);
await c.end();
"

# 4. Lint & typecheck — sama kedua kondisi
cd /home/z/my-project/retry-failure/apps/payment-api
pnpm lint
pnpm typecheck

# 5. Quick repository test (Node script — butuh DB up)
# Tambah script scripts/smoke-db.ts lalu run via ts-node:
# pnpm exec ts-node -r tsconfig-paths/register scripts/smoke-db.ts

# 6. Revert migration (test) — sama kedua kondisi (asalkan DB dapat diakses)
pnpm db:migrate:revert
pnpm db:migrate  # re-apply

# 7. Generate new migration (untuk task berikutnya)
# pnpm db:migration:generate src/database/migrations/0002_add_something
```

## Notes

- **`numeric` returns string**: TypeORM `numeric` column returns JS `string` untuk preserve precision (avoid float rounding). Aplikasi harus handle ini — di TASK-07 service akan `Number(amount)` bila perlu, atau tetap sebagai string untuk display.
- **Native enum**: TypeORM 0.3 dengan PostgreSQL mendukung `type: 'enum'` yang otomatis create PG enum type. Migration pertama generate harusnya handle ini.
- **`synchronize: false`**: WAJIB. Jangan pernah `true` di production.
- **`pgcrypto` extension**: PostgreSQL 13+ sudah punya `gen_random_uuid()` builtin di `pgcrypto`-less mode, tapi tetap best practice enable extension untuk safety.
- **Migration sequence**: `0001_init.ts` create enum + tables + indexes. Migration berikutnya (bila ada schema change) pakai `0002_*.ts` dst.
- **Sandbox tanpa Docker**: bila Docker tidak tersedia di sandbox, dokumentasikan di TASK-15 bahwa PostgreSQL butuh external instance (atau gunakan in-memory mock repository). Untuk dev/test, mock repository cukup untuk most scenarios kecuali E2E.
- Setelah task ini selesai, TASK-06 (gateway adapter) & TASK-07 (payments service) bisa pakai repository ini.
