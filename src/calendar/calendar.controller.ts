import {
  BadRequestException,
  Controller,
  Delete,
  Get,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../common/types/authenticated-user';
import { GoogleCalendarService } from './google-calendar.service';

const MAX_RANGE_DAYS = 92;

@ApiTags('calendar')
@ApiBearerAuth()
@Controller('calendar')
export class CalendarController {
  constructor(private readonly calendar: GoogleCalendarService) {}

  @Get('status')
  @ApiOperation({
    summary: 'Whether the current user has Google Calendar connected',
  })
  status(@CurrentUser() user: AuthenticatedUser) {
    return this.calendar.status(user.id);
  }

  @Get('events')
  @ApiOperation({
    summary:
      "The current user's Google Calendar events in a range (ISO from/to)",
  })
  async events(
    @CurrentUser() user: AuthenticatedUser,
    @Query('from') fromRaw?: string,
    @Query('to') toRaw?: string,
  ) {
    const from = fromRaw ? new Date(fromRaw) : new Date();
    const to = toRaw
      ? new Date(toRaw)
      : new Date(from.getTime() + 30 * 86_400_000);
    if (
      Number.isNaN(from.getTime()) ||
      Number.isNaN(to.getTime()) ||
      to <= from
    ) {
      throw new BadRequestException('from/to must be ISO dates with from < to');
    }
    if (to.getTime() - from.getTime() > MAX_RANGE_DAYS * 86_400_000) {
      throw new BadRequestException(
        `Range may not exceed ${MAX_RANGE_DAYS} days`,
      );
    }
    return this.calendar.listEvents(user.id, from, to);
  }

  @Delete('connection')
  @ApiOperation({
    summary: 'Disconnect Google: revoke the grant and delete stored tokens',
  })
  disconnect(@CurrentUser() user: AuthenticatedUser) {
    return this.calendar.disconnect(user.id);
  }
}
