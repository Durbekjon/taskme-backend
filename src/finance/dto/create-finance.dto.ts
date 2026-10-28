import { IsString, IsOptional, IsNumber, IsDateString, IsEnum, Min } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ClientPaymentType } from '@prisma/client';

/**
 * Note on dates: `paymentDate` / `expenseDate` used to be required, so every
 * form in the app - none of which has a date picker - got a 400. They are now
 * optional and default to "now" on the server.
 *
 * Note on `createdBy`: the column is `createdById`. The old name was passed
 * straight into `prisma.create({ data })` and raised an unknown-argument
 * error. It is no longer accepted from the body at all - it comes from the JWT.
 */

export class CreateClientPaymentDto {
  @ApiProperty()
  @IsString()
  bookingId: string;

  @ApiProperty({ example: 500 })
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  amount: number;

  @ApiProperty({ enum: ClientPaymentType })
  @IsEnum(ClientPaymentType)
  paymentType: ClientPaymentType;

  @ApiPropertyOptional({ example: '2026-09-17T00:00:00Z', description: 'Defaults to now' })
  @IsOptional()
  @IsDateString()
  paymentDate?: string;

  @ApiPropertyOptional({ example: 'Zelle' })
  @IsOptional()
  @IsString()
  paymentMethod?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  notes?: string;
}

export class CreateWorkerPaymentDto {
  @ApiProperty()
  @IsString()
  assignmentId: string;

  @ApiProperty({ example: 500 })
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  amount: number;

  @ApiPropertyOptional({ example: '2026-09-17T00:00:00Z', description: 'Defaults to now' })
  @IsOptional()
  @IsDateString()
  paymentDate?: string;

  @ApiPropertyOptional({ example: 'Zelle' })
  @IsOptional()
  @IsString()
  paymentMethod?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  notes?: string;
}

export class CreateExpenseDto {
  @ApiPropertyOptional({ description: 'Attach the expense to a booking' })
  @IsOptional()
  @IsString()
  bookingId?: string;

  @ApiProperty({ example: 'Equipment Rental' })
  @IsString()
  category: string;

  @ApiProperty({ example: 'Second camera body for the ceremony' })
  @IsString()
  description: string;

  @ApiProperty({ example: 150 })
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  amount: number;

  @ApiPropertyOptional({ example: '2026-09-17T00:00:00Z', description: 'Defaults to now' })
  @IsOptional()
  @IsDateString()
  expenseDate?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  notes?: string;
}
