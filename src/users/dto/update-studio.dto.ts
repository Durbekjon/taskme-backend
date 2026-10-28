import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';

export class UpdateStudioDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(200) name?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(500) address?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(100) city?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(100) state?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(20)  zipCode?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(100) country?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(300) email?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(50)  phone?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(300) website?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(10)  currency?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(100) timezone?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(500) logoUrl?: string;
}
