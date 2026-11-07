import { ApiProperty } from '@nestjs/swagger';
import { IsPhoneNumber } from 'class-validator';

export class SendOtpDto {
  @ApiProperty({ example: '+998901234567' })
  @IsPhoneNumber(undefined, {
    message: 'phoneNumber must be a valid international phone number',
  })
  phoneNumber: string;
}
