import { Injectable, Logger } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { Strategy, StrategyOptions, VerifyCallback } from 'passport-google-oauth20';
import { AuthService } from './auth.service';
import { env } from '../config/env';

@Injectable()
export class GoogleStrategy extends PassportStrategy(Strategy, 'google') {
  private readonly logger = new Logger(GoogleStrategy.name);

  constructor(private authService: AuthService) {
    // When Google OAuth env vars are absent we still construct the strategy
    // with placeholder values so Passport doesn't crash on boot.  The actual
    // /auth/google routes will return a 503 guard (see auth.controller.ts).
    const options: StrategyOptions = {
      clientID: env.googleClientId || 'GOOGLE_NOT_CONFIGURED',
      clientSecret: env.googleClientSecret || 'GOOGLE_NOT_CONFIGURED',
      callbackURL: env.googleCallbackUrl,
      scope: ['email', 'profile', 'https://www.googleapis.com/auth/calendar'],
    };
    super(options);
    this.logger.debug('GoogleStrategy initialized');
  }

  async validate(
    accessToken: string,
    refreshToken: string,
    profile: any,
    done: VerifyCallback,
  ): Promise<any> {
    this.logger.debug(`Google OAuth callback triggered`);
    this.logger.debug(`Profile ID: ${profile.id}`);
    this.logger.debug(`Profile email: ${profile.emails?.[0]?.value}`);
    this.logger.debug(`Access token received: ${!!accessToken}`);
    this.logger.debug(`Refresh token received: ${!!refreshToken}`);

    const { name, emails, photos } = profile;
    const email = emails[0].value;

    const googleUser = {
      googleId: profile.id,
      email,
      firstName: name.givenName,
      lastName: name.familyName,
      avatarUrl: photos?.[0]?.value,
      accessToken,
      refreshToken,
    };

    this.logger.debug(`Calling authService.validateGoogleUser for: ${email}`);
    const user = await this.authService.validateGoogleUser(googleUser);
    this.logger.debug(`User validated/created: ${user?.id}`);

    done(null, user as any);
  }
}
