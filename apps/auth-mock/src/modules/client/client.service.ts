/**
 * ClientService — hardcoded OAuth2 client registration (AUTH-03).
 *
 * Plan reference: PLAN2 Section 10.2 (Client registration).
 *
 * Single registered confidential client (`payment-api`) per plan2 §10.2:
 *   - redirect_uris:  http://localhost:3001/auth/callback
 *   - grant_types:    authorization_code, refresh_token
 *   - scopes:         openid profile payment.read payment.write
 *   - token_endpoint_auth_method: client_secret_post
 *
 * Production auth services would store client registrations in a DB; for the
 * mock this hardcoded Map is sufficient. `OAUTH_CLIENT_SECRET` env overrides
 * the default `dev-client-secret` so integration tests can pin it.
 */
import { Injectable } from '@nestjs/common';

export interface OAuthClient {
  clientId: string;
  clientSecret: string;
  redirectUris: string[];
  grantTypes: string[];
  scopes: string[];
  tokenEndpointAuthMethod: 'client_secret_post' | 'client_secret_basic';
}

@Injectable()
export class ClientService {
  private readonly clients = new Map<string, OAuthClient>();

  constructor() {
    const paymentApi: OAuthClient = {
      clientId: 'payment-api',
      clientSecret: process.env.OAUTH_CLIENT_SECRET ?? 'dev-client-secret',
      redirectUris: ['http://localhost:3001/auth/callback'],
      grantTypes: ['authorization_code', 'refresh_token'],
      scopes: ['openid', 'profile', 'payment.read', 'payment.write'],
      tokenEndpointAuthMethod: 'client_secret_post',
    };
    this.clients.set(paymentApi.clientId, paymentApi);
  }

  findById(clientId: string): OAuthClient | undefined {
    return this.clients.get(clientId);
  }

  /** Confidential client credential check (RFC 6749 §2.3.1). */
  validateClientCredentials(
    clientId: string,
    clientSecret: string,
  ): boolean {
    const c = this.findById(clientId);
    if (!c) return false;
    // Constant-time-ish compare; dev only — not a real secret comparison.
    if (c.clientSecret.length !== clientSecret.length) return false;
    return c.clientSecret === clientSecret;
  }

  /** Redirect URI must match exactly one registered for this client. */
  validateRedirectUri(clientId: string, redirectUri: string): boolean {
    const c = this.findById(clientId);
    if (!c) return false;
    return c.redirectUris.includes(redirectUri);
  }
}
