# Pre-Task Checklist Template

> **Template ini ditambahkan ke setiap task spec di `docs/plan2-auth-integration/tasks/AUTH-XX-*.md`**
> **sebelum mulai implementasi.**
>
> **Sumber**: [`CODING_STANDARDS.md`](CODING_STANDARDS.md)

---

## Pre-Implementation Checklist

Sebelum mulai coding task ini, jawab (centang dengan `x`):

### 🔍 DRY Check

- [ ] **Cek duplikasi**: Sudah `grep` logic serupa di `src/`?
  ```bash
  grep -rn "<pattern logic yang akan ditulis>" apps/auth-mock/src packages/security/src
  ```
- [ ] **Kalau ada duplikat >10 lines**: Extract ke shared service/factory dulu sebelum tulis kode baru.
- [ ] **Kalau ada duplikat <10 lines**: Pertimbangkan extract, atau dokumentasi alasan tidak extract.

### 🏗 SOLID Check

- [ ] **SRP**: Apakah class yang akan saya buat punya 1 responsibility saja?
  - File >300 lines? → Kemungkinan violate SRP, split.
  - Function >50 lines? → Kemungkinan terlalu banyak responsibility, extract helper.
- [ ] **OCP**: Tambah fitur baru = tambah file baru, bukan modify existing?
- [ ] **LSP**: Subclass tidak weaken parent contract?
- [ ] **ISP**: Interface yang akan saya buat punya ≤5 methods? Kalau >5, split.
- [ ] **DIP**: Apakah saya akan depend pada concrete class?
  - Kalau ya, apakah acceptable untuk mock context? Catat di TODO kalau tidak.
  - Untuk service yang punya >1 implementation: WAJIB interface.

### 📝 Naming Check

- [ ] **File**: `kebab-case.service.ts` / `kebab-case.controller.ts` / `kebab-case.module.ts`?
- [ ] **Class**: `PascalCase` + suffix (Service, Controller, Guard, Module, Factory)?
- [ ] **Method**: `camelCase` + verb prefix (get, find, validate, verify, issue, render, build, handle)?
- [ ] **Constant**: `UPPER_SNAKE_CASE`?
- [ ] **No abbreviations** (kecuali domain terms: JWT, PKCE, JWKS, API)?

### ⚠️ Error Handling Check

- [ ] **Status code akurat?**
  - 400 BadRequestException: input validation error
  - 401 UnauthorizedException: missing/invalid auth
  - 403 ForbiddenException: authed tapi no permission
  - 404 NotFoundException: resource not found
  - 409 ConflictException: duplicate resource
- [ ] **OAuth2 specific** (RFC 6749 §5.2):
  - `invalid_grant` → 400
  - `invalid_client` → 401
  - `invalid_request` → 400

### 🧪 Test Check

- [ ] **Test file naming**:
  - `*.spec.ts` = unit test (mock dependencies, isolated)
  - `*.integration.spec.ts` = real dependencies, NestJS app
  - `*.e2e-spec.ts` = HTTP server via supertest
- [ ] **Test name**: `'<behavior>'` (bukan `'test X'`)?
- [ ] **Coverage**: Happy path + edge cases + error cases?
- [ ] **Mock external deps** di unit test (DB, HTTP, time)?

### 📚 Documentation Check

- [ ] **JSDoc** di public methods (signature, params, returns, side effects)?
- [ ] **Plan reference** di top of file (`Plan reference: PLAN2 Section X.Y`)?
- [ ] **Bahasa**: Docs Indonesia, code comments English?

### ✅ Pre-Commit Check

- [ ] `pnpm lint` (semua packages)
- [ ] `pnpm check:duplication` (jscpd)
- [ ] `pnpm typecheck` (semua packages)
- [ ] `pnpm test` (semua packages)
- [ ] `pnpm check:all` (semua di atas sekaligus)

---

## Cara Pakai Template

### Untuk Task Spec Baru

Tempelkan section ini di awal task spec (setelah `## Goal`, sebelum `## Scope`):

```markdown
## Pre-Implementation Checklist

> Lihat [`docs/PRE_TASK_CHECKLIST.md`](../../PRE_TASK_CHECKLIST.md) untuk template lengkap.

Sebelum mulai coding, jawab:
- [ ] DRY: Sudah grep logic serupa?
- [ ] SOLID: 1 class = 1 responsibility?
- [ ] Naming: kebab-case + PascalCase?
- [ ] Error: status code akurat?
- [ ] Test: *.spec.ts (unit) vs *.integration.spec.ts (real deps)?
- [ ] Docs: JSDoc + plan reference?
```

### Untuk Self-Review Sebelum Commit

```bash
# 1. Run lint
pnpm lint

# 2. Check duplication
pnpm check:duplication

# 3. Run typecheck
pnpm typecheck

# 4. Run all tests
pnpm test

# 5. Atau semua sekaligus
pnpm check:all
```

---

## Violation Examples (Learning Material)

### Contoh DRY Violation (Batch 4 — sebelum refactor)

❌ **BAD** — JWT signing logic duplikat di 3 tempat:

```typescript
// File A: oauth.service.ts
const accessToken = await this.signer.sign(
  { sub: user.id, username: user.username, roleId },
  { issuer: AUTH_ISSUER, audience: JWT_AUDIENCE, expiresIn: '15m' },
);

// File B: internal.service.ts — IDENTICAL
const accessToken = await this.jwtSigner.sign(
  { sub: user.id, username: user.username, roleId: role.id },
  { issuer: AUTH_ISSUER, audience: JWT_AUDIENCE, expiresIn: '15m' },
);

// File C: dev.controller.ts — IDENTICAL
const accessToken = await this.jwtSigner.sign(
  { sub: user.id, username: user.username, roleId: role.id },
  { issuer: AUTH_ISSUER, audience: JWT_AUDIENCE, expiresIn: '15m' },
);
```

✅ **GOOD** — Extract ke `TokenFactory`:

```typescript
// token-factory.ts
@Injectable()
export class TokenFactory {
  constructor(private readonly jwtSigner: JwtSignerService) {}

  async issuePair(user, roleId, clientId): Promise<TokenPair> {
    // Centralized JWT signing logic
  }
}

// File A, B, C: just call
const pair = await this.tokenFactory.issuePair(user, role.id, 'payment-api');
```

### Contoh Status Code Salah (Batch 4 — sebelum refactor)

❌ **BAD** — `dev.controller.ts` pakai 403 untuk semua error:

```typescript
if (!user) {
  throw new ForbiddenException('User not found'); // ❌ should be 404 (or 403 if hide existence)
}
if (!role) {
  throw new ForbiddenException('Role not assigned'); // ❌ should be 400 (input validation)
}
```

✅ **GOOD** — Status code akurat per `CODING_STANDARDS.md`:

```typescript
if (!user) {
  throw new ForbiddenException('User not found'); // 403 — dev endpoint, hide user existence
}
if (!role) {
  throw new BadRequestException('Role not assigned to this user'); // 400 — input validation error
}
```

---

## Referensi

- [`CODING_STANDARDS.md`](CODING_STANDARDS.md) — aturan coding lengkap
- [`CONTRIBUTING.md`](../CONTRIBUTING.md) — process rules (test/build/commit)
- [`TEST_MAINTENANCE_RULES.md`](TEST_MAINTENANCE_RULES.md) — test sync conflict resolution
