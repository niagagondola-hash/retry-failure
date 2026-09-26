/**
 * MockVerifier — unit tests (AUTH-10).
 *
 * Verifies:
 *  - MockVerifier is a subclass of JwksVerifier (same logic, different config).
 *  - MockVerifier.verify() works identically to JwksVerifier when the same
 *    SecurityOptions are passed (auth-mock URL is the authIssuer).
 *  - MockVerifier.verifyAuthUser() returns the thin AuthUser shape.
 *
 * Plan reference: AUTH-10 task spec §3 (MockVerifier), §6 (acceptance).
 */
import { createServer } from 'node:http';
import { AddressInfo } from 'node:net';

import {
  SignJWT,
  exportJWK,
  generateKeyPair,
  calculateJwkThumbprint,
  type KeyLike,
} from 'jose';

import type { SecurityOptions } from '../src/security.module';
import { JwksVerifier } from '../src/verifiers/jwks-verifier';
import { MockVerifier } from '../src/verifiers/mock-verifier';

describe('MockVerifier', () => {
  let key: {
    kid: string;
    privateKey: KeyLike;
    publicKey: KeyLike;
    jwk: { kty: string; n: string; e: string; kid: string; use: string; alg: string };
  };
  let server: { baseUrl: string; close: () => Promise<void> };

  beforeAll(async () => {
    const kp = await generateKeyPair('RS256', { modulusLength: 2048 });
    const jwk = await exportJWK(kp.publicKey);
    const kid = await calculateJwkThumbprint(jwk as any);
    key = {
      kid,
      privateKey: kp.privateKey,
      publicKey: kp.publicKey,
      jwk: { kty: 'RSA', kid, use: 'sig', alg: 'RS256', n: jwk.n!, e: jwk.e! },
    };
  });

  beforeEach(async () => {
    const srv = createServer((req, res) => {
      if (req.url === '/.well-known/jwks.json') {
        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Cache-Control', 'public, max-age=300');
        res.end(JSON.stringify({ keys: [key.jwk] }));
      } else {
        res.statusCode = 404;
        res.end();
      }
    });
    await new Promise<void>((r) => srv.listen(0, '127.0.0.1', r));
    const addr = srv.address() as AddressInfo;
    server = {
      baseUrl: `http://127.0.0.1:${addr.port}`,
      close: () =>
        new Promise<void>((resolve, reject) =>
          srv.close((err) => (err ? reject(err) : resolve())),
        ),
    };
  });

  afterEach(async () => {
    await server.close();
  });

  it('is a subclass of JwksVerifier', () => {
    expect(MockVerifier.prototype).toBeInstanceOf(JwksVerifier);
    const opts: SecurityOptions = {
      authMode: 'mock',
      sessionStore: 'memory',
      authBaseUrl: server.baseUrl,
      authIssuer: server.baseUrl,
      jwtAudience: 'payment-api',
      oauthClientId: 'payment-api',
      oauthClientSecret: 'x',
      oauthRedirectUri: 'http://localhost:3001/auth/callback',
      oauthScopes: 'openid profile',
    };
    const v = new MockVerifier(opts);
    expect(v).toBeInstanceOf(JwksVerifier);
    expect(v.verify).toBe(JwksVerifier.prototype.verify);
    expect(v.verifyAuthUser).toBe(JwksVerifier.prototype.verifyAuthUser);
  });

  it('verifies identically to JwksVerifier with the same SecurityOptions', async () => {
    const opts: SecurityOptions = {
      authMode: 'mock',
      sessionStore: 'memory',
      authBaseUrl: server.baseUrl,
      authIssuer: server.baseUrl,
      jwtAudience: 'payment-api',
      oauthClientId: 'payment-api',
      oauthClientSecret: 'x',
      oauthRedirectUri: 'http://localhost:3001/auth/callback',
      oauthScopes: 'openid profile',
      jwksCacheTtlSec: 300,
      jwtClockToleranceSec: 5,
    };
    const mock = new MockVerifier(opts);
    const std = new JwksVerifier(opts);

    const token = await new SignJWT({ username: 'budi', roleId: 'r-1' })
      .setProtectedHeader({ alg: 'RS256', kid: key.kid, typ: 'JWT' })
      .setIssuer(server.baseUrl)
      .setAudience('payment-api')
      .setIssuedAt()
      .setExpirationTime('15m')
      .setSubject('user-budi')
      .setJti('mock-jti')
      .sign(key.privateKey);

    const mockPayload = await mock.verify(token);
    const stdPayload = await std.verify(token);
    expect(mockPayload).toEqual(stdPayload);
    expect(mockPayload.sub).toBe('user-budi');
  });

  it('verifyAuthUser returns the thin AuthUser shape', async () => {
    const opts: SecurityOptions = {
      authMode: 'mock',
      sessionStore: 'memory',
      authBaseUrl: server.baseUrl,
      authIssuer: server.baseUrl,
      jwtAudience: 'payment-api',
      oauthClientId: 'payment-api',
      oauthClientSecret: 'x',
      oauthRedirectUri: 'http://localhost:3001/auth/callback',
      oauthScopes: 'openid',
    };
    const mock = new MockVerifier(opts);

    const token = await new SignJWT({ username: 'superadmin', roleId: 'role-super-admin' })
      .setProtectedHeader({ alg: 'RS256', kid: key.kid, typ: 'JWT' })
      .setIssuer(server.baseUrl)
      .setAudience('payment-api')
      .setIssuedAt()
      .setExpirationTime('15m')
      .setSubject('user-superadmin')
      .setJti('super-jti')
      .sign(key.privateKey);

    const user = await mock.verifyAuthUser(token);
    expect(user).toEqual({
      userId: 'user-superadmin',
      username: 'superadmin',
      roleId: 'role-super-admin',
      jti: 'super-jti',
    });
  });

  it('rejects tokens with wrong audience (same behavior as JwksVerifier)', async () => {
    const opts: SecurityOptions = {
      authMode: 'mock',
      sessionStore: 'memory',
      authBaseUrl: server.baseUrl,
      authIssuer: server.baseUrl,
      jwtAudience: 'payment-api',
      oauthClientId: 'payment-api',
      oauthClientSecret: 'x',
      oauthRedirectUri: 'http://localhost:3001/auth/callback',
      oauthScopes: 'openid',
    };
    const mock = new MockVerifier(opts);

    const token = await new SignJWT({})
      .setProtectedHeader({ alg: 'RS256', kid: key.kid, typ: 'JWT' })
      .setIssuer(server.baseUrl)
      .setAudience('wrong-audience')
      .setIssuedAt()
      .setExpirationTime('15m')
      .setSubject('user-1')
      .sign(key.privateKey);

    await expect(mock.verify(token)).rejects.toThrow(/claim invalid.*aud/i);
  });
});
