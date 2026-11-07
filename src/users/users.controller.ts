import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Put,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { extname, join } from 'path';
import { UsersService } from './users.service';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../common/types/authenticated-user';
import { Roles } from '../auth/roles.decorator';
import {
  InviteToTeamDto,
  RemoveFromTeamDto,
  RespondToInviteDto,
} from './dto/team.dto';
import { UpdateProfileDto } from './dto/update-profile.dto';

/**
 * Note: this controller used to carry a class-level `@Public()`, which exposed
 * every user's email, every notification and both team-mutation endpoints to
 * unauthenticated callers. All routes now require a valid JWT, and the studio
 * is always taken from that token rather than from the request body.
 */
@ApiTags('users')
@ApiBearerAuth()
@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  private requireStudio(user: AuthenticatedUser): string {
    if (!user.studioId) {
      throw new BadRequestException(
        'You need to finish studio onboarding before managing a team',
      );
    }
    return user.studioId;
  }

  @Patch('me')
  @ApiOperation({ summary: "Update the caller's own profile" })
  updateOwnProfile(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: UpdateProfileDto,
  ) {
    return this.usersService.updateOwnProfile(user.id, dto);
  }

  @Post('me/avatar')
  @ApiOperation({ summary: "Upload caller's avatar (local storage)" })
  @UseInterceptors(
    FileInterceptor('file', {
      storage: diskStorage({
        destination: join(process.cwd(), 'uploads', 'avatars'),
        filename: (_req, file, cb) => {
          const ext = extname(file.originalname).toLowerCase();
          cb(null, `avatar-${Date.now()}${ext}`);
        },
      }),
      limits: { fileSize: 5 * 1024 * 1024 },
      fileFilter: (_req, file, cb) => {
        const ext = extname(file.originalname).toLowerCase();
        if (!['.jpg', '.jpeg', '.png', '.gif', '.webp'].includes(ext)) {
          return cb(new BadRequestException('Only image files are allowed'), false);
        }
        cb(null, true);
      },
    }),
  )
  async uploadAvatar(
    @CurrentUser() user: AuthenticatedUser,
    @UploadedFile() file: Express.Multer.File,
  ) {
    if (!file) throw new BadRequestException('No file uploaded');
    const avatarUrl = `/uploads/avatars/${file.filename}`;
    return this.usersService.updateOwnProfile(user.id, { avatarUrl });
  }

  @Post('push-token')
  @ApiOperation({ summary: "Save the caller's push token" })
  updatePushToken(
    @CurrentUser() user: AuthenticatedUser,
    @Body('token') token: string,
  ) {
    if (!token) throw new BadRequestException('Token is required');
    return this.usersService.updatePushToken(user.id, token);
  }

  // --- Team (declared before ':id' so they are not shadowed) ---------------

  @Get('team')
  @ApiOperation({ summary: "List the current user's studio team" })
  getTeam(@CurrentUser() user: AuthenticatedUser) {
    return this.usersService.getTeam(this.requireStudio(user));
  }

  @Post('team/invite')
  @Roles('ADMIN')
  @ApiOperation({ summary: 'Invite a creative to your studio team' })
  inviteToTeam(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: InviteToTeamDto,
  ) {
    return this.usersService.inviteWorkerToStudio(
      dto.workerPublicId,
      this.requireStudio(user),
    );
  }

  @Post('team/remove')
  @Roles('ADMIN')
  @ApiOperation({ summary: 'Remove a creative from your studio team' })
  removeFromTeam(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: RemoveFromTeamDto,
  ) {
    return this.usersService.removeUserFromStudio(
      dto.userId,
      this.requireStudio(user),
      user.id,
    );
  }

  @Post('team/respond')
  @ApiOperation({ summary: 'Respond to a team invitation addressed to you' })
  respondToTeamInvite(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: RespondToInviteDto,
  ) {
    return this.usersService.respondToTeamInvite(user.id, dto.studioId, dto.action);
  }

  // --- Notifications -------------------------------------------------------

  @Get('notifications')
  @ApiOperation({ summary: 'Get notifications for the current user' })
  getNotifications(@CurrentUser() user: AuthenticatedUser) {
    return this.usersService.getUserNotifications(user.id);
  }

  @Put('notifications/read-all')
  @ApiOperation({ summary: 'Mark every notification as read' })
  markAllNotificationsAsRead(@CurrentUser() user: AuthenticatedUser) {
    return this.usersService.markAllNotificationsAsRead(user.id);
  }

  @Put('notifications/:id/read')
  @ApiOperation({ summary: 'Mark one notification as read' })
  markNotificationAsRead(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.usersService.markNotificationAsRead(id, user.id);
  }

  // --- Lookup --------------------------------------------------------------

  @Get('search/:workerPublicId')
  @ApiOperation({ summary: 'Look up a creative by their public ID' })
  findByWorkerPublicId(@Param('workerPublicId') workerPublicId: string) {
    return this.usersService.findByWorkerPublicId(workerPublicId);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a user visible to the caller' })
  findOne(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.usersService.findOneVisibleTo(id, user.id, user.studioId);
  }
}
