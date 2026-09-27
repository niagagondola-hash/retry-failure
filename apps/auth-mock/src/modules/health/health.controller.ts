/**
 * HealthController — `/health` endpoint for auth-mock (fixes TECHNICAL_DEBT #11).
 *
 * Plan reference: TECHNICAL_DEBT.md issue #11, CODING_STANDARDS.md §Error Handling.
 *
 * Returns service health status untuk monitoring (Docker healthcheck, k8s liveness probe).
 *
 * Response shape:
 *   { "status": "ok", "service": "auth-mock", "timestamp": "<ISO>" }
 *
 * Status code: 200 if healthy, 503 if unhealthy (no dependencies to check yet — always 200).
 */
import { Controller, Get } from '@nestjs/common';

@Controller()
export class HealthController {
  @Get('health')
  health() {
    return {
      status: 'ok',
      service: 'auth-mock',
      timestamp: new Date().toISOString(),
    };
  }
}
