/**
 * Derive Idempotency-Key dari payment ID.
 * Plan section 9: key = payment.id as-is (no hash).
 */
export function deriveIdempotencyKey(paymentId: string): string {
  if (!paymentId || paymentId.trim() === '') {
    throw new Error('paymentId is required to derive Idempotency-Key');
  }
  return paymentId;
}
