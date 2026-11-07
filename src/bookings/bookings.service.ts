import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { BookingStatus, Prisma } from '@prisma/client';
import { CreateBookingDto } from './dto/create-booking.dto';
import { UpdateBookingDto } from './dto/update-booking.dto';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class BookingsService {
  constructor(private readonly prisma: PrismaService) {}

  private async autoAdvanceStatuses(studioId: string) {
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const todayEnd = new Date();
    todayEnd.setHours(23, 59, 59, 999);

    await this.prisma.booking.updateMany({
      where: {
        studioId,
        status: BookingStatus.CONFIRMED,
        eventDate: { gte: todayStart, lte: todayEnd },
      },
      data: { status: BookingStatus.IN_PROGRESS },
    });

    await this.prisma.booking.updateMany({
      where: {
        studioId,
        status: { in: [BookingStatus.CONFIRMED, BookingStatus.IN_PROGRESS] },
        eventDate: { lt: todayStart },
      },
      data: { status: BookingStatus.COMPLETED },
    });
  }

  async create(createBookingDto: CreateBookingDto, studioId: string) {
    const { people, parts, deposit, ...bookingData } = createBookingDto;

    return this.prisma.$transaction(async (tx) => {
      const booking = await tx.booking.create({
        data: {
          ...bookingData,
          studioId,
          status: bookingData.status ?? BookingStatus.DRAFT,
          people: people?.length ? { create: people } : undefined,
          eventParts: parts?.length
            ? { create: parts.map((part, index) => ({ sortOrder: index, ...part })) }
            : undefined,
        },
        include: {
          people: true,
          eventParts: { orderBy: { sortOrder: 'asc' } },
        },
      });

      if (deposit && deposit > 0) {
        await tx.clientPayment.create({
          data: {
            bookingId: booking.id,
            amount: deposit,
            paymentType: 'DEPOSIT',
            paymentDate: new Date(),
          }
        });
      }

      return booking;
    });
  }

  async findAll(studioId: string, page: number = 1, limit: number = 20, filters: any = {}) {
    await this.autoAdvanceStatuses(studioId);
    const skip = (page - 1) * limit;
    const take = limit;
    
    const where: Prisma.BookingWhereInput = { studioId };
    
    if (filters.status && filters.status !== 'ALL') {
      where.status = filters.status as BookingStatus;
    }
    
    if (filters.search) {
      where.OR = [
        { title: { contains: filters.search, mode: 'insensitive' } },
        { people: { some: { firstName: { contains: filters.search, mode: 'insensitive' } } } },
        { people: { some: { lastName: { contains: filters.search, mode: 'insensitive' } } } }
      ];
    }
    
    if (filters.dateStart || filters.dateEnd) {
      where.eventDate = {};
      if (filters.dateStart) (where.eventDate as any).gte = new Date(filters.dateStart);
      if (filters.dateEnd) (where.eventDate as any).lte = new Date(filters.dateEnd);
    } else if (filters.month) {
      const start = new Date(`${filters.month}-01T00:00:00Z`);
      const end = new Date(start);
      end.setMonth(end.getMonth() + 1);
      where.eventDate = { gte: start, lt: end };
    }
    
    let orderBy: Prisma.BookingOrderByWithRelationInput = { eventDate: 'desc' };
    if (filters.sortBy === 'date_asc') orderBy = { eventDate: 'asc' };
    else if (filters.sortBy === 'date_desc') orderBy = { eventDate: 'desc' };
    else if (filters.sortBy === 'name_asc') orderBy = { title: 'asc' };
    else if (filters.sortBy === 'name_desc') orderBy = { title: 'desc' };

    const [data, total] = await Promise.all([
      this.prisma.booking.findMany({
        where,
        include: {
          people: true,
          eventParts: { orderBy: { sortOrder: 'asc' } },
          clientPayments: true,
          assignments: {
            include: {
              worker: { include: { user: true } },
              payments: true,
            }
          }
        },
        orderBy,
        skip,
        take,
      }),
      this.prisma.booking.count({ where })
    ]);

    return {
      data,
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit) || 1
      }
    };
  }

  async findOne(id: string, studioId: string) {
    await this.autoAdvanceStatuses(studioId);
    const booking = await this.prisma.booking.findFirst({
      where: { id, studioId },
      include: {
        people: true,
        eventParts: { orderBy: { sortOrder: 'asc' } },
        assignments: {
          include: {
            worker: { include: { user: true } },
            assignedParts: { include: { eventPart: true } },
          },
        },
        clientPayments: true,
        expenses: true,
      },
    });

    if (!booking) {
      throw new NotFoundException(`Booking with ID ${id} not found`);
    }
    return booking;
  }

  async update(id: string, updateBookingDto: UpdateBookingDto, studioId: string) {
    await this.assertOwned(id, studioId);

    const { people, parts, deposit, ...updateData } = updateBookingDto as any;

    return this.prisma.$transaction(async (tx) => {
      if (people !== undefined) {
        await tx.bookingPerson.deleteMany({ where: { bookingId: id } });
      }
      if (parts !== undefined) {
        await tx.eventPart.deleteMany({ where: { bookingId: id } });
      }

      return tx.booking.update({
        where: { id },
        data: {
          ...(updateData as Prisma.BookingUpdateInput),
          ...(people !== undefined && {
            people: { create: people },
          }),
          ...(parts !== undefined && {
            eventParts: {
              create: parts.map((part: any, index: number) => ({ sortOrder: index, ...part })),
            },
          }),
        },
        include: {
          people: true,
          eventParts: { orderBy: { sortOrder: 'asc' } },
        },
      });
    });
  }

  async remove(id: string, studioId: string) {
    await this.assertOwned(id, studioId);
    await this.prisma.booking.delete({ where: { id } });
    return { success: true };
  }

  private async assertOwned(id: string, studioId: string) {
    const booking = await this.prisma.booking.findFirst({
      where: { id, studioId },
      select: { id: true },
    });
    if (!booking) {
      throw new NotFoundException(`Booking with ID ${id} not found`);
    }
  }
}
