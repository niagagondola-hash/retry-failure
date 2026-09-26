import { Injectable } from '@nestjs/common';
import { SignJWT, jwtVerify, JWTPayload } from 'jose';

import { KeyPairService } from './key-pair.service';

export interface SignOptions {
  /** `iss` claim — auth-mock base URL (e.g. http://localhost:4001). */
  issuer: string;
  /** `aud` claim — intended resource server (e.g. payment-api). */
  audience: string;
  /** jose expiry expression — e.g. '15m', '8h'. */
  expiresIn: string;
  /** Optional `jti` (JWT ID). Default: random UUID. */
  jti?: string;
}

/**
 * JwtSignerService — wrap `jose` SignJWT + jwtVerify with RS256 + kid header.
 *
 * Sign: embed `alg: RS256`, `kid: <keypair kid>`, `typ: JWT` di protected
 * header. Standard claims: iat, iss, aud, exp, jti (auto UUID jika tidak
 * di-supply). Verifier dapat pick key dari JWKS by `kid`.
 *
 * Verify: strict algorithms=['RS256'], audience + issuer match, clockTolerance
 * 5 detik (compensate skew antar server).
 */
@Injectable()
export class JwtSignerService {
  constructor(private readonly keyPair: KeyPairService) {}

  async sign(
    claims: Record<string, unknown>,
    options: SignOptions,
  ): Promise<string> {
    return await new SignJWT({ ...claims })
      .setProtectedHeader({
        alg: 'RS256',
        kid: this.keyPair.kid,
        typ: 'JWT',
      })
      .setIssuedAt()
      .setIssuer(options.issuer)
      .setAudience(options.audience)
      .setExpirationTime(options.expiresIn)
      .setJti(options.jti ?? crypto.randomUUID())
      .sign(this.keyPair.privateKey);
  }

  async verify(
    token: string,
    expectedAudience: string,
    expectedIssuer: string,
  ): Promise<JWTPayload> {
    const { payload } = await jwtVerify(token, this.keyPair.publicKey, {
      algorithms: ['RS256'],
      audience: expectedAudience,
      issuer: expectedIssuer,
      clockTolerance: 5,
    });
    return payload;
  }
}
