# Coding Standards — Plan 2 Auth Integration

> **Dokumen ini berisi aturan coding yang WAJIB diikuti** untuk semua kontribusi di proyek `retry-failure/`.
> Dibuat setelah self-review Batch 4 yang menemukan 3 DRY violations, 3 DIP violations, dan beberapa status code salah yang tetap lolos karena `pnpm test` semua pass.
>
> **Bahasa**: Indonesia untuk docs, English untuk code (komentar, nama variabel, log).
>
> **Pelengkap**:
> - [`CONTRIBUTING.md`](../CONTRIBUTING.md) — process rules (test/build/commit)
> - [`TEST_MAINTENANCE_RULES.md`](TEST_MAINTENANCE_RULES.md) — test sync conflict resolution

---

## 📋 TL;DR — 7 Aturan Inti

1. **SOLID**: 1 class = 1 responsibility. Depends on interface, bukan concrete class.
2. **DRY**: Sebelum tulis function, `grep` logic serupa. >10 lines duplikat = extract.
3. **Naming**: Self-documenting. No abbreviations (kecuali domain terms).
4. **Error Handling**: HTTP status code harus akurat (404 ≠ 403 ≠ 400).
5. **Tests**: `*.spec.ts` = unit (mocked deps), `*.integration.spec.ts` = real deps, `*.e2e-spec.ts` = HTTP server.
6. **Comments**: JSDoc + plan reference untuk semua public methods. Indonesia untuk docs, English untuk inline comments.
7. **Pre-Task Checklist**: Baca checklist di akhir dokumen ini SEBELUM mulai coding task baru.

---

## 🏗 SOLID Principles

### S — Single Responsibility (SRP)

> **1 class/module = 1 alasan untuk berubah.**

#### Aturan

- Controller: orchestrate HTTP only (parse input, call service, format response). Tidak ada business logic.
- Service: business logic only. Tidak ada HTTP concerns (`req`/`res`/`@Body`).
- Repository: data access only. Tidak ada business rules.
- DTO: data shape only. Tidak ada behavior.
- Guard: auth check only. Tidak ada business logic.

#### Indikator Violation

- File >300 lines (warn) atau >500 lines (error) → kemungkinan violate SRP
- Function >50 lines → kemungkinan terlalu banyak responsibility
- Class dengan >5 public methods → kemungkinan terlalu banyak responsibility
- Import >10 dependencies → kemungkinan terlalu banyak responsibility

#### Contoh Violation (dari Batch 4)

❌ **BAD** — `oauth.controller.ts` melakukan 5 hal sekaligus:

```typescript
@Get('authorize')
async authorize(...) {
  // 1. Validate client_id
  // 2. Validate redirect_uri
  // 3. Validate PKCE
  // 4. Check session + user lookup
  // 5. Branch: single-role redirect vs multi-role render
  // 6. Render login page
}
```

✅ **GOOD** — Controller hanya orchestrate:

```typescript
@Get('authorize')
async authorize(...) {
  const ctx = this.validator.validateAuthorizeRequest(query);  // step 1-3
  const user = await this.sessionHandler.getUserFromSession(req); // step 4
  return this.flowHandler.handleAuthorizeFlow(res, ctx, user, query); // step 5-6
}
```

---

### O — Open/Closed (OCP)

> **Open for extension, closed for modification.**

#### Aturan

- Tambah fitur baru = tambah file baru, bukan modify existing
- Gunakan decorator/strategy pattern untuk extension points
- Gunakan `@Inject('TOKEN')` untuk swap implementation tanpa modify consumer

#### Contoh Good (dari Batch 3)

✅ `SecurityModule.forRoot()` factory pattern — swap `MockVerifier` ↔ `JwksVerifier` berdasarkan `authMode` tanpa modify consumer:

```typescript
{
  provide: JWT_VERIFIER,
  useFactory: (): JwtVerifier => {
    if (options.authMode === 'mock') return new MockVerifier(options);
    return new JwksVerifier(options);
  },
}
```

#### Contoh Bad

❌ `if/else` chain yang panjang untuk handle berbagai mode → kalau tambah mode baru, harus modify function.

---

### L — Liskov Substitution (LSP)

> **Subclass harus bisa menggantikan parent tanpa break behavior.**

