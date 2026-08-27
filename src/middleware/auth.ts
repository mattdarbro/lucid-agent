/**
 * Authentication Middleware
 *
 * Bearer-token auth for the whole API. Lucid is a single-user app, so a
 * single shared secret (LUCID_API_TOKEN) held by the iOS client is the
 * trust boundary. There is no per-user session layer behind it — the
 * database is accessed with the Supabase service key and has no RLS.
 */

import { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import { config } from '../config';
import { logger } from '../logger';

let warnedNoToken = false;

/**
 * Constant-time string comparison to avoid leaking the token via timing.
 */
function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) {
    // Still do a comparison so length mismatches take similar time
    crypto.timingSafeEqual(bufA, bufA);
    return false;
  }
  return crypto.timingSafeEqual(bufA, bufB);
}

/**
 * Requires `Authorization: Bearer <LUCID_API_TOKEN>` on every request.
 *
 * The token is now REQUIRED — validateConfig() refuses to boot without it, so
 * a missing variable crash-loops instead of silently serving open. The only
 * way to reach the unauthenticated path is ALLOW_UNAUTHENTICATED=true, which
 * is a deliberate local-dev act rather than a forgotten deploy variable.
 *
 * (The old behavior was a migration ramp: allow-through with a warning so a
 * deploy couldn't lock out the iOS app before the client shipped the token.
 * The client ships it now, so the ramp is retired.)
 */
export function requireApiToken(req: Request, res: Response, next: NextFunction) {
  const expected = config.auth.apiToken;

  if (!expected) {
    // Only reachable with ALLOW_UNAUTHENTICATED=true — validateConfig() would
    // have refused to boot otherwise.
    if (!warnedNoToken) {
      logger.warn(
        '⚠️  API is running UNAUTHENTICATED via ALLOW_UNAUTHENTICATED=true. ' +
          'Never set this outside local development.'
      );
      warnedNoToken = true;
    }
    return next();
  }

  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice('Bearer '.length) : '';

  if (!token || !safeEqual(token, expected)) {
    logger.warn('Rejected request with missing/invalid API token', {
      method: req.method,
      path: req.path,
      ip: req.ip,
    });
    return res.status(401).json({
      error: 'Unauthorized',
      message: 'Valid Bearer token required',
    });
  }

  next();
}
