import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { AuthenticatedUser } from '../types/authenticated-user';

/**
 * Typed access to the JWT-derived user, replacing `@Req() req: any` plus the
 * `req.user.userId || req.user.id || req.user.sub` guesswork that was spread
 * across the controllers.
 */
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthenticatedUser => {
    return ctx.switchToHttp().getRequest().user;
  },
);
