import { Controller, Get } from '@nestjs/common';

@Controller()
export class OAuthController {
  @Get('health')
  health() {
    return { status: 'ok', service: 'auth-mock', version: '0.1.0' };
  }
}
