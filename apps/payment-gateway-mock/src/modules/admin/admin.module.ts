/**
 * AdminModule — wires AdminController + AdminService with shared MockState.
 */

import { Module } from '@nestjs/common';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';
import { SharedModule } from '../shared/shared.module';

@Module({
  imports: [SharedModule],
  providers: [AdminService],
  controllers: [AdminController],
})
export class AdminModule {}
