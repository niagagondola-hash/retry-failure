/**
 * SwitchRoleDto — body for POST /auth/switch-role (AUTH-17).
 *
 * Plan reference: PLAN2 Section 5.6, AUTH-17 task spec §4.
 */
import { IsString, IsNotEmpty } from 'class-validator';

export class SwitchRoleDto {
  /** Target role UUID — must belong to the authenticated user. */
  @IsString()
  @IsNotEmpty()
  roleId!: string;
}