#### Aturan

- Subclass tidak boleh weaken parent contract (misal: throw error yang parent tidak throw)
- Subclass tidak boleh strengthen preconditions (misal: require input yang parent tidak require)
- Empty subclass (marker class) = OK (untuk DI swap clarity)
- Subclass yang override method dengan `throw new Error('not supported')` = violate LSP

#### Contoh Good (dari Batch 3)

✅ `MockVerifier extends JwksVerifier {}` — empty body, hanya marker untuk DI swap. LSP OK.

---

### I — Interface Segregation (ISP)

> **Client tidak boleh dipaksa depend pada interface yang tidak dipakai.**

#### Aturan

- 1 interface = 1 client role
- Interface >5 methods = kemungkinan terlalu gemuk, split
- Jangan combine "read" + "write" methods di 1 interface jika client hanya butuh read

#### Contoh Good (dari Batch 3)

✅ `JwtVerifier` interface — 2 methods saja (`verify`, `verifyAuthUser`):

```typescript
export interface JwtVerifier {
  verify(token: string): Promise<JWTPayload>;
  verifyAuthUser(token: string): Promise<VerifiedAuthUser>;
}
```

#### Contoh Bad (sebaiknya dihindari)

❌ Interface `UserService` yang punya `validateCredentials`, `findById`, `findByUsername`, `findRole`, `createUser`, `updateUser`, `deleteUser` — client yang hanya butuh lookup tidak boleh dipaksa depend pada CRUD methods.

---

### D — Dependency Inversion (DIP)

> **Depend on abstraction (interface), bukan concrete class.**

#### Aturan

- High-level module tidak boleh depend pada low-level module. Keduanya depend pada abstraction.
- Abstraction tidak boleh depend pada detail. Detail depend pada abstraction.
- Gunakan `@Inject('TOKEN')` dengan interface, bukan inject concrete class langsung.

#### Exception untuk Mock Project

- **Dev mock boleh concrete** (catat di TODO) — karena mock context, over-engineering DIP penuh tidak worth it
- Tapi untuk service yang punya >1 implementation (misal: `JwtVerifier` punya `JwksVerifier` + `MockVerifier`), WAJIB interface

#### Contoh Violation (dari Batch 4)

❌ `InternalService` depend pada concrete `UserService` + `JwtSignerService`:

```typescript
constructor(
  private readonly users: UserService,         // ❌ concrete class
  private readonly jwtSigner: JwtSignerService, // ❌ concrete class
) {}
```

✅ Seharusnya depend pada interface:

```typescript
constructor(
  @Inject('IUserRepository') private readonly users: IUserRepository,
  @Inject('IJwtSigner') private readonly jwtSigner: IJwtSigner,
) {}
```

---

## 🔁 DRY (Don't Repeat Yourself)

> **Sebelum tulis function baru, cek apakah logic serupa sudah ada.**

#### Aturan

- Sebelum tulis function: `grep -rn "similar logic" src/`
- >10 lines code identical di 2+ tempat = extract ke helper/service/factory
- >3 lines code similar (beda nama variabel saja) = pertimbangkan extract
- Gunakan `jscpd` untuk auto-detect duplication: `pnpm check:duplication`

#### Contoh Violation (dari Batch 4)

❌ **BAD** — JWT signing logic duplikat di 3 tempat (`oauth.service.ts`, `internal.service.ts`, `dev.controller.ts`):

```typescript
// Di 3 file berbeda — IDENTICAL logic:
const issuer = process.env.AUTH_ISSUER ?? 'http://localhost:4001';
const audience = process.env.JWT_AUDIENCE ?? 'payment-api';
const accessToken = await this.jwtSigner.sign(
  { sub: user.id, username: user.username, roleId: role.id },
  { issuer, audience, expiresIn: '15m' },
);
```

✅ **GOOD** — Extract ke `TokenFactory`:

