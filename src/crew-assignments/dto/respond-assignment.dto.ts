import { ApiProperty } from '@nestjs/swagger';
import { IsIn } from 'class-validator';
import { AssignmentStatus } from '@prisma/client';

/**
 * Only the two answers a worker can give. The endpoint previously accepted any
 * string, which is how "ACCEPTED" (web) and "confirmed" (mobile) both ended up
 * in the same column.
 */
export const ASSIGNMENT_RESPONSES = [
  AssignmentStatus.CONFIRMED,
  AssignmentStatus.DECLINED,
] as const;

export type AssignmentResponse = (typeof ASSIGNMENT_RESPONSES)[number];

export class RespondAssignmentDto {
  @ApiProperty({ enum: ASSIGNMENT_RESPONSES })
  @IsIn(ASSIGNMENT_RESPONSES as unknown as string[])
  status: AssignmentResponse;
}
