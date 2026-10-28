import { PartialType } from '@nestjs/swagger';
import { CreateCrewAssignmentDto } from './create-crew-assignment.dto';

export class UpdateCrewAssignmentDto extends PartialType(CreateCrewAssignmentDto) {}