```typescript
// token-factory.ts
@Injectable()
export class TokenFactory {
  constructor(private readonly jwtSigner: JwtSignerService) {}

  async issuePair(user: MockUser, role: MockRole): Promise<TokenPair> {
    const issuer = process.env.AUTH_ISSUER ?? 'http://localhost:4001';
    const audience = process.env.JWT_AUDIENCE ?? 'payment-api';
    const accessToken = await this.jwtSigner.sign(
      { sub: user.id, username: user.username, roleId: role.id },
      { issuer, audience, expiresIn: '15m' },
    );
    const refreshToken = await this.jwtSigner.sign(
      {
        sub: user.id,
        username: user.username,
        roleId: role.id,
        type: 'refresh',
        client_id: 'payment-api',
      },
      { issuer, audience, expiresIn: '8h' },
    );
    return { accessToken, refreshToken };
  }
}
```

---

## 📝 Naming Conventions

### File Naming

| Tipe | Pattern | Contoh |
|---|---|---|
| Service | `kebab-case.service.ts` | `user.service.ts`, `oauth.service.ts` |
| Controller | `kebab-case.controller.ts` | `internal.controller.ts` |
| Module | `kebab-case.module.ts` | `discovery.module.ts` |
| Guard | `kebab-case.guard.ts` | `bearer-auth.guard.ts` |
| DTO | `kebab-case.dto.ts` | `switch-role.dto.ts` |
| Interface | `kebab-case.interface.ts` ATAU inline di service | `jwt-verifier.interface.ts` |
| Entity | `kebab-case.entity.ts` | `payment.entity.ts` |
| Test unit | `kebab-case.spec.ts` | `user.service.spec.ts` |
| Test integration | `kebab-case.integration.spec.ts` | `internal.controller.integration.spec.ts` |
| Test e2e | `kebab-case.e2e-spec.ts` | `login-flow.e2e-spec.ts` |

### Code Naming

| Tipe | Pattern | Contoh |
|---|---|---|
| Class | `PascalCase` + suffix | `UserService`, `OAuthController`, `BearerAuthGuard` |
| Interface | `PascalCase` (no `I` prefix) | `JwtVerifier`, `MockUser` (bukan `IJwtVerifier`) |
| Method | `camelCase` + verb prefix | `findById`, `validateCredentials`, `issueCodeAndRedirect` |
| Variable | `camelCase` | `accessToken`, `redirectUri` |
| Constant | `UPPER_SNAKE_CASE` | `DEFAULT_CLOCK_TOLERANCE_SEC`, `AUTH_SID_COOKIE` |
| Enum | `PascalCase` + PascalCase members | `PaymentStatus.Succeeded` |
| Type alias | `PascalCase` | `TokenPair`, `SignOptions` |

### Verb Prefixes untuk Methods

| Prefix | Kapan pakai | Contoh |
|---|---|---|
| `get` | Return data tanpa side effect | `getPermissions()`, `getDiscovery()` |
| `find` | Return data atau null/undefined | `findById()`, `findByUsername()` |
| `validate` | Cek validity, throw kalau invalid | `validateCredentials()`, `validateClient()` |
| `verify` | Verify signature/token | `verify()`, `verifyAuthUser()` |
| `issue` | Create + return new token/code | `issueCodeAndRedirect()`, `issuePair()` |
| `create` | Create new resource (persist) | `createUser()` |
| `update` | Modify existing resource | `updateUser()` |
| `delete` / `remove` | Delete resource | `deleteSession()` |
| `render` | Return HTML/view | `render('login', {...})` |
| `build` | Construct object (no persist) | `buildDiscovery()` |
| `handle` | Orchestrate flow | `handleAuthorizeFlow()` |

### Aturan Tambahan

- **No abbreviations** — kecuali domain terms yang sudah umum (misal: `JWT`, `PKCE`, `JWKS`, `API`)
- **No single-letter variable names** — kecuali loop index (`i`, `j`) atau math formulas
- **Boolean variables**: prefix `is`/`has`/`can` (`isSuperAdmin`, `hasPermission`, `canRetry`)

---

## ⚠️ Error Handling — HTTP Status Codes

> **Status code harus akurat. Jangan pakai 403 untuk "not found".**

### Mapping Status Codes

| Scenario | Status | Exception | Contoh |
|---|---|---|---|
| Input validation error (missing field, invalid format) | **400** | `BadRequestException` | `roleId` kosong di body |
| Missing/invalid auth token | **401** | `UnauthorizedException` | No `Authorization: Bearer` header |
| Authed tapi no permission untuk resource | **403** | `ForbiddenException` | User Akses resource B |
| Resource not found | **404** | `NotFoundException` | `userId` tidak ada di DB |
| Duplicate resource conflict | **409** | `ConflictException` | `orderId` sudah ada |
| Server error (unexpected) | **500** | (auto by NestJS) | DB connection failed |

