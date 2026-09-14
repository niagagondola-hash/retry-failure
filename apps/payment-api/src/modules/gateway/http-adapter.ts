import { Injectable, Optional } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';
import type { AxiosError, AxiosResponse } from 'axios';
import { parseRetryAfter } from '@retry-failure/resilience';
import { MetricsService } from '../observability/metrics.service';
import type { PaymentGatewayPort } from './port';
import type { ChargeRequest, ChargeResult } from './types';
import { deriveIdempotencyKey } from './idempotency-key';

@Injectable()
export class HttpPaymentGateway implements PaymentGatewayPort {
  private readonly baseUrl: string;

  constructor(
    private readonly http: HttpService,
    configService: ConfigService,
    @Optional() private readonly metrics?: MetricsService,
  ) {
    this.baseUrl = configService.get<string>('GATEWAY_URL') ?? 'http://localhost:3002';
  }

  async charge(req: ChargeRequest): Promise<ChargeResult> {
    const idempotencyKey = deriveIdempotencyKey(req.paymentId);
    const url = `${this.baseUrl}/v1/charges`;
    const start = performance.now();

    try {
      const response: AxiosResponse = await firstValueFrom(
        this.http.post(
          url,
          {
            amount: Number(req.amount),
            currency: req.currency,
            order_id: req.orderId,
          },
          {
            headers: {
              'Content-Type': 'application/json',
              'Idempotency-Key': idempotencyKey,
            },
          },
        ),
      );

      const duration = performance.now() - start;
      this.metrics?.observeGatewayDuration(duration);

      const result = this.mapSuccess(response);
      this.metrics?.incGatewayRequest('success', result.httpStatus ?? 200);
      if (result.replayed) {
        this.metrics?.incReplay();
      }
      return result;
    } catch (err) {
      const duration = performance.now() - start;
      this.metrics?.observeGatewayDuration(duration);

      const result = this.mapError(err as AxiosError);
      const httpStatus = result.httpStatus ?? (result.errorCode === 'ETIMEDOUT' ? 'timeout' : 'network_error');
      this.metrics?.incGatewayRequest('failure', httpStatus);
      return result;
    }
  }

  private mapSuccess(response: AxiosResponse): ChargeResult {
    const status = response.status;
    const body = (response.data ?? {}) as Record<string, unknown>;

    if (status >= 200 && status < 300) {
      return {
        status: 'succeeded',
        httpStatus: status,
        gatewayReference:
          typeof body.gateway_reference === 'string' ? body.gateway_reference : undefined,
        replayed: body.replayed === true,
      };
    }

    return {
      status: 'failed',
      httpStatus: status,
      replayed: false,
      errorCode: typeof body.error_code === 'string' ? body.error_code : undefined,
      errorMessage: typeof body.message === 'string' ? body.message : `unexpected status ${status}`,
      retryAfterMs: parseRetryAfterHeader(response.headers?.['retry-after']),
    };
  }

  private mapError(err: AxiosError): ChargeResult {
    if (err.response) {
      const status = err.response.status;
      const body = (err.response.data ?? {}) as Record<string, unknown>;
      return {
        status: 'failed',
        httpStatus: status,
        replayed: body.replayed === true,
        errorCode: typeof body.error_code === 'string' ? body.error_code : undefined,
        errorMessage: typeof body.message === 'string' ? body.message : err.message,
        retryAfterMs: parseRetryAfterHeader(err.response.headers?.['retry-after']),
      };
    }

    return {
      status: 'failed',
      replayed: false,
      errorCode: err.code ?? 'network_error',
      errorMessage: err.message,
    };
  }
}

function parseRetryAfterHeader(value: unknown): number | undefined {
  if (typeof value !== 'string' && typeof value !== 'number') return undefined;
  const ms = parseRetryAfter(String(value));
  return ms ?? undefined;
}
