import http2 from 'http2';
import crypto from 'crypto';
import fs from 'fs';
import { logger } from '../logger';
import { config } from '../config';

/**
 * APNs notification payload
 */
export interface ApnsNotification {
  title: string;
  body: string;
  /** Custom data payload delivered to the iOS app */
  data?: Record<string, any>;
  /** APNs category for actionable notifications */
  category?: string;
  /** Thread ID for grouping notifications */
  threadId?: string;
  /** Sound name (default: 'default') */
  sound?: string;
  /** Badge count (null = don't change) */
  badge?: number;
}

/**
 * ApnsService
 *
 * Sends push notifications via Apple Push Notification service (APNs).
 * Uses HTTP/2 + JWT authentication (token-based, not certificate-based).
 *
 * No external dependencies — uses Node.js built-in http2 and crypto modules.
 *
 * Setup:
 * 1. Create a key in Apple Developer Portal > Keys > APNs
 * 2. Download the .p8 file and note the Key ID
 * 3. Set APNS_KEY_ID, APNS_TEAM_ID, APNS_KEY_PATH, APNS_BUNDLE_ID in environment
 */
export class ApnsService {
  private keyId: string;
  private teamId: string;
  private bundleId: string;
  private signingKey: string | null = null;
  private cachedToken: string | null = null;
  private tokenIssuedAt: number = 0;
  private readonly TOKEN_REFRESH_INTERVAL = 45 * 60; // Refresh every 45 min (Apple requires < 1 hour)

  private readonly host: string;

  constructor() {
    this.keyId = config.apns.keyId;
    this.teamId = config.apns.teamId;
    this.bundleId = config.apns.bundleId;
    this.host = config.nodeEnv === 'production'
      ? 'api.push.apple.com'
      : 'api.sandbox.push.apple.com';

    if (config.apns.enabled && config.apns.keyPath) {
      try {
        this.signingKey = fs.readFileSync(config.apns.keyPath, 'utf8');
        logger.info('APNs service initialized', {
          keyId: this.keyId,
          teamId: this.teamId,
          bundleId: this.bundleId,
          environment: config.nodeEnv === 'production' ? 'production' : 'sandbox',
        });
      } catch (err: any) {
        logger.warn('APNs key file not found, push notifications disabled', {
          keyPath: config.apns.keyPath,
          error: err.message,
        });
      }
    } else {
      logger.info('APNs service disabled - APNS_KEY_ID or APNS_TEAM_ID not set');
    }
  }

  /**
   * Check if APNs is configured and ready to send
   */
  isEnabled(): boolean {
    return !!this.signingKey && !!this.keyId && !!this.teamId && !!this.bundleId;
  }

  /**
   * Send a push notification to a single device token
   */
  async sendToDevice(deviceToken: string, notification: ApnsNotification): Promise<boolean> {
    if (!this.isEnabled()) {
      logger.debug('APNs disabled, skipping notification', { title: notification.title });
      return false;
    }

    const token = this.getAuthToken();
    if (!token) {
      logger.error('Failed to generate APNs auth token');
      return false;
    }

    const payload = this.buildPayload(notification);

    return new Promise<boolean>((resolve) => {
      const client = http2.connect(`https://${this.host}`);

      client.on('error', (err) => {
        logger.error('APNs HTTP/2 connection error', { error: err.message });
        client.close();
        resolve(false);
      });

      const headers = {
        ':method': 'POST',
        ':path': `/3/device/${deviceToken}`,
        'authorization': `bearer ${token}`,
        'apns-topic': this.bundleId,
        'apns-push-type': 'alert',
        'apns-priority': '10',
        'content-type': 'application/json',
      };

      if (notification.threadId) {
        (headers as any)['apns-collapse-id'] = notification.threadId;
      }

      const req = client.request(headers);

      let responseData = '';
      let statusCode = 0;

      req.on('response', (headers) => {
        statusCode = headers[':status'] as number;
      });

      req.on('data', (chunk) => {
        responseData += chunk;
      });

      req.on('end', () => {
        client.close();

        if (statusCode === 200) {
          logger.info('APNs notification sent', {
            deviceToken: deviceToken.substring(0, 12) + '...',
            title: notification.title,
          });
          resolve(true);
        } else {
          let reason = 'unknown';
          try {
            const parsed = JSON.parse(responseData);
            reason = parsed.reason || reason;
          } catch {
            // ignore parse error
          }
          logger.error('APNs send failed', {
            statusCode,
            reason,
            deviceToken: deviceToken.substring(0, 12) + '...',
          });
          resolve(false);
        }
      });

      req.on('error', (err) => {
        logger.error('APNs request error', { error: err.message });
        client.close();
        resolve(false);
      });

      // Set a timeout for the request
      req.setTimeout(15000, () => {
        logger.error('APNs request timed out');
        req.close();
        client.close();
        resolve(false);
      });

      req.write(JSON.stringify(payload));
      req.end();
    });
  }

  /**
   * Send a notification to multiple device tokens
   * Returns number of successful sends
   */
  async sendToDevices(
    deviceTokens: string[],
    notification: ApnsNotification
  ): Promise<{ sent: number; failed: number }> {
    if (deviceTokens.length === 0) {
      return { sent: 0, failed: 0 };
    }

    let sent = 0;
    let failed = 0;

    for (const token of deviceTokens) {
      const success = await this.sendToDevice(token, notification);
      if (success) {
        sent++;
      } else {
        failed++;
      }
    }

    return { sent, failed };
  }

  /**
   * Build the APNs JSON payload
   */
  private buildPayload(notification: ApnsNotification): Record<string, any> {
    const payload: Record<string, any> = {
      aps: {
        alert: {
          title: notification.title,
          body: notification.body,
        },
        sound: notification.sound || 'default',
        'mutable-content': 1,
      },
    };

    if (notification.badge !== undefined) {
      payload.aps.badge = notification.badge;
    }

    if (notification.category) {
      payload.aps.category = notification.category;
    }

    if (notification.threadId) {
      payload.aps['thread-id'] = notification.threadId;
    }

    // Custom data goes at the top level of the payload (outside aps)
    if (notification.data) {
      payload.lucid = notification.data;
    }

    return payload;
  }

  /**
   * Get or refresh the JWT auth token for APNs
   *
   * Apple requires tokens to be refreshed at least every 60 minutes.
   * We refresh every 45 minutes to be safe.
   */
  private getAuthToken(): string | null {
    const now = Math.floor(Date.now() / 1000);

    if (this.cachedToken && (now - this.tokenIssuedAt) < this.TOKEN_REFRESH_INTERVAL) {
      return this.cachedToken;
    }

    try {
      const header = {
        alg: 'ES256',
        kid: this.keyId,
      };

      const claims = {
        iss: this.teamId,
        iat: now,
      };

      const encodedHeader = this.base64url(JSON.stringify(header));
      const encodedClaims = this.base64url(JSON.stringify(claims));
      const signingInput = `${encodedHeader}.${encodedClaims}`;

      const sign = crypto.createSign('SHA256');
      sign.update(signingInput);
      const signature = sign.sign(this.signingKey!, 'base64url');

      this.cachedToken = `${signingInput}.${signature}`;
      this.tokenIssuedAt = now;

      return this.cachedToken;
    } catch (err: any) {
      logger.error('Failed to create APNs JWT', { error: err.message });
      return null;
    }
  }

  /**
   * Base64url encode a string
   */
  private base64url(str: string): string {
    return Buffer.from(str)
      .toString('base64')
      .replace(/=/g, '')
      .replace(/\+/g, '-')
      .replace(/\//g, '_');
  }
}