### Contoh Violation (dari Batch 4)

❌ **BAD** — `dev.controller.ts` pakai 403 untuk semua error:

```typescript
if (!user) {
  throw new ForbiddenException('User not found'); // ❌ should be 404
}
if (!role) {
  throw new ForbiddenException('Role not assigned'); // ❌ should be 400
}
```

✅ **GOOD**:

```typescript
if (!user) {
  throw new NotFoundException('User not found'); // 404
}
if (!role) {
  throw new BadRequestException('Role not assigned to this user'); // 400
}
```

### OAuth2 Specific (RFC 6749 §5.2)

| Error | Status | HTTP Code | Description |
|---|---|---|---|
| `invalid_grant` | 400 | `BadRequestException` | Code invalid/expired/reused, refresh reuse |
| `invalid_client` | 401 | `UnauthorizedException` | Client credentials invalid |
| `invalid_request` | 400 | `BadRequestException` | Missing required parameter |
| `invalid_scope` | 400 | `BadRequestException` | Requested scope invalid |
| `unsupported_grant_type` | 400 | `BadRequestException` | Grant type not supported |
| `unauthorized_client` | 400 | `BadRequestException` | Client not authorized for grant type |

---

## 🧪 Test Conventions

### Test File Naming

| Tipe | Naming | Kapan pakai | Dependencies |
|---|---|---|---|
| **Unit test** | `*.spec.ts` | Test 1 class/function isolated | Mock semua dependencies |
| **Integration test** | `*.integration.spec.ts` | Test dengan real dependencies | Real services, NestJS app (no HTTP server) |
| **E2E test** | `*.e2e-spec.ts` | Test full HTTP flow | Real HTTP server via supertest |

### Contoh yang Benar

```typescript
// user.service.spec.ts (UNIT test — mock dependencies)
const mod = await Test.createTestingModule({
  providers: [UserService], // no AppModule, isolated
}).compile();

// internal.controller.integration.spec.ts (INTEGRATION — real deps)
const mod = await Test.createTestingModule({
  imports: [AppModule], // full app, real dependencies
}).compile();
const app = mod.createNestApplication();
await app.init();
// Use supertest to call HTTP endpoints

// login-flow.e2e-spec.ts (E2E — HTTP server)
const app = await buildApp(); // creates real HTTP server
await request(app.getHttpServer()).get('/oauth/authorize');
```

### Aturan Test

- 1 `describe` block per public method
- 1 `it` per scenario (happy path + edge cases + error cases)
- Test name: `'<behavior>'` (bukan `'test X'`)
- Arrange-Act-Assert pattern
- Setup di `beforeEach`, cleanup di `afterEach`
- Mock external dependencies di unit test (DB, HTTP, time)
- Gunakan `expect().toBe()` untuk primitives, `expect().toEqual()` untuk objects

### Contoh Test Name yang Baik

✅ `'validates budi_santoso + ChangeMe_123!'`
✅ `'rejects wrong password with null'`
✅ `'returns 401 without Authorization header'`
✅ `'switches budi HRD → Finance + returns new tokens'`

❌ `'test1'`, `'test login'`, `'should work'`

---

## 📝 Comments & Documentation

### Bahasa

- **Docs** (`.md` files, README, plan): Indonesia
- **Code comments** (JSDoc, inline): English
- **Log messages**: English
- **Error messages** (user-facing): English (untuk API consistency)

### JSDoc untuk Public Methods

```typescript
/**
 * Validate username + plaintext password. Returns the user or null.
 * Caller (OAuthController) decides what to do on null (401 re-render).
 *
 * DEV ONLY: plain text comparison. Production: bcrypt.compare(password, user.passwordHash).
 *
 * @param username - Fixture username (e.g. "superadmin", "budi_santoso")
 * @param password - Plaintext password
 * @returns MockUser if valid, null otherwise
 */
async validateCredentials(
  username: string,
  password: string,
): Promise<MockUser | null> {
```

