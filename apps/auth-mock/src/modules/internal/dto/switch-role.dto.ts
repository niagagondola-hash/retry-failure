/**
 * SwitchRoleDto — body for POST /api/v1/auth/switch-role (AUTH-05).
 *
 * Plan reference: AUTH-05 task spec §1, PLAN2 §5.6.
 */
import { IsString, IsNotEmpty } from 'class-validator';

export class SwitchRoleDto {
  /** Target role UUID — must belong to the authenticated user. */
  @IsString()
  @IsNotEmpty()
  roleId!: string;
}
