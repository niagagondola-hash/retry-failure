# Contract Tests — AUTH_CONTRACT.md v1.0.0

> Plan reference: PLAN2 Section 17.5, Section 25.7, Section 25.8.
> Task: AUTH-27.

Verifies the running auth service (auth-mock by default, or auth asli staging/production) complies with [`docs/plan2-auth-integration/AUTH_CONTRACT.md`](../../../docs/plan2-auth-integration/AUTH_CONTRACT.md) v1.0.0.

## Struktur file

| File | Tujuan |
|---|---|
| `contract-fixtures.ts` | Expected contract values (JWT claims, endpoints, error format). Source of truth: AUTH_CONTRACT.md. |
| `contract-runner.ts` | Generic HTTP runner (axios) yang accept `baseUrl` + credentials + test user. |
| `auth-contract.spec.ts` | Main test suite — 5 describe blocks, ~32 test cases. |
| `jest.contract.config.js` | Separate Jest config (testMatch: `**/*.contract.spec.ts`). |

## Prasyarat

Auth service **harus running** sebelum tests start:

```bash
# auth-mock (default)
cd /home/z/my-project/retry-failure && pnpm --filter auth-mock start:dev &
# Tunggu hingga nest boot selesai (lihat "Nest application successfully started")

# Verify respond
curl http://localhost:4001/.well-known/jwks.json | jq .keys[0].kid
```

## Cara run

### Default — against auth-mock (port 4001)

```bash
cd /home/z/my-project/retry-failure && pnpm --filter payment-api test:contract
```

### With verbose output

```bash
cd /home/z/my-project/retry-failure && pnpm --filter payment-api test:contract -- --verbose
```

### Run a specific describe block

```bash
# Hanya JWT Claims contract
cd /home/z/my-project/retry-failure && pnpm --filter payment-api test:contract -- --testNamePattern="JWT Claims"
```

### Against auth asli (staging/production)

Auth asli **tidak punya `/dev/token` shortcut** — harus pakai full OAuth2 flow atau inject pre-acquired token.

#### Opsi 1: Pre-acquired token (recommended untuk CI)

```bash
# 1. Acquire access token via OAuth2 flow (manual atau via script)
ACCESS_TOKEN="eyJ..."  # access token dari /oauth/token

# 2. Run contract tests with pre-acquired token
cd /home/z/my-project/retry-failure && \
  AUTH_BASE_URL=https://staging.auth.example.com \
  AUTH_CONTRACT_PRE_ACQUIRED_TOKEN="$ACCESS_TOKEN" \
  pnpm --filter payment-api test:contract
```

#### Opsi 2: Test user credentials (jika auth asli punya test user)

```bash
cd /home/z/my-project/retry-failure && \
  AUTH_BASE_URL=https://staging.auth.example.com \
  OAUTH_CLIENT_ID=payment-api \
  OAUTH_CLIENT_SECRET=real-secret-from-vault \
  OAUTH_REDIRECT_URI=https://staging.payment.example.com/auth/callback \
  AUTH_TEST_USERNAME=testuser \
  AUTH_TEST_PASSWORD=testpass \
  pnpm --filter payment-api test:contract
```

> ⚠️ Opsi 2 hanya bekerja kalau auth asli mengimplementasikan `/dev/token` (tidak recommended untuk production). Default recommendation: Opsi 1.

## Env vars reference

| Env var | Default | Tujuan |
|---|---|---|
| `AUTH_BASE_URL` | `http://localhost:4001` | Base URL auth service. |
| `OAUTH_CLIENT_ID` | `payment-api` | OAuth client_id. |
| `OAUTH_CLIENT_SECRET` | `""` (kosong) | OAuth client_secret (auth-mock tidak validate). |
| `OAUTH_REDIRECT_URI` | `http://localhost:3000/auth/callback` | OAuth redirect_uri. |
| `AUTH_TEST_USERNAME` | `budi_santoso` | Test user username. |
| `AUTH_TEST_PASSWORD` | `ChangeMe_123!` | Test user password. |
| `AUTH_CONTRACT_PRE_ACQUIRED_TOKEN` | (unset) | Skip `/dev/token` — inject pre-acquired access token. |
| `JWT_AUDIENCE` | `payment-api` | Expected `aud` claim value. |

## Test coverage

| # | Describe block | AUTH_CONTRACT section | Test count |
|---|---|---|---|
| 1 | JWT Claims contract | §4 | 11 |
| 2 | JWKS endpoint contract | §5 | 5 |
| 3 | `/api/v1/me/permissions` response format | §6 | 6 |
| 4 | Error format contract | §7 | 4 (+1 skipped) |
| 5 | Endpoint paths contract | §2 + §3 | 6 |
| **Total** | | | **~32** |

## Known contract drift

Berikut adalah area di mana auth-mock behavior mungkin tidak match contract exactly. Tests di-design untuk tolerant terhadap ini (accept multiple status codes / shapes) sambil tetap detect major drift:

1. **`/oauth/token` 400 error format**: RFC 6749 §5.2 pakai `{error, error_description}` — AUTH_CONTRACT.md §7 specifies `{statusCode, message}`. Test 4 (Error format) accepts both formats.
2. **403 Forbidden**: Tidak ada endpoint di auth-mock yang return 403 (internal endpoints don't have role-based guards). Test accept 400 OR 403 sebagai valid rejection.
3. **429 Too Many Requests**: Test di-skip (`it.skip`) karena throttler state shared across runs — flaky. Lihat JSDoc di test untuk implementasi isolated mode.
4. **Extra `error` field in NestJS responses**: NestJS default exception filter returns `{statusCode, message, error}` — contract only requires `{statusCode, message}`. Tests verify required fields only.

## Maintenance: update fixtures when contract changes

Ketika `AUTH_CONTRACT.md` di-update:

1. Bump `EXPECTED_CONTRACT_VERSION` di `contract-fixtures.ts`.
2. Update `EXPECTED_JWT_CLAIMS`, `EXPECTED_OAUTH_ENDPOINTS`, `EXPECTED_INTERNAL_ENDPOINTS`, atau `EXPECTED_ERROR_FORMAT` sesuai perubahan.
3. Update test assertions di `auth-contract.spec.ts` bila ada new/changed claim/field.
4. Re-run `pnpm --filter payment-api test:contract` — failures indicate contract drift in auth-mock atau auth asli.

> Contract uses SemVer (AUTH_CONTRACT.md §8). MAJOR bump = breaking change — payment-api must support N and N-1 per plan2 §18.2.

## Useful commands

```bash
# Typecheck + lint (tidak butuh auth service running)
cd /home/z/my-project/retry-failure && pnpm --filter payment-api typecheck
cd /home/z/my-project/retry-failure && pnpm --filter payment-api lint

# Run contract tests (butuh auth service running)
cd /home/z/my-project/retry-failure && pnpm --filter payment-api test:contract

# Generate coverage report (opsional — parse Jest JSON output)
cd /home/z/my-project/retry-failure && pnpm --filter payment-api test:contract -- --json --outputFile=test-results.json
# TODO: write parser script that generates docs/plan2-auth-integration/contract-coverage.md from test-results.json
```

## See also

- [`docs/plan2-auth-integration/AUTH_CONTRACT.md`](../../../docs/plan2-auth-integration/AUTH_CONTRACT.md) — the contract being tested.
- [`docs/plan2-auth-integration/tasks/AUTH-27-contract-tests.md`](../../../docs/plan2-auth-integration/tasks/AUTH-27-contract-tests.md) — task spec.
- [`docs/CODING_STANDARDS.md`](../../../docs/CODING_STANDARDS.md) — test naming + conventions.
