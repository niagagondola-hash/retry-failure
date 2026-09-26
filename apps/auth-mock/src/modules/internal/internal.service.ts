/**
 * InternalService — business logic for /api/v1/me/permissions + /auth/switch-role (AUTH-05).
 *
 * Plan reference: PLAN2 Section 10.6 (response shape), Section 5.2 (JWT claims),
 * Section 5.6 (switch-role flow), AUTH-05 task spec §3.
 *
 * `getPermissions(jwt)` returns user + active role + permissionCodes per plan2 §10.6.
 * `switchRole(jwt, roleId)` issues new access + refresh JWTs with the new roleId.
 *
 * Response envelope per AUTH_CONTRACT.md §6: `{ success: true, data: {...} }`.
 */
import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { JWTPayload } from 'jose';

import { JwtSignerService } from '../keypair/jwt-signer.service';
import { TokenFactory } from '../keypair/token-factory';
import { MockUser, UserService } from '../user/user.service';

@Injectable()
export class InternalService {
  constructor(
    private readonly users: UserService,
    private readonly jwtSigner: JwtSignerService,
    private readonly tokenFactory: TokenFactory,
  ) {}

  /**
   * Get user + active role + permissionCodes per plan2 §10.6.
   * Active role comes from JWT `roleId` claim.
   */
  async getPermissions(jwt: JWTPayload): Promise<{
    user: ReturnType<InternalService['toUserDto']>;
    role: { id: string; name: string };
    permissionCodes: string[];
  }> {
    const user = await this.users.findById(jwt.sub!);
    if (!user) {
      throw new NotFoundException('User not found');
    }
    const role = user.roles.find((r) => r.id === jwt.roleId);
    if (!role) {
      throw new BadRequestException(
        'Active role no longer assigned to user',
      );
    }
    return {
      user: this.toUserDto(user),
      role: { id: role.id, name: role.name },
      permissionCodes: role.permissionCodes,
    };
  }

  /**
   * Switch active role for the authenticated user. Issues new access (15m)
   * + refresh (8h) JWTs with the new roleId (plan2 §5.6).
   *
   * Uses TokenFactory for signing (DRY refactor per CODING_STANDARDS.md §DRY).
   * No persistence to TokenStore — switch-role tokens are NOT tracked for
   * reuse detection (only OAuth2-issued tokens are).
   */
  async switchRole(
    jwt: JWTPayload,
    newRoleId: string,
  ): Promise<{
    accessToken: string;
    refreshToken: string;
    role: { id: string; name: string };
  }> {
    const user = await this.users.findById(jwt.sub!);
    if (!user) {
      throw new NotFoundException('User not found');
    }
    const role = user.roles.find((r) => r.id === newRoleId);
    if (!role) {
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
    };
  }

  private toUserDto(u: MockUser) {
    return {
      id: u.id,
      username: u.username,
      email: u.email,
      name: u.name,
      isSuperAdmin: u.isSuperAdmin,
    };
  }
}
