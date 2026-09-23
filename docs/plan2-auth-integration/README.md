# Plan 2 — Auth Integration

Integrasi auth service eksternal ke `payment-api` dengan OAuth 2.0 + PKCE
via BFF, JWT tipis, otorisasi berbasis menu, dan lazy sync per-sesi.

## Status

- **Version**: 1.0.0
- **Status**: FINAL
- **Created**: 2026-09-20
- **Last updated**: 2026-09-23
- **Baseline**: `../plan1-cockatiel-retry-failure-scenario/PLAN1_Cockatiel_Retry_Failure_Scenario.md`

## Dokumen

| Dokumen | Versi | Deskripsi |
|---|---|---|
| [PLAN-Auth_Integration.md](./PLAN-Auth_Integration.md) | 1.0.0 | Plan utama |
| [AUTH_CONTRACT.md](./AUTH_CONTRACT.md) | 1.0.0 | Kontrak auth |
| [auth-openapi.json](./auth-openapi.json) | — | Artefak OpenAPI |
| [CHANGELOG-AUTH.md](./CHANGELOG-AUTH.md) | — | Riwayat versi kontrak |

## Dokumen Terkait (shared)

| Dokumen | Deskripsi |
|---|---|
| [../SANDBOX_NOTES.md](../SANDBOX_NOTES.md) | Catatan environment |
| [../plan1-cockatiel-retry-failure-scenario/PLAN1_Cockatiel_Retry_Failure_Scenario.md](../plan1-cockatiel-retry-failure-scenario/PLAN1_Cockatiel_Retry_Failure_Scenario.md) | Plan 1 (baseline) |

## Ringkasan Cepat

| Aspek | Keputusan |
|---|---|
| Alur login | OAuth 2.0 Authorization Code + PKCE (S256) |
| Client | Backend payment (confidential) |
| Pola | BFF |
| Token di browser | Tidak ada — hanya cookie `HttpOnly` |
| Signing JWT | RS256 + JWKS |
| Payload JWT | `sub`, `username`, `roleId`, `iss`, `aud`, `exp`, `iat`, `jti` |
| Otorisasi | Berbasis menu code, dari cache lokal |
| Cache | 2 tabel: `cached_users` + `sessions` |
| Sinkronisasi | Initial + Lazy (SWR) + Webhook (opsional) |
| Versioning | 4 level: plan, contract, API, auth service |

## Cara Pakai

1. Baca **PLAN-Auth_Integration.md** untuk arsitektur lengkap.
2. Baca **AUTH_CONTRACT.md** sebelum implementasi `packages/security`.
3. Lihat **auth-openapi.json** untuk detail endpoint auth.
4. Cek **CHANGELOG-AUTH.md** saat auth rilis versi baru.
5. Cek **../SANDBOX_NOTES.md** saat setup environment.
```