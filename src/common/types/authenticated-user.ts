/**
 * Shape produced by JwtStrategy.validate() and attached to `request.user`.
 */
export interface AuthenticatedUser {
  id: string;
  email: string;
  roles: string[];
  studioId: string | null;
}
