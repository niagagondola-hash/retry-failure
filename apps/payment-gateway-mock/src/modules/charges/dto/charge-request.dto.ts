/**
 * Request DTO for POST /v1/charges.
 *
 * class-validator decorators drive the global ValidationPipe (whitelist +
 * transform) configured in main.ts. Unknown fields are stripped.
 *
 * Field names follow the gateway's external JSON convention (snake_case),
 * matching the plan's `order_id` reference in section 9.
 */

import {
  IsNumber,
  IsOptional,
  IsString,
  Min,
  Matches,
} from 'class-validator';

export class ChargeRequestDto {
  /** Amount in minor units (e.g. cents). Must be positive. */
  @IsNumber()
  @Min(1)
  amount!: number;

  /** ISO 4217 currency code (3 uppercase letters). */
  @IsString()
  @Matches(/^[A-Z]{3}$/)
  currency!: string;

  /** Optional merchant order id — echoed back for traceability. */
  @IsOptional()
  @IsString()
  order_id?: string;
}
