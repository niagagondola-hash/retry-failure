/**
 * OAuthService — unit tests for AUTH-03.
 *
 * Verifies:
 *  - PKCE S256 verification (valid, invalid method, wrong verifier).
 *  - Authorization code store: store + consume (one-time use) + TTL.
 *  - JWT issuance: access + refresh token claims + expiry.
 *  - Refresh rotation: old refresh revoked after success.
 *  - Reuse detection: presenting revoked refresh → all user tokens revoked.
 *  - exchangeCode: PKCE mismatch → InvalidGrantError, redirect_uri mismatch,
 *    invalid client → InvalidClientError.
 *  - revoke: marks token revoked; returns silently on malformed token.
 *
 * Plan reference: AUTH-03 task spec §11 (acceptance criteria).
 */
import { createHash } from 'node:crypto';

import { SignJWT, exportJWK, generateKeyPair, jwtVerify } from 'jose';

import { ClientService } from '../client/client.service';
import { JwtSignerService } from '../keypair/jwt-signer.service';
import { KeyPairService } from '../keypair/key-pair.service';
import { TokenFactory } from '../keypair/token-factory';
import { UserService } from '../user/user.service';

import { AuthCodeStore } from './auth-code.store';
import { AuthSessionService } from './auth-session.service';
import { OAuthService, InvalidGrantError, InvalidClientError } from './oauth.service';
import { TokenStore } from './token.store';


/** Local S256 challenge (RFC 7636 §4.2) — duplicate of packages/security's helper. */
function computeChallenge(verifier: string): string {
  return createHash('sha256').update(verifier).digest('base64url');
}

// Build a real RS256 keypair so JwtSignerService can sign real tokens.
async function buildKeyPairService(): Promise<KeyPairService> {
  const kp = await generateKeyPair('RS256', { modulusLength: 2048 });
  const jwk = await exportJWK(kp.publicKey);
  // Mock KeyPairService — bypass file system + OnModuleInit.
  const svc = {
    privateKey: kp.privateKey,
    publicKey: kp.publicKey,
    kid: 'test-kid',
    publicJwk: {
      kty: 'RSA' as const,
      kid: 'test-kid',
      use: 'sig' as const,
      alg: 'RS256' as const,
      n: jwk.n!,
      e: jwk.e!,
    },
  } as unknown as KeyPairService;
  return svc;
}

async function buildService(): Promise<{
  service: OAuthService;
  tokenStore: TokenStore;
  authCodes: AuthCodeStore;
  users: UserService;
  keyPair: KeyPairService;
}> {
  const keyPair = await buildKeyPairService();
  const signer = new JwtSignerService(keyPair);
  const tokenFactory = new TokenFactory(signer);
  const authCodes = new AuthCodeStore();
  const tokenStore = new TokenStore();
  // AuthSessionService — we don't exercise cookie logic here, but we need the instance.
  const authSessions = new AuthSessionService();
  const clients = new ClientService();
  const users = new UserService();
  await users.onModuleInit(); // AUTH-06: seed fixtures (was in constructor before)
  const service = new OAuthService(signer, authCodes, tokenStore, authSessions, clients, tokenFactory);
  service.setUserLookup((id) => users.findById(id));
  return { service, tokenStore, authCodes, users, keyPair };
}

