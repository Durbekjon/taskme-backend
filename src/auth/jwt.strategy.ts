import { ExtractJwt, Strategy } from 'passport-jwt';
import { PassportStrategy } from '@nestjs/passport';
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { env } from '../config/env';
import type { AuthenticatedUser } from '../common/types/authenticated-user';

export interface JwtPayload {
  sub: string;
  email: string;
  roles: string[];
  studioId: string | null;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(private readonly prisma: PrismaService) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: env.jwtSecret,
    });
  }

  async validate(payload: JwtPayload): Promise<AuthenticatedUser> {
    // JWTs live for days; a deleted account must stop working immediately.
    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
      select: { deletedAt: true },
    });
    if (!user || user.deletedAt) throw new UnauthorizedException();
    return {
      id: payload.sub,
      email: payload.email,
      roles: payload.roles ?? [],
      studioId: payload.studioId ?? null,
    };
  }
}
