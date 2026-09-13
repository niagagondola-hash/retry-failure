/**
 * Response shapes returned by POST /v1/charges.
 *
 * These are documentation only — NestJS will JSON-serialize whatever the
 * controller returns. Keeping them as interfaces (not classes) avoids
 * class-transformer plainToClass ceremony for responses.
 */

export interface ChargeSuccessResponse {
  status: 'succeeded';
  gateway_reference: string;
  replayed: boolean;
  amount?: number;
  currency?: string;
  order_id?: string;
}

export interface ChargeFailureResponse {
  status: 'failed';
  error_code: string;
  message: string;
  attempt?: number;
  required?: number;
}
