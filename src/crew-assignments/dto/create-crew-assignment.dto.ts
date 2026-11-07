import {
  IsString,
  IsOptional,
  IsNumber,
  IsDateString,
  IsArray,
  Min,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateCrewAssignmentDto {
  @ApiProperty({ example: 'uuid-booking-1234' })
  @IsString()
  bookingId: string;

  @ApiProperty({ example: 'uuid-worker-1234' })
  @IsString()
  workerId: string;

  @ApiPropertyOptional({ example: 'Photographer' })
  @IsOptional()
  @IsString()
  role?: string;

  @ApiPropertyOptional({ example: 1000.0 })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  agreedFee?: number;

  @ApiPropertyOptional({ example: 200.0 })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  deposit?: number;

  @ApiPropertyOptional({ example: '2026-09-17T07:30:00Z' })
  @IsOptional()
  @IsDateString()
  callTime?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  notes?: string;

  @ApiPropertyOptional({ type: [String], description: 'Array of EventPart IDs to assign this worker to' })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  eventPartIds?: string[];
}
