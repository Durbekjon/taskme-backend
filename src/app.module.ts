import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ThrottlerModule } from '@nestjs/throttler';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { PrismaModule } from './prisma/prisma.module';
import { UsersModule } from './users/users.module';
import { AuthModule } from './auth/auth.module';

import { WhatsappModule } from './whatsapp/whatsapp.module';
import { APP_GUARD } from '@nestjs/core';
import { JwtAuthGuard } from './auth/jwt-auth.guard';
import { RolesGuard } from './auth/roles.guard';
import { BookingsModule } from './bookings/bookings.module';
import { CrewAssignmentsModule } from './crew-assignments/crew-assignments.module';
import { FinanceModule } from './finance/finance.module';
import { NotificationsModule } from './notifications/notifications.module';
import { env } from './config/env';

// The `activities` and `files` modules were removed: both were untouched Nest
// CLI scaffolds that returned strings like "This action returns all files" and
// parsed cuid ids with `+id` (producing NaN). Nothing called them.

@Module({
  imports: [
    ThrottlerModule.forRoot([{ name: 'default', ttl: 60_000, limit: 60 }]),
    BullModule.forRoot({
      connection: {
        host: env.redisHost,
        port: env.redisPort,
        maxRetriesPerRequest: null, // Required for BullMQ
      },
    }),
    PrismaModule,
    UsersModule,
    AuthModule,
    WhatsappModule,
    BookingsModule,
    CrewAssignmentsModule,
    FinanceModule,
    NotificationsModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    {
      provide: APP_GUARD,
      useClass: JwtAuthGuard,
    },
    {
      provide: APP_GUARD,
      useClass: RolesGuard,
    },
  ],
})
export class AppModule {}
