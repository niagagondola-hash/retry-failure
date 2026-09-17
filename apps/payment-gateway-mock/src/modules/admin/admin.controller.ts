/**
 * AdminController - runtime config + stats endpoints (plan section 8.1).
 *
 *   GET  /admin/config - return current MockConfig.
 *   PUT  /admin/config - merge partial config, return new config.
 *   GET  /admin/stats  - return aggregate counters + idempotency store size.
 *   POST /admin/reset   - reset all counters + idempotency store (config kept).
 *
 * The reset endpoint is not in the spec but is convenient for demo clean-up
 * between scenarios.
 */

import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Put,
} from '@nestjs/common';
import { AdminService } from './admin.service';
import { UpdateMockConfigDto } from './dto/mock-config.dto';

@Controller('admin')
export class AdminController {
  constructor(private readonly adminService: AdminService) {}

  @Get('config')
  getConfig() {
    return this.adminService.getConfig();
  }

  @Put('config')
  @HttpCode(HttpStatus.OK)
  updateConfig(@Body() body: UpdateMockConfigDto) {
    return this.adminService.updateConfig(body);
  }

  @Get('stats')
  getStats() {
    return this.adminService.getStats();
  }

  @Post('reset')
  @HttpCode(HttpStatus.OK)
  reset() {
    return this.adminService.reset();
  }
}
