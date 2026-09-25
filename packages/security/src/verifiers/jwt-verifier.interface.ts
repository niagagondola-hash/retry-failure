/**
 * JwtVerifier — interface for JWT verifiers (AUTH-10).
 *
 * Plan reference: PLAN2 Section 9.3 (AUTH_MODE), AUTH-10 task spec §1.
 *
 * Implementations:
 *   - `JwksVerifier`   — fetches JWKS from `authIssuer/.well-known/jwks.json`,
 *                        verifies RS256 + issuer + audience + clock tolerance.
 *   - `MockVerifier`   — subclass; same logic, used when AUTH_MODE=mock
 *                        (auth-mock URL is http://localhost:4001 by default).
 *
 * `verifyAuthUser` returns the *thin* JWT claims (sub, username, roleId) per
 * plan2 §5.2 — `isSuperAdmin` + `permissionCodes` are NOT in the JWT and must
 * be merged by the caller (SessionGuard in AUTH-13) from SessionStore / cache.
 */
import type { JWTPayload } from 'jose';

export interface VerifiedAuthUser {
  /** `sub` claim — user UUID. */
  userId: string;
  /** Custom `username` claim. */
  username: string;
  /** Custom `roleId` claim — active role. */
  roleId: string;
  /** Original `jti` for session tracking / revoke. */
  jti?: string;
}

export interface JwtVerifier {
  /** Verify JWT signature + claims. Returns the decoded payload. */
  verify(token: string): Promise<JWTPayload>;

  /** Verify + map payload → thin AuthUser (plan2 §5.2). */
  verifyAuthUser(token: string): Promise<VerifiedAuthUser>;
}

/** DI token used by SecurityModule to provide the active verifier. */
export const JWT_VERIFIER = Symbol('JWT_VERIFIER');
