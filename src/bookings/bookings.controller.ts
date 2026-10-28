import {
  BadRequestException,
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  Query,
} from '@nestjs/common';
import { BookingsService } from './bookings.service';
import { CreateBookingDto } from './dto/create-booking.dto';
import { UpdateBookingDto } from './dto/update-booking.dto';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiQuery } from '@nestjs/swagger';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../common/types/authenticated-user';

@ApiTags('bookings')
@ApiBearerAuth()
@Controller('bookings')
export class BookingsController {
  constructor(private readonly bookingsService: BookingsService) {}

  private requireStudio(user: AuthenticatedUser): string {
    if (!user.studioId) {
      throw new BadRequestException(
        'You need to finish studio onboarding before managing bookings',
      );
    }
    return user.studioId;
  }

  @Post()
  @ApiOperation({ summary: 'Create a new booking with people and parts' })
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() createBookingDto: CreateBookingDto,
  ) {
    return this.bookingsService.create(createBookingDto, this.requireStudio(user));
  }

  @Get()
  @ApiOperation({ summary: "List all bookings for the caller's studio" })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  findAll(
    @CurrentUser() user: AuthenticatedUser,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('search') search?: string,
    @Query('status') status?: string,
    @Query('month') month?: string,
    @Query('dateStart') dateStart?: string,
    @Query('dateEnd') dateEnd?: string,
    @Query('crew') crew?: string,
    @Query('sortBy') sortBy?: string,
  ) {
    const pageNumber = Math.max(1, parseInt(page ?? '1', 10) || 1);
    const limitNumber = Math.min(200, Math.max(1, parseInt(limit ?? '20', 10) || 20));
    return this.bookingsService.findAll(this.requireStudio(user), pageNumber, limitNumber, {
      search, status, month, dateStart, dateEnd, crew, sortBy
    });
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a specific booking workspace by ID' })
  findOne(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.bookingsService.findOne(id, this.requireStudio(user));
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update a specific booking' })
  update(
    @Param('id') id: string,
    @Body() updateBookingDto: UpdateBookingDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.bookingsService.update(id, updateBookingDto, this.requireStudio(user));
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete a specific booking' })
  remove(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.bookingsService.remove(id, this.requireStudio(user));
  }
}
