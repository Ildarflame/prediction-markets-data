/**
 * Kalshi API JWT Authentication
 *
 * Creates JWT tokens for authenticating with Kalshi API using RSA-256 signatures.
 * Reference: https://trading-api.readme.io/reference/authentication
 */

import jwt from 'jsonwebtoken';

export interface KalshiJWTOptions {
  apiKeyId: string;
  privateKeyPem: string;
  expiresIn?: number; // seconds, default 300 (5 minutes)
}

/**
 * Create a JWT token for Kalshi API authentication
 *
 * @param options - API key ID and private key
 * @returns JWT token string
 */
export function createKalshiJWT(options: KalshiJWTOptions): string {
  const { apiKeyId, privateKeyPem, expiresIn = 300 } = options;

  const now = Math.floor(Date.now() / 1000);

  const payload = {
    sub: apiKeyId,
    iat: now,
    exp: now + expiresIn,
  };

  const token = jwt.sign(payload, privateKeyPem, {
    algorithm: 'RS256',
    header: {
      alg: 'RS256',
      typ: 'JWT',
    },
  });

  return token;
}

/**
 * Cache for JWT tokens to avoid regenerating on every request
 */
class JWTCache {
  private token: string | null = null;
  private expiresAt: number = 0;

  get(options: KalshiJWTOptions): string {
    const now = Math.floor(Date.now() / 1000);

    // Regenerate if token expired or will expire in next 60 seconds
    if (!this.token || this.expiresAt - now < 60) {
      this.token = createKalshiJWT(options);
      this.expiresAt = now + (options.expiresIn ?? 300);
    }

    return this.token;
  }

  clear(): void {
    this.token = null;
    this.expiresAt = 0;
  }
}

export const jwtCache = new JWTCache();
