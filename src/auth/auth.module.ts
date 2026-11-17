import { Module } from '@nestjs/common';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { PassportModule } from '@nestjs/passport';
import { JwtModule, JwtModuleOptions } from '@nestjs/jwt';

import { JwtStrategy } from './jwt.strategy';
import { AppleAuthService } from './apple-auth.service';
import { GoogleStrategy } from './google.strategy';
import { PrismaModule } from '../prisma/prisma.module';
import { env } from '../config/env';

import { WhatsappModule } from '../whatsapp/whatsapp.module';

@Module({
  imports: [
    PrismaModule,
    WhatsappModule,
    PassportModule,
    JwtModule.registerAsync({
      useFactory: (): JwtModuleOptions => ({
        secret: env.jwtSecret,
        // `expiresIn` is typed as a template literal union upstream; the value
        // is validated at runtime by jsonwebtoken.
        signOptions: { expiresIn: env.jwtExpiresIn as any },
      }),
    }),
  ],
  providers: [AuthService, JwtStrategy, GoogleStrategy, AppleAuthService],
  controllers: [AuthController],
  exports: [AuthService, AppleAuthService],
})
export class AuthModule {}
