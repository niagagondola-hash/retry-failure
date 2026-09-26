/**
 * JwtAuthGuard — NOT USED in Plan 2 BFF architecture (AUTH-13 stub).
 *
 * Plan reference: PLAN2 Section 6 (BFF architecture), AUTH-13 task spec §5.
 *
 * Plan 2 uses `SessionGuard` (cookie `sid` → session store) instead of direct
 * JWT verification per request. JWT is verified only at OAuth callback (via
 * JwksVerifier from AUTH-10) — after that, session is the source of truth.
 *
 * This stub is kept for future use cases (e.g., machine-to-machine API tokens
 * where there's no session cookie, only a Bearer token in Authorization header).
 *
 * Out of scope for Plan 2.
 */
import { Injectable } from '@nestjs/common';

@Injectable()
export class JwtAuthGuard {
  // Implementation: out of scope for Plan 2.
  // Future: verify Bearer token via JwtVerifier (AUTH-10), set req.user.
}
