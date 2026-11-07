import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { MemberStatus, MemberRole } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { normalizeWorkerPublicId } from '../auth/creative-id';
import { TeamInviteAction } from './dto/team.dto';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { NotificationsGateway } from '../notifications/notifications.gateway';

/** Columns safe to expose for any user other than yourself. */
const PUBLIC_USER_SELECT = {
  id: true,
  firstName: true,
  lastName: true,
  email: true,
  avatarUrl: true,
  accountType: true,
  studioId: true,
  createdAt: true,
  workerProfile: {
    select: {
      id: true,
      workerPublicId: true,
      primaryRole: true,
      primaryGear: true,
      city: true,
      state: true,
      bio: true,
    },
  },
} as const;

type TeamMemberRow = {
  user: {
    id: string;
    firstName: string | null;
    lastName: string | null;
    email: string;
    avatarUrl: string | null;
    workerProfile: { id: string; workerPublicId: string; primaryRole: string | null } | null;
  };
  id: string;
  role: MemberRole;
  status: MemberStatus;
};

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsGateway,
  ) {}

  async findOne(id: string) {
    const user = await this.prisma.user.findUnique({
      where: { id },
      select: PUBLIC_USER_SELECT,
    });
    if (!user) {
      throw new NotFoundException(`User with ID ${id} not found`);
    }
    return user;
  }

  async updatePushToken(userId: string, expoPushToken: string) {
    return this.prisma.user.update({
      where: { id: userId },
      data: { expoPushToken },
    });
  }

  /**
   * A user may read their own record, and a studio may read the records of
   * people on its team. Anything else is a 404 rather than a 403 so the
   * endpoint cannot be used to probe which ids exist.
   */
  async findOneVisibleTo(id: string, actorId: string, actorStudioId: string | null) {
    if (id !== actorId) {
      const sharesStudio =
        actorStudioId !== null &&
        (await this.prisma.studioMember.findFirst({
          where: { studioId: actorStudioId, userId: id },
          select: { id: true },
        }));
      if (!sharesStudio) {
        throw new NotFoundException(`User with ID ${id} not found`);
      }
    }
    return this.findOne(id);
  }

  async findByWorkerPublicId(workerPublicId: string) {
    const normalized = normalizeWorkerPublicId(workerPublicId);
    if (!normalized) {
      throw new BadRequestException(
        'Creative ID must contain 6 digits, for example TM-847521',
      );
    }
    const profile = await this.prisma.workerProfile.findUnique({
      where: { workerPublicId: normalized },
      select: { user: { select: PUBLIC_USER_SELECT } },
    });
    if (!profile) {
      throw new NotFoundException(`No creative found with ID ${normalized}`);
    }
    return profile.user;
  }

  /**
   * Updates the caller's own profile. Worker-only fields are applied to the
   * WorkerProfile when the user has one; email and roles are not editable here.
   */
  async updateOwnProfile(userId: string, dto: UpdateProfileDto) {
    const { firstName, lastName, avatarUrl, ...workerFields } = dto;
    const hasWorkerFields = Object.values(workerFields).some((v) => v !== undefined);

    const existing = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { workerProfile: { select: { id: true } } },
    });
    if (!existing) throw new NotFoundException('User not found');

    await this.prisma.user.update({
      where: { id: userId },
      data: {
        firstName,
        lastName,
        avatarUrl,
        workerProfile:
          hasWorkerFields && existing.workerProfile
            ? { update: workerFields }
            : undefined,
      },
    });

    return this.findOne(userId);
  }

  // -------------------------------------------------------------------------
  // Team
  // -------------------------------------------------------------------------

  /**
   * Shapes a member the way both clients render one. `fullName` is computed
   * here so the web and mobile team lists stop showing blank names.
   */
  private toTeamMember(member: TeamMemberRow) {
    const firstName = member.user.firstName ?? '';
    const lastName = member.user.lastName ?? '';
    return {
      id: member.user.id,
      studioMemberId: member.id,
      firstName: member.user.firstName,
      lastName: member.user.lastName,
      fullName: `${firstName} ${lastName}`.trim() || member.user.email,
      email: member.user.email,
      avatarUrl: member.user.avatarUrl,
      role: member.role,
      roleTitle: member.user.workerProfile?.primaryRole ?? null,
      status: member.status,
      workerProfileId: member.user.workerProfile?.id ?? null,
      workerPublicId: member.user.workerProfile?.workerPublicId ?? null,
    };
  }

  async getTeam(studioId: string) {
    const members = await this.prisma.studioMember.findMany({
      where: { studioId },
      include: {
        user: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
            avatarUrl: true,
            workerProfile: {
              select: { id: true, workerPublicId: true, primaryRole: true },
            },
          },
        },
      },
      orderBy: { joinedAt: 'asc' },
    });

    const shaped = members.map((m) => this.toTeamMember(m));
    return {
      active: shaped.filter((m) => m.status === MemberStatus.ACTIVE),
      pending: shaped.filter((m) => m.status === MemberStatus.INVITED),
    };
  }

  async inviteWorkerToStudio(workerPublicId: string, studioId: string) {
    const normalized = normalizeWorkerPublicId(workerPublicId);
    if (!normalized) {
      throw new BadRequestException(
        'Creative ID must contain 6 digits, for example TM-847521',
      );
    }

    const profile = await this.prisma.workerProfile.findUnique({
      where: { workerPublicId: normalized },
      include: { user: true },
    });
    if (!profile) {
      throw new NotFoundException(`No creative found with ID ${normalized}`);
    }

    const studio = await this.prisma.studio.findUnique({ where: { id: studioId } });
    if (!studio) throw new NotFoundException('Studio not found');

    const existing = await this.prisma.studioMember.findUnique({
      where: { studioId_userId: { studioId, userId: profile.userId } },
    });
    if (existing?.status === MemberStatus.ACTIVE) {
      throw new BadRequestException('This creative is already on your team');
    }

    return this.prisma.$transaction(async (tx) => {
      const member = await tx.studioMember.upsert({
        where: { studioId_userId: { studioId, userId: profile.userId } },
        update: { status: MemberStatus.INVITED },
        create: {
          studioId,
          userId: profile.userId,
          status: MemberStatus.INVITED,
          role: MemberRole.MEMBER,
        },
      });

      const notif = await tx.notification.create({
        data: {
          userId: profile.userId,
          title: 'New Studio Invitation',
          message: `${studio.name} has invited you to join their team.`,
          type: 'TEAM_INVITE',
          referenceId: studioId,
        },
      });

      // Real-time push if the worker has the app open.
      this.notifications.emitToUser(profile.userId, 'notification', {
        id: notif.id,
        type: notif.type,
        title: notif.title,
        message: notif.message,
        referenceId: notif.referenceId,
        createdAt: notif.createdAt.toISOString(),
      });

      return member;
    });
  }

  async respondToTeamInvite(
    userId: string,
    studioId: string,
    action: TeamInviteAction,
  ) {
    const invite = await this.prisma.studioMember.findUnique({
      where: { studioId_userId: { studioId, userId } },
    });
    if (!invite || invite.status !== MemberStatus.INVITED) {
      throw new NotFoundException('No pending invitation from this studio');
    }

    await this.prisma.$transaction(async (tx) => {
      if (action === TeamInviteAction.ACCEPT) {
        await tx.studioMember.update({
          where: { studioId_userId: { studioId, userId } },
          data: { status: MemberStatus.ACTIVE },
        });
        await tx.user.update({ where: { id: userId }, data: { studioId } });
      } else {
        await tx.studioMember.delete({
          where: { studioId_userId: { studioId, userId } },
        });
      }

      await tx.notification.updateMany({
        where: { userId, type: 'TEAM_INVITE', referenceId: studioId },
        data: { read: true },
      });
    });

    return { success: true, action };
  }

  async removeUserFromStudio(userId: string, studioId: string, actingUserId: string) {
    if (userId === actingUserId) {
      throw new BadRequestException('You cannot remove yourself from your own studio');
    }

    const member = await this.prisma.studioMember.findUnique({
      where: { studioId_userId: { studioId, userId } },
    });
    if (!member) throw new NotFoundException('This user is not on your team');
    if (member.role === MemberRole.OWNER) {
      throw new ForbiddenException('The studio owner cannot be removed');
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.studioMember.delete({
        where: { studioId_userId: { studioId, userId } },
      });
      // Clearing the denormalised pointer too - leaving it set kept removed
      // members able to read the studio's bookings.
      await tx.user.updateMany({
        where: { id: userId, studioId },
        data: { studioId: null },
      });
    });

    return { success: true };
  }

  // -------------------------------------------------------------------------
  // Notifications
  // -------------------------------------------------------------------------

  async getUserNotifications(userId: string) {
    return this.prisma.notification.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
  }

  async markNotificationAsRead(id: string, userId: string) {
    // updateMany + userId filter: update() alone would let anyone flip any
    // notification by guessing its id.
    const result = await this.prisma.notification.updateMany({
      where: { id, userId },
      data: { read: true },
    });
    if (result.count === 0) {
      throw new NotFoundException('Notification not found');
    }
    return { success: true };
  }

  async markAllNotificationsAsRead(userId: string) {
    const result = await this.prisma.notification.updateMany({
      where: { userId, read: false },
      data: { read: true },
    });
    return { success: true, updated: result.count };
  }
}
