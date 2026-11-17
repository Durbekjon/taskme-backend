import { Module } from '@nestjs/common';
import { MulterModule } from '@nestjs/platform-express';
import { UsersService } from './users.service';
import { UsersController } from './users.controller';
import { StudioController } from './studio.controller';
import { CalendarModule } from '../calendar/calendar.module';
import { PrismaModule } from '../prisma/prisma.module';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [
    PrismaModule,
    MulterModule.register({ dest: './uploads' }),
    NotificationsModule,
    CalendarModule,
  ],
  controllers: [UsersController, StudioController],
  providers: [UsersService],
  exports: [UsersService],
})
export class UsersModule {}

