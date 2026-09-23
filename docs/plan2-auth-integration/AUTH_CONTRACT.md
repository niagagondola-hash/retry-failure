# AUTH CONTRACT

> **Version**: 1.0.0
> **Auth service version**: 0.1.0
> **Effective**: 2026-09-20
> **Last updated**: 2026-09-23

## 1. Base URL

| Environment | URL |
|---|---|
| Dev | `http://localhost:4001` |
| Staging | TBD |
| Production | TBD |

## 2. OAuth2 Endpoints

| Method | Path | Deskripsi |
|---|---|---|
| GET | `/oauth/authorize` | Authorization endpoint |
| POST | `/oauth/token` | Token endpoint |
| POST | `/oauth/revoke` | Revoke |
| GET | `/.well-known/jwks.json` | JWKS |

## 3. Internal Endpoints

| Method | Path | Auth | Deskripsi |
|---|---|---|---|
| GET | `/api/v1/me/permissions` | Bearer | User + role + permission codes |
| POST | `/api/v1/auth/switch-role` | Bearer | Ganti active role |

## 4. JWT Claims

| Klaim | Tipe | Wajib | Contoh |
|---|---|---|---|
| `sub` | string (uuid) | ya | `a0eebc99-...` |
| `username` | string | ya | `budi_santoso` |
| `roleId` | string (uuid) | ya | `d3eebc99-...` |
| `iss` | string | ya | `https://auth.example.com` |
| `aud` | string | ya | `payment-api` |
| `exp` | number | ya | `1730000000` |
| `iat` | number | ya | `1729999100` |
| `jti` | string | ya | `...` |

## 5. Signing

- Algoritma: RS256
- JWKS URL: `/.well-known/jwks.json`
- Rotasi: `kid` berbeda, dual-key period

## 6. Response `/api/v1/me/permissions`

```json
{
  "success": true,
  "data": {
    "user": {
      "id": "uuid",
      "username": "budi_santoso",
      "email": "budi@perusahaan.com",
      "name": "Budi Santoso",
      "isSuperAdmin": false
    },
    "role": { "id": "role-uuid", "name": "HRD" },
    "permissionCodes": ["dashboard", "payment.read", "payment.write"]
  }
}
```

## 7. Error Taxonomy

| HTTP | Format | Arti |
|---|---|---|
| 400 | `{statusCode, message}` | Validasi gagal |
| 401 | `{statusCode, message}` | Token invalid / expired |
| 403 | `{statusCode, message}` | Tidak punya izin |
| 429 | `{statusCode, message, retryAfter}` | Rate limited |

## 8. Versioning

- Kontrak ini pakai SemVer.
- Perubahan breaking → MAJOR.
- Payment-api mendukung N dan N-1.

## 9. Scopes

- `openid`
- `profile`
- `payment.read`
- `payment.write`

## 10. Client Registration

| Field | Value |
|---|---|
| `client_id` | `payment-api` |
| `client_secret` | dari env, rotasi dual-secret |
| `redirect_uri` | `http://localhost:3000/auth/callback` |
| `grant_types` | `authorization_code`, `refresh_token` |
| `scopes` | `openid profile payment.read payment.write` |