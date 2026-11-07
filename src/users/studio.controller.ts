import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Patch,
  Post,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiConsumes } from '@nestjs/swagger';
import { diskStorage } from 'multer';
import { extname, join } from 'path';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../common/types/authenticated-user';
import { PrismaService } from '../prisma/prisma.service';
import { UpdateStudioDto } from './dto/update-studio.dto';
import { Roles } from '../auth/roles.decorator';

const ALLOWED_EXTS = ['.jpg', '.jpeg', '.png', '.gif', '.webp'];

@ApiTags('studio')
@ApiBearerAuth()
@Controller('studio')
export class StudioController {
  constructor(private readonly prisma: PrismaService) {}

  private requireStudio(user: AuthenticatedUser): string {
    if (!user.studioId) {
      throw new BadRequestException('No studio associated with your account');
    }
    return user.studioId;
  }

  @Get()
  @ApiOperation({ summary: "Get the caller's studio profile" })
  async getStudio(@CurrentUser() user: AuthenticatedUser) {
    const studioId = this.requireStudio(user);
    return this.prisma.studio.findUniqueOrThrow({ where: { id: studioId } });
  }

  @Patch()
  @Roles('ADMIN')
  @ApiOperation({ summary: "Update the caller's studio profile" })
  async updateStudio(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: UpdateStudioDto,
  ) {
    const studioId = this.requireStudio(user);
    return this.prisma.studio.update({ where: { id: studioId }, data: dto });
  }

  @Post('logo')
  @Roles('ADMIN')
  @ApiOperation({ summary: 'Upload studio logo (local storage)' })
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: diskStorage({
        destination: join(process.cwd(), 'uploads', 'logos'),
        filename: (_req, file, cb) => {
          const ext = extname(file.originalname).toLowerCase();
          cb(null, `studio-${Date.now()}${ext}`);
        },
      }),
      limits: { fileSize: 5 * 1024 * 1024 }, // 5 MB
      fileFilter: (_req, file, cb) => {
        const ext = extname(file.originalname).toLowerCase();
        if (!ALLOWED_EXTS.includes(ext)) {
          return cb(new BadRequestException('Only image files are allowed'), false);
        }
        cb(null, true);
      },
    }),
  )
  async uploadLogo(
    @CurrentUser() user: AuthenticatedUser,
    @UploadedFile() file: Express.Multer.File,
  ) {
    if (!file) throw new BadRequestException('No file uploaded');
    const studioId = this.requireStudio(user);
    const logoUrl = `/uploads/logos/${file.filename}`;
    await this.prisma.studio.update({ where: { id: studioId }, data: { logoUrl } });
    return { logoUrl };
  }
}
