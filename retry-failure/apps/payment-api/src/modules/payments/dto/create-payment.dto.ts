import { IsString, IsNumber, MinLength, MaxLength, IsPositive, Max, Length, IsIn } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

const SUPPORTED_CURRENCIES = ['IDR', 'USD', 'SGD', 'EUR'] as const;

export class CreatePaymentDto {
  @ApiProperty({ example: 'ORD-12345', description: 'Unique order identifier' })
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  orderId!: string;

  @ApiProperty({ example: 10000, description: 'Amount in minor units', minimum: 1, maximum: 1000000 })
  @IsNumber()
  @IsPositive()
  @Max(1_000_000)
  amount!: number;

  @ApiPropertyOptional({ example: 'IDR', enum: SUPPORTED_CURRENCIES, default: 'IDR', description: 'ISO 4217 currency code' })
  @IsString()
  @Length(3, 3)
  @IsIn(SUPPORTED_CURRENCIES as unknown as string[])
  currency: string = 'IDR';
}
