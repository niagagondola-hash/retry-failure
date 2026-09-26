/**
 * BearerAuthGuard — verify Bearer JWT (AUTH-05).
 *
 * Plan reference: PLAN2 Section 5.2, Section 10.6, AUTH-05 task spec §1.
 *
 * Extracts `Authorization: Bearer <token>` header, verifies via
 * `JwtSignerService.verify()` (local public key, faster than JWKS fetch).
 *
 * On success attaches `req.user = JWTPayload` ({ sub, username, roleId, ... }).
 * On failure throws UnauthorizedException (401).
 *
 * NOT a global guard — applied per-controller via `@UseGuards(BearerAuthGuard)`.
 */
import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request } from 'express';
import { JWTPayload } from 'jose';

import { JwtSignerService } from '../keypair/jwt-signer.service';

/** Metadata key for @Public() decorator — routes that skip Bearer auth. */
export const IS_PUBLIC_KEY = 'isPublic';

@Injectable()
export class BearerAuthGuard implements CanActivate {
  constructor(
    private readonly jwtSigner: JwtSignerService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    // Allow @Public() routes to skip auth (future-proofing for /dev/token
    // if it were ever guarded).
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (isPublic) return true;

    const req = ctx.switchToHttp().getRequest<Request & { user?: JWTPayload }>();
    const auth = (req.headers['authorization'] ?? '') as string;
    const match = /^Bearer\s+(.+)$/i.exec(auth);
    if (!match) {
      throw new UnauthorizedException('Missing Bearer token');
    }

    try {
      const payload = await this.jwtSigner.verify(
        match[1],
        process.env.JWT_AUDIENCE ?? 'payment-api',
        process.env.AUTH_ISSUER ?? 'http://localhost:4001',
      );
      req.user = payload; // { sub, username, roleId, iss, aud, exp, iat, jti, ... }
      return true;
    } catch {
      throw new UnauthorizedException('Invalid or expired token');
    }
  }
}
