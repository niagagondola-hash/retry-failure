# Plan 2 — Auth Integration (OAuth 2.0 + PKCE + BFF + Lazy Sync)

> **Version**: 1.2.0
> **Status**: FINAL
> **Last updated**: 2026-09-24

Integrasi `payment-api` dengan auth service eksternal menggunakan OAuth 2.0 + PKCE via BFF pattern, JWT tipis + `roleId`, lazy sync (SWR), dan cache 2 tabel.

## Source of Truth

| File | Description |
|---|---|
| [PLAN2-Auth_Integration.md](./PLAN2-Auth_Integration.md) | Plan lengkap (25 sections) — arsitektur, alur OAuth2, token strategy, cache model, lazy sync, testing, versioning, roadmap OAuth2 server |

## Contract & Changelog

| File | Description |
|---|---|
| [AUTH_CONTRACT.md](./AUTH_CONTRACT.md) | Auth contract v1.0.0 — OAuth2 endpoints, JWT claims, RS256 signing, error taxonomy, scopes |
| [CHANGELOG-AUTH.md](./CHANGELOG-AUTH.md) | Changelog kontrak auth (SemVer) |

## Tasks

> Folder `tasks/` akan dibuat saat implementasi plan2 dimulai.

## Key Architecture

```
FE Vue  --cookie-->  BE payment (BFF)  --OAuth2-->  auth-mock / auth-service
                          |
                          +--> cached_users
                          +--> sessions (permission_codes jsonb)
                          +--> lazy sync (SWR)
                          +--> JWKS verify (RS256)
```

- **BFF pattern**: Token tidak menyentuh browser
- **PKCE S256**: Standar RFC 9700
- **JWT tipis**: `sub` + `username` + `roleId` saja, permission di cache lokal
- **Lazy sync (SWR)**: Fresh 5min → background sync → blocking sync 30min → grace 2h
- **Versioning 4 level**: Plan, contract, API, auth service — independen

## Cross-Plan Reference

| File | Description |
|---|---|
| [../README.md](../README.md) | Global docs index (semua plan) |
| [../SANDBOX_NOTES.md](../SANDBOX_NOTES.md) | Environment notes |
| [../plan1-cockatiel-retry-failure/README.md](../plan1-cockatiel-retry-failure/README.md) | Plan 1 — Cockatiel Retry/Failure |
