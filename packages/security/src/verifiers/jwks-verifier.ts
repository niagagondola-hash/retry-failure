/**
 * JwksVerifier — verify RS256 JWTs via remote JWKS (AUTH-10).
 *
 * Plan reference: PLAN2 Section 5.1 (Signing — RS256, JWKS, kid),
 * Section 2.3 (jose v5 stack), Section 9.3 (AUTH_MODE),
 * Section 16 (env JWT_CLOCK_TOLERANCE_SEC=5, JWKS_CACHE_TTL_SEC=300),
 * Section 21.2 (key rotation), AUTH-10 task spec §2.
 *
 * Implementation notes:
 *  - `jose.v5.createRemoteJWKSet(new URL(jwksUri), opts)` returns a
 *    `RemoteJWKSet` that handles:
 *      * HTTP fetch (default: GET, expects JSON `{ keys: [...] }`)
 *      * In-memory cache with `cooldownDuration` (30s) + `cacheMaxAge` (300s)
 *      * Auto-refetch when `kid` in JWT header is not in cache (kid rotation)
 *      * Honors `Cache-Control: max-age=...` from auth-mock JWKS endpoint
 *  - `jose.v5.jwtVerify(token, key, options)` — verifies RS256 signature,
 *    `iss`, `aud`, `exp`, `nbf` claims, with `clockTolerance` for skew.
 *  - Errors are mapped to plain Error messages so callers don't need jose
 *    types (plan2 AUTH-10 notes — error mapping).
 *
 * Clock tolerance (default 5s) compensates for clock drift between auth
 * server and payment-api server. JWKS cache TTL (default 300s) limits fetch
 * rate; auth-mock sets `Cache-Control: max-age=300` so verifiers cache safely.
 */
import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  createRemoteJWKSet,
  jwtVerify,
  JWTPayload,
  errors as joseErrors,
} from 'jose';

import type { SecurityOptions } from '../security.module';
import { JwtVerifier, VerifiedAuthUser } from './jwt-verifier.interface';

/** Default cache + clock tolerance per plan2 §16. */
const DEFAULT_CLOCK_TOLERANCE_SEC = 5;
const DEFAULT_JWKS_CACHE_TTL_SEC = 300;
const DEFAULT_COOLDOWN_MS = 30_000;

/** Re-export so callers can use the jose error class without importing jose. */
export { joseErrors };

@Injectable()
export class JwksVerifier implements JwtVerifier {
  private readonly logger = new Logger('JwksVerifier');
  private readonly remoteJwks: ReturnType<typeof createRemoteJWKSet>;
  private readonly issuer: string;
  private readonly audience: string;
  private readonly clockToleranceSec: number;

  constructor(
    @Inject('SECURITY_OPTIONS') opts: SecurityOptions,
  ) {
    const issuerBase = (opts.authIssuer ?? '').replace(/\/+$/, '');
    if (!issuerBase) {
      throw new Error(
        'JwksVerifier: SECURITY_OPTIONS.authIssuer is required (e.g. http://localhost:4001)',
      );
    }
    if (!opts.jwtAudience) {
      throw new Error(
        'JwksVerifier: SECURITY_OPTIONS.jwtAudience is required (e.g. payment-api)',
      );
    }
    const jwksUri = `${issuerBase}/.well-known/jwks.json`;
    const cacheTtlMs = (opts.jwksCacheTtlSec ?? DEFAULT_JWKS_CACHE_TTL_SEC) * 1000;
    this.remoteJwks = createRemoteJWKSet(new URL(jwksUri), {
      cooldownDuration: DEFAULT_COOLDOWN_MS,
      cacheMaxAge: cacheTtlMs,
    });
    this.issuer = issuerBase;
    this.audience = opts.jwtAudience;
    this.clockToleranceSec = opts.jwtClockToleranceSec ?? DEFAULT_CLOCK_TOLERANCE_SEC;
    this.logger.log(
      `Initialized JWKS verifier: jwksUri=${jwksUri}, iss=${this.issuer}, ` +
        `aud=${this.audience}, clockTolerance=${this.clockToleranceSec}s, ` +
        `cacheTtl=${cacheTtlMs}ms`,
    );
  }

  /** Verify JWT signature + iss + aud + exp. Returns the decoded payload. */
  async verify(token: string): Promise<JWTPayload> {
    try {
      const { payload } = await jwtVerify(token, this.remoteJwks, {
        algorithms: ['RS256'],
        issuer: this.issuer,
        audience: this.audience,
        clockTolerance: this.clockToleranceSec,
      });
      return payload;
    } catch (err) {
      throw this.mapError(err);
    }
  }

  /**
   * Verify + map to thin AuthUser (plan2 §5.2):
   *   { userId (sub), username, roleId }
   * `isSuperAdmin` + `permissionCodes` are NOT in the JWT — caller (SessionGuard)
   * merges from SessionStore / cached_users.
   */
  async verifyAuthUser(token: string): Promise<VerifiedAuthUser> {
    const payload = await this.verify(token);
    if (!payload.sub) {
      throw new Error('JWT missing required claim: sub');
    }
    if (!payload.username) {
      throw new Error('JWT missing required claim: username');
    }
    if (!payload.roleId) {
      throw new Error('JWT missing required claim: roleId');
    }
    return {
      userId: payload.sub,
      username: payload.username as string,
      roleId: payload.roleId as string,
      jti: payload.jti,
    };
  }

  /**
   * Map jose typed errors to plain Error so callers don't depend on jose.
   * Keeps a stable message format for log/alert filters.
   */
  private mapError(err: unknown): Error {
    if (err instanceof joseErrors.JWSSignatureVerificationFailed) {
      return new Error('JWT signature invalid');
    }
    if (err instanceof joseErrors.JWTExpired) {
      return new Error('JWT expired');
    }
    if (err instanceof joseErrors.JWTClaimValidationFailed) {
      // message includes which claim failed — pass through.
      return new Error(`JWT claim invalid: ${err.message}`);
    }
    if (err instanceof joseErrors.JWTInvalid) {
      return new Error('JWT invalid (malformed)');
    }
    if (err instanceof joseErrors.JWKSNoMatchingKey) {
      return new Error(`JWKS no matching key for kid: ${(err as Error).message}`);
    }
    if (err instanceof joseErrors.JWKSTimeout) {
      return new Error('JWKS fetch timed out');
    }
    if (err instanceof joseErrors.JWKSInvalid) {
      return new Error('JWKS response invalid');
    }
    if (err instanceof Error) {
      return err;
    }
    return new Error(`JWT verification failed: ${String(err)}`);
  }
}
