/**
 * The user shape every auth endpoint returns. The web and mobile clients both
 * read this directly after login, so it must stay in sync with
 * `frontend/types/api.ts` and `mobile/src/types/api.ts`.
 */
export interface AuthUser {
  id: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
  fullName: string;
  avatarUrl: string | null;
  accountType: string | null;
  studioId: string | null;
  /** Denormalised for the app shell, which shows the studio name and logo in its header. */
  studio: { id: string; name: string; logoUrl: string | null } | null;
  roles: string[];
  workerProfileId: string | null;
  workerPublicId: string | null;
  bio: string | null;
  primaryRole: string | null;
  primaryGear: string | null;
  city: string | null;
  memberOfStudio: { id: string; name: string } | null;
}

export interface AuthResponse {
  access_token: string;
  user: AuthUser;
}