describe('OAuthService', () => {
  const REDIRECT = 'http://localhost:3001/auth/callback';
  const CLIENT_ID = 'payment-api';
  const CLIENT_SECRET = 'dev-client-secret';

  // ---------- PKCE verification --------------------------------------

  describe('verifyPkce', () => {
    it('accepts valid S256 verifier + challenge pair', async () => {
      const { service } = await buildService();
      const verifier = 'a'.repeat(64);
      const challenge = computeChallenge(verifier);
      expect(service.verifyPkce(verifier, challenge, 'S256')).toBe(true);
    });

    it('rejects code_challenge_method=plain', async () => {
      const { service } = await buildService();
      expect(service.verifyPkce('verifier', 'verifier', 'plain')).toBe(false);
    });

    it('rejects wrong verifier (challenge mismatch)', async () => {
      const { service } = await buildService();
      const real = computeChallenge('verifier-1');
      expect(service.verifyPkce('verifier-2', real, 'S256')).toBe(false);
    });

    it('rejects verifier shorter than 43 chars', async () => {
      const { service } = await buildService();
      expect(
        service.verifyPkce('short', computeChallenge('short'), 'S256'),
      ).toBe(false);
    });

    it('rejects verifier longer than 128 chars', async () => {
      const { service } = await buildService();
      const long = 'a'.repeat(200);
      expect(service.verifyPkce(long, computeChallenge(long), 'S256')).toBe(false);
    });
  });

  // ---------- Authorization code store + TTL -------------------------

  describe('authorization code', () => {
    it('stores code and consumes (one-time use)', async () => {
      const { service, authCodes } = await buildService();
      const verifier = 'v'.repeat(64);
      const challenge = computeChallenge(verifier);
      await authCodes.store({
        code: 'code-1',
        clientId: CLIENT_ID,
        userId: '00000000-0000-1000-8000-000000000002',
        roleId: '00000000-0000-1000-8000-000000000102',
        redirectUri: REDIRECT,
        codeChallenge: challenge,
        codeChallengeMethod: 'S256',
        scope: 'openid profile',
        expiresAt: Date.now() + 60_000,
        consumed: false,
      });
      const first = await authCodes.consume('code-1');
      expect(first?.code).toBe('code-1');
      const second = await authCodes.consume('code-1');
      expect(second).toBeNull();
    });

    it('returns null for expired code', async () => {
      const { authCodes } = await buildService();
      await authCodes.store({
        code: 'expired-code',
        clientId: CLIENT_ID,
        userId: '00000000-0000-1000-8000-000000000002',
        roleId: '00000000-0000-1000-8000-000000000102',
        redirectUri: REDIRECT,
        codeChallenge: computeChallenge('v'.repeat(64)),
        codeChallengeMethod: 'S256',
        scope: 'openid',
        expiresAt: Date.now() - 1, // already expired
        consumed: false,
      });
      expect(await authCodes.consume('expired-code')).toBeNull();
    });
  });

  // ---------- exchangeCode (authorization_code grant) ----------------

  describe('exchangeCode', () => {
    it('issues access + refresh token pair on valid PKCE + client + redirect', async () => {
      const { service, authCodes, keyPair } = await buildService();
      const verifier = 'v'.repeat(64);
      const challenge = computeChallenge(verifier);
      await authCodes.store({
        code: 'code-good',
        clientId: CLIENT_ID,
        userId: '00000000-0000-1000-8000-000000000002',
        roleId: '00000000-0000-1000-8000-000000000102',
        redirectUri: REDIRECT,
        codeChallenge: challenge,
        codeChallengeMethod: 'S256',
        scope: 'openid profile',
        expiresAt: Date.now() + 60_000,
        consumed: false,
      });

      const pair = await service.exchangeCode({
        code: 'code-good',
        codeVerifier: verifier,
        clientId: CLIENT_ID,
        clientSecret: CLIENT_SECRET,
        redirectUri: REDIRECT,
      });

      expect(pair.accessToken).toBeTruthy();
      expect(pair.refreshToken).toBeTruthy();
      expect(pair.expiresIn).toBe(900);
      expect(pair.tokenType).toBe('Bearer');

      // Verify the access token via the keypair public key (signature + iss + aud).
      const { payload } = await jwtVerify(pair.accessToken, keyPair.publicKey, {
        algorithms: ['RS256'],
        issuer: 'http://localhost:4001',
        audience: 'payment-api',
      });
      expect(payload.sub).toBe('00000000-0000-1000-8000-000000000002');
      expect(payload.username).toBe('budi_santoso');
      expect(payload.roleId).toBe('00000000-0000-1000-8000-000000000102');
      expect(payload.type).toBe('access');
      expect(payload.jti).toBe(pair.accessJti);
    });

    it('rejects PKCE mismatch with InvalidGrantError', async () => {
      const { service, authCodes } = await buildService();
      await authCodes.store({
        code: 'code-pkce',
        clientId: CLIENT_ID,
        userId: '00000000-0000-1000-8000-000000000002',
        roleId: '00000000-0000-1000-8000-000000000102',
        redirectUri: REDIRECT,
        codeChallenge: computeChallenge('correct-verifier'),
        codeChallengeMethod: 'S256',
        scope: 'openid',
        expiresAt: Date.now() + 60_000,
        consumed: false,
      });
      await expect(
        service.exchangeCode({
          code: 'code-pkce',
          codeVerifier: 'wrong-verifier-12345678901234567890123456789012',
          clientId: CLIENT_ID,
          clientSecret: CLIENT_SECRET,
          redirectUri: REDIRECT,
        }),
      ).rejects.toBeInstanceOf(InvalidGrantError);
    });

    it('rejects invalid client credentials with InvalidClientError', async () => {
      const { service, authCodes } = await buildService();
      const verifier = 'v'.repeat(64);
      await authCodes.store({
        code: 'code-bad-client',
        clientId: CLIENT_ID,
        userId: '00000000-0000-1000-8000-000000000002',
        roleId: '00000000-0000-1000-8000-000000000102',
        redirectUri: REDIRECT,
        codeChallenge: computeChallenge(verifier),
        codeChallengeMethod: 'S256',
        scope: 'openid',
        expiresAt: Date.now() + 60_000,
        consumed: false,
      });
      await expect(
        service.exchangeCode({
          code: 'code-bad-client',
          codeVerifier: verifier,
          clientId: CLIENT_ID,
          clientSecret: 'wrong-secret',
          redirectUri: REDIRECT,
        }),
      ).rejects.toBeInstanceOf(InvalidClientError);
    });

    it('rejects unknown code with InvalidGrantError', async () => {
      const { service } = await buildService();
      await expect(
        service.exchangeCode({
          code: 'nonexistent',
          codeVerifier: 'v'.repeat(64),
          clientId: CLIENT_ID,
          clientSecret: CLIENT_SECRET,
          redirectUri: REDIRECT,
        }),
      ).rejects.toBeInstanceOf(InvalidGrantError);
    });

    it('rejects redirect_uri mismatch with InvalidGrantError', async () => {
      const { service, authCodes } = await buildService();
      const verifier = 'v'.repeat(64);
      await authCodes.store({
        code: 'code-redirect',
        clientId: CLIENT_ID,
        userId: '00000000-0000-1000-8000-000000000002',
        roleId: '00000000-0000-1000-8000-000000000102',
        redirectUri: REDIRECT,
        codeChallenge: computeChallenge(verifier),
        codeChallengeMethod: 'S256',
        scope: 'openid',
        expiresAt: Date.now() + 60_000,
        consumed: false,
      });
      await expect(
        service.exchangeCode({
          code: 'code-redirect',
          codeVerifier: verifier,
          clientId: CLIENT_ID,
          clientSecret: CLIENT_SECRET,
          redirectUri: 'http://evil.example.test/cb',
        }),
      ).rejects.toBeInstanceOf(InvalidGrantError);
    });

    it('enforces one-time use (second exchange → InvalidGrantError)', async () => {
      const { service, authCodes } = await buildService();
      const verifier = 'v'.repeat(64);
      await authCodes.store({
        code: 'code-onetime',
        clientId: CLIENT_ID,
        userId: '00000000-0000-1000-8000-000000000002',
        roleId: '00000000-0000-1000-8000-000000000102',
        redirectUri: REDIRECT,
        codeChallenge: computeChallenge(verifier),
        codeChallengeMethod: 'S256',
        scope: 'openid',
        expiresAt: Date.now() + 60_000,
        consumed: false,
      });
      await service.exchangeCode({
        code: 'code-onetime',
        codeVerifier: verifier,
        clientId: CLIENT_ID,
        clientSecret: CLIENT_SECRET,
        redirectUri: REDIRECT,
      });
      // Second attempt — code should be gone.
      await expect(
        service.exchangeCode({
          code: 'code-onetime',
          codeVerifier: verifier,
          clientId: CLIENT_ID,
          clientSecret: CLIENT_SECRET,
          redirectUri: REDIRECT,
        }),
      ).rejects.toBeInstanceOf(InvalidGrantError);
    });
  });

  // ---------- refresh rotation + reuse detection -------------------

  describe('refresh rotation', () => {
    it('issues new pair + revokes old refresh on success', async () => {
      const { service, authCodes, tokenStore, keyPair } = await buildService();
      const verifier = 'v'.repeat(64);
      await authCodes.store({
        code: 'code-refresh',
        clientId: CLIENT_ID,
        userId: '00000000-0000-1000-8000-000000000002',
        roleId: '00000000-0000-1000-8000-000000000102',
        redirectUri: REDIRECT,
        codeChallenge: computeChallenge(verifier),
        codeChallengeMethod: 'S256',
        scope: 'openid profile',
        expiresAt: Date.now() + 60_000,
        consumed: false,
      });
      const initial = await service.exchangeCode({
        code: 'code-refresh',
        codeVerifier: verifier,
        clientId: CLIENT_ID,
        clientSecret: CLIENT_SECRET,
        redirectUri: REDIRECT,
      });

      // Old refresh should NOT be revoked yet.
      expect(await tokenStore.isRevoked(initial.refreshJti)).toBe(false);

      // Rotate.
      const rotated = await service.refresh({
        refreshToken: initial.refreshToken,
        clientId: CLIENT_ID,
        clientSecret: CLIENT_SECRET,
      });

      expect(rotated.accessToken).not.toBe(initial.accessToken);
      expect(rotated.refreshToken).not.toBe(initial.refreshToken);
      expect(rotated.refreshJti).not.toBe(initial.refreshJti);

      // Old refresh now revoked.
      expect(await tokenStore.isRevoked(initial.refreshJti)).toBe(true);
      // New refresh not revoked.
      expect(await tokenStore.isRevoked(rotated.refreshJti)).toBe(false);

      // Verify the new access token is valid against the public key.
      const { payload } = await jwtVerify(rotated.accessToken, keyPair.publicKey, {
        algorithms: ['RS256'],
        issuer: 'http://localhost:4001',
        audience: 'payment-api',
      });
      expect(payload.sub).toBe('00000000-0000-1000-8000-000000000002');
    });

    it('reuse detection: presenting revoked refresh → InvalidGrantError + all user tokens revoked', async () => {
      const { service, tokenStore, authCodes } = await buildService();
      const verifier = 'v'.repeat(64);
      await authCodes.store({
        code: 'code-reuse',
        clientId: CLIENT_ID,
        userId: '00000000-0000-1000-8000-000000000002',
        roleId: '00000000-0000-1000-8000-000000000102',
        redirectUri: REDIRECT,
        codeChallenge: computeChallenge(verifier),
        codeChallengeMethod: 'S256',
        scope: 'openid profile',
        expiresAt: Date.now() + 60_000,
        consumed: false,
      });
      const initial = await service.exchangeCode({
        code: 'code-reuse',
        codeVerifier: verifier,
        clientId: CLIENT_ID,
        clientSecret: CLIENT_SECRET,
        redirectUri: REDIRECT,
      });

      // Rotate once — old refresh revoked.
      const rotated = await service.refresh({
        refreshToken: initial.refreshToken,
        clientId: CLIENT_ID,
        clientSecret: CLIENT_SECRET,
      });

      // Old refresh now revoked. Access token (initial) is still alive but
      // tied to user.
      expect(await tokenStore.isRevoked(initial.refreshJti)).toBe(true);
      expect(await tokenStore.isRevoked(initial.accessJti)).toBe(false);

      // Reuse: try to rotate the old (now-revoked) refresh.
      await expect(
        service.refresh({
          refreshToken: initial.refreshToken,
          clientId: CLIENT_ID,
          clientSecret: CLIENT_SECRET,
        }),
      ).rejects.toBeInstanceOf(InvalidGrantError);

      // Panic: ALL tokens for user should now be revoked (including the
      // freshly-rotated access + refresh).
      expect(await tokenStore.isRevoked(rotated.accessJti)).toBe(true);
      expect(await tokenStore.isRevoked(rotated.refreshJti)).toBe(true);
      expect(await tokenStore.isRevoked(initial.accessJti)).toBe(true);
    });

    it('rejects invalid refresh token signature with InvalidGrantError', async () => {
      const { service } = await buildService();
      await expect(
        service.refresh({
          refreshToken: 'not-a-jwt',
          clientId: CLIENT_ID,
          clientSecret: CLIENT_SECRET,
        }),
      ).rejects.toBeInstanceOf(InvalidGrantError);
    });

    it('rejects refresh token signed by different key (InvalidGrantError)', async () => {
      const { service } = await buildService();
      // Generate a different keypair + sign a refresh token with it.
      const otherKp = await generateKeyPair('RS256', { modulusLength: 2048 });
      const foreignToken = await new SignJWT({
        sub: '00000000-0000-1000-8000-000000000002',
        username: 'budi_santoso',
        roleId: '00000000-0000-1000-8000-000000000102',
        type: 'refresh',
        client_id: CLIENT_ID,
      })
        .setProtectedHeader({ alg: 'RS256', kid: 'other-kid' })
        .setIssuer('http://localhost:4001')
        .setAudience('payment-api')
        .setIssuedAt()
        .setExpirationTime('8h')
        .setJti('foreign-jti')
        .sign(otherKp.privateKey);

      await expect(
        service.refresh({
          refreshToken: foreignToken,
          clientId: CLIENT_ID,
          clientSecret: CLIENT_SECRET,
        }),
      ).rejects.toBeInstanceOf(InvalidGrantError);
    });

    it('rejects refresh with wrong client_secret (InvalidClientError)', async () => {
      const { service, authCodes } = await buildService();
      const verifier = 'v'.repeat(64);
      await authCodes.store({
        code: 'code-client-mismatch',
        clientId: CLIENT_ID,
        userId: '00000000-0000-1000-8000-000000000002',
        roleId: '00000000-0000-1000-8000-000000000102',
        redirectUri: REDIRECT,
        codeChallenge: computeChallenge(verifier),
        codeChallengeMethod: 'S256',
        scope: 'openid profile',
        expiresAt: Date.now() + 60_000,
        consumed: false,
      });
      const initial = await service.exchangeCode({
        code: 'code-client-mismatch',
        codeVerifier: verifier,
        clientId: CLIENT_ID,
        clientSecret: CLIENT_SECRET,
        redirectUri: REDIRECT,
      });
      await expect(
        service.refresh({
          refreshToken: initial.refreshToken,
          clientId: CLIENT_ID,
          clientSecret: 'wrong-secret',
        }),
      ).rejects.toBeInstanceOf(InvalidClientError);
    });
  });

  // ---------- revoke (RFC 7009) -------------------------------------

  describe('revoke', () => {
    it('marks token revoked on valid token', async () => {
      const { service, tokenStore, authCodes } = await buildService();
      const verifier = 'v'.repeat(64);
      await authCodes.store({
        code: 'code-revoke',
        clientId: CLIENT_ID,
        userId: '00000000-0000-1000-8000-000000000002',
        roleId: '00000000-0000-1000-8000-000000000102',
        redirectUri: REDIRECT,
        codeChallenge: computeChallenge(verifier),
        codeChallengeMethod: 'S256',
        scope: 'openid profile',
        expiresAt: Date.now() + 60_000,
        consumed: false,
      });
      const pair = await service.exchangeCode({
        code: 'code-revoke',
        codeVerifier: verifier,
        clientId: CLIENT_ID,
        clientSecret: CLIENT_SECRET,
        redirectUri: REDIRECT,
      });
      expect(await tokenStore.isRevoked(pair.accessJti)).toBe(false);
      await service.revoke({
        token: pair.accessToken,
        clientId: CLIENT_ID,
        clientSecret: CLIENT_SECRET,
      });
      expect(await tokenStore.isRevoked(pair.accessJti)).toBe(true);
    });

    it('returns silently on malformed token (RFC 7009 §2.2)', async () => {
      const { service } = await buildService();
      await expect(
        service.revoke({
          token: 'not-a-jwt',
          clientId: CLIENT_ID,
          clientSecret: CLIENT_SECRET,
        }),
      ).resolves.toBeUndefined();
    });

    it('rejects invalid client credentials', async () => {
      const { service } = await buildService();
      await expect(
        service.revoke({
          token: 'anything',
          clientId: CLIENT_ID,
          clientSecret: 'wrong-secret',
        }),
      ).rejects.toBeInstanceOf(InvalidClientError);
    });
  });
});
