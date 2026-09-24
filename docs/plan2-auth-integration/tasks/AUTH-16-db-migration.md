# AUTH-16 — DB migration (cached_users + sessions tables + payments.user_id nullable)

> **Task ID**: AUTH-16
> **Plan**: Plan 2 — Auth Integration (v1.2.2)
> **Depends on**: -
> **Estimated effort**: M (~2 jam)
> **Plan reference**: Section 7.1 (cached_users), Section 7.2 (sessions), Section 7.3 (payments.user_id nullable), Section 7.4 (kenapa hanya 2 tabel), Section 7.5 (batasan jsonb), Section 16 (env DB_*)

---

## Goal

Buat 3 file migration di `apps/payment-api/src/migrations/` untuk:
1. Tabel `cached_users` — cache info stabil user (dari auth `/api/v1/me/permissions`).
2. Tabel `sessions` — snapshot sesi + permissionCodes (audit trail, dipakai jika `SESSION_STORE=postgres`).
3. Tambah column `user_id` (nullable) di tabel `payments` — link payment ke user yang membuat (nullable supaya existing payments dari Plan1 tidak rusak).

## Scope

**In scope**:
- Migration `0003_create_cached_users.ts`:
  - Table `cached_users` per plan2 section 7.1:
    - `user_id uuid PRIMARY KEY` (dari auth service).
    - `username varchar(64) NOT NULL`.
    - `email varchar(128) NULL`.
    - `name varchar(128) NOT NULL`.
    - `is_super_admin boolean NOT NULL DEFAULT false`.
    - `last_sync_at timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)`.
  - Index: `idx_cached_users_username` (unique — username stabil dari auth).
- Migration `0004_create_sessions.ts`:
  - Table `sessions` per plan2 section 7.2:
    - `sid varchar(64) PRIMARY KEY`.
    - `user_id uuid NOT NULL REFERENCES cached_users(user_id) ON DELETE CASCADE`.
    - `role_id uuid NOT NULL` (dari JWT).
    - `permission_codes jsonb NOT NULL DEFAULT '[]'`.
    - `access_token text NULL` (encrypted at rest — aplikasi tangani encrypt).
    - `refresh_token text NULL` (encrypted at rest).
    - `access_expires_at timestamp(3) NULL`.
    - `refresh_expires_at timestamp(3) NULL`.
    - `created_at timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)`.
    - `last_seen_at timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)`.
    - `last_sync_at timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)`.
  - Index (per plan2 section 7.2):
    - `idx_sessions_user_id` (user_id).
    - `idx_sessions_last_sync_at` (last_sync_at — untuk cleanup scheduler).
    - `idx_sessions_refresh_expires_at` (refresh_expires_at).
    - `idx_sessions_permission_codes_gin` (GIN index on `permission_codes` jsonb — untuk query `WHERE permission_codes @> '["payment.write"]'`).
- Migration `0005_add_payments_user_id.ts`:
  - `ALTER TABLE payments ADD COLUMN user_id uuid NULL` (NULLABLE per user decision).
  - FK: `ALTER TABLE payments ADD CONSTRAINT fk_payments_user_id FOREIGN KEY (user_id) REFERENCES cached_users(user_id) ON DELETE SET NULL`.
  - Index: `idx_payments_user_id` (untuk query by user).
- Entities TypeORM (di `packages/security/src/cache/` — sudah stub di AUTH-08):
  - `CachedUser` entity → register ke payment-api TypeORM module.
  - `SessionEntity` entity → register (tapi skip jika `SESSION_STORE=memory` via condition).
- Seed scripts (opsional, untuk dev):
  - `cached_users` tidak perlu seed (diisi saat login pertama).
  - Tidak ada seed untuk `sessions` (diisi runtime).
- Verify migration:
  - `pnpm --filter payment-api migration:run` → 3 migration applied.
  - `pnpm --filter payment-api migration:revert` → revert last migration.
  - Manual: psql `\d cached_users`, `\d sessions`, `\d payments` → structure sesuai spec.

**Out of scope**:
- Encrypt access_token/refresh_token at rest (column text, app-layer encrypt via `crypto.createCipheriv('aes-256-gcm', ...)` — di-task terpisah atau di AUTH-12 SessionService).
- Cleanup scheduler untuk session expired (cron job) — di-task terpisah (opsional).
- Migration untuk `cached_roles` / `cached_menus` / `cached_user_roles` — tidak dibuat (plan2 section 7.4 explicit).
- Postgres full-text search di `permission_codes` — GIN index cukup untuk `@>` query.
- Backup strategy — opsional, di luar scope.

