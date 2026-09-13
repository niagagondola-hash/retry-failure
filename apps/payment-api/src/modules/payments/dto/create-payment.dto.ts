import { IsString, IsNumber, MinLength, MaxLength, IsPositive, Max, Length, IsIn } from 'class-validator';

const SUPPORTED_CURRENCIES = ['IDR', 'USD', 'SGD', 'EUR'] as const;

export class CreatePaymentDto {
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  orderId!: string;

  @IsNumber()
  @IsPositive()
  @Max(1_000_000)
  amount!: number;

  @IsString()
  @Length(3, 3)
  @IsIn(SUPPORTED_CURRENCIES as unknown as string[])
  currency: string = 'IDR';
}
