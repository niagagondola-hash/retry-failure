import { describe, it, expect, jest } from '@jest/globals';
import { of, throwError } from 'rxjs';
import { HttpPaymentGateway } from '../../../src/modules/gateway/http-adapter';
import type { ChargeRequest } from '../../../src/modules/gateway/types';
import type { AxiosResponse } from 'axios';

function mockHttpService() {
  return { post: jest.fn() } as unknown as { post: ReturnType<typeof jest.fn> };
}

function mockConfigService(baseUrl: string = 'http://localhost:3002') {
  return {
    get: jest.fn((key: string) => (key === 'GATEWAY_URL' ? baseUrl : undefined)),
  } as unknown as { get: ReturnType<typeof jest.fn> };
}

const SAMPLE_REQ: ChargeRequest = {
  paymentId: 'pay-001',
  orderId: 'ORD-001',
  amount: '100.00',
  currency: 'IDR',
};

function makeResponse(status: number, data: unknown, headers: Record<string, string> = {}): Partial<AxiosResponse> {
  return { status, data, headers, statusText: '', config: {} as never };
}

describe('HttpPaymentGateway - success path', () => {
  it('maps 200 with gateway_reference + replayed=false', async () => {
    const http = mockHttpService();
    const gw = new HttpPaymentGateway(http as never, mockConfigService() as never);
    http.post.mockReturnValue(of(makeResponse(200, {
      status: 'succeeded', gateway_reference: 'gw-ref-123', replayed: false,
    })));

    const result = await gw.charge(SAMPLE_REQ);
    expect(result.status).toBe('succeeded');
    expect(result.httpStatus).toBe(200);
    expect(result.gatewayReference).toBe('gw-ref-123');
    expect(result.replayed).toBe(false);
  });

  it('maps 200 replay (replayed=true)', async () => {
    const http = mockHttpService();
    const gw = new HttpPaymentGateway(http as never, mockConfigService() as never);
    http.post.mockReturnValue(of(makeResponse(200, {
      status: 'succeeded', gateway_reference: 'gw-ref-existing', replayed: true,
    })));

    const result = await gw.charge(SAMPLE_REQ);
    expect(result.replayed).toBe(true);
  });
});

describe('HttpPaymentGateway - HTTP error (axios error with response)', () => {
  it('maps 400 client-error with error_code', async () => {
    const http = mockHttpService();
    const gw = new HttpPaymentGateway(http as never, mockConfigService() as never);
    const axiosErr = {
      isAxiosError: true,
      response: makeResponse(400, { error_code: 'invalid_card', message: 'Card number invalid' }),
      message: 'Request failed with status code 400',
      code: 'ERR_BAD_REQUEST',
    };
    http.post.mockReturnValue(throwError(() => axiosErr));

    const result = await gw.charge(SAMPLE_REQ);
    expect(result.status).toBe('failed');
    expect(result.httpStatus).toBe(400);
    expect(result.errorCode).toBe('invalid_card');
  });

  it('maps 429 rate-limited with Retry-After header -> retryAfterMs', async () => {
    const http = mockHttpService();
    const gw = new HttpPaymentGateway(http as never, mockConfigService() as never);
    const axiosErr = {
      isAxiosError: true,
      response: makeResponse(429, { message: 'rate limited' }, { 'retry-after': '10' }),
      message: 'Request failed with status code 429',
      code: 'ERR_TOO_MANY_REQUESTS',
    };
    http.post.mockReturnValue(throwError(() => axiosErr));

    const result = await gw.charge(SAMPLE_REQ);
    expect(result.httpStatus).toBe(429);
    expect(result.retryAfterMs).toBe(10000);
  });

  it('maps 500 server error', async () => {
    const http = mockHttpService();
    const gw = new HttpPaymentGateway(http as never, mockConfigService() as never);
    const axiosErr = {
      isAxiosError: true,
      response: makeResponse(500, { message: 'internal server error' }),
      message: 'Request failed with status code 500',
      code: 'ERR_BAD_RESPONSE',
    };
    http.post.mockReturnValue(throwError(() => axiosErr));

    const result = await gw.charge(SAMPLE_REQ);
    expect(result.httpStatus).toBe(500);
    expect(result.errorMessage).toBe('internal server error');
  });
});

describe('HttpPaymentGateway - network error (no response)', () => {
  it('maps ECONNREFUSED without httpStatus', async () => {
    const http = mockHttpService();
    const gw = new HttpPaymentGateway(http as never, mockConfigService() as never);
    const axiosErr = {
      isAxiosError: true,
      message: 'connect ECONNREFUSED 127.0.0.1:3002',
      code: 'ECONNREFUSED',
    };
    http.post.mockReturnValue(throwError(() => axiosErr));

    const result = await gw.charge(SAMPLE_REQ);
    expect(result.status).toBe('failed');
    expect(result.httpStatus).toBeUndefined();
    expect(result.errorCode).toBe('ECONNREFUSED');
  });

  it('maps ETIMEDOUT without httpStatus', async () => {
    const http = mockHttpService();
    const gw = new HttpPaymentGateway(http as never, mockConfigService() as never);
    const axiosErr = {
      isAxiosError: true,
      message: 'timeout of 2000ms exceeded',
      code: 'ETIMEDOUT',
    };
    http.post.mockReturnValue(throwError(() => axiosErr));

    const result = await gw.charge(SAMPLE_REQ);
    expect(result.errorCode).toBe('ETIMEDOUT');
  });
});

describe('HttpPaymentGateway - sends correct headers', () => {
  it('sends Idempotency-Key derived from paymentId', async () => {
    const http = mockHttpService();
    const gw = new HttpPaymentGateway(http as never, mockConfigService() as never);
    http.post.mockReturnValue(of(makeResponse(200, { gateway_reference: 'ref', replayed: false })));

    await gw.charge(SAMPLE_REQ);
    expect(http.post).toHaveBeenCalledWith(
      'http://localhost:3002/v1/charges',
      { amount: 100, currency: 'IDR', order_id: 'ORD-001' },
      {
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': 'pay-001',
        },
      },
    );
  });
});
