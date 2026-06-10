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
 * Migration path: if LUCID_API_TOKEN is not configured, requests are allowed
 * through with a loud warning so a deploy can't lock out the iOS app before
 * the client ships the token. Set the env var to turn enforcement on.
 */
export function requireApiToken(req: Request, res: Response, next: NextFunction) {
  const expected = config.auth.apiToken;

  if (!expected) {
    if (!warnedNoToken) {
      logger.warn(
        '⚠️  LUCID_API_TOKEN is not set — API is running UNAUTHENTICATED. ' +
          'Set LUCID_API_TOKEN and configure the client to send it as a Bearer token.'
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
