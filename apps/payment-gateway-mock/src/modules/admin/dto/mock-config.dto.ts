/**
 * DTO for PUT /admin/config.
 *
 * All fields optional — caller can update a subset. class-validator enforces
 * value ranges; class-transformer coerces JSON values to the right types
 * (e.g. "2" -> 2) when `transform: true` is set on the global ValidationPipe.
 */

import {
  IsIn,
  IsNumber,
  IsOptional,
  Max,
  Min,
} from 'class-validator';
import { FAILURE_MODES, type FailureMode } from '../../../shared/state/mock-state';

export class UpdateMockConfigDto {
  /** Active failure mode (must be one of 8 supported values). */
  @IsOptional()
  @IsIn(FAILURE_MODES)
  mode?: FailureMode;

  /** For `fail-first-n`: number of failed attempts before success. >= 0. */
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(1000)
  n?: number;

  /** For `random`: success probability, 0..1 inclusive. */
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(1)
  probability?: number;

  /** For `rate-limited`: Retry-After value in seconds. >= 0. */
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(86400)
  retryAfterSeconds?: number;

  /** For `always-timeout`: delay before response (ms). >= 0. */
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(60000)
  timeoutMs?: number;
}
