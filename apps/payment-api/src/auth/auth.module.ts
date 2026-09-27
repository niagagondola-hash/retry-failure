/**
 * AuthModule — wires AuthController + AuthService + SecurityModule (AUTH-17).
 *
 * Plan reference: PLAN2 Section 4.2 (BFF), Section 9 (packages/security),
 * AUTH-17 task spec §5.
 *
 * Imports SecurityModule.forRoot(buildSecurityOptions()) — this brings in:
 *   - SessionService + CacheRepository (from AUTH-12)
 *   - SessionGuard + MenuAccessGuard (from AUTH-13)
 *   - LazySyncMiddleware + AuthSyncService + SyncLockService (from AUTH-14)
 *   - CsrfMiddleware + HelmetMiddleware (from AUTH-15)
 *   - OAuthClientService + JwtVerifier (from AUTH-09 + AUTH-10)
 *   - TypeOrmModule.forFeature([CachedUser]) for cache table
 *
 * Exports AuthService + SecurityModule so other modules can use them.
 */
import { Module } from '@nestjs/common';

import { SecurityModule } from '@retry-failure/security';

import { buildSecurityOptions } from '../config/security.config';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';

@Module({
  imports: [SecurityModule.forRoot(buildSecurityOptions())],
  controllers: [AuthController],
  providers: [AuthService],
  exports: [AuthService, SecurityModule],
})
export class AuthModule {}
