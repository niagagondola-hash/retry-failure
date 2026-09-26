/**
 * MockVerifier — JWKS verifier variant for AUTH_MODE=mock (AUTH-10).
 *
 * Plan reference: PLAN2 Section 9.3 (AUTH_MODE=mock uses auth-mock),
 * AUTH-10 task spec §3.
 *
 * Same logic as `JwksVerifier` — auth-mock also serves
 * `/.well-known/jwks.json` (per AUTH-02). The only difference is the
 * configuration: when `SecurityOptions.authMode='mock'`, the payment-api
 * app typically sets `authIssuer='http://localhost:4001'` (auth-mock's URL).
 *
 * This subclass exists so DI swap is explicit and so logs distinguish
 * `MockVerifier` from production `JwksVerifier` (useful for debugging
 * "why is this token verifying against localhost?" surprises).
 */
import { Injectable } from '@nestjs/common';

import { JwksVerifier } from './jwks-verifier';

@Injectable()
export class MockVerifier extends JwksVerifier {
  // Configuration (authIssuer, jwtAudience, clockTolerance, cache TTL) comes
  // from SECURITY_OPTIONS via the parent constructor. No logic override
  // needed — auth-mock is a real OAuth2 server with real RS256 + JWKS.
  //
  // Subclassing only buys:
  //   - Distinct log prefix / class identity for DI consumers
  //   - Future hook to add mock-only behaviors (e.g. inject synthetic clock skew)
}
