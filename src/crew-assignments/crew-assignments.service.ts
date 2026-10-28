import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AssignmentStatus, Prisma } from '@prisma/client';
import { CreateCrewAssignmentDto } from './dto/create-crew-assignment.dto';
import { UpdateCrewAssignmentDto } from './dto/update-crew-assignment.dto';
import { PrismaService } from '../prisma/prisma.service';
import { Expo } from 'expo-server-sdk';
import type { AuthenticatedUser } from '../common/types/authenticated-user';
import { normalizeWorkerPublicId } from '../auth/creative-id';
import {
  bookingWindow,
  blocksTime,
  overlaps,
  summarize,
  toIso,
  type AvailabilityStatus,
  type Conflict,
} from './availability';
import { NotificationsGateway } from '../notifications/notifications.gateway';

const ASSIGNMENT_WITH_CONTEXT = {
  worker: { include: { user: true } },
  assignedParts: { include: { eventPart: true } },
} satisfies Prisma.CrewAssignmentInclude;

@Injectable()
export class CrewAssignmentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsGateway,
  ) {}

  async create(dto: CreateCrewAssignmentDto, studioId: string) {
    const { eventPartIds, workerId, bookingId, deposit, ...assignmentData } = dto;

    const booking = await this.prisma.booking.findFirst({
      where: { id: bookingId, studioId },
      select: { id: true },
    });
    if (!booking) {
      throw new NotFoundException(`Booking with ID ${bookingId} not found`);
    }

    // Callers pass either a WorkerProfile id or the underlying User id - the
    // team list returns users, the assignment list returns profiles.
    const workerProfile = await this.prisma.workerProfile.findFirst({
      where: { OR: [{ id: workerId }, { userId: workerId }] },
      select: { id: true, userId: true },
    });
    if (!workerProfile) {
      // Studio owners and admins are team members but have no creative
      // profile, so they cannot be booked as crew. Say which it is rather
      // than echoing a raw id back at the user.
      const person = await this.prisma.user.findUnique({
        where: { id: workerId },
        select: { firstName: true, lastName: true, email: true },
      });
      if (person) {
        const name =
          `${person.firstName ?? ''} ${person.lastName ?? ''}`.trim() || person.email;
        throw new BadRequestException(
          `${name} does not have a creative profile, so they cannot be assigned to a booking.`,
        );
      }
      throw new NotFoundException('That team member no longer exists.');
    }

    const duplicate = await this.prisma.crewAssignment.findFirst({
      where: { bookingId, workerId: workerProfile.id },
      select: { id: true },
    });
    if (duplicate) {
      throw new BadRequestException(
        'This creative is already assigned to this booking.',
      );
    }

    if (eventPartIds?.length) {
      const owned = await this.prisma.eventPart.count({
        where: { id: { in: eventPartIds }, bookingId },
      });
      if (owned !== eventPartIds.length) {
        throw new NotFoundException('One or more event parts do not belong to this booking');
      }
    }

    return this.prisma.$transaction(async (tx) => {
      const assignment = await tx.crewAssignment.create({
        data: {
          ...assignmentData,
          bookingId,
          workerId: workerProfile.id,
          assignedParts: eventPartIds?.length
            ? { create: eventPartIds.map((eventPartId) => ({ eventPartId })) }
            : undefined,
        },
        include: ASSIGNMENT_WITH_CONTEXT,
      });

      // A creative from another studio has no reason to be watching this
      // studio's bookings, so tell them an invitation is waiting.
      const context = await tx.booking.findUnique({
        where: { id: bookingId },
        select: { title: true, studio: { select: { name: true } } },
      });
      const notif = await tx.notification.create({
        data: {
          userId: workerProfile.userId,
          title: 'New job invitation',
          message: `${context?.studio?.name ?? 'A studio'} invited you to ${
            context?.title ?? 'a booking'
          }.`,
          type: 'CREW_INVITE',
          referenceId: assignment.id,
        },
      });

      // Real-time: push to worker if they have the app open.
      this.notifications.emitToUser(workerProfile.userId, 'notification', {
        id: notif.id,
        type: notif.type,
        title: notif.title,
        message: notif.message,
        referenceId: notif.referenceId,
        createdAt: notif.createdAt.toISOString(),
      });

      const workerUser = await tx.user.findUnique({
        where: { id: workerProfile.userId },
        select: { expoPushToken: true },
      });

      if (workerUser?.expoPushToken && Expo.isExpoPushToken(workerUser.expoPushToken)) {
        const expo = new Expo();
        try {
          await expo.sendPushNotificationsAsync([{
            to: workerUser.expoPushToken,
            sound: 'default',
            title: 'New job invitation',
            body: `${context?.studio?.name ?? 'A studio'} invited you to ${context?.title ?? 'a booking'}.`,
            data: { assignmentId: assignment.id },
          }]);
        } catch (error) {
          console.error('Failed to send push notification', error);
        }
      }

      if (deposit && deposit > 0) {
        await tx.workerPayment.create({
          data: {
            assignmentId: assignment.id,
            workerId: workerProfile.id,
            amount: deposit,
            paymentDate: new Date(),
          },
        });
      }

      return assignment;
    });
  }

  /**
   * Looks a creative up by their public ID and reports whether they are free
   * for a given booking.
   *
   * Creatives are not scoped to a studio - a studio can book anyone whose ID
   * they have been given, including someone who normally works elsewhere. The
   * clash list is redacted for bookings the asking studio does not own.
   */
  async checkAvailability(
    bookingId: string,
    workerPublicId: string,
    studioId: string,
  ) {
    const normalized = normalizeWorkerPublicId(workerPublicId);
    if (!normalized) {
      throw new BadRequestException(
        'Creative ID must contain 6 digits, for example TM-847521',
      );
    }

    const booking = await this.prisma.booking.findFirst({
      where: { id: bookingId, studioId },
      select: {
        id: true,
        eventDate: true,
        eventParts: { select: { startAt: true, endAt: true } },
      },
    });
    if (!booking) {
      throw new NotFoundException(`Booking with ID ${bookingId} not found`);
    }

    const profile = await this.prisma.workerProfile.findUnique({
      where: { workerPublicId: normalized },
      include: {
        user: { select: { id: true, firstName: true, lastName: true, email: true, avatarUrl: true } },
        skills: { select: { skill: true } },
      },
    });
    if (!profile) {
      throw new NotFoundException(`No creative found with ID ${normalized}`);
    }

    const alreadyOnThisBooking = await this.prisma.crewAssignment.findFirst({
      where: { bookingId, workerId: profile.id },
      select: { id: true, status: true },
    });

    const onYourTeam = await this.prisma.studioMember.findFirst({
      where: { studioId, userId: profile.userId, status: 'ACTIVE' },
      select: { id: true },
    });

    const window = bookingWindow(booking);
    const conflicts: Conflict[] = [];

    if (window) {
      const assignments = await this.prisma.crewAssignment.findMany({
        where: { workerId: profile.id, bookingId: { not: bookingId } },
        include: {
          booking: {
            select: {
              title: true,
              eventDate: true,
              studioId: true,
              studio: { select: { name: true } },
              eventParts: { select: { startAt: true, endAt: true } },
            },
          },
          assignedParts: { select: { eventPart: { select: { startAt: true, endAt: true } } } },
        },
      });

      for (const assignment of assignments) {
        if (!blocksTime(assignment.status)) continue;

        // Prefer the parts this creative is actually booked for; fall back to
        // the whole booking when they are on the entire event.
        const parts = assignment.assignedParts.length
          ? assignment.assignedParts.map((p) => p.eventPart)
          : assignment.booking.eventParts;
        const other = bookingWindow({
          eventDate: assignment.booking.eventDate,
          eventParts: parts,
        });
        if (!other || !overlaps(window, other)) continue;

        const isOwnStudio = assignment.booking.studioId === studioId;
        conflicts.push({
          startAt: other.start.toISOString(),
          endAt: toIso(other.end),
          status: assignment.status,
          isOwnStudio,
          title: isOwnStudio ? assignment.booking.title : null,
          studioName: isOwnStudio ? (assignment.booking.studio?.name ?? null) : null,
        });
      }

      conflicts.sort((a, b) => a.startAt.localeCompare(b.startAt));
    }

    const status: AvailabilityStatus = summarize(conflicts, !!window);

    return {
      worker: {
        id: profile.id,
        userId: profile.userId,
        workerPublicId: profile.workerPublicId,
        fullName:
          `${profile.user.firstName ?? ''} ${profile.user.lastName ?? ''}`.trim() ||
          profile.user.email,
        avatarUrl: profile.user.avatarUrl,
        primaryRole: profile.primaryRole,
        primaryGear: profile.primaryGear,
        city: profile.city,
        bio: profile.bio,
        skills: profile.skills.map((s) => s.skill),
        onYourTeam: !!onYourTeam,
      },
      bookingWindow: window
        ? { startAt: window.start.toISOString(), endAt: toIso(window.end) }
        : null,
      availability: { status, conflicts },
      alreadyAssigned: alreadyOnThisBooking
        ? { id: alreadyOnThisBooking.id, status: alreadyOnThisBooking.status }
        : null,
    };
  }

  async findAllByBooking(bookingId: string, studioId: string) {
    const booking = await this.prisma.booking.findFirst({
      where: { id: bookingId, studioId },
      select: { id: true },
    });
    if (!booking) {
      throw new NotFoundException(`Booking with ID ${bookingId} not found`);
    }

    const assignments = await this.prisma.crewAssignment.findMany({
      where: { bookingId },
      include: ASSIGNMENT_WITH_CONTEXT,
    });

    return assignments.map((a) => ({
      ...a,
      agreedFee: a.agreedFee === null ? null : Number(a.agreedFee),
      worker: {
        ...a.worker,
        firstName: a.worker.user?.firstName ?? null,
        lastName: a.worker.user?.lastName ?? null,
        fullName:
          `${a.worker.user?.firstName ?? ''} ${a.worker.user?.lastName ?? ''}`.trim() ||
          a.worker.user?.email ||
          'Unknown',
        email: a.worker.user?.email ?? null,
      },
    }));
  }

  /**
   * A worker's own schedule. The date/time and venue are derived from the
   * booking's event parts - `Booking` has never had `location`, `startTime` or
   * `endTime` columns, so reading them here produced `undefined` for every
   * field the schedule screens render.
   */
  async findAllByWorker(workerId: string, actor: AuthenticatedUser) {
    const worker = await this.prisma.workerProfile.findFirst({
      where: { OR: [{ id: workerId }, { userId: workerId }] },
      select: { id: true, userId: true },
    });
    if (!worker) {
      throw new NotFoundException(`Worker profile not found for id ${workerId}`);
    }

    // You may read your own assignments; a studio may read those of its team.
    if (worker.userId !== actor.id) {
      const sharesStudio =
        actor.studioId !== null &&
        (await this.prisma.studioMember.findFirst({
          where: { studioId: actor.studioId, userId: worker.userId },
          select: { id: true },
        }));
      if (!sharesStudio) {
        throw new ForbiddenException("You cannot read this worker's assignments");
      }
    }

    const assignments = await this.prisma.crewAssignment.findMany({
      where: { workerId: worker.id },
      include: {
        booking: {
          include: {
            studio: true,
            eventParts: { orderBy: { sortOrder: 'asc' } },
          },
        },
        assignedParts: { include: { eventPart: true } },
      },
      orderBy: { booking: { eventDate: 'asc' } },
    });

    return assignments.map((a) => {
      // Prefer the parts this worker is actually booked for, and fall back to
      // the booking's own schedule when they are assigned to the whole event.
      const parts = a.assignedParts.length
        ? a.assignedParts.map((p) => p.eventPart)
        : a.booking.eventParts;
      const starts = parts.map((p) => p.startAt).filter((d): d is Date => !!d);
      const ends = parts.map((p) => p.endAt).filter((d): d is Date => !!d);
      const firstStart = starts.length
        ? new Date(Math.min(...starts.map((d) => d.getTime())))
        : a.callTime ?? a.booking.eventDate;
      const lastEnd = ends.length
        ? new Date(Math.max(...ends.map((d) => d.getTime())))
        : null;
      const venue = parts.find((p) => p.venueName || p.address);

      return {
        id: a.id,
        bookingId: a.bookingId,
        workerId: a.workerId,
        role: a.role,
        notes: a.notes,
        status: a.status,
        callTime: a.callTime,
        fee: a.agreedFee === null ? null : Number(a.agreedFee),
        deposit: a.deposit === null ? null : Number(a.deposit),
        title: a.booking.title,
        category: a.booking.eventType,
        location: venue
          ? [venue.venueName, venue.address, venue.city].filter(Boolean).join(', ')
          : null,
        // ISO instants, not wall-clock strings. These used to be rendered from
        // toISOString(), so a creative saw the UTC hour instead of the hour the
        // studio booked - a five-hour lie for a Tashkent studio, eight for a
        // Pacific one. The client formats them in its own timezone.
        startAt: firstStart ? firstStart.toISOString() : null,
        endAt: lastEnd ? lastEnd.toISOString() : null,
        studioId: a.booking.studioId,
        studio: a.booking.studio,
        assignedParts: a.assignedParts,
      };
    });
  }

  async findOne(id: string, actor: AuthenticatedUser) {
    const assignment = await this.prisma.crewAssignment.findUnique({
      where: { id },
      include: { ...ASSIGNMENT_WITH_CONTEXT, booking: true },
    });
    if (!assignment || !(await this.canAccess(assignment, actor))) {
      throw new NotFoundException(`CrewAssignment with ID ${id} not found`);
    }
    return assignment;
  }

  async update(id: string, dto: UpdateCrewAssignmentDto, studioId: string) {
    await this.assertOwnedByStudio(id, studioId);
    const { eventPartIds, workerId, bookingId, ...updateData } = dto;

    const existing = await this.prisma.crewAssignment.findUnique({
      where: { id },
      select: {
        worker: { select: { userId: true, user: { select: { expoPushToken: true } } } },
        booking: { select: { title: true, studio: { select: { name: true } } } },
      },
    });

    const a = await this.prisma.crewAssignment.update({
      where: { id },
      data: updateData,
      include: ASSIGNMENT_WITH_CONTEXT,
    });

    if (existing) {
      const workerUserId = existing.worker.userId;
      const studioName = existing.booking.studio?.name ?? 'Your studio';
      const bookingTitle = existing.booking.title ?? 'a booking';

      const notif = await this.prisma.notification.create({
        data: {
          userId: workerUserId,
          title: 'Job details updated',
          message: `${studioName} updated your assignment for ${bookingTitle}.`,
          type: 'ASSIGNMENT_UPDATED',
          referenceId: id,
        },
      });
      this.notifications.emitToUser(workerUserId, 'notification', {
        id: notif.id,
        type: notif.type,
        title: notif.title,
        message: notif.message,
        referenceId: notif.referenceId,
        createdAt: notif.createdAt.toISOString(),
      });
      this.notifications.emitToUser(workerUserId, 'assignment_updated', {
        bookingId: a.bookingId,
        assignmentId: id,
        status: a.status,
      });

      const token = existing.worker.user?.expoPushToken;
      if (token && Expo.isExpoPushToken(token)) {
        const expo = new Expo();
        try {
          await expo.sendPushNotificationsAsync([{
            to: token,
            sound: 'default',
            title: 'Job details updated',
            body: `${studioName} updated your assignment for ${bookingTitle}.`,
            data: { assignmentId: id },
          }]);
        } catch (error) {
          console.error('Failed to send push notification', error);
        }
      }
    }

    return {
      ...a,
      agreedFee: a.agreedFee === null ? null : Number(a.agreedFee),
      deposit: a.deposit === null ? null : Number(a.deposit),
      worker: {
        ...a.worker,
        firstName: a.worker.user?.firstName ?? null,
        lastName: a.worker.user?.lastName ?? null,
        fullName:
          `${a.worker.user?.firstName ?? ''} ${a.worker.user?.lastName ?? ''}`.trim() ||
          a.worker.user?.email ||
          'Unknown',
        email: a.worker.user?.email ?? null,
      },
    };
  }

  /**
   * Only the assigned worker may accept or decline. This used to take any
   * string from any authenticated caller and write it straight to the column.
   */
  async respond(id: string, status: AssignmentStatus, actor: AuthenticatedUser) {
    const existing = await this.prisma.crewAssignment.findUnique({
      where: { id },
      select: {
        id: true,
        bookingId: true,
        worker: {
          select: {
            userId: true,
            user: { select: { firstName: true, lastName: true } },
          },
        },
        booking: { select: { id: true, title: true, studioId: true } },
      },
    });
    if (!existing) {
      throw new NotFoundException(`CrewAssignment with ID ${id} not found`);
    }
    if (existing.worker.userId !== actor.id) {
      throw new ForbiddenException('Only the assigned worker can respond to this assignment');
    }

    const updated = await this.prisma.crewAssignment.update({
      where: { id },
      data: { status },
      include: ASSIGNMENT_WITH_CONTEXT,
    });

    // Notify the studio owner in real-time.
    const workerName =
      `${existing.worker.user?.firstName ?? ''} ${existing.worker.user?.lastName ?? ''}`.trim() ||
      'A crew member';
    const verb = status === AssignmentStatus.CONFIRMED ? 'accepted' : 'declined';

    const studioOwner = await this.prisma.studioMember.findFirst({
      where: { studioId: existing.booking.studioId, role: 'OWNER' },
      select: { userId: true },
    });

    if (studioOwner) {
      const notif = await this.prisma.notification.create({
        data: {
          userId: studioOwner.userId,
          title: `Job ${verb}`,
          message: `${workerName} ${verb} the invitation for ${existing.booking.title ?? 'a booking'}.`,
          type: 'ASSIGNMENT_RESPONSE',
          referenceId: existing.booking.id,
        },
      });
      this.notifications.emitToUser(studioOwner.userId, 'notification', {
        id: notif.id,
        type: notif.type,
        title: notif.title,
        message: notif.message,
        referenceId: notif.referenceId,
        createdAt: notif.createdAt.toISOString(),
      });
    }

    // Broadcast assignment status change to the studio owner's sockets (for live crew list).
    if (studioOwner) {
      this.notifications.emitToUser(studioOwner.userId, 'assignment_updated', {
        bookingId: existing.booking.id,
        assignmentId: id,
        status,
      });
    }

    return updated;
  }

  async remove(id: string, studioId: string) {
    await this.assertOwnedByStudio(id, studioId);

    const existing = await this.prisma.crewAssignment.findUnique({
      where: { id },
      select: {
        bookingId: true,
        worker: { select: { userId: true, user: { select: { expoPushToken: true } } } },
        booking: { select: { title: true, studio: { select: { name: true } } } },
      },
    });

    await this.prisma.crewAssignment.delete({ where: { id } });

    if (existing) {
      const workerUserId = existing.worker.userId;
      const studioName = existing.booking.studio?.name ?? 'A studio';
      const bookingTitle = existing.booking.title ?? 'a booking';

      const notif = await this.prisma.notification.create({
        data: {
          userId: workerUserId,
          title: 'Removed from booking',
          message: `${studioName} removed you from ${bookingTitle}.`,
          type: 'ASSIGNMENT_REMOVED',
          referenceId: existing.bookingId,
        },
      });
      this.notifications.emitToUser(workerUserId, 'notification', {
        id: notif.id,
        type: notif.type,
        title: notif.title,
        message: notif.message,
        referenceId: notif.referenceId,
        createdAt: notif.createdAt.toISOString(),
      });
      this.notifications.emitToUser(workerUserId, 'assignment_updated', {
        bookingId: existing.bookingId,
        assignmentId: id,
        status: 'REMOVED',
      });

      const token = existing.worker.user?.expoPushToken;
      if (token && Expo.isExpoPushToken(token)) {
        const expo = new Expo();
        try {
          await expo.sendPushNotificationsAsync([{
            to: token,
            sound: 'default',
            title: 'Removed from booking',
            body: `${studioName} removed you from ${bookingTitle}.`,
            data: { bookingId: existing.bookingId },
          }]);
        } catch (error) {
          console.error('Failed to send push notification', error);
        }
      }
    }

    return { success: true };
  }

  private async assertOwnedByStudio(id: string, studioId: string) {
    const assignment = await this.prisma.crewAssignment.findFirst({
      where: { id, booking: { studioId } },
      select: { id: true },
    });
    if (!assignment) {
      throw new NotFoundException(`CrewAssignment with ID ${id} not found`);
    }
  }

  private async canAccess(
    assignment: { booking: { studioId: string }; worker: { userId: string } },
    actor: AuthenticatedUser,
  ) {
    if (assignment.worker.userId === actor.id) return true;
    return actor.studioId !== null && assignment.booking.studioId === actor.studioId;
  }
}
