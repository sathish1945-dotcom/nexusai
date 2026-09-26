import { createClient, type Client, type InValue } from '@libsql/client';
import path from 'path';
import fs from 'fs';
import { logger } from './logger.js';

export interface DbUser {
  id: string;
  email?: string;
  passwordHash?: string;
  displayName?: string;
  avatarUrl?: string;
  isAnonymous: boolean;
  createdAt: string;
  updatedAt: string;
}

export type ConnectionStatus =
  | 'connected'
  | 'disconnected'
  | 'reconnect_required'
  | 'permission_required'
  | 'error';

export interface DbUserIntegration {
  id: string;
  userId: string;
  provider: string;
  externalAccountId?: string;
  encryptedAccessToken: string;
  encryptedRefreshToken?: string;
  tokenExpiry?: number;
  scopes: string[];
  connectionStatus: ConnectionStatus;
  lastError?: string;
  createdAt: string;
  updatedAt: string;
}

export interface DbUserWebhook {
  id: string;
  userId: string;
  name: string;
  targetUrl: string;
  encryptedSecret?: string;
  environment: string;
  createdAt: string;
}

export interface DbOAuthState {
  state: string;
  userId: string;
  connectorId: string;
  createdAt: number;
}

export interface DbIdempotencyRecord {
  idempotencyKey: string;
  userId: string;
  toolName: string;
  result: unknown;
  status: 'completed' | 'failed';
  error?: string;
  createdAt: number;
}

export interface DbAuditLog {
  id: string;
  userId: string;
  timestamp: string;
  toolName: string;
  sensitivity: 'safe' | 'sensitive';
  idempotencyKey: string;
  parameters: Record<string, unknown>;
  status: 'completed' | 'failed' | 'awaiting_confirmation' | 'rejected';
  durationMs: number;
  result?: unknown;
  error?: string;
  clientIp?: string;
}

export interface DbAiUsage {
  userId: string;
  requestsToday: number;
  tokensUsedToday: number;
  toolCallsToday: number;
  dailyLimit: number;
  lastResetDate: string;
}

