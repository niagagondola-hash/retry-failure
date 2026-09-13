import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import type { AttemptView } from '../audit/audit-port';
import type { PaymentStatus } from '../../../database/entities/enums';

export class PaymentResponseDto {
  @ApiProperty({ example: '550e8400-e29b-41d4-a716-446655440000' })
  id!: string;

  @ApiProperty({ example: 'ORD-12345' })
  orderId!: string;

  @ApiProperty({ example: 150000.0 })
  amount!: number;

  @ApiProperty({ example: 'IDR' })
  currency!: string;

  @ApiProperty({ enum: ['processing', 'succeeded', 'failed', 'scheduled_for_retry'] })
  status!: PaymentStatus;

  @ApiPropertyOptional({ example: 'GW-REF-98765', nullable: true })
  gatewayReference?: string | null;

  @ApiProperty({ example: 3 })
  attemptCount!: number;

  @ApiProperty({ example: 1 })
  totalRetryCount!: number;

  @ApiPropertyOptional({ example: '2025-01-15T10:30:00.000Z', nullable: true })
  nextRetryAt?: Date | null;

  @ApiPropertyOptional({ example: 'max_total_retries_exceeded', nullable: true })
  failureReason?: string | null;

  @ApiProperty({ example: '2025-01-15T10:25:00.000Z' })
  createdAt!: Date;

  @ApiProperty({ example: '2025-01-15T10:25:05.000Z' })
  updatedAt!: Date;
}

export class PaymentDetailResponseDto {
  @ApiProperty({ type: () => PaymentResponseDto })
  payment!: PaymentResponseDto;

  @ApiProperty({ type: 'array', description: 'Attempt history urut attemptNumber ASC.' })
  attempts!: AttemptView[];
}

export class ListPaymentsResponseDto {
  @ApiProperty({ type: () => PaymentResponseDto, isArray: true })
  payments!: PaymentResponseDto[];

  @ApiProperty({ example: 50 })
  limit!: number;

  @ApiProperty({ example: 0 })
  offset!: number;
}

export class CreatePaymentResponseDto {
  @ApiProperty({ type: () => PaymentResponseDto })
  payment!: PaymentResponseDto;
}

export class RetryPaymentResponseDto {
  @ApiProperty({ type: () => PaymentResponseDto })
  payment!: PaymentResponseDto;
}