## Files to create/modify

- `apps/payment-api/src/migrations/0003_create_cached_users.ts` — NEW
- `apps/payment-api/src/migrations/0004_create_sessions.ts` — NEW
- `apps/payment-api/src/migrations/0005_add_payments_user_id.ts` — NEW
- `apps/payment-api/src/migrations/0006_drop_payments_user_id.ts` — NEW (down migration untuk 0005, untuk revert)
- `packages/security/src/cache/cached-user.entity.ts` — UPDATE (full impl, dari stub AUTH-08)
- `packages/security/src/cache/session.entity.ts` — UPDATE (full impl, dari stub AUTH-08)
- `apps/payment-api/src/app.module.ts` — UPDATE: register `CachedUser` + `SessionEntity` di TypeORM `entities` array (conditional: hanya jika `SESSION_STORE != memory`)
- `apps/payment-api/src/config/typeorm.config.ts` — UPDATE: include migration path + entities
- `apps/payment-api/package.json` — UPDATE: add scripts `migration:run`, `migration:revert`, `migration:generate`

## Implementation steps

1. **`0003_create_cached_users.ts`**:
   ```ts
   import { MigrationInterface, QueryRunner } from 'typeorm';

   export class CreateCachedUsers1700000000003 implements MigrationInterface {
     name = 'CreateCachedUsers1700000000003';

     public async up(queryRunner: QueryRunner): Promise<void> {
       await queryRunner.query(`
         CREATE TABLE "cached_users" (
           "user_id"          uuid            NOT NULL,
           "username"         varchar(64)     NOT NULL,
           "email"            varchar(128),
           "name"             varchar(128)    NOT NULL,
           "is_super_admin"   boolean         NOT NULL DEFAULT false,
           "last_sync_at"     TIMESTAMP(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
           CONSTRAINT "PK_cached_users" PRIMARY KEY ("user_id")
         )
       `);
       await queryRunner.query(`
         CREATE UNIQUE INDEX "idx_cached_users_username" ON "cached_users" ("username")
       `);
     }

     public async down(queryRunner: QueryRunner): Promise<void> {
       await queryRunner.query(`DROP INDEX "idx_cached_users_username"`);
       await queryRunner.query(`DROP TABLE "cached_users"`);
     }
   }
   ```

2. **`0004_create_sessions.ts`**:
   ```ts
   import { MigrationInterface, QueryRunner } from 'typeorm';

   export class CreateSessions1700000000004 implements MigrationInterface {
     name = 'CreateSessions1700000000004';

     public async up(queryRunner: QueryRunner): Promise<void> {
       await queryRunner.query(`
         CREATE TABLE "sessions" (
           "sid"                  varchar(64)     NOT NULL,
           "user_id"              uuid            NOT NULL,
           "role_id"              uuid            NOT NULL,
           "permission_codes"     jsonb           NOT NULL DEFAULT '[]',
           "access_token"         text,
           "refresh_token"        text,
           "access_expires_at"    TIMESTAMP(3),
           "refresh_expires_at"   TIMESTAMP(3),
           "created_at"           TIMESTAMP(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
           "last_seen_at"         TIMESTAMP(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
           "last_sync_at"         TIMESTAMP(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
           CONSTRAINT "PK_sessions" PRIMARY KEY ("sid"),
           CONSTRAINT "FK_sessions_cached_users" FOREIGN KEY ("user_id")
             REFERENCES "cached_users"("user_id") ON DELETE CASCADE
         )
       `);
       await queryRunner.query(`CREATE INDEX "idx_sessions_user_id" ON "sessions" ("user_id")`);
       await queryRunner.query(`CREATE INDEX "idx_sessions_last_sync_at" ON "sessions" ("last_sync_at")`);
       await queryRunner.query(`CREATE INDEX "idx_sessions_refresh_expires_at" ON "sessions" ("refresh_expires_at")`);
       // GIN index untuk query permission_codes @> '["payment.write"]'::jsonb
       await queryRunner.query(`CREATE INDEX "idx_sessions_permission_codes_gin" ON "sessions" USING GIN ("permission_codes")`);
     }

     public async down(queryRunner: QueryRunner): Promise<void> {
       await queryRunner.query(`DROP INDEX "idx_sessions_permission_codes_gin"`);
       await queryRunner.query(`DROP INDEX "idx_sessions_refresh_expires_at"`);
       await queryRunner.query(`DROP INDEX "idx_sessions_last_sync_at"`);
       await queryRunner.query(`DROP INDEX "idx_sessions_user_id"`);
       await queryRunner.query(`DROP TABLE "sessions"`);
     }
   }
   ```

3. **`0005_add_payments_user_id.ts`**:
   ```ts
   import { MigrationInterface, QueryRunner } from 'typeorm';

   export class AddPaymentsUserId1700000000005 implements MigrationInterface {
     name = 'AddPaymentsUserId1700000000005';

     public async up(queryRunner: QueryRunner): Promise<void> {
       // NULLABLE: existing payments dari Plan1 tidak punya user_id
       await queryRunner.query(`ALTER TABLE "payments" ADD COLUMN "user_id" uuid`);
       await queryRunner.query(`
         ALTER TABLE "payments"
           ADD CONSTRAINT "fk_payments_user_id"
           FOREIGN KEY ("user_id") REFERENCES "cached_users"("user_id")
           ON DELETE SET NULL
       `);
       await queryRunner.query(`CREATE INDEX "idx_payments_user_id" ON "payments" ("user_id")`);
     }

     public async down(queryRunner: QueryRunner): Promise<void> {
       await queryRunner.query(`DROP INDEX "idx_payments_user_id"`);
       await queryRunner.query(`ALTER TABLE "payments" DROP CONSTRAINT "fk_payments_user_id"`);
       await queryRunner.query(`ALTER TABLE "payments" DROP COLUMN "user_id"`);
     }
   }
   ```

4. **`cached-user.entity.ts`** (UPDATE dari stub AUTH-08):
   ```ts
   import { Entity, PrimaryColumn, Column, Index, CreateDateColumn } from 'typeorm';

   @Entity('cached_users')
   @Index('idx_cached_users_username', ['username'], { unique: true })
   export class CachedUser {
     @PrimaryColumn({ type: 'uuid', name: 'user_id' })
     userId: string;

     @Column({ type: 'varchar', length: 64 })
     username: string;

     @Column({ type: 'varchar', length: 128, nullable: true })
     email: string | null;

     @Column({ type: 'varchar', length: 128 })
     name: string;

     @Column({ type: 'boolean', name: 'is_super_admin', default: false })
     isSuperAdmin: boolean;

     @Column({ type: 'timestamp(3)', name: 'last_sync_at', default: () => 'CURRENT_TIMESTAMP(3)' })
     lastSyncAt: Date;
   }
   ```

5. **`session.entity.ts`** (UPDATE dari stub AUTH-08):
   ```ts
   import { Entity, PrimaryColumn, Column, Index, CreateDateColumn, ManyToOne, JoinColumn } from 'typeorm';
   import { CachedUser } from './cached-user.entity';

   @Entity('sessions')
   @Index('idx_sessions_user_id', ['userId'])
   @Index('idx_sessions_last_sync_at', ['lastSyncAt'])
   @Index('idx_sessions_refresh_expires_at', ['refreshExpiresAt'])
   @Index('idx_sessions_permission_codes_gin', ['permissionCodes'], { sync: false }) // GIN — manual via migration
   export class SessionEntity {
     @PrimaryColumn({ type: 'varchar', length: 64 })
     sid: string;

     @Column({ type: 'uuid', name: 'user_id' })
     userId: string;

     @ManyToOne(() => CachedUser, { onDelete: 'CASCADE' })
     @JoinColumn({ name: 'user_id', referencedColumnName: 'userId' })
     user: CachedUser;

     @Column({ type: 'uuid', name: 'role_id' })
     roleId: string;

     @Column({ type: 'jsonb', name: 'permission_codes', default: [] })
     permissionCodes: string[];

     @Column({ type: 'text', name: 'access_token', nullable: true })
     accessToken: string | null;

     @Column({ type: 'text', name: 'refresh_token', nullable: true })
     refreshToken: string | null;

     @Column({ type: 'timestamp(3)', name: 'access_expires_at', nullable: true })
     accessExpiresAt: Date | null;

     @Column({ type: 'timestamp(3)', name: 'refresh_expires_at', nullable: true })
     refreshExpiresAt: Date | null;

     @CreateDateColumn({ type: 'timestamp(3)', name: 'created_at' })
     createdAt: Date;

     @Column({ type: 'timestamp(3)', name: 'last_seen_at', default: () => 'CURRENT_TIMESTAMP(3)' })
     lastSeenAt: Date;

     @Column({ type: 'timestamp(3)', name: 'last_sync_at', default: () => 'CURRENT_TIMESTAMP(3)' })
     lastSyncAt: Date;
   }
   ```

6. **Update `app.module.ts`** (payment-api):
   ```ts
   @Module({
     imports: [
       TypeOrmModule.forRootAsync({
         useFactory: () => ({
           type: 'postgres',
           host: process.env.DB_HOST,
           port: parseInt(process.env.DB_PORT ?? '5432'),
           username: process.env.DB_USER,
           password: process.env.DB_PASS,
           database: process.env.DB_NAME,
           entities: [
             Payment,
             PaymentAttempt,
             CachedUser,
             // SessionEntity hanya kalau SESSION_STORE=postgres atau sebagai audit
             ...(process.env.SESSION_STORE === 'postgres' || process.env.SESSION_AUDIT_ENABLED === 'true'
               ? [SessionEntity]
               : []),
           ],
           migrations: ['dist/migrations/*.js'],
           migrationsRun: false, // controlled via CLI
           synchronize: false, // never in production
         }),
       }),
       TypeOrmModule.forFeature([Payment, PaymentAttempt, CachedUser]),
       // ... other modules
     ],
   })
   export class AppModule {}
   ```

7. **Add scripts di `payment-api/package.json`**:
   ```json
   {
     "scripts": {
       "migration:run": "typeorm migration:run -d dist/src/config/typeorm.config.js",
       "migration:revert": "typeorm migration:revert -d dist/src/config/typeorm.config.js",
       "migration:generate": "typeorm migration:generate -d dist/src/config/typeorm.config.js src/migrations/%npm_config_name%"
     }
   }
   ```

8. **Verify**:
   - Jalankan `pnpm --filter payment-api migration:run` (memerlukan Postgres running — gunakan Docker atau local).
   - psql connect → `\d cached_users`, `\d sessions`, `\d payments`.
   - Verify index: `\di sessions`.
   - Test revert: `pnpm --filter payment-api migration:revert` (revert 0005) → column `user_id` hilang.
   - Re-run: `pnpm --filter payment-api migration:run` → 0005 applied lagi.

## Acceptance criteria

- [ ] Migration `0003_create_cached_users` membuat table `cached_users` dengan 6 column + 1 unique index di `username`.
- [ ] Migration `0004_create_sessions` membuat table `sessions` dengan 11 column + 4 index (1 PK + 3 B-tree + 1 GIN).
- [ ] Migration `0005_add_payments_user_id` menambah column `user_id` (nullable) + FK `fk_payments_user_id` + index `idx_payments_user_id`.
- [ ] `payments.user_id` **NULLABLE** (per user decision) — existing payments dari Plan1 tidak rusak.
- [ ] FK `sessions.user_id` → `cached_users.user_id` `ON DELETE CASCADE` (bila user di-delete dari cache, sessions turut hilang).
- [ ] FK `payments.user_id` → `cached_users.user_id` `ON DELETE SET NULL` (bila user di-delete, payments tetap ada dengan `user_id = NULL` — audit trail).
- [ ] GIN index `idx_sessions_permission_codes_gin` untuk query `permission_codes @> '["..."]'::jsonb`.
- [ ] `CachedUser` entity register ke TypeORM module (selalu).
- [ ] `SessionEntity` conditional register (hanya bila `SESSION_STORE=postgres` atau `SESSION_AUDIT_ENABLED=true`).
- [ ] `pnpm --filter payment-api migration:run` berhasil dari empty state.
- [ ] `pnpm --filter payment-api migration:revert` revert 3 migration terakhir (0005 → 0004 → 0003).
- [ ] `pnpm --filter payment-api typecheck` lulus (entity types match migration).
- [ ] `pnpm --filter payment-api lint` lulus.
- [ ] Document di `SANDBOX_NOTES.md`: tabel `cached_users` + `sessions` di DB plan1 (Postgres), bukan di `auth-mock`.

## Useful commands

```bash
# Install TypeORM CLI (jika belum)
cd /home/z/my-project/retry-failure && pnpm --filter payment-api add typeorm

# Run migration (local Postgres harus running)
cd /home/z/my-project/retry-failure && pnpm --filter payment-api migration:run

# Revert last migration
cd /home/z/my-project/retry-failure && pnpm --filter payment-api migration:revert

# Generate migration from entity changes (for future)
cd /home/z/my-project/retry-failure && npm_config_name=UpdateCachedUsers pnpm --filter payment-api migration:generate

# Verify schema via psql
docker exec -it retry-failure-postgres psql -U retry_failure -d retry_failure -c "\d cached_users"
docker exec -it retry-failure-postgres psql -U retry_failure -d retry_failure -c "\d sessions"
docker exec -it retry_failure -postgres psql -U retry_failure -d retry_failure -c "\d payments"
docker exec -it retry-failure-postgres psql -U retry_failure -d retry_failure -c "\di"

# Test GIN index query
docker exec -it retry-failure-postgres psql -U retry_failure -d retry_failure -c \
  "EXPLAIN SELECT * FROM sessions WHERE permission_codes @> '[\"payment.write\"]'::jsonb;"

# Test FK cascade
docker exec -it retry-failure-postgres psql -U retry_failure -d retry_failure -c \
  "INSERT INTO cached_users (user_id, username, name, is_super_admin) VALUES ('00000000-0000-1000-8000-000000000001', 'test', 'Test', false);"
docker exec -it retry-failure-postgres psql -U retry_failure -d retry_failure -c \
  "INSERT INTO sessions (sid, user_id, role_id) VALUES ('test-sid', '00000000-0000-1000-8000-000000000001', '00000000-0000-1000-8000-000000000002');"
# Delete user → session cascade
docker exec -it retry-failure-postgres psql -U retry_failure -d retry_failure -c \
  "DELETE FROM cached_users WHERE user_id = '00000000-0000-1000-8000-000000000001';"
# Should also delete the session row.

# Typecheck after entity changes
cd /home/z/my-project/retry-failure && pnpm --filter payment-api typecheck
cd /home/z/my-project/retry-failure && pnpm --filter @retry-failure/security typecheck

# Lint
cd /home/z/my-project/retry-failure && pnpm --filter payment-api lint
```

## Notes

- **`payments.user_id` NULLABLE** (per user decision): existing payments dari Plan1 (created_by kosong) tidak rusak saat migration run. Aplikasi bisa set `user_id` saat user login + create payment. Bila user di-delete dari cache, `user_id` jadi `NULL` (audit trail tetap ada).
- **`ON DELETE SET NULL` di payments**: user_id jadi NULL bila user di-delete dari `cached_users`. Tidak cascade — payment history tetap ada untuk audit.
- **`ON DELETE CASCADE` di sessions**: bila user di-delete, semua sesinya hilang (security best practice — user yang di-delete tidak bisa pakai sesi lama).
- **GIN index `permission_codes`**: penting untuk query "siapa yang punya permission `payment.write`" atau "session yang masih punya akses menu X". Tanpa GIN, query scan seluruh table.
- **`SESSION_STORE=memory`**: tabel `sessions` tetap dibuat (untuk audit), tapi tidak dipakai sebagai source of truth. Bila `SESSION_STORE=redis` → tabel `sessions` adalah audit (sync dari Redis via webhook atau lazy sync). Bila `SESSION_STORE=postgres` → tabel `sessions` adalah source of truth.
- **Encrypt `access_token` + `refresh_token`** di app-layer (di AUTH-12 `SessionService`). Column `text` menyimpan ciphertext, key dari env `SESSION_ENCRYPTION_KEY`. Bila tidak ada key → skip encrypt (dev only — log warning).
- **Plan2 section 7.4 "Kenapa hanya 2 tabel"**:
  - `cached_users` info user stabil lintas sesi.
  - `sessions` snapshot permissionCodes.
  - Tidak butuh `cached_roles` / `cached_menus` / `cached_user_roles` / `cached_role_menus` — query ke auth cukup saat sync, hasil tinggal di session.
- **Index strategy**:
  - `idx_sessions_user_id` — query sessions by user (untuk logout-all-devices).
  - `idx_sessions_last_sync_at` — cleanup scheduler (cron) untuk hapus session stale > 24 jam.
  - `idx_sessions_refresh_expires_at` — cleanup session yang refresh token sudah expired.
  - `idx_sessions_permission_codes_gin` — query "session yang masih punya permission X" (untuk audit log).
- **No down migration untuk `0003` dan `0004`** selain drop — keduanya bisa drop table. Tapi `0005` punya FK constraint → drop constraint dulu, baru column, baru index.
- Setelah task ini selesai, **Plan 2 Fase 1 langkah 4** (DB migration) tercapai. Selanjutnya: AUTH-17 (BFF controller integration di payment-api).
