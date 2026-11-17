import { Injectable, ExecutionContext, Logger } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

@Injectable()
export class GoogleAuthGuard extends AuthGuard('google') {
  private readonly logger = new Logger(GoogleAuthGuard.name);

  canActivate(context: ExecutionContext) {
    this.logger.debug('GoogleAuthGuard.canActivate called');
    return super.canActivate(context);
  }

  /**
   * Calendar sync needs a refresh token, and Google only issues one for
   * `access_type=offline`. `include_granted_scopes` lets incremental consent
   * keep earlier grants.
   */
  getAuthenticateOptions() {
    // `prompt: consent` makes Google issue a refresh token even to users who
    // granted access before; without it they only ever get a 1‑hour token.
    return { accessType: 'offline', includeGrantedScopes: true, prompt: 'consent' };
  }
}
