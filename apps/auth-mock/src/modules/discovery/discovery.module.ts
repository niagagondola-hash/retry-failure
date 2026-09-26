/**
 * DiscoveryModule — wires DiscoveryController + DiscoveryService (AUTH-07).
 *
 * Plan reference: AUTH-07 task spec §4.
 */
import { Module } from '@nestjs/common';

import { DiscoveryController } from './discovery.controller';
import { DiscoveryService } from './discovery.service';

@Module({
  providers: [DiscoveryService],
  controllers: [DiscoveryController],
})
export class DiscoveryModule {}
