/**
 * InternalController — /api/v1/me/permissions + /api/v1/auth/switch-role (AUTH-05).
 *
 * Plan reference: PLAN2 Section 10.6, Section 5.6, AUTH-05 task spec §2.
 *
 * Guarded by BearerAuthGuard (JWT verified via local KeyPairService).
 * Called by payment-api (BFF) to:
 *   - Get permission data for lazy sync (plan2 §8 — SWR cache).
 *   - Switch active role + issue new JWT pair (plan2 §5.6).
 *
 * Response envelope: `{ success: true, data: {...} }` per AUTH_CONTRACT §6.
 */
import {
  Body,
  Controller,
  Get,
  HttpCode,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Request } from 'express';
import { JWTPayload } from 'jose';

import { BearerAuthGuard } from './bearer-auth.guard';
import { SwitchRoleDto } from './dto/switch-role.dto';
import { InternalService } from './internal.service';

@Controller('api/v1')
@UseGuards(BearerAuthGuard)
export class InternalController {
  constructor(private readonly internal: InternalService) {}

  /**
   * GET /api/v1/me/permissions — return user + active role + permissionCodes.
   *
   * Response shape per plan2 §10.6:
   * { success: true, data: { user, role, permissionCodes } }
   */
  @Get('me/permissions')
  async mePermissions(@Req() req: Request & { user?: JWTPayload }) {
    const data = await this.internal.getPermissions(req.user!);
    return { success: true, data };
  }

  /**
   * POST /api/v1/auth/switch-role — switch active role, issue new JWT pair.
   * Body: { roleId: "<uuid>" }
   *
   * Returns 200 OK (not 201 Created) per OAuth2 token endpoint convention —
   * we're issuing tokens, not creating a resource.
   *
   * Response: { success: true, data: { accessToken, refreshToken, role } }
   */
  @Post('auth/switch-role')
  @HttpCode(200)
  async switchRole(
    @Req() req: Request & { user?: JWTPayload },
    @Body() dto: SwitchRoleDto,
  ) {
    const data = await this.internal.switchRole(req.user!, dto.roleId);
    return { success: true, data };
  }
}
