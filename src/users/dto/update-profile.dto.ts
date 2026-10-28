import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';

export class UpdateProfileDto {
  @ApiPropertyOptional({ example: 'Aziz' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  firstName?: string;

  @ApiPropertyOptional({ example: 'Karimov' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  lastName?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  avatarUrl?: string;

  /** Worker-profile fields. Ignored for users without one. */
  @ApiPropertyOptional({ example: 'Lead Videographer' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  primaryRole?: string;

  @ApiPropertyOptional({ example: 'Sony A7IV, DJI RS3' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  primaryGear?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  bio?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(100)
  city?: string;
}
