/**
 * HealthModule — wires HealthController (TECHNICAL_DEBT #11 fix).
 *
 * Plan reference: TECHNICAL_DEBT.md issue #11.
 */
import { Module } from '@nestjs/common';

import { HealthController } from './health.controller';

@Module({
  controllers: [HealthController],
})
export class HealthModule {}
