import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  ConflictException,
} from '@nestjs/common';
import { ApiOperation, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import { PaymentsService } from './payments.service';
import type { PaymentView } from './payments.service';
import { CreatePaymentDto } from './dto/create-payment.dto';
import { ListPaymentsQueryDto } from './dto/list-payments-query.dto';
import type {
  CreatePaymentResponseDto,
  ListPaymentsResponseDto,
  PaymentDetailResponseDto,
  PaymentResponseDto,
  RetryPaymentResponseDto,
} from './dto/payment-response.dto';
import { InvalidTransitionError } from './state-machine';

@ApiTags('payments')
@Controller('payments')
export class PaymentsController {
  constructor(private readonly payments: PaymentsService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create + process payment (sync)' })
  @ApiResponse({ status: 201, description: 'Payment created + executed' })
  @ApiResponse({ status: 400, description: 'Validation error' })
  async create(@Body() dto: CreatePaymentDto): Promise<CreatePaymentResponseDto> {
    const payment = await this.payments.createPayment(dto);
    return { payment: this.toResponse(payment) };
  }

  @Get()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'List payments (optional filter by status)' })
  @ApiQuery({ name: 'status', required: false, enum: ['processing', 'succeeded', 'failed', 'scheduled_for_retry'] })
  @ApiResponse({ status: 200, description: 'List of payments' })
  async list(@Query() query: ListPaymentsQueryDto): Promise<ListPaymentsResponseDto> {
    const limit = query.limit ?? 50;
    const offset = query.offset ?? 0;
    const rows = await this.payments.list({
      status: query.status,
    });
    const paginated = rows.slice(offset, offset + limit);
    return {
      payments: paginated.map((r) => this.toResponse(r)),
      limit,
      offset,
    };
  }

  @Get(':id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Get payment detail + attempt history' })
  @ApiResponse({ status: 200, description: 'Payment detail with attempts' })
  @ApiResponse({ status: 404, description: 'Payment not found' })
  async getById(@Param('id') id: string): Promise<PaymentDetailResponseDto> {
    const result = await this.payments.getById(id);
    return {
      payment: this.toResponse(result),
      attempts: result.attempts,
    };
  }

  @Post(':id/retry')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Manual retry (failed / scheduled_for_retry only)' })
  @ApiResponse({ status: 200, description: 'Payment retried' })
  @ApiResponse({ status: 404, description: 'Payment not found' })
  @ApiResponse({ status: 409, description: 'Invalid state transition' })
  async retry(@Param('id') id: string): Promise<RetryPaymentResponseDto> {
    try {
      const payment = await this.payments.manualRetry(id);
      return { payment: this.toResponse(payment) };
    } catch (err) {
      if (err instanceof InvalidTransitionError) {
        throw new ConflictException(
          `Payment is in state '${err.from}' - retry not allowed`,
        );
      }
      throw err;
    }
  }

  private toResponse(p: PaymentView): PaymentResponseDto {
    return {
      id: p.id,
      orderId: p.orderId,
      amount: Number(p.amount),
      currency: p.currency,
      status: p.status,
      gatewayReference: p.gatewayReference,
      attemptCount: p.attemptCount,
      totalRetryCount: p.totalRetryCount,
      nextRetryAt: p.nextRetryAt,
      failureReason: p.failureReason,
      createdAt: p.createdAt,
      updatedAt: p.updatedAt,
    };
  }
}
