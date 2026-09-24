# CHANGELOG — AUTH CONTRACT

Semua perubahan pada kontrak auth dicatat di sini.
Format: [Keep a Changelog](https://keepachangelog.com/), [SemVer](https://semver.org/).

## [Unreleased]

## [1.0.0] - 2026-09-20

### Added
- OAuth2 endpoints: `/oauth/authorize`, `/oauth/token`, `/oauth/revoke`
- JWKS: `/.well-known/jwks.json`
- `/api/v1/me/permissions`
- `/api/v1/auth/switch-role`
- JWT claims: `sub`, `username`, `roleId`, `iss`, `aud`, `exp`, `iat`, `jti`
- RS256 signing

### Changed
- Migrasi dari HS256 ke RS256
- Prefix `/api` → `/api/v1` untuk endpoint internal
