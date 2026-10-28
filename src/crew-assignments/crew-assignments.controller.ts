import {
  BadRequestException,
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
} from '@nestjs/common';
import { CrewAssignmentsService } from './crew-assignments.service';
import { CreateCrewAssignmentDto } from './dto/create-crew-assignment.dto';
import { UpdateCrewAssignmentDto } from './dto/update-crew-assignment.dto';
import { RespondAssignmentDto } from './dto/respond-assignment.dto';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../common/types/authenticated-user';
import { Roles } from '../auth/roles.decorator';

@ApiTags('crew-assignments')
@ApiBearerAuth()
@Controller('crew-assignments')
export class CrewAssignmentsController {
  constructor(private readonly crewAssignmentsService: CrewAssignmentsService) {}

  private requireStudio(user: AuthenticatedUser): string {
    if (!user.studioId) {
      throw new BadRequestException(
        'You need to finish studio onboarding before managing crew',
      );
    }
    return user.studioId;
  }

  @Post()
  @Roles('ADMIN')
  @ApiOperation({ summary: 'Assign a worker to a booking' })
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateCrewAssignmentDto,
  ) {
    return this.crewAssignmentsService.create(dto, this.requireStudio(user));
  }

  @Get('availability/:bookingId/:workerPublicId')
  @Roles('ADMIN')
  @ApiOperation({
    summary: 'Look up a creative by public ID and check them against a booking',
  })
  checkAvailability(
    @Param('bookingId') bookingId: string,
    @Param('workerPublicId') workerPublicId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.crewAssignmentsService.checkAvailability(
      bookingId,
      workerPublicId,
      this.requireStudio(user),
    );
  }

  @Get('booking/:bookingId')
  @ApiOperation({ summary: 'List all assignments for a booking' })
  findAllByBooking(
    @Param('bookingId') bookingId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.crewAssignmentsService.findAllByBooking(
      bookingId,
      this.requireStudio(user),
    );
  }

  @Get('worker/me')
  @ApiOperation({ summary: "List the caller's own assignments" })
  findMine(@CurrentUser() user: AuthenticatedUser) {
    return this.crewAssignmentsService.findAllByWorker(user.id, user);
  }

  @Get('worker/:workerId')
  @ApiOperation({ summary: 'List all assignments for a worker' })
  findAllByWorker(
    @Param('workerId') workerId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.crewAssignmentsService.findAllByWorker(workerId, user);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a specific assignment' })
  findOne(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.crewAssignmentsService.findOne(id, user);
  }

  @Patch(':id/respond')
  @ApiOperation({ summary: 'Respond to an assignment (confirm/decline)' })
  respond(
    @Param('id') id: string,
    @Body() dto: RespondAssignmentDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.crewAssignmentsService.respond(id, dto.status, user);
  }

  @Patch(':id')
  @Roles('ADMIN')
  @ApiOperation({ summary: 'Update a specific assignment' })
  update(
    @Param('id') id: string,
    @Body() dto: UpdateCrewAssignmentDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.crewAssignmentsService.update(id, dto, this.requireStudio(user));
  }

  @Delete(':id')
  @Roles('ADMIN')
  @ApiOperation({ summary: 'Delete a specific assignment' })
  remove(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.crewAssignmentsService.remove(id, this.requireStudio(user));
  }
}
