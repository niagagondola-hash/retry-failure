/**
 * InternalModule — wires internal endpoints (AUTH-05).
 *
 * Plan reference: AUTH-05 task spec §5.
 *
 * Provides:
 *   - /api/v1/me/permissions (InternalController, guarded)
 *   - /api/v1/auth/switch-role (InternalController, guarded)
 *   - /dev/token (DevController, no guard — NODE_ENV check only)
 */
import { Module } from '@nestjs/common';

import { KeyPairModule } from '../keypair/keypair.module';
import { UserModule } from '../user/user.module';

import { BearerAuthGuard } from './bearer-auth.guard';
import { DevController } from './dev.controller';
import { InternalController } from './internal.controller';
import { InternalService } from './internal.service';

@Module({
  imports: [KeyPairModule, UserModule],
  providers: [InternalService, BearerAuthGuard],
  controllers: [InternalController, DevController],
})
export class InternalModule {}
