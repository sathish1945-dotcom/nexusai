import crypto from 'crypto';
import { encryptString, decryptString } from './crypto.js';
import {
  dbStoreUserIntegration,
  dbGetUserIntegration,
  dbGetUserIntegrations,
  dbDeleteUserIntegration,
  dbUpdateUserIntegrationStatus,
  dbSaveOAuthState,
  dbVerifyOAuthState,
  DbUserIntegration,
  ConnectionStatus
} from './db.js';
import { logger } from './logger.js';

export interface ConnectorPublicStatus {
  id: string;
  name: string;
  description: string;
  authType: 'oauth2' | 'api_key' | 'webhook' | 'none';
  connected: boolean;
  status: ConnectionStatus;
  accountEmail?: string;
  scopes: string[];
  connectedAt?: string;
  isExpired?: boolean;
  lastError?: string;
}

/**
 * Generates an isolated OAuth state token tied to this specific authenticated user.
 */
export async function generateOAuthState(userId: string, connectorId: string): Promise<string> {
  const state = crypto.randomBytes(24).toString('hex');
  (await dbSaveOAuthState(state, userId, connectorId));
  logger.info('OAuth', `Generated CSRF state token for user "${userId}" connector "${connectorId}"`);
  return state;
}

/**
 * Verifies OAuth state token ensuring it belongs strictly to this user and connector.
 */
export async function verifyOAuthState(state: string, userId: string, connectorId: string): Promise<boolean> {
  const isValid = (await dbVerifyOAuthState(state, userId, connectorId));
  if (isValid) {
    logger.info('OAuth', `Successfully validated CSRF state token for user "${userId}" connector "${connectorId}"`);
  } else {
    logger.warn('OAuth', `CSRF state verification failed for user "${userId}" connector "${connectorId}"`);
  }
  return isValid;
}

/**
 * Stores OAuth or API Key credentials encrypted with AES-256-GCM under the user's ID.
 */
export async function storeUserConnectorToken(params: {
  userId: string;
  connectorId: string;
  accessToken: string;
  refreshToken?: string;
  scopes?: string[];
  expiresIn?: number;
}): Promise<{ accountEmail?: string; connectedAt: string }> {
  const { userId, connectorId, accessToken, refreshToken, scopes = [], expiresIn } = params;

  // Retrieve authenticated account identity via Google userinfo if Google connector
  let accountEmail: string | undefined;
  if (connectorId === 'gmail' || connectorId === 'google_calendar' || connectorId === 'google_drive') {
    try {
      const userRes = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
        headers: { Authorization: `Bearer ${accessToken}` }
      });
      if (userRes.ok) {
        const userData = (await userRes.json()) as { email?: string };
        accountEmail = userData.email;
      }
    } catch (err) {
      logger.warn('Vault', `Could not fetch userinfo for user "${userId}" connector "${connectorId}": ${err}`);
    }
  }

  // Encrypt access token with AES-256-GCM
  const encryptedAccessToken = encryptString(accessToken);
  const encryptedRefreshToken = refreshToken ? encryptString(refreshToken) : undefined;
  const tokenExpiry = expiresIn ? Date.now() + expiresIn * 1000 : undefined;

  // Persist directly to SQLite database with tenant isolation
  const record = (await dbStoreUserIntegration({
    userId,
    provider: connectorId,
    externalAccountId: accountEmail,
    encryptedAccessToken,
    encryptedRefreshToken,
    tokenExpiry,
    scopes,
    connectionStatus: 'connected'
  }));

  logger.info('Vault', `Credentials securely stored in database for user "${userId}" provider "${connectorId}"`, {
    accountEmail: accountEmail || 'unknown',
    scopesCount: scopes.length,
    expiresIn: expiresIn || 3600
  });

  return { accountEmail, connectedAt: record.createdAt };
}

/**
 * Decrypts and retrieves the active access token for a user.
 * Performs automatic token refresh if expired and refresh token is available.
 */
