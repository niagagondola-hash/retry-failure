/**
 * ChargesController — POST /v1/charges.
 *
 * Uses `@Res({ passthrough: true })` so we can set custom HTTP status + headers
 * (Retry-After for 429) while letting NestJS serialize the returned body.
 *
 * Idempotency-Key header is optional at the HTTP level — service auto-generates
 * a random UUID when absent. (For proper replay semantics, clients should
 * always send a stable key.)
 */

import {
  Body,
  Controller,
  Headers,
  Post,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import { ChargesService, ChargeOutcome } from './charges.service';
import { ChargeRequestDto } from './dto/charge-request.dto';

@Controller('v1/charges')
export class ChargesController {
  constructor(private readonly chargesService: ChargesService) {}

  @Post()
  async charge(
    @Headers('idempotency-key') key: string | undefined,
    @Body() body: ChargeRequestDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<unknown> {
    const outcome: ChargeOutcome = await this.chargesService.charge(key, body);

    // Apply optional headers (e.g. Retry-After for 429).
    if (outcome.headers) {
      for (const [h, v] of Object.entries(outcome.headers)) {
        res.set(h, v);
      }
    }
    res.status(outcome.status);
    return outcome.body;
  }
}
