import { Controller, Get, Post, Body, UseGuards, Req, Res, Logger } from '@nestjs/common';
import { ThrottlerGuard, Throttle } from '@nestjs/throttler';
import { AuthService } from './auth.service';

import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { CreateUserDto } from '../users/dto/create-user.dto';
import { LoginDto } from './dto/login.dto';
import { SendOtpDto } from './dto/send-otp.dto';
import { VerifyOtpDto } from './dto/verify-otp.dto';
import { Public } from './public.decorator';
import { GoogleAuthGuard } from './google-auth.guard';
import { OnboardingDto } from './dto/onboarding.dto';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../common/types/authenticated-user';
import { env } from '../config/env';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  private readonly logger = new Logger(AuthController.name);

  constructor(private readonly authService: AuthService) {}

  @Public()
  @Post('register')
  @UseGuards(ThrottlerGuard)
  @ApiOperation({ summary: 'Register a new user and return a session' })
  @ApiResponse({ status: 201, description: 'Returns { access_token, user }' })
  async register(@Body() createUserDto: CreateUserDto) {
    return this.authService.register(createUserDto);
  }

  @Public()
  @Post('login')
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiOperation({ summary: 'Login and get a JWT token' })
  @ApiResponse({ status: 200, description: 'Returns { access_token, user }' })
  async login(@Body() loginDto: LoginDto) {
    return this.authService.login(loginDto);
  }

  @Get('me')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get the currently authenticated user' })
  async me(@CurrentUser() user: AuthenticatedUser) {
    return this.authService.getAuthUser(user.id);
  }

  @Public()
  @Get('google')
  @UseGuards(GoogleAuthGuard)
  @ApiOperation({ summary: 'Initiate Google OAuth2 login' })
  async googleAuth() {
    // Passport redirects automatically
  }

  @Public()
  @Get('google/callback')
  @UseGuards(GoogleAuthGuard)
  @ApiOperation({ summary: 'Google OAuth2 callback' })
  async googleAuthCallback(@Req() req: any, @Res() res: any) {
    const { access_token, user } = this.authService.buildAuthResponse(req.user);
    // Only the token travels in the URL; the client calls /auth/me for the
    // rest, so profile fields never end up in browser history or referrers.
    res.redirect(
      `${env.frontendUrl}/auth/google/success?token=${encodeURIComponent(access_token)}`,
    );
    this.logger.debug(`Google OAuth completed for user ${user.id}`);
  }

  @Post('whatsapp/send-otp')
  @ApiBearerAuth()
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 3, ttl: 300_000 } })
  @ApiOperation({ summary: 'Send an OTP to WhatsApp' })
  async sendWhatsappOtp(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: SendOtpDto,
  ) {
    return this.authService.sendWhatsappOtp(user.id, dto);
  }

  @Post('whatsapp/verify-otp')
  @ApiBearerAuth()
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 10, ttl: 300_000 } })
  @ApiOperation({ summary: 'Verify a WhatsApp OTP' })
  async verifyWhatsappOtp(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: VerifyOtpDto,
  ) {
    return this.authService.verifyWhatsappOtp(user.id, dto);
  }

  @Post('onboarding')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Complete user onboarding and set role' })
  @ApiResponse({ status: 200, description: 'Returns { access_token, user }' })
  async onboarding(
    @CurrentUser() user: AuthenticatedUser,
    @Body() onboardingDto: OnboardingDto,
  ) {
    return this.authService.onboarding(user.id, onboardingDto);
  }
}