export async function getUserConnectorAccessToken(userId: string, connectorId: string): Promise<string | null> {
  const record = (await dbGetUserIntegration(userId, connectorId));
  if (!record) {
    logger.warn('Vault', `No credentials found in database for user "${userId}" connector "${connectorId}"`);
    return null;
  }

  // Check expiration if recorded
  if (record.tokenExpiry && Date.now() > record.tokenExpiry) {
    // Attempt automatic refresh if refresh token exists
    if (record.encryptedRefreshToken) {
      try {
        const refreshToken = decryptString(record.encryptedRefreshToken);
        const refreshed = await refreshGoogleToken(refreshToken);
        if (refreshed?.access_token) {
          logger.info('Vault', `Successfully refreshed expired token for user "${userId}" connector "${connectorId}"`);
          const encryptedNew = encryptString(refreshed.access_token);
          const newExpiry = refreshed.expires_in ? Date.now() + refreshed.expires_in * 1000 : undefined;

          (await dbStoreUserIntegration({
            userId,
            provider: connectorId,
            externalAccountId: record.externalAccountId,
            encryptedAccessToken: encryptedNew,
            encryptedRefreshToken: record.encryptedRefreshToken,
            tokenExpiry: newExpiry,
            scopes: record.scopes,
            connectionStatus: 'connected'
          }));

          return refreshed.access_token;
        }
      } catch (refreshErr) {
        logger.error('Vault', `Failed to refresh token for user "${userId}" connector "${connectorId}"`, refreshErr);
      }
    }

    (await dbUpdateUserIntegrationStatus(userId, connectorId, 'reconnect_required', 'Access token expired'));
    logger.warn('Vault', `Stored token for user "${userId}" connector "${connectorId}" has expired`);
    return null;
  }

  try {
    const decrypted = decryptString(record.encryptedAccessToken);
    logger.info('Vault', `Decrypted active credentials for user "${userId}" connector "${connectorId}"`, {
      accountEmail: record.externalAccountId || 'unknown'
    });
    return decrypted;
  } catch (err) {
    (await dbUpdateUserIntegrationStatus(userId, connectorId, 'error', 'Failed to decrypt token'));
    logger.error('Vault', `Failed to decrypt token for user "${userId}" connector "${connectorId}"`, err);
    return null;
  }
}

/**
 * Checks if a specific connector is currently connected and active for a user.
 */
export async function isUserConnectorConnected(userId: string, connectorId: string): Promise<boolean> {
  const record = (await dbGetUserIntegration(userId, connectorId));
  if (!record) return false;
  if (record.connectionStatus !== 'connected') return false;
  if (record.tokenExpiry && Date.now() > record.tokenExpiry && !record.encryptedRefreshToken) {
    return false;
  }
  return true;
}

/**
 * Revokes and deletes a user's integration from the database.
 */
export async function revokeUserConnectorToken(userId: string, connectorId: string): Promise<boolean> {
  // Best-effort external revocation for Google tokens
  try {
    const token = await getUserConnectorAccessToken(userId, connectorId);
    if (token) {
      await fetch(`https://oauth2.googleapis.com/revoke?token=${token}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
      }).catch(() => {});
    }
  } catch {
    // Ignore external network failure during revoke
  }

  const revoked = (await dbDeleteUserIntegration(userId, connectorId));
  logger.info('Vault', `Credentials revoked and deleted for user "${userId}" connector "${connectorId}"`, {
    success: revoked
  });
  return revoked;
}

/**
 * Returns integration status details for a user.
 */
export async function getUserConnectorAuthDetails(userId: string, connectorId: string): Promise<DbUserIntegration | null> {
  return (await dbGetUserIntegration(userId, connectorId));
}

/**
 * Helper to refresh Google OAuth token using server-side client credentials if configured.
 */
async function refreshGoogleToken(refreshToken: string): Promise<{ access_token: string; expires_in?: number } | null> {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) return null;

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: 'refresh_token'
    })
  });

  if (!res.ok) return null;
  return (await res.json()) as { access_token: string; expires_in?: number };
}
