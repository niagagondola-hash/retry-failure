# auth-mock dev keys

This folder holds the **dev-only** RSA 2048 keypair for `auth-mock` (Plan 2 — Auth Integration).

## Behavior

- Files `dev-private.pem` + `dev-public.pem` are **auto-generated** on first start of `auth-mock` (via `KeyPairService.onModuleInit`).
- Files are **gitignored** (see `.gitignore`) — they are local-only dev secrets.
- File modes:
  - `dev-private.pem` → `0o600` (owner read/write only).
  - `dev-public.pem` → `0o644` (world-readable, public key).
- The `kid` (key ID) is the **RFC 7638 SHA-256 thumbprint** of the public JWK, computed via `jose.calculateJwkThumbprint(jwk)`.
- Public key is exposed via JWKS endpoint `GET /.well-known/jwks.json` (see `JwksController`).

## Regenerating keys

```bash
# From repo root
rm -f apps/auth-mock/keys/dev-*.pem
pnpm --filter auth-mock start:dev   # regenerates on boot
```

## Production warning

**DO NOT** use these keys in production. `auth-mock` is a reference implementation for development and E2E tests only. Production auth service manages its own keypair (see plan2 section 25.3.A for HS256 → RS256 migration path).