class AsyncDatabase {
 constructor(private client: Client) {}
 prepare(sql: string) {
  const execute = (...args: InValue[]) => this.client.execute({ sql, args });
  return {
   run: async (...args: InValue[]) => { const r = await execute(...args); return { changes: r.rowsAffected }; },
   get: async (...args: InValue[]) => (await execute(...args)).rows[0],
   all: async (...args: InValue[]) => (await execute(...args)).rows,
  };
 }
}
let dbPromise: Promise<AsyncDatabase> | null = null;
export function getDb(): Promise<AsyncDatabase> {
 if (!dbPromise) dbPromise = initializeDb().catch(error => { dbPromise = null; throw error; });
 return dbPromise;
}
async function initializeDb(): Promise<AsyncDatabase> {
 const remoteUrl = process.env.NEXUS_TURSO_DATABASE_URL || process.env.TURSO_DATABASE_URL;
 if (process.env.VERCEL && !remoteUrl) throw new Error('TURSO_DATABASE_URL is required on Vercel');
 if (!remoteUrl) fs.mkdirSync(path.resolve(process.cwd(), 'data'), { recursive: true });
 const client = createClient({ url: remoteUrl || 'file:' + path.resolve(process.cwd(), 'data/nexusai.db'), authToken: process.env.NEXUS_TURSO_AUTH_TOKEN || process.env.TURSO_AUTH_TOKEN });
 try {
  // 1. Users table (Multi-tenant authentication)
  await client.executeMultiple(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT UNIQUE,
      password_hash TEXT,
      display_name TEXT,
      avatar_url TEXT,
      is_anonymous INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
  `);

  // 2. User Integrations table (Encrypted OAuth credentials isolated per user)
  await client.executeMultiple(`
    CREATE TABLE IF NOT EXISTS user_integrations (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      provider TEXT NOT NULL,
      external_account_id TEXT,
      encrypted_access_token TEXT NOT NULL,
      encrypted_refresh_token TEXT,
      token_expiry INTEGER,
      scopes TEXT NOT NULL,
      connection_status TEXT NOT NULL DEFAULT 'connected',
      last_error TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      UNIQUE (user_id, provider)
    );
    CREATE INDEX IF NOT EXISTS idx_user_integrations_user ON user_integrations(user_id);
  `);

  // 3. User Webhooks table (Tenant isolated server-side registered webhooks)
  await client.executeMultiple(`
    CREATE TABLE IF NOT EXISTS user_webhooks (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      name TEXT NOT NULL,
      target_url TEXT NOT NULL,
      encrypted_secret TEXT,
      environment TEXT NOT NULL DEFAULT 'production',
      created_at TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_user_webhooks_user ON user_webhooks(user_id);
  `);

  // 4. OAuth CSRF State Table (Isolated per user with 10-minute validity)
  await client.executeMultiple(`
    CREATE TABLE IF NOT EXISTS oauth_states (
      state TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      connector_id TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
  `);

  // 5. Idempotency Records Table (Isolated per user)
  await client.executeMultiple(`
    CREATE TABLE IF NOT EXISTS idempotency_records (
      idempotency_key TEXT NOT NULL,
      user_id TEXT NOT NULL,
      tool_name TEXT NOT NULL,
      result_json TEXT,
      status TEXT NOT NULL,
      error TEXT,
      created_at INTEGER NOT NULL,
      PRIMARY KEY (user_id, idempotency_key)
    );
  `);

  // 6. Audit Logs Table (Isolated per user)
  await client.executeMultiple(`
    CREATE TABLE IF NOT EXISTS audit_logs (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      timestamp TEXT NOT NULL,
      tool_name TEXT NOT NULL,
      sensitivity TEXT NOT NULL,
      idempotency_key TEXT NOT NULL,
      parameters_json TEXT NOT NULL,
      status TEXT NOT NULL,
      duration_ms INTEGER NOT NULL,
      result_json TEXT,
      error TEXT,
      client_ip TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_audit_user_time ON audit_logs(user_id, timestamp DESC);
  `);

  // 7. Rate Limits Table (Enforces limits per user and per IP)
  await client.executeMultiple(`
    CREATE TABLE IF NOT EXISTS rate_limits (
      rate_key TEXT PRIMARY KEY,
      count INTEGER NOT NULL,
      reset_at INTEGER NOT NULL
    );
  `);

  // 8. User AI Usage Table (Prevents quota abuse on OpenRouter)
  await client.executeMultiple(`
    CREATE TABLE IF NOT EXISTS user_ai_usage (
      user_id TEXT PRIMARY KEY,
      requests_today INTEGER NOT NULL DEFAULT 0,
      tokens_used_today INTEGER NOT NULL DEFAULT 0,
      tool_calls_today INTEGER NOT NULL DEFAULT 0,
      daily_limit INTEGER NOT NULL DEFAULT 100,
      last_reset_date TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );
  `);


 return new AsyncDatabase(client);
 } catch (error) { client.close(); throw error; }
}
// =============================================================================
// User Authentication DB Operations
// =============================================================================

export async function dbCreateUser(params: {
  id: string;
  email?: string;
  passwordHash?: string;
  displayName?: string;
  avatarUrl?: string;
  isAnonymous?: boolean;
}): Promise<DbUser> {
  const db = (await getDb());
  const now = new Date().toISOString();
  const isAnon = params.isAnonymous ? 1 : 0;

  const stmt = db.prepare(`
    INSERT INTO users (id, email, password_hash, display_name, avatar_url, is_anonymous, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?);
  `);

  (await stmt.run(
    params.id,
    params.email || null,
    params.passwordHash || null,
    params.displayName || (params.isAnonymous ? 'Guest User' : 'NexusAI User'),
    params.avatarUrl || null,
    isAnon,
    now,
    now
  ));

  return {
    id: params.id,
    email: params.email,
    passwordHash: params.passwordHash,
    displayName: params.displayName || (params.isAnonymous ? 'Guest User' : 'NexusAI User'),
    avatarUrl: params.avatarUrl,
    isAnonymous: Boolean(isAnon),
    createdAt: now,
    updatedAt: now
  };
}

export async function dbGetUserById(id: string): Promise<DbUser | null> {
  const db = (await getDb());
  const stmt = db.prepare('SELECT * FROM users WHERE id = ?;');
  const row = (await stmt.get(id)) as any;
  if (!row) return null;

  return {
    id: row.id,
    email: row.email || undefined,
    passwordHash: row.password_hash || undefined,
    displayName: row.display_name || undefined,
    avatarUrl: row.avatar_url || undefined,
    isAnonymous: Boolean(row.is_anonymous),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

export async function dbGetUserByEmail(email: string): Promise<DbUser | null> {
  const db = (await getDb());
  const stmt = db.prepare('SELECT * FROM users WHERE LOWER(email) = LOWER(?);');
  const row = (await stmt.get(email)) as any;
  if (!row) return null;

  return {
    id: row.id,
    email: row.email,
    passwordHash: row.password_hash || undefined,
    displayName: row.display_name || undefined,
    avatarUrl: row.avatar_url || undefined,
    isAnonymous: Boolean(row.is_anonymous),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

// =============================================================================
// User Integration DB Operations (Strictly Tenant-Isolated)
// =============================================================================

export async function dbStoreUserIntegration(params: {
  userId: string;
  provider: string;
  externalAccountId?: string;
  encryptedAccessToken: string;
  encryptedRefreshToken?: string;
  tokenExpiry?: number;
  scopes: string[];
  connectionStatus?: ConnectionStatus;
  lastError?: string;
}): Promise<DbUserIntegration> {
  const db = (await getDb());
  const now = new Date().toISOString();
  const id = `${params.userId}:${params.provider}`;
  const status: ConnectionStatus = params.connectionStatus || 'connected';
  const scopesJson = JSON.stringify(params.scopes);

  const stmt = db.prepare(`
    INSERT INTO user_integrations (
      id, user_id, provider, external_account_id, encrypted_access_token,
      encrypted_refresh_token, token_expiry, scopes, connection_status, last_error, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(user_id, provider) DO UPDATE SET
      external_account_id = excluded.external_account_id,
      encrypted_access_token = excluded.encrypted_access_token,
      encrypted_refresh_token = COALESCE(excluded.encrypted_refresh_token, user_integrations.encrypted_refresh_token),
      token_expiry = excluded.token_expiry,
      scopes = excluded.scopes,
      connection_status = excluded.connection_status,
      last_error = excluded.last_error,
      updated_at = excluded.updated_at;
  `);

  (await stmt.run(
    id,
    params.userId,
    params.provider,
    params.externalAccountId || null,
    params.encryptedAccessToken,
    params.encryptedRefreshToken || null,
    params.tokenExpiry || null,
    scopesJson,
    status,
    params.lastError || null,
    now,
    now
  ));

  logger.info('Database', `Persisted integration credentials for user "${params.userId}" provider "${params.provider}"`, {
    externalAccountId: params.externalAccountId || 'unknown',
    scopesCount: params.scopes.length
  });

  return {
    id,
    userId: params.userId,
    provider: params.provider,
    externalAccountId: params.externalAccountId,
    encryptedAccessToken: params.encryptedAccessToken,
    encryptedRefreshToken: params.encryptedRefreshToken,
    tokenExpiry: params.tokenExpiry,
    scopes: params.scopes,
    connectionStatus: status,
    lastError: params.lastError,
    createdAt: now,
    updatedAt: now
  };
}

export async function dbGetUserIntegration(userId: string, provider: string): Promise<DbUserIntegration | null> {
  const db = (await getDb());
  const stmt = db.prepare(`
    SELECT * FROM user_integrations
    WHERE user_id = ? AND provider = ?;
  `);
  const row = (await stmt.get(userId, provider)) as any;
  if (!row) return null;

  let scopes: string[] = [];
  try {
    scopes = JSON.parse(row.scopes);
  } catch {
    scopes = [];
  }

  return {
    id: row.id,
    userId: row.user_id,
    provider: row.provider,
    externalAccountId: row.external_account_id || undefined,
    encryptedAccessToken: row.encrypted_access_token,
    encryptedRefreshToken: row.encrypted_refresh_token || undefined,
    tokenExpiry: row.token_expiry ? Number(row.token_expiry) : undefined,
    scopes,
    connectionStatus: row.connection_status as ConnectionStatus,
    lastError: row.last_error || undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

export async function dbGetUserIntegrations(userId: string): Promise<DbUserIntegration[]> {
  const db = (await getDb());
  const stmt = db.prepare('SELECT * FROM user_integrations WHERE user_id = ?;');
  const rows = (await stmt.all(userId)) as any[];

  return rows.map((row) => {
    let scopes: string[] = [];
    try {
      scopes = JSON.parse(row.scopes);
    } catch {
      scopes = [];
    }
    return {
      id: row.id,
      userId: row.user_id,
      provider: row.provider,
      externalAccountId: row.external_account_id || undefined,
      encryptedAccessToken: row.encrypted_access_token,
      encryptedRefreshToken: row.encrypted_refresh_token || undefined,
      tokenExpiry: row.token_expiry ? Number(row.token_expiry) : undefined,
      scopes,
      connectionStatus: row.connection_status as ConnectionStatus,
      lastError: row.last_error || undefined,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  });
}

export async function dbDeleteUserIntegration(userId: string, provider: string): Promise<boolean> {
  const db = (await getDb());
  const stmt = db.prepare('DELETE FROM user_integrations WHERE user_id = ? AND provider = ?;');
  const res = (await stmt.run(userId, provider));
  logger.info('Database', `Deleted integration for user "${userId}" provider "${provider}"`);
  return Number(res.changes) > 0;
}

export async function dbUpdateUserIntegrationStatus(
  userId: string,
  provider: string,
  status: ConnectionStatus,
  lastError?: string
): Promise<void> {
  const db = (await getDb());
  const now = new Date().toISOString();
  (await db.prepare(`
    UPDATE user_integrations
    SET connection_status = ?, last_error = ?, updated_at = ?
    WHERE user_id = ? AND provider = ?;
  `).run(status, lastError || null, now, userId, provider));
}

// =============================================================================
// OAuth CSRF State Operations (Strictly Tenant-Isolated)
// =============================================================================

export async function dbSaveOAuthState(state: string, userId: string, connectorId: string): Promise<void> {
  const db = (await getDb());
  // Prune expired states older than 15 minutes
  const cutoff = Date.now() - 15 * 60 * 1000;
  (await db.prepare('DELETE FROM oauth_states WHERE created_at < ?;').run(cutoff));

  (await db.prepare('INSERT OR REPLACE INTO oauth_states (state, user_id, connector_id, created_at) VALUES (?, ?, ?, ?);')
    .run(state, userId, connectorId, Date.now()));

  logger.info('Database', `OAuth CSRF state saved for user "${userId}" connector "${connectorId}"`);
}

export async function dbVerifyOAuthState(state: string, userId: string, connectorId: string): Promise<boolean> {
  const db = (await getDb());
  const stmt = db.prepare('SELECT state, user_id, connector_id, created_at FROM oauth_states WHERE state = ?;');
  const row = (await stmt.get(state)) as any;

  if (!row) {
    logger.warn('Database', 'OAuth state verification failed: State not found');
    return false;
  }

  // Delete state to prevent replay attacks
  (await db.prepare('DELETE FROM oauth_states WHERE state = ?;').run(state));

  const STATE_TTL_MS = 10 * 60 * 1000;
  const isExpired = Date.now() - Number(row.created_at) > STATE_TTL_MS;
  const isUserMatch = row.user_id === userId;
  const isConnectorMatch = row.connector_id === connectorId;

  if (isExpired) {
    logger.warn('Database', 'OAuth state expired');
    return false;
  }
  if (!isUserMatch) {
    logger.warn('Database', `OAuth tenant mismatch: state belongs to user ${row.user_id}, but requested by ${userId}`);
    return false;
  }
  if (!isConnectorMatch) {
    logger.warn('Database', `OAuth connector mismatch: expected ${connectorId}, found ${row.connector_id}`);
    return false;
  }

  return true;
}

// =============================================================================
// Idempotency Record Operations (Strictly Tenant-Isolated)
// =============================================================================

export async function dbGetIdempotency(key: string, userId: string): Promise<DbIdempotencyRecord | null> {
  const db = (await getDb());
  const stmt = db.prepare('SELECT * FROM idempotency_records WHERE idempotency_key = ? AND user_id = ?;');
  const row = (await stmt.get(key, userId)) as any;
  if (!row) return null;

  let result: unknown = null;
  if (row.result_json) {
    try {
      result = JSON.parse(row.result_json);
    } catch {
      result = row.result_json;
    }
  }

  return {
    idempotencyKey: row.idempotency_key,
    userId: row.user_id,
    toolName: row.tool_name,
    result,
    status: row.status as 'completed' | 'failed',
    error: row.error || undefined,
    createdAt: Number(row.created_at)
  };
}

export async function dbSetIdempotency(record: {
  idempotencyKey: string;
  userId: string;
  toolName: string;
  result: unknown;
  status: 'completed' | 'failed';
  error?: string;
}): Promise<void> {
  const db = (await getDb());
  const resultJson = record.result !== undefined ? JSON.stringify(record.result) : null;

  (await db.prepare(`
    INSERT OR REPLACE INTO idempotency_records (
      idempotency_key, user_id, tool_name, result_json, status, error, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?);
  `).run(
    record.idempotencyKey,
    record.userId,
    record.toolName,
    resultJson,
    record.status,
    record.error || null,
    Date.now()
  ));
}

// =============================================================================
// Audit Log Operations (Strictly Tenant-Isolated)
// =============================================================================

export async function dbRecordAudit(log: DbAuditLog): Promise<void> {
  const db = (await getDb());
  const parametersJson = JSON.stringify(log.parameters || {});
  const resultJson = log.result !== undefined ? JSON.stringify(log.result) : null;

  (await db.prepare(`
    INSERT INTO audit_logs (
      id, user_id, timestamp, tool_name, sensitivity, idempotency_key,
      parameters_json, status, duration_ms, result_json, error, client_ip
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);
  `).run(
    log.id,
    log.userId,
    log.timestamp,
    log.toolName,
    log.sensitivity,
    log.idempotencyKey,
    parametersJson,
    log.status,
    log.durationMs,
    resultJson,
    log.error || null,
    log.clientIp || null
  ));
}

export async function dbGetAuditLogs(userId: string, limit = 50): Promise<DbAuditLog[]> {
  const db = (await getDb());
  const stmt = db.prepare('SELECT * FROM audit_logs WHERE user_id = ? ORDER BY timestamp DESC LIMIT ?;');
  const rows = (await stmt.all(userId, limit)) as any[];

  return rows.map((r) => {
    let parameters = {};
    try {
      parameters = JSON.parse(r.parameters_json);
    } catch {
      parameters = {};
    }
    let result = undefined;
    if (r.result_json) {
      try {
        result = JSON.parse(r.result_json);
      } catch {
        result = r.result_json;
      }
    }

    return {
      id: r.id,
      userId: r.user_id,
      timestamp: r.timestamp,
      toolName: r.tool_name,
      sensitivity: r.sensitivity as 'safe' | 'sensitive',
      idempotencyKey: r.idempotency_key,
      parameters,
      status: r.status,
      durationMs: Number(r.duration_ms),
      result,
      error: r.error || undefined,
      clientIp: r.client_ip || undefined
    };
  });
}

// =============================================================================
// AI Usage & Abuse Prevention (Strictly Tenant-Isolated)
// =============================================================================

export async function dbCheckUserAiUsage(
  userId: string,
  dailyLimit = 100
): Promise<{ allowed: boolean; requestsToday: number; tokensUsedToday: number; remaining: number }> {
  const db = (await getDb());
  const today = new Date().toISOString().slice(0, 10);

  const stmt = db.prepare('SELECT * FROM user_ai_usage WHERE user_id = ?;');
  let row = (await stmt.get(userId)) as any;

  if (!row || row.last_reset_date !== today) {
    // Reset or create today's usage row
    (await db.prepare(`
      INSERT INTO user_ai_usage (user_id, requests_today, tokens_used_today, tool_calls_today, daily_limit, last_reset_date)
      VALUES (?, 0, 0, 0, ?, ?)
      ON CONFLICT(user_id) DO UPDATE SET
        requests_today = 0,
        tokens_used_today = 0,
        tool_calls_today = 0,
        daily_limit = excluded.daily_limit,
        last_reset_date = excluded.last_reset_date;
    `).run(userId, dailyLimit, today));

    return { allowed: true, requestsToday: 0, tokensUsedToday: 0, remaining: dailyLimit };
  }

  const currentRequests = Number(row.requests_today);
  const currentTokens = Number(row.tokens_used_today);
  const userLimit = Number(row.daily_limit || dailyLimit);

  if (currentRequests >= userLimit) {
    return {
      allowed: false,
      requestsToday: currentRequests,
      tokensUsedToday: currentTokens,
      remaining: 0
    };
  }

  return {
    allowed: true,
    requestsToday: currentRequests,
    tokensUsedToday: currentTokens,
    remaining: userLimit - currentRequests
  };
}

export async function dbIncrementUserAiUsage(userId: string, tokens = 0, isToolCall = false): Promise<void> {
  const db = (await getDb());
  const today = new Date().toISOString().slice(0, 10);
  const toolCallInc = isToolCall ? 1 : 0;

  (await db.prepare(`
    INSERT INTO user_ai_usage (user_id, requests_today, tokens_used_today, tool_calls_today, daily_limit, last_reset_date)
    VALUES (?, 1, ?, ?, 100, ?)
    ON CONFLICT(user_id) DO UPDATE SET
      requests_today = user_ai_usage.requests_today + 1,
      tokens_used_today = user_ai_usage.tokens_used_today + ?,
      tool_calls_today = user_ai_usage.tool_calls_today + ?;
  `).run(userId, tokens, toolCallInc, today, tokens, toolCallInc));
}

// =============================================================================
// Persistent Rate Limiter (Per User and Per IP)
// =============================================================================

export async function dbCheckRateLimit(
  rateKey: string,
  maxRequests: number,
  windowMs: number
): Promise<{ allowed: boolean; remaining: number; resetAt: number }> {
  const db = (await getDb());
  const now = Date.now();

  const stmt = db.prepare('SELECT rate_key, count, reset_at FROM rate_limits WHERE rate_key = ?;');
  const row = (await stmt.get(rateKey)) as any;

  if (!row || now > Number(row.reset_at)) {
    const newResetAt = now + windowMs;
    (await db.prepare('INSERT OR REPLACE INTO rate_limits (rate_key, count, reset_at) VALUES (?, ?, ?);')
      .run(rateKey, 1, newResetAt));
    return { allowed: true, remaining: maxRequests - 1, resetAt: newResetAt };
  }

  const currentCount = Number(row.count);
  if (currentCount >= maxRequests) {
    return { allowed: false, remaining: 0, resetAt: Number(row.reset_at) };
  }

  const updatedCount = currentCount + 1;
  (await db.prepare('UPDATE rate_limits SET count = ? WHERE rate_key = ?;')
    .run(updatedCount, rateKey));

  return {
    allowed: true,
    remaining: Math.max(0, maxRequests - updatedCount),
    resetAt: Number(row.reset_at)
  };
}

// =============================================================================
// User Webhooks DB Operations (Strictly Tenant-Isolated & SSRF Safe)
// =============================================================================

export async function dbStoreUserWebhook(params: {
  id: string;
  userId: string;
  name: string;
  targetUrl: string;
  encryptedSecret?: string;
  environment?: string;
}): Promise<DbUserWebhook> {
  const db = (await getDb());
  const now = new Date().toISOString();
  const env = params.environment || 'production';

  (await db.prepare(`
    INSERT INTO user_webhooks (id, user_id, name, target_url, encrypted_secret, environment, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?);
  `).run(
    params.id,
    params.userId,
    params.name,
    params.targetUrl,
    params.encryptedSecret || null,
    env,
    now
  ));

  return {
    id: params.id,
    userId: params.userId,
    name: params.name,
    targetUrl: params.targetUrl,
    encryptedSecret: params.encryptedSecret,
    environment: env,
    createdAt: now
  };
}

export async function dbGetUserWebhooks(userId: string): Promise<DbUserWebhook[]> {
  const db = (await getDb());
  const stmt = db.prepare('SELECT * FROM user_webhooks WHERE user_id = ?;');
  const rows = (await stmt.all(userId)) as any[];

  return rows.map((r) => ({
    id: r.id,
    userId: r.user_id,
    name: r.name,
    targetUrl: r.target_url,
    encryptedSecret: r.encrypted_secret || undefined,
    environment: r.environment,
    createdAt: r.created_at
  }));
}

export async function dbGetUserWebhookById(userId: string, webhookId: string): Promise<DbUserWebhook | null> {
  const db = (await getDb());
  const stmt = db.prepare('SELECT * FROM user_webhooks WHERE user_id = ? AND id = ?;');
  const r = (await stmt.get(userId, webhookId)) as any;
  if (!r) return null;

  return {
    id: r.id,
    userId: r.user_id,
    name: r.name,
    targetUrl: r.target_url,
    encryptedSecret: r.encrypted_secret || undefined,
    environment: r.environment,
    createdAt: r.created_at
  };
}

export async function dbDeleteUserWebhook(userId: string, webhookId: string): Promise<boolean> {
  const db = (await getDb());
  const res = (await db.prepare('DELETE FROM user_webhooks WHERE user_id = ? AND id = ?;').run(userId, webhookId));
  return Number(res.changes) > 0;
}
