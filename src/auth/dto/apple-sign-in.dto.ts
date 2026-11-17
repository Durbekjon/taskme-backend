import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, Length, MaxLength } from 'class-validator';

export class AppleSignInDto {
  @ApiProperty({ description: 'identityToken from expo-apple-authentication' })
  @IsString()
  @Length(20, 5000)
  identityToken: string;

  @ApiProperty({ description: 'Raw nonce; its SHA-256 was passed to Apple' })
  @IsString()
  @Length(16, 200)
  nonce: string;

  @ApiPropertyOptional({
    description: 'One-time authorizationCode (used to allow token revocation)',
  })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  authorizationCode?: string;

  /** Apple sends the name only on the very first sign-in, to the app. */
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(100)
  firstName?: string;
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(100)
  lastName?: string;
}
