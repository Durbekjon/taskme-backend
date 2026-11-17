import { ApiProperty } from '@nestjs/swagger';
import { IsString, Length, Matches } from 'class-validator';

export class GoogleExchangeDto {
  @ApiProperty({ description: 'Code from the taskme://auth/google redirect' })
  @IsString()
  @Length(10, 2000)
  code: string;

  @ApiProperty({
    description: 'PKCE verifier whose SHA-256 was sent as code_challenge',
  })
  @IsString()
  @Matches(/^[A-Za-z0-9._~-]{43,128}$/, {
    message: 'codeVerifier must be 43-128 URL-safe characters',
  })
  codeVerifier: string;
}
