import type { ChargeRequest, ChargeResult, OnAttemptCallback } from './types';

export const PAYMENT_GATEWAY_PORT = Symbol('PAYMENT_GATEWAY_PORT');

export interface PaymentGatewayPort {
  charge(req: ChargeRequest): Promise<ChargeResult>;
}

export interface AttemptObservable {
  setOnAttempt(cb: OnAttemptCallback): void;
}
