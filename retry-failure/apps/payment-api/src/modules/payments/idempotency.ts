export { deriveIdempotencyKey } from '../gateway/idempotency-key';

export function assertInvariant(actualCharges: number, _httpCalls: number): boolean {
  return actualCharges <= 1;
}
