# Auth Mock (apps/auth-mock)

OAuth2 reference implementation for Plan 2 — Auth Integration.

**Port**: 4001 (dev default)
**Framework**: NestJS 11 + Express + EJS templates
**Purpose**: Full OAuth2 Authorization Server reference (RS256, PKCE, JWKS, discovery)

## Run

```bash
pnpm --filter auth-mock start:dev
# → http://localhost:4001/health
```

## Endpoints (planned)

| Endpoint | Status |
|---|---|
| `GET /health` | ✅ Scaffold |
| `GET /.well-known/jwks.json` | ⏳ AUTH-02 |
| `GET /oauth/authorize` | ⏳ AUTH-03 |
| `POST /oauth/token` | ⏳ AUTH-03 |
| `POST /oauth/revoke` | ⏳ AUTH-03 |
| `GET /.well-known/openid-configuration` | ⏳ AUTH-07 |
| `GET /api/v1/me/permissions` | ⏳ AUTH-05 |
| `POST /api/v1/auth/switch-role` | ⏳ AUTH-05 |
| `POST /dev/token` | ⏳ AUTH-05 |
| Login UI (EJS) | ⏳ AUTH-04 |

## Warning

**Development only — do NOT use in production.**
