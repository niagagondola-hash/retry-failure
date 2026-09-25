/**
 * PKCE helpers — RFC 7636 Proof Key for Code Exchange by OAuth Public Clients.
 *
 * Plan reference: PLAN2 Section 4.3 (PKCE), Section 9 (oauth-client.service.ts).
 *
 * - `code_verifier`: 43–128 karakter random, charset [A-Z][a-z][0-9]-._~
 *   (we generate base64url from random bytes, truncated to length).
 * - `code_challenge`: `BASE64URL(SHA256(verifier))` for method `S256`.
 * - PKCE wajib meski client confidential (RFC 9700 §2.1.1).
 */
import { createHash, randomBytes } from 'node:crypto';

/** RFC 7636 §4.1: 43-128 char, [A-Z][a-z][0-9]-._~ */
export function generateCodeVerifier(length = 64): string {
  if (length < 43 || length > 128) {
    throw new Error(
      `code_verifier length must be 43-128 (got ${length})`,
    );
  }
  // Generate ~length bytes of entropy, base64url-encode (which is longer),
  // then truncate to requested length. base64url output ~1.33x the input,
  // so ceil(length / 1.33) bytes produces at least `length` chars.
  const bytes = Math.ceil(length * 1.34);
  return randomBytes(bytes).toString('base64url').slice(0, length);
}

/** RFC 7636 §4.2: BASE64URL(SHA256(verifier)) for method S256. */
export function computeCodeChallenge(verifier: string): string {
  return createHash('sha256').update(verifier).digest('base64url');
}

/**
 * Generate verifier + challenge pair for OAuth2 PKCE S256 flow.
 * Caller stores `codeVerifier` (e.g. in short-lived cookie / session) and
 * sends `codeChallenge` in the authorization request.
 */
export function generatePkcePair(): {
  codeVerifier: string;
  codeChallenge: string;
  codeChallengeMethod: 'S256';
} {
  const codeVerifier = generateCodeVerifier();
  const codeChallenge = computeCodeChallenge(codeVerifier);
  return { codeVerifier, codeChallenge, codeChallengeMethod: 'S256' };
}
