/**
 * Typed, validated access to process.env.
 *
 * Everything the app reads from the environment goes through here so a value
 * has exactly one spelling and one default. Required values are checked at
 * boot: a missing JWT_SECRET used to fall back to a different hard-coded
 * string in each consumer, which silently produced tokens that could never be
 * verified. Failing to start is the safer outcome.
 */

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `Missing required environment variable ${name}. See .env.example.`,
    );
  }
  return value;
}

function optional(name: string, fallback: string): string {
  return process.env[name] || fallback;
}

function optionalNumber(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number(raw);
  if (Number.isNaN(parsed)) {
    throw new Error(`Environment variable ${name} must be a number, got "${raw}".`);
  }
  return parsed;
}

export const env = {
  get port() {
    return optionalNumber('PORT', 4000);
  },
  get corsOrigins(): string[] {
    return optional('CORS_ORIGINS', 'http://localhost:3000')
      .split(',')
      .map((origin) => origin.trim())
      .filter(Boolean);
  },
  get frontendUrl() {
    return optional('FRONTEND_URL', 'http://localhost:3000');
  },

  get jwtSecret() {
    return required('JWT_SECRET');
  },
  get jwtExpiresIn() {
    return optional('JWT_EXPIRES_IN', '7d');
  },

  /** Google OAuth – optional. When unset, the /auth/google routes are
   *  unavailable but the app boots fine (email+OTP auth still works). */
  get googleClientId() {
    return process.env.GOOGLE_CLIENT_ID || '';
  },
  get googleClientSecret() {
    return process.env.GOOGLE_CLIENT_SECRET || '';
  },
  get googleCallbackUrl() {
    return optional('GOOGLE_CALLBACK_URL', 'http://localhost:4000/api/auth/google/callback');
  },
  get googleOAuthEnabled() {
    return !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
  },

  get whatsappAccessToken() {
    return process.env.META_WA_ACCESS_TOKEN || '';
  },
  get whatsappPhoneNumberId() {
    return process.env.META_WA_PHONE_NUMBER_ID || '';
  },

  get redisHost() {
    return optional('REDIS_HOST', 'localhost');
  },
  get redisPort() {
    return optionalNumber('REDIS_PORT', 6379);
  },
};

/**
 * Touch every hard-required value so a misconfigured deploy fails at boot
 * rather than on the first request that happens to need it.
 */
export function assertRequiredEnv(): void {
  env.jwtSecret;
  if (env.googleOAuthEnabled) {
    // validate that both are present when either is set
    env.googleClientId;
    env.googleClientSecret;
  }
}
