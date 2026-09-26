/**
 * DiscoveryService — build OIDC discovery document (AUTH-07).
 *
 * Plan reference: PLAN2 Section 25.3.H (discovery document),
 * Section 5.2 (JWT claims), Section 9 (scopes), AUTH-07 task spec §2.
 *
 * Returns the discovery JSON per OIDC Discovery 1.0 / RFC 8414. Used by
 * `openid-client` v5 in payment-api (AUTH-09) to auto-discover auth-mock
 * endpoints (reduces env config — plan2 §15.4).
 *
 * `issuer` field MUST match JWT `iss` claim — verifier compares (plan2 §5.2).
 *
 * Auth-mock = reference for real auth — real auth must match field-by-field
 * so `openid-client` works with both without code change.
 */
import { Injectable } from '@nestjs/common';

/** Default issuer when AUTH_ISSUER env is not set (dev/sandbox). */
const DEFAULT_ISSUER = 'http://localhost:4001';

/** Scopes per AUTH_CONTRACT §9. */
const SCOPES_SUPPORTED = [
  'openid',
  'profile',
  'payment.read',
  'payment.write',
] as const;

/** JWT claims per AUTH_CONTRACT §4 (plan2 §5.2 — thin JWT). */
const CLAIMS_SUPPORTED = [
  'sub',
  'username',
  'roleId',
  'iss',
  'aud',
  'exp',
  'iat',
  'jti',
] as const;

/**
 * Discovery document shape per OIDC Discovery 1.0 / RFC 8414.
 * Field names snake_case per spec.
 */
export interface DiscoveryDocument {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  revocation_endpoint: string;
  jwks_uri: string;
  userinfo_endpoint: string;
  response_types_supported: string[];
  grant_types_supported: string[];
  code_challenge_methods_supported: string[];
  scopes_supported: string[];
  token_endpoint_auth_methods_supported: string[];
  id_token_signing_alg_values_supported: string[];
  subject_types_supported: string[];
  claims_supported: string[];
}

@Injectable()
export class DiscoveryService {
  /**
   * Build discovery document. Issuer comes from AUTH_ISSUER env (default
   * `http://localhost:4001`). Trailing slash is stripped to avoid
   * double-slash in endpoint URLs (e.g. `http://localhost:4001//oauth/authorize`).
   */
  buildDiscovery(issuerOverride?: string): DiscoveryDocument {
    const rawIssuer = issuerOverride ?? process.env.AUTH_ISSUER ?? DEFAULT_ISSUER;
    // Strip trailing slash(es) — `http://localhost:4001/` → `http://localhost:4001`
    const issuer = rawIssuer.replace(/\/+$/, '');

    return {
      issuer,
      authorization_endpoint: `${issuer}/oauth/authorize`,
      token_endpoint: `${issuer}/oauth/token`,
      revocation_endpoint: `${issuer}/oauth/revoke`,
      jwks_uri: `${issuer}/.well-known/jwks.json`,
      // userinfo_endpoint — listed for discovery completeness even though
      // /oauth/userinfo is not yet implemented (plan2 §10.1 marks optional).
      userinfo_endpoint: `${issuer}/oauth/userinfo`,
      response_types_supported: ['code'],
      grant_types_supported: ['authorization_code', 'refresh_token'],
      // PKCE: S256 only (RFC 7636, plain is rejected per AUTH-03).
      code_challenge_methods_supported: ['S256'],
      scopes_supported: [...SCOPES_SUPPORTED],
      token_endpoint_auth_methods_supported: [
        'client_secret_post',
        'client_secret_basic',
      ],
      id_token_signing_alg_values_supported: ['RS256'],
      subject_types_supported: ['public'],
      claims_supported: [...CLAIMS_SUPPORTED],
    };
  }
}
