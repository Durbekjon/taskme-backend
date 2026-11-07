import { ApiProperty } from '@nestjs/swagger';
import { IsEnum, IsString, IsNotEmpty } from 'class-validator';

export class InviteToTeamDto {
  @ApiProperty({ example: 'TM-847521', description: 'The creative public ID' })
  @IsString()
  @IsNotEmpty()
  workerPublicId: string;
}

export class RemoveFromTeamDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  userId: string;
}

export enum TeamInviteAction {
  ACCEPT = 'accept',
  REJECT = 'reject',
}

export class RespondToInviteDto {
  @ApiProperty({ description: 'The studio that sent the invitation' })
  @IsString()
  @IsNotEmpty()
  studioId: string;

  @ApiProperty({ enum: TeamInviteAction })
  @IsEnum(TeamInviteAction)
  action: TeamInviteAction;
}
