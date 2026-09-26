/**
 * DevTokenDto — body for POST /dev/token (AUTH-05).
 *
 * Plan reference: AUTH-05 task spec §4, PLAN2 §9.3.2.
 *
 * `roleId` optional — if omitted, picks first role on the user (e.g. budi
 * defaults to HRD per AUTH-06 fixtures).
 */
import { IsString, IsNotEmpty, IsOptional } from 'class-validator';

export class DevTokenDto {
  /** Fixture username (e.g. "superadmin", "budi_santoso"). */
  @IsString()
  @IsNotEmpty()
  username!: string;

  /** Optional role UUID — if omitted, uses first role on the user. */
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  roleId?: string;
}