### Aturan Komentar

- **JSDoc di public methods** — wajib (signature, params, returns, side effects)
- **Inline comments** — untuk "why", bukan "what" (code harus self-explanatory untuk "what")
- **TODO comments** — format: `// TODO: <description> — see <issue/ticket>`
- **Plan reference** — tambahkan `Plan reference: PLAN2 Section X.Y` di top of file

---

## 🔧 Tooling

### ESLint Rules (Categories 1 + 2)

Lihat konfigurasi di `apps/auth-mock/eslint.config.mjs` dan `packages/security/eslint.config.mjs`.

#### Kategori 1 (Wajib)

- `eslint-plugin-unused-imports` — auto-remove unused imports
- `eslint-plugin-import` — import order consistency
- `no-console` — use Logger instead
- `no-debugger` — no debugger statements
- `no-warning-comments` — catch loose TODOs

#### Kategori 2 (Recommended)

- `max-lines` — max 300 lines per file (warn)
- `max-lines-per-function` — max 50 lines per function (warn)
- `max-params` — max 4 params per function (warn)
- `complexity` — max cyclomatic complexity 10 (warn)
- `no-duplicate-imports` — no duplicate imports

### Duplication Detector

```bash
# Run jscpd to detect code duplication
pnpm check:duplication

# Output: list of duplications with file paths + line numbers
# Threshold: 3+ duplications of 10+ lines = warning
```

### Commands

```bash
# Lint all packages
pnpm lint

# Check duplication
pnpm check:duplication

# Typecheck all packages
pnpm typecheck

# Run all tests
pnpm test

# Run all checks (lint + duplication + typecheck + test)
pnpm check:all
```

---

## ✅ Pre-Task Checklist

> **Sebelum mulai coding task baru, WAJIB jawab checklist ini.**
> Tempelkan ke awal task spec di `docs/plan2-auth-integration/tasks/AUTH-XX-*.md`.

```markdown
## Pre-Implementation Checklist

Sebelum mulai coding task ini, jawab:

- [ ] **Cek duplikasi**: Sudah `grep` logic serupa di `src/`? Kalau ada, extract dulu.
- [ ] **Interface vs concrete**: Apakah saya akan depend pada concrete class? Kalau ya, apakah acceptable untuk mock context? Catat di TODO kalau tidak.
- [ ] **File size**: Apakah file yang akan saya buat >300 lines? Kalau ya, split.
- [ ] **Function size**: Apakah function yang akan saya buat >50 lines? Kalau ya, extract helper.
- [ ] **DRY**: Apakah saya akan duplicate >10 lines dari file lain? Kalau ya, extract ke shared service/factory.
- [ ] **Error handling**: HTTP status code sudah akurat? (404 untuk not found, 400 untuk bad request, 403 untuk no permission)
- [ ] **Test naming**: Apakah test saya `*.spec.ts` (unit) atau `*.integration.spec.ts` (real deps) atau `*.e2e-spec.ts` (HTTP)?
- [ ] **Comments**: Public methods punya JSDoc? Plan reference di top of file?
- [ ] **Bahasa**: Docs Indonesia, code comments English?
```

---

## 📚 Referensi

- [SOLID Principles](https://en.wikipedia.org/wiki/SOLID)
- [DRY Principle](https://en.wikipedia.org/wiki/Don%27t_repeat_yourself)
- [RFC 6749 §5.2 — OAuth2 Error Responses](https://datatracker.ietf.org/doc/html/rfc6749#section-5.2)
- [RFC 8414 — OAuth 2.0 Authorization Server Metadata](https://datatracker.ietf.org/doc/html/rfc8414)
- [NestJS Documentation](https://docs.nestjs.com)
- [`CONTRIBUTING.md`](../CONTRIBUTING.md) — process rules
- [`TEST_MAINTENANCE_RULES.md`](TEST_MAINTENANCE_RULES.md) — test sync rules

---

## 📝 Changelog

- **2026-09-25**: Initial version. Dibuat setelah self-review Batch 4 yang menemukan 3 DRY violations (JWT signing logic duplikat di 3 tempat), 3 DIP violations (concrete dependencies), dan beberapa status code salah. Latar belakang: `pnpm test` semua pass, tapi code quality tidak terverifikasi.
