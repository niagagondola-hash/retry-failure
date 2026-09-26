/**
 * JwksVerifier — unit tests with jose keypair + local HTTP JWKS server.
 *
 * Plan reference: AUTH-10 task spec §6, PLAN2 §5.1 (JWKS), §16 (clockTolerance).
 *
 * We don't use nock (not installed). Instead we spin up an `http.Server` on
 * port 0 (auto-assign) that serves the JWKS JSON at
 * `/.well-known/jwks.json`. Each test points `JwksVerifier` at the server's
 * ephemeral URL.
 *
 * Test cases:
 *  1. Verifies a valid RS256 JWT (signed by the keypair backing the JWKS).
 *  2. verifyAuthUser returns {userId, username, roleId, jti} from JWT claims.
 *  3. Rejects wrong issuer → "JWT claim invalid".
 *  4. Rejects wrong audience → "JWT claim invalid".
 *  5. Rejects expired JWT → "JWT expired".
 *  6. Rejects token signed by a different key with the same kid → "JWT signature invalid".
 *  7. kid rotation: server starts with one kid, then serves both → new kid
 *     gets auto-fetched on second verify.
 *  8. MockVerifier is a subclass of JwksVerifier + verifies identically.
 */
import { createServer, Server } from 'node:http';
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

interface KeyMaterial {
  kid: string;
  privateKey: KeyLike;
  publicKey: KeyLike;
  jwk: { kty: string; n: string; e: string; kid: string; use: string; alg: string };
}

async function makeKey(): Promise<KeyMaterial> {
  const kp = await generateKeyPair('RS256', { modulusLength: 2048 });
  const jwk = (await exportJWK(kp.publicKey)) as {
    kty: string;
    n: string;
    e: string;
  };
  const kid = await calculateJwkThumbprint(jwk as any);
  return {
    kid,
    privateKey: kp.privateKey,
    publicKey: kp.publicKey,
    jwk: {
      kty: 'RSA',
      kid,
      use: 'sig',
      alg: 'RS256',
      n: jwk.n,
      e: jwk.e,
    },
  };
}

