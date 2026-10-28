import {
  IsString,
  IsOptional,
  IsNumber,
  IsDateString,
  IsArray,
  ValidateNested,
  IsEnum,
  IsEmail,
  IsNotEmpty,
} from 'class-validator';
import { BookingStatus } from '@prisma/client';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateEventPersonDto {
  @ApiProperty({ example: 'bride' })
  @IsString()
  personType: string;

  @ApiProperty({ example: 'Sarah' })
  @IsString()
  firstName: string;

  @ApiPropertyOptional({ example: 'Smith' })
  @IsOptional()
  @IsString()
  lastName?: string;

  @ApiPropertyOptional({ example: '+1234567890' })
  @IsOptional()
  @IsString()
  phone?: string;

  @ApiPropertyOptional({ example: 'sarah@example.com' })
  @IsOptional()
  @IsEmail()
  email?: string;
}

export class CreateEventPartDto {
  @ApiProperty({ example: 'Preparation' })
  @IsString()
  partType: string;

  @ApiPropertyOptional({ example: "Bride's Prep" })
  @IsOptional()
  @IsString()
  customName?: string;

  @ApiPropertyOptional({ example: '2026-09-17T08:00:00Z' })
  @IsOptional()
  @IsDateString()
  startAt?: string;

  @ApiPropertyOptional({ example: '2026-09-17T11:00:00Z' })
  @IsOptional()
  @IsDateString()
  endAt?: string;

  @ApiPropertyOptional({ example: 'Plaza Hotel' })
  @IsOptional()
  @IsString()
  venueName?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  address?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  city?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  state?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  zipCode?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  notes?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  sortOrder?: number;
}

export class CreateBookingDto {
  // studioId is intentionally absent: it is derived from the caller's JWT.

  @ApiPropertyOptional({ example: 1000.00 })
  @IsOptional()
  @IsNumber()
  deposit?: number;

  @ApiProperty({ example: 'Wedding' })
  @IsString()
  eventType: string;

  @ApiProperty({ example: '2026-09-17T00:00:00Z' })
  @IsDateString()
  eventDate: string;

  @ApiPropertyOptional({ example: 'NY, Manhattan' })
  @IsOptional()
  @IsString()
  location?: string;

  @ApiProperty({ example: 'Sarah & David Wedding' })
  @IsString()
  title: string;

  @ApiPropertyOptional({ example: 7500.00 })
  @IsOptional()
  @IsNumber()
  agreedPrice?: number;

  @ApiPropertyOptional({ example: 'USD' })
  @IsOptional()
  @IsString()
  currency?: string;

  @ApiPropertyOptional({ enum: BookingStatus })
  @IsOptional()
  @IsEnum(BookingStatus)
  status?: BookingStatus;

  @ApiPropertyOptional({ example: 'uuid-manager-1234' })
  @IsOptional()
  @IsString()
  managerId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  notes?: string;

  @ApiPropertyOptional({ type: [CreateEventPersonDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateEventPersonDto)
  people?: CreateEventPersonDto[];

  @ApiPropertyOptional({ type: [CreateEventPartDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateEventPartDto)
  parts?: CreateEventPartDto[];
}
