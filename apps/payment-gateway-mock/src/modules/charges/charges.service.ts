/**
 * ChargesService - orchestrates idempotency, mode application, stats + metrics.
 *
 * Flow (plan section 9 + TASK-03 spec):
 *   1. requestCount++
 *   2. If key in idempotency store -> replayCount++, return stored result with `replayed: true`.
 *   3. Apply mode via mode-handler.
 *   4. If `delayMs` (always-timeout) -> await sleep(delayMs).
 *   5. If `chargeCaptured` -> save to idempotency store, actualChargesCount++,
 *      enrich response body with request echo.
 *   6. Increment successCount or failureCount based on HTTP status.
 *   7. If `shouldDropResponse` -> await sleep(10s) then throw
 *      ServiceUnavailableException (client has already timed out).
 *   8. Return ChargeOutcome - controller maps to res.status().json().
 */

import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { MockState } from '../../shared/state/mock-state';
import { IdempotencyStore, ChargeResult } from '../../shared/idempotency/idempotency-store';
import { applyMode } from '../../shared/modes';
import { ChargeRequestDto } from './dto/charge-request.dto';
import { MetricsService } from '../metrics/metrics.service';

export interface ChargeOutcome {
  status: number;
  body: unknown;
  headers?: Record<string, string>;
}

/** Sleep helper - promisified setTimeout. */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

@Injectable()
export class ChargesService {
  private readonly logger = new Logger(ChargesService.name);

  constructor(
    private readonly state: MockState,
    private readonly idempotencyStore: IdempotencyStore,
    private readonly metrics: MetricsService,
  ) {}

  async charge(rawKey: string | undefined, body: ChargeRequestDto): Promise<ChargeOutcome> {
    const key = rawKey && rawKey.trim().length > 0 ? rawKey : randomUUID();

    // Step 1: increment request counter (every incoming request, incl. replays).
    this.state.requestCount++;

    // Step 2: replay check - replays short-circuit before mode handler.
    const existing = this.idempotencyStore.get(key);
    if (existing) {
      this.state.replayCount++;
      this.metrics.incrementReplays();
      this.logger.log(`replay key=${key} ref=${existing.gatewayReference}`);
      const outcome: ChargeOutcome = {
        status: 200,
        body: {
          status: 'succeeded' as const,
          gateway_reference: existing.gatewayReference,
          replayed: true,
          amount: existing.amount,
          currency: existing.currency,
          order_id: existing.orderId,
        },
      };
      this.metrics.incrementRequests('success', 200);
      return outcome;
    }

    // Step 3: apply mode.
    const result = applyMode(this.state.config.mode, {
      idempotencyKey: key,
      state: this.state,
    });

    // Step 4: delay (always-timeout mode). Client's GATEWAY_TIMEOUT_MS=2000
    // will fire before we return 503 - but we still record the outcome.
    if (result.delayMs && result.delayMs > 0) {
      this.logger.warn(`delaying ${result.delayMs}ms key=${key} (always-timeout mode)`);
      await sleep(result.delayMs);
    }

    // Step 5: persist captured charge to idempotency store (success + drop-response).
    if (result.chargeCaptured) {
      const successBody = result.body as { gateway_reference: string };
      const record: ChargeResult = {
        gatewayReference: successBody.gateway_reference,
        capturedAt: new Date().toISOString(),
        amount: body.amount,
        currency: body.currency,
        orderId: body.order_id,
      };
      this.idempotencyStore.set(key, record);
      this.state.actualChargesCount++;
      this.metrics.incrementActualCharges();

      // Enrich response body with request echo (for client traceability).
      const enriched = result.body as Record<string, unknown>;
      enriched.amount = body.amount;
      enriched.currency = body.currency;
      if (body.order_id !== undefined) {
        enriched.order_id = body.order_id;
      }
    }

    // Step 6: aggregate success/failure counters (2xx = success, others = failure).
    const isSuccess = result.status >= 200 && result.status < 300;
    if (isSuccess) {
      this.state.successCount++;
    } else {
      this.state.failureCount++;
    }
    this.metrics.incrementRequests(isSuccess ? 'success' : 'failure', result.status);

    // Step 7: drop-response - charge already captured, now hang long enough
    // for the client to time out, then throw so NestJS closes the socket.
    if (result.shouldDropResponse) {
      this.logger.warn(
        `dropping response key=${key} (charge already captured) - hanging 10s`,
      );
      await sleep(10_000);
      throw new ServiceUnavailableException('response dropped (simulated)');
    }

    // Step 8: return outcome; controller maps to res.status().json().
    return {
      status: result.status,
      body: result.body,
      headers: result.headers,
    };
  }
}
