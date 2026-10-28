import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../prisma/prisma.service';
import * as bcrypt from 'bcrypt';
import { CreateUserDto } from '../users/dto/create-user.dto';
import { LoginDto } from './dto/login.dto';
import { OnboardingDto, OnboardingRole } from './dto/onboarding.dto';
import { SendOtpDto } from './dto/send-otp.dto';
import { VerifyOtpDto } from './dto/verify-otp.dto';
import { AuthResponse, AuthUser } from './auth.types';
import { generateWorkerPublicId, normalizeWorkerPublicId } from './creative-id';
import { WhatsappService } from '../whatsapp/whatsapp.service';

const OTP_TTL_MINUTES = 10;
const OTP_MAX_ATTEMPTS = 5;

/** Everything needed to build an AuthUser in one query. */
const AUTH_USER_INCLUDE = {
  userRoles: { include: { role: true } },
  workerProfile: true,
  studio: { select: { id: true, name: true, logoUrl: true } },
  studioMembers: { select: { studio: { select: { id: true, name: true } }, status: true }, take: 1 },
} as const;

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private prisma: PrismaService,
    private jwtService: JwtService,
    private whatsappService: WhatsappService,
  ) {}

  // -------------------------------------------------------------------------
  // Shared shaping
  // -------------------------------------------------------------------------

  private toAuthUser(user: any): AuthUser {
    const firstName = user.firstName ?? '';
    const lastName = user.lastName ?? '';
    return {
      id: user.id,
      email: user.email,
      firstName: firstName || null,
      lastName: lastName || null,
      fullName: `${firstName} ${lastName}`.trim() || user.email,
      avatarUrl: user.avatarUrl ?? null,
      accountType: user.accountType ?? null,
      studioId: user.studioId ?? null,
      studio: user.studio
        ? { id: user.studio.id, name: user.studio.name, logoUrl: user.studio.logoUrl ?? null }
        : null,
      roles: user.userRoles?.map((ur: any) => ur.role.name) ?? [],
      workerProfileId: user.workerProfile?.id ?? null,
      workerPublicId: user.workerProfile?.workerPublicId ?? null,
      bio: user.workerProfile?.bio ?? null,
      primaryRole: user.workerProfile?.primaryRole ?? null,
      primaryGear: user.workerProfile?.primaryGear ?? null,
      city: user.workerProfile?.city ?? null,
      memberOfStudio: user.studioMembers?.[0]?.studio
        ? { id: user.studioMembers[0].studio.id, name: user.studioMembers[0].studio.name }
        : null,
    };
  }

  /**
   * The single place a token is minted. Every caller returns the same
   * `{ access_token, user }` envelope so no client has to guess what the
   * response contains.
   */
  buildAuthResponse(user: any): AuthResponse {
    const authUser = this.toAuthUser(user);
    const payload = {
      sub: authUser.id,
      email: authUser.email,
      roles: authUser.roles,
      studioId: authUser.studioId,
    };
    return {
      access_token: this.jwtService.sign(payload),
      user: authUser,
    };
  }

  async getAuthUser(userId: string): Promise<AuthUser> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: AUTH_USER_INCLUDE,
    });
    if (!user) throw new NotFoundException('User not found');
    return this.toAuthUser(user);
  }

  // -------------------------------------------------------------------------
  // Email + password
  // -------------------------------------------------------------------------

  async validateUser(email: string, pass: string) {
    const user = await this.prisma.user.findUnique({
      where: { email },
      include: AUTH_USER_INCLUDE,
    });
    // Google-only accounts have an empty password hash; bcrypt.compare would
    // reject anyway, but bail explicitly so the intent is clear.
    if (!user || !user.password) return null;
    if (!(await bcrypt.compare(pass, user.password))) return null;
    return user;
  }

  async login(loginDto: LoginDto): Promise<AuthResponse> {
    const user = await this.validateUser(loginDto.email, loginDto.password);
    if (!user) {
      throw new UnauthorizedException('Invalid credentials');
    }
    return this.buildAuthResponse(user);
  }

  async register(createUserDto: CreateUserDto): Promise<AuthResponse> {
    const existing = await this.prisma.user.findUnique({
      where: { email: createUserDto.email },
    });
    if (existing) {
      throw new BadRequestException('An account with this email already exists');
    }

    const hashedPassword = await bcrypt.hash(createUserDto.password, 10);
    const defaultRole = await this.prisma.role.findUnique({ where: { name: 'USER' } });

    const user = await this.prisma.user.create({
      data: {
        firstName: createUserDto.firstName,
        lastName: createUserDto.lastName,
        email: createUserDto.email,
        password: hashedPassword,
        userRoles: defaultRole
          ? { create: [{ role: { connect: { id: defaultRole.id } } }] }
          : undefined,
      },
      include: AUTH_USER_INCLUDE,
    });

    // Registration logs the user straight in, same envelope as /auth/login.
    return this.buildAuthResponse(user);
  }

  // -------------------------------------------------------------------------
  // Google OAuth
  // -------------------------------------------------------------------------

  async validateGoogleUser(googleUser: {
    googleId: string;
    email: string;
    firstName: string;
    lastName?: string;
    avatarUrl?: string;
    accessToken: string;
    refreshToken?: string;
  }) {
    const existing = await this.prisma.user.findUnique({
      where: { email: googleUser.email },
    });

    if (existing) {
      return this.prisma.user.update({
        where: { id: existing.id },
        data: {
          googleId: googleUser.googleId,
          googleAccessToken: googleUser.accessToken,
          googleRefreshToken: googleUser.refreshToken ?? null,
          avatarUrl: googleUser.avatarUrl,
        },
        include: AUTH_USER_INCLUDE,
      });
    }

    const defaultRole = await this.prisma.role.findUnique({ where: { name: 'USER' } });
    return this.prisma.user.create({
      data: {
        email: googleUser.email,
        firstName: googleUser.firstName,
        lastName: googleUser.lastName,
        googleId: googleUser.googleId,
        googleAccessToken: googleUser.accessToken,
        googleRefreshToken: googleUser.refreshToken ?? null,
        avatarUrl: googleUser.avatarUrl,
        password: '', // Google-only account, see validateUser()
        userRoles: defaultRole
          ? { create: [{ role: { connect: { id: defaultRole.id } } }] }
          : undefined,
      },
      include: AUTH_USER_INCLUDE,
    });
  }

  // -------------------------------------------------------------------------
  // Onboarding
  // -------------------------------------------------------------------------

  async onboarding(userId: string, dto: OnboardingDto): Promise<AuthResponse> {
    const existingUser = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { userRoles: true, workerProfile: true },
    });
    if (!existingUser) throw new NotFoundException('User not found');

    const roleName = dto.role === OnboardingRole.STUDIO ? 'ADMIN' : 'CREATIVE';
    const role = await this.prisma.role.upsert({
      where: { name: roleName },
      update: {},
      create: { name: roleName },
    });

    const hasRole = existingUser.userRoles.some((ur) => ur.roleId === role.id);
    const userRolesUpdate = hasRole ? undefined : { create: { roleId: role.id } };

    if (dto.role === OnboardingRole.STUDIO) {
      const user = await this.prisma.$transaction(async (tx) => {
        const studio = await tx.studio.create({
          data: {
            name: dto.studioName || 'My Studio',
            address: dto.studioLocation || '',
            createdById: userId,
          },
        });
        return tx.user.update({
          where: { id: userId },
          data: {
            firstName: dto.firstName,
            lastName: dto.lastName,
            whatsapp: dto.whatsapp,
            accountType: 'studio',
            studioId: studio.id,
            userRoles: userRolesUpdate,
            // The studio owner is also a team member, otherwise they do not
            // appear in their own crew list.
            studioMembers: {
              create: { studioId: studio.id, role: 'OWNER', status: 'ACTIVE' },
            },
          },
          include: AUTH_USER_INCLUDE,
        });
      });
      return this.buildAuthResponse(user);
    }

    const workerPublicId =
      (dto.creativeId && normalizeWorkerPublicId(dto.creativeId)) ||
      (await this.generateUniqueWorkerPublicId());

    const user = await this.prisma.user.update({
      where: { id: userId },
      data: {
        firstName: dto.firstName,
        lastName: dto.lastName,
        whatsapp: dto.whatsapp,
        accountType: 'worker',
        userRoles: userRolesUpdate,
        workerProfile: existingUser.workerProfile
          ? {
              update: {
                primaryRole: dto.specialization,
                primaryGear: dto.primaryGear,
              },
            }
          : {
              create: {
                workerPublicId,
                primaryRole: dto.specialization,
                primaryGear: dto.primaryGear,
              },
            },
      },
      include: AUTH_USER_INCLUDE,
    });
    return this.buildAuthResponse(user);
  }

  private async generateUniqueWorkerPublicId(): Promise<string> {
    for (let attempt = 0; attempt < 10; attempt++) {
      const candidate = generateWorkerPublicId();
      const clash = await this.prisma.workerProfile.findUnique({
        where: { workerPublicId: candidate },
        select: { id: true },
      });
      if (!clash) return candidate;
    }
    throw new BadRequestException('Could not allocate a creative ID, please retry');
  }

  // -------------------------------------------------------------------------
  // WhatsApp OTP
  // -------------------------------------------------------------------------

  async sendWhatsappOtp(userId: string, dto: SendOtpDto) {
    const otp = String(Math.floor(100000 + Math.random() * 900000));
    const expiry = new Date(Date.now() + OTP_TTL_MINUTES * 60_000);

    const user = await this.prisma.user.update({
      where: { id: userId },
      data: {
        whatsapp: dto.phoneNumber,
        // Stored hashed: a database leak should not hand over live OTPs.
        whatsappOtp: await bcrypt.hash(otp, 10),
        whatsappOtpExpiry: expiry,
        whatsappOtpAttempts: 0,
        whatsappVerified: false,
      },
    });

    await this.whatsappService.sendOtp(dto.phoneNumber, otp, user.firstName || 'User');
    return { message: 'OTP sent successfully' };
  }

  async verifyWhatsappOtp(userId: string, dto: VerifyOtpDto) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');

    if (!user.whatsappOtp || !user.whatsappOtpExpiry) {
      throw new BadRequestException('No OTP was requested');
    }
    if (new Date() > user.whatsappOtpExpiry) {
      throw new BadRequestException('OTP expired, please request a new one');
    }
    if (user.whatsappOtpAttempts >= OTP_MAX_ATTEMPTS) {
      throw new BadRequestException('Too many attempts, please request a new OTP');
    }

    if (!(await bcrypt.compare(dto.otp, user.whatsappOtp))) {
      await this.prisma.user.update({
        where: { id: userId },
        data: { whatsappOtpAttempts: { increment: 1 } },
      });
      throw new BadRequestException('Invalid OTP');
    }

    await this.prisma.user.update({
      where: { id: userId },
      data: {
        whatsappVerified: true,
        whatsappOtp: null,
        whatsappOtpExpiry: null,
        whatsappOtpAttempts: 0,
      },
    });

    return { message: 'WhatsApp verified successfully', verified: true };
  }
}
