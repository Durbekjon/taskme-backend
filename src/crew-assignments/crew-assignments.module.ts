import { Module } from '@nestjs/common';
import { CrewAssignmentsService } from './crew-assignments.service';
import { CrewAssignmentsController } from './crew-assignments.controller';
import { PrismaModule } from '../prisma/prisma.module';
import { CalendarModule } from '../calendar/calendar.module';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [PrismaModule, NotificationsModule, CalendarModule],
  controllers: [CrewAssignmentsController],
  providers: [CrewAssignmentsService],
})
export class CrewAssignmentsModule {}