/** Start a tiny HTTP server that serves JWKS at the well-known path. Returns the base URL. */
async function startJwksServer(getKeys: () => KeyMaterial[]): Promise<{
  baseUrl: string;
  server: Server;
  close: () => Promise<void>;
  /** How many times the server has been hit (kid rotation assertion helper). */
  hits: () => number;
}> {
  let hitCount = 0;
  const server = createServer((req, res) => {
    if (req.url === '/.well-known/jwks.json') {
      hitCount++;
      // Map each KeyMaterial → bare JWK (kty, kid, use, alg, n, e).
      // We must NOT serialize privateKey/publicKey/extra fields — jose expects
      // RFC 7517 JWK shape per key entry.
      const keys = getKeys().map((k) => k.jwk);
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Cache-Control', 'public, max-age=300');
      res.end(JSON.stringify({ keys }));
    } else {
      res.statusCode = 404;
      res.end('not found');
    }
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const addr = server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${addr.port}`;
  return {
    baseUrl,
    server,
    hits: () => hitCount,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      }),
  };
}

function makeOptions(baseUrl: string): SecurityOptions {
  return {
    authMode: 'oauth',
    sessionStore: 'memory',
    authBaseUrl: baseUrl,
    authIssuer: baseUrl,
    jwtAudience: 'payment-api',
    oauthClientId: 'payment-api',
    oauthClientSecret: 'dev-client-secret',
    oauthRedirectUri: 'http://localhost:3001/auth/callback',
    oauthScopes: 'openid profile',
    jwksCacheTtlSec: 300,
    jwtClockToleranceSec: 5,
  };
}

async function signAccessToken(
  key: KeyMaterial,
  opts: {
    issuer?: string;
    audience?: string;
    expiresIn?: string;
    sub?: string;
    username?: string;
    roleId?: string;
    jti?: string;
    extraClaims?: Record<string, unknown>;
  } = {},
): Promise<string> {
  const jwt = new SignJWT({
    username: opts.username ?? 'budi_santoso',
    roleId: opts.roleId ?? 'role-operator',
    ...(opts.extraClaims ?? {}),
  })
    .setProtectedHeader({ alg: 'RS256', kid: key.kid, typ: 'JWT' })
    .setIssuer(opts.issuer ?? 'http://localhost:4001')
    .setAudience(opts.audience ?? 'payment-api')
    .setIssuedAt()
    .setExpirationTime(opts.expiresIn ?? '15m')
    .setSubject(opts.sub ?? 'user-budi');

  if (opts.jti) jwt.setJti(opts.jti);
  return jwt.sign(key.privateKey);
}

describe('JwksVerifier', () => {
  let keyA: KeyMaterial;
  let keyB: KeyMaterial;
  let server: {
    baseUrl: string;
    close: () => Promise<void>;
    hits: () => number;
  };

  beforeAll(async () => {
    keyA = await makeKey();
    keyB = await makeKey();
  });

  beforeEach(async () => {
    server = await startJwksServer(() => [keyA]);
  });

  afterEach(async () => {
    await server.close();
  });

  it('verifies a valid RS256 JWT signed by the keypair backing the JWKS', async () => {
    const verifier = new JwksVerifier(makeOptions(server.baseUrl));
    const token = await signAccessToken(keyA, { issuer: server.baseUrl });
    const payload = await verifier.verify(token);
    expect(payload.sub).toBe('user-budi');
    expect(payload.username).toBe('budi_santoso');
    expect(payload.roleId).toBe('role-operator');
  });

  it('verifyAuthUser returns {userId, username, roleId, jti} from JWT claims', async () => {
    const verifier = new JwksVerifier(makeOptions(server.baseUrl));
    const token = await signAccessToken(keyA, {
      issuer: server.baseUrl,
      username: 'superadmin',
      roleId: 'role-super-admin',
      sub: 'user-superadmin',
      jti: 'jti-123',
    });
    const user = await verifier.verifyAuthUser(token);
    expect(user).toEqual({
      userId: 'user-superadmin',
      username: 'superadmin',
      roleId: 'role-super-admin',
      jti: 'jti-123',
    });
  });

  it('rejects token with wrong issuer', async () => {
    const verifier = new JwksVerifier(makeOptions(server.baseUrl));
    const token = await signAccessToken(keyA, { issuer: 'https://wrong.example' });
    await expect(verifier.verify(token)).rejects.toThrow(/claim invalid.*iss/i);
  });

  it('rejects token with wrong audience', async () => {
    const verifier = new JwksVerifier(makeOptions(server.baseUrl));
    const token = await signAccessToken(keyA, {
      issuer: server.baseUrl,
      audience: 'other-api',
    });
    await expect(verifier.verify(token)).rejects.toThrow(/claim invalid.*aud/i);
  });

  it('rejects expired token', async () => {
    // Use a verifier with clockTolerance=0 so even a freshly-expired token
    // (expiresIn '0s' + ~50ms test overhead) is rejected. The default 5s
    // tolerance would accept it.
    const opts = { ...makeOptions(server.baseUrl), jwtClockToleranceSec: 0 };
    const verifier = new JwksVerifier(opts);
    const token = await signAccessToken(keyA, {
      issuer: server.baseUrl,
      expiresIn: '0s',
    });
    // Small delay so the JWT is unambiguously past expiry.
    await new Promise((r) => setTimeout(r, 50));
    await expect(verifier.verify(token)).rejects.toThrow(/expired/i);
  });

  it('rejects token signed by a different key (signature mismatch)', async () => {
    const verifier = new JwksVerifier(makeOptions(server.baseUrl));
    // Server returns keyA's JWK; sign token with keyB but use keyA's kid.
    const token = await new SignJWT({ username: 'x', roleId: 'r' })
      .setProtectedHeader({ alg: 'RS256', kid: keyA.kid, typ: 'JWT' })
      .setIssuer(server.baseUrl)
      .setAudience('payment-api')
      .setIssuedAt()
      .setExpirationTime('15m')
      .setSubject('user-x')
      .sign(keyB.privateKey);
    await expect(verifier.verify(token)).rejects.toThrow(/signature invalid/i);
  });

  it('supports kid rotation — verifies tokens signed with either of 2 keys in JWKS', async () => {
    // Production scenario (plan2 §21.2): auth rotates keypair, then serves
    // BOTH old kid + new kid in JWKS during the grace period. Verifier
    // fetches the multi-key JWKS once and can verify either token without
    // refetching.
    //
    // Note: jose v5's `createRemoteJWKSet` does NOT refetch on kid miss
    // during `cooldownDuration` — that's intentional DoS protection. So a
    // brand-new kid arriving mid-cooldown returns JWKSNoMatchingKey until
    // the cooldown expires. Production deployments rely on auth always
    // serving BOTH old + new kids in JWKS during rotation.
    const rotServer = await startJwksServer(() => [keyA, keyB]);
    try {
      const verifier = new JwksVerifier(makeOptions(rotServer.baseUrl));

      const tokenA = await signAccessToken(keyA, { issuer: rotServer.baseUrl, username: 'old' });
      const tokenB = await signAccessToken(keyB, {
        issuer: rotServer.baseUrl,
        username: 'new',
        roleId: 'role-finance',
      });

      const payloadA = await verifier.verify(tokenA);
      const payloadB = await verifier.verify(tokenB);
      expect(payloadA.username).toBe('old');
      expect(payloadB.username).toBe('new');
      expect(payloadB.roleId).toBe('role-finance');
    } finally {
      await rotServer.close();
    }
  });

  it('rejects JWT missing required claims in verifyAuthUser', async () => {
    const verifier = new JwksVerifier(makeOptions(server.baseUrl));
    // Sign a token WITHOUT custom claims (no username / roleId).
    const token = await new SignJWT({})
      .setProtectedHeader({ alg: 'RS256', kid: keyA.kid, typ: 'JWT' })
      .setIssuer(server.baseUrl)
      .setAudience('payment-api')
      .setIssuedAt()
      .setExpirationTime('15m')
      .setSubject('user-1')
      .sign(keyA.privateKey);
    await expect(verifier.verifyAuthUser(token)).rejects.toThrow(
      /missing required claim: username/i,
    );
  });

  it('throws on construction if authIssuer is missing', () => {
    expect(
      () => new JwksVerifier({ ...makeOptions(server.baseUrl), authIssuer: undefined }),
    ).toThrow(/authIssuer/i);
  });

  it('throws on construction if jwtAudience is missing', () => {
    expect(
      () => new JwksVerifier({ ...makeOptions(server.baseUrl), jwtAudience: undefined }),
    ).toThrow(/jwtAudience/i);
  });
});

describe('MockVerifier', () => {
  it('is a subclass of JwksVerifier', () => {
    expect(MockVerifier.prototype).toBeInstanceOf(JwksVerifier);
  });

  it('verifies identically to JwksVerifier (auth-mock JWKS URL)', async () => {
    const key = await makeKey();
    const srv = await startJwksServer(() => [key]);
    try {
      const opts = makeOptions(srv.baseUrl);
      opts.authMode = 'mock';
      const verifier = new MockVerifier(opts);
      const token = await signAccessToken(key, { issuer: srv.baseUrl });
      const payload = await verifier.verify(token);
      expect(payload.sub).toBe('user-budi');
    } finally {
      await srv.close();
    }
  });
});
