/**
 * DevController — POST /dev/token (AUTH-05).
 *
 * Plan reference: PLAN2 Section 9.3.2, AUTH-05 task spec §4,
 * CODING_STANDARDS.md §Error Handling.
 *
 * Dev shortcut to get JWT tokens without OAuth2 flow. Useful for payment-api
 * dev — skip /oauth/authorize + /oauth/token dance, just POST username.
 *
 * Hard rejection if NODE_ENV=production (plan2 §9.3.2 mandatory).
 *
 * Status codes (per CODING_STANDARDS.md §Error Handling):
 *   - 200 OK: tokens issued
 *   - 400 Bad Request: role not assigned to user (input validation error)
 *   - 403 Forbidden: NODE_ENV=production OR user not found (dev-only endpoint,
 *     we don't reveal user existence — return 403 instead of 404)
 *   - 422 Unprocessable: (not used here, but documented for future)
 *
 * Body: { username, roleId? }
 *   - `roleId` optional — if omitted, uses first role on the user
 *     (e.g. budi_santoso defaults to HRD per AUTH-06 fixtures).
 *
 * Uses TokenFactory for JWT signing (DRY refactor per CODING_STANDARDS.md §DRY).
 *
 * No BearerAuthGuard — only NODE_ENV check.
 */
import {
  Body,
  Controller,
  ForbiddenException,
  HttpCode,
  BadRequestException,
  Post,
} from '@nestjs/common';

import { TokenFactory } from '../keypair/token-factory';
import { UserService } from '../user/user.service';

import { DevTokenDto } from './dto/dev-token.dto';

@Controller('dev')
export class DevController {
  constructor(
    private readonly users: UserService,
    private readonly tokenFactory: TokenFactory,
  ) {}

  /**
   * POST /dev/token — issue access + refresh JWTs for a fixture user.
   *
   * Returns 200 OK (not 201 Created) per OAuth2 token endpoint convention —
   * we're issuing tokens, not creating a resource.
   *
   * Status codes:
   *   - 200: tokens issued
   *   - 400: role not assigned to user (input validation error)
   *   - 403: NODE_ENV=production OR user not found
   *         (dev-only endpoint, hide user existence — return 403 for both)
   */
  @Post('token')
  @HttpCode(200)
  async devToken(@Body() dto: DevTokenDto) {
    if (process.env.NODE_ENV === 'production') {
      throw new ForbiddenException('/dev/token disabled in production');
    }
    const user = await this.users.findByUsername(dto.username);
    if (!user) {
      // Dev-only endpoint: don't reveal whether user exists.
      // Return 403 (Forbidden) instead of 404 (Not Found) to hide user list.
      throw new ForbiddenException('User not found');
    }

    const role = dto.roleId
      ? user.roles.find((r) => r.id === dto.roleId)
      : user.roles[0];
    if (!role) {
      // Role not assigned to user = input validation error (400, not 403)
      throw new BadRequestException('Role not assigned to this user');
    }

    const pair = await this.tokenFactory.issuePair(
      user,
      role.id,
      'payment-api',
    );

    return {
      accessToken: pair.accessToken,
      refreshToken: pair.refreshToken,
      role: { id: role.id, name: role.name },
      user: {
        id: user.id,
        username: user.username,
        name: user.name,
        isSuperAdmin: user.isSuperAdmin,
      },
    };
  }
}
