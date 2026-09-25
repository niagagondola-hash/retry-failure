import { createHash } from 'node:crypto';

import {
  computeCodeChallenge,
  generateCodeVerifier,
  generatePkcePair,
} from '../src/oauth/pkce.util';

describe('pkce.util', () => {
  describe('generateCodeVerifier', () => {
    it('default length is 64', () => {
      const v = generateCodeVerifier();
      expect(v).toHaveLength(64);
    });

    it('minimum length 43 is accepted', () => {
      const v = generateCodeVerifier(43);
      expect(v).toHaveLength(43);
    });

    it('maximum length 128 is accepted', () => {
      const v = generateCodeVerifier(128);
      expect(v).toHaveLength(128);
    });

    it('produces base64url charset (A-Za-z0-9-._~ per RFC 7636 §4.1)', () => {
      const v = generateCodeVerifier(128);
      // base64url alphabet + '.' + '~' are technically allowed by RFC 7636;
      // our generator produces base64url chars (A-Za-z0-9-_) which is a subset.
      expect(v).toMatch(/^[A-Za-z0-9_-]+$/);
    });

    it('throws if length < 43', () => {
      expect(() => generateCodeVerifier(42)).toThrow(/43-128/);
    });

    it('throws if length > 128', () => {
      expect(() => generateCodeVerifier(129)).toThrow(/43-128/);
    });

    it('produces distinct values across calls (high entropy)', () => {
      const a = generateCodeVerifier();
      const b = generateCodeVerifier();
      expect(a).not.toEqual(b);
    });
  });

  describe('computeCodeChallenge', () => {
    it('matches RFC 7636 Appendix B test vector (S256)', () => {
      // https://datatracker.ietf.org/doc/html/rfc7636#appendix-B
      const verifier =
        'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
      const expectedChallenge =
        'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM';
      expect(computeCodeChallenge(verifier)).toEqual(expectedChallenge);
    });

    it('is deterministic for the same verifier', () => {
      const verifier = generateCodeVerifier();
      expect(computeCodeChallenge(verifier)).toEqual(
        computeCodeChallenge(verifier),
      );
    });

    it('matches manual SHA-256 base64url computation', () => {
      const verifier = 'test-verifier-12345';
      const expected = createHash('sha256')
        .update(verifier)
        .digest('base64url');
      expect(computeCodeChallenge(verifier)).toEqual(expected);
    });

    it('produces 43-char (256-bit) challenge for any verifier in range', () => {
      // SHA-256 → 32 bytes → base64url ≈ 43 chars (no padding)
      const verifier = generateCodeVerifier(64);
      const challenge = computeCodeChallenge(verifier);
      expect(challenge).toHaveLength(43);
    });
  });

  describe('generatePkcePair', () => {
    it('returns verifier + matching S256 challenge + method', () => {
      const pair = generatePkcePair();
      expect(pair.codeChallengeMethod).toEqual('S256');
      expect(pair.codeVerifier).toHaveLength(64);
      // Round-trip: challenge matches manual SHA256(verifier)
      expect(pair.codeChallenge).toEqual(
        computeCodeChallenge(pair.codeVerifier),
      );
    });

    it('verifier and challenge differ across calls', () => {
      const a = generatePkcePair();
      const b = generatePkcePair();
      expect(a.codeVerifier).not.toEqual(b.codeVerifier);
      expect(a.codeChallenge).not.toEqual(b.codeChallenge);
    });
  });
});
