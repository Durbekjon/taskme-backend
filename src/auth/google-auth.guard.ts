import { Injectable, ExecutionContext, Logger } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

/** base64url SHA-256 digest: exactly 43 chars. */
const PKCE_CHALLENGE = /^[A-Za-z0-9_-]{43}$/;

@Injectable()
export class GoogleAuthGuard extends AuthGuard('google') {
  private readonly logger = new Logger(GoogleAuthGuard.name);

  canActivate(context: ExecutionContext) {
    this.logger.debug('GoogleAuthGuard.canActivate called');
    return super.canActivate(context);
  }

  /**
   * - `access_type=offline` + `prompt=consent`: calendar sync needs a refresh
   *   token, and Google only issues one on an explicit consent.
   * - `include_granted_scopes` keeps earlier grants on incremental consent.
   * - Mobile sign-in carries a PKCE challenge through Google's `state`, so the
   *   callback knows to hand back an exchange code instead of a web redirect.
   */
  getAuthenticateOptions(context: ExecutionContext) {
    const req = context
      .switchToHttp()
      .getRequest<{ query?: Record<string, string | undefined> }>();
    const challenge = req.query?.code_challenge;
    const mobile =
      req.query?.client === 'mobile' &&
      !!challenge &&
      PKCE_CHALLENGE.test(challenge);
    return {
      accessType: 'offline',
      includeGrantedScopes: true,
      prompt: 'consent',
      ...(mobile ? { state: `m.${challenge}` } : {}),
    };
  }
}
