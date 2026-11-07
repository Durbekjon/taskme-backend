import { IsString, IsOptional, IsEnum, IsNotEmpty, IsPhoneNumber } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export enum OnboardingRole {
  STUDIO = 'STUDIO',
  CREATIVE = 'CREATIVE',
}

export class OnboardingDto {
  @ApiProperty({ enum: OnboardingRole })
  @IsEnum(OnboardingRole)
  role: OnboardingRole;

  @ApiProperty({ example: '+998901234567' })
  @IsPhoneNumber(undefined, {
    message: 'whatsapp must be a valid international phone number',
  })
  @IsNotEmpty()
  whatsapp: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  firstName?: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  lastName?: string;

  // Studio specific
  @IsString()
  @IsOptional()
  studioName?: string;

  @IsString()
  @IsOptional()
  studioLocation?: string;

  // Creative specific
  @IsString()
  @IsOptional()
  specialization?: string;

  @IsString()
  @IsOptional()
  primaryGear?: string;

  @IsString()
  @IsOptional()
  creativeId?: string;
}
