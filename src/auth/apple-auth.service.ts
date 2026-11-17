import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { createHash, createPublicKey, sign, verify } from 'crypto';
import { env } from '../config/env';

const APPLE_ISSUER = 'https://appleid.apple.com';
const KEYS_URL = `${APPLE_ISSUER}/auth/keys`;
const TOKEN_URL = `${APPLE_ISSUER}/auth/token`;
const REVOKE_URL = `${APPLE_ISSUER}/auth/revoke`;

interface AppleJwk {
  kid: string;
  kty: string;
  alg: string;
  n: string;
  e: string;
  use: string;
}

export interface AppleIdentity {
  appleId: string;
  email: string | null;
  emailVerified: boolean;
}

/**
 * Sign in with Apple, server side.
 *
 * The app sends Apple's identity token (an RS256 JWT). We check it against
 * Apple's published keys, our bundle id as audience, and the nonce the app
 * generated, so a token minted for another app or replayed cannot be used.
 * No extra dependencies: Node turns the JWK into a key, jsonwebtoken checks it.
 */
@Injectable()
export class AppleAuthService {
  private readonly logger = new Logger(AppleAuthService.name);
  private keys: { at: number; byKid: Map<string, string> } | null = null;

  async verifyIdentityToken(
    identityToken: string,
    rawNonce: string,
  ): Promise<AppleIdentity> {
    const kid = this.headerKid(identityToken);
    const pem = await this.publicKey(kid);

    // Verified with Node's crypto directly: JwtService always uses the app's
    // HMAC secret and ignores a passed public key, so RS256 never validates.
    const [h, p, s] = identityToken.split('.');
    const reject = (why: string): never => {
      this.logger.warn(`Apple token rejected: ${why}`);
      throw new UnauthorizedException('Apple sign-in failed, please try again');
    };
    if (!h || !p || !s) reject('malformed');
    const header = JSON.parse(Buffer.from(h, 'base64url').toString()) as {
      alg?: string;
    };
    if (header.alg !== 'RS256') reject(`alg ${header.alg}`);
    if (
      !verify(
        'sha256',
        Buffer.from(`${h}.${p}`),
        pem,
        Buffer.from(s, 'base64url'),
      )
    ) {
      reject('bad signature');
    }

    const claims = JSON.parse(Buffer.from(p, 'base64url').toString()) as {
      iss?: string;
      aud?: string | string[];
      exp?: number;
      sub?: string;
      email?: string;
      email_verified?: boolean | string;
      nonce?: string;
    };
    const audiences = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
    if (claims.iss !== APPLE_ISSUER) reject('issuer');
    if (!audiences.includes(env.appleBundleId)) reject('audience');
    if (!claims.exp || claims.exp * 1000 < Date.now() - 60_000)
      reject('expired');

    // The app passed SHA-256(rawNonce) to Apple; Apple echoes it back.
    const expectedNonce = createHash('sha256').update(rawNonce).digest('hex');
    if (!claims.sub || claims.nonce !== expectedNonce) {
      throw new UnauthorizedException('Apple sign-in failed, please try again');
    }

    return {
      appleId: claims.sub,
      email: claims.email ?? null,
      emailVerified:
        claims.email_verified === true || claims.email_verified === 'true',
    };
  }

  /**
   * Trade the one-time authorization code for a refresh token, so it can be
   * revoked later. Best effort; requires the APPLE_* key settings.
   */
  async refreshTokenFor(authorizationCode: string): Promise<string | null> {
    if (!env.appleRevocationEnabled) return null;
    try {
      const res = await fetch(TOKEN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: env.appleBundleId,
          client_secret: this.clientSecret(),
          code: authorizationCode,
          grant_type: 'authorization_code',
        }),
      });
      const data = (await res.json()) as {
        refresh_token?: string;
        error?: string;
      };
      if (!res.ok || !data.refresh_token) {
        this.logger.warn(
          `Apple code exchange failed: ${data.error ?? res.status}`,
        );
        return null;
      }
      return data.refresh_token;
    } catch (e) {
      this.logger.warn(`Apple code exchange failed: ${(e as Error).message}`);
      return null;
    }
  }

  /** Revoke our access when the user deletes their account (App Store rule). */
  async revoke(refreshToken: string): Promise<void> {
    if (!env.appleRevocationEnabled) return;
    try {
      const res = await fetch(REVOKE_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: env.appleBundleId,
          client_secret: this.clientSecret(),
          token: refreshToken,
          token_type_hint: 'refresh_token',
        }),
      });
      if (!res.ok) this.logger.warn(`Apple revoke returned ${res.status}`);
    } catch (e) {
      this.logger.warn(`Apple revoke failed: ${(e as Error).message}`);
    }
  }

  /**
   * ES256 client secret Apple expects, signed with the .p8 key.
   *
   * Signed with Node's crypto directly: JwtService always prefers the app's
   * HMAC secret over a passed private key, which makes ES256 throw.
   */
  private clientSecret(): string {
    const now = Math.floor(Date.now() / 1000);
    const enc = (o: object) =>
      Buffer.from(JSON.stringify(o)).toString('base64url');
    const input = `${enc({ alg: 'ES256', kid: env.appleKeyId })}.${enc({
      iss: env.appleTeamId,
      iat: now,
      exp: now + 300,
      aud: APPLE_ISSUER,
      sub: env.appleBundleId,
    })}`;
    const sig = sign('sha256', Buffer.from(input), {
      key: env.applePrivateKey,
      dsaEncoding: 'ieee-p1363',
    });
    return `${input}.${sig.toString('base64url')}`;
  }

  private headerKid(token: string): string {
    try {
      const header = JSON.parse(
        Buffer.from(token.split('.')[0], 'base64url').toString(),
      ) as {
        kid?: string;
      };
      if (header.kid) return header.kid;
    } catch {
      /* fall through */
    }
    throw new UnauthorizedException('Apple sign-in failed, please try again');
  }

  /** Apple's signing keys, cached for an hour and refetched on an unknown kid. */
  private async publicKey(kid: string): Promise<string> {
    const fresh = this.keys && Date.now() - this.keys.at < 3600_000;
    if (!fresh || !this.keys!.byKid.has(kid)) {
      const res = await fetch(KEYS_URL);
      if (!res.ok)
        throw new UnauthorizedException(
          'Apple sign-in is unavailable, try again later',
        );
      const { keys } = (await res.json()) as { keys: AppleJwk[] };
      const byKid = new Map<string, string>();
      for (const k of keys) {
        byKid.set(
          k.kid,
          createPublicKey({ key: { ...k }, format: 'jwk' })
            .export({ type: 'spki', format: 'pem' })
            .toString(),
        );
      }
      this.keys = { at: Date.now(), byKid };
    }
    const pem = this.keys!.byKid.get(kid);
    if (!pem)
      throw new UnauthorizedException('Apple sign-in failed, please try again');
    return pem;
  }
}
