import express, { Request, Response } from 'express';
import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import {
  UNIFIED_TOOL_REGISTRY,
  executeToolSecurely,
  getAllowlistedOpenRouterTools,
  getAuditLogs
} from './server/toolExecutor';
import { CONNECTORS, validateSafeWebhookUrl } from './server/pluginRegistry';
import {
  generateOAuthState,
  verifyOAuthState,
  storeUserConnectorToken,
  revokeUserConnectorToken,
  getUserConnectorAuthDetails,
  isUserConnectorConnected
} from './server/integrationStore';
import {
  sessionMiddleware,
  requireAuth,
  signSessionToken,
  hashPassword,
  verifyPassword
} from './server/auth';
import {
  dbCreateUser,
  dbGetUserById,
  dbGetUserByEmail,
  dbGetUserIntegrations,
  dbStoreUserWebhook,
  dbGetUserWebhooks,
  dbDeleteUserWebhook,
  dbCheckUserAiUsage,
  dbIncrementUserAiUsage,
  dbStoreUserIntegration,
  dbVerifyOAuthState
} from './server/db';
import { encryptString } from './server/crypto';
import { logger } from './server/logger';

// Load environment variables from .env
dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Read Google OAuth Client ID if available
let googleClientId = process.env.GOOGLE_CLIENT_ID || '';
try {
  const cfgPath = path.join(__dirname, 'firebase-applet-config.json');
  if (fs.existsSync(cfgPath)) {
    const raw = fs.readFileSync(cfgPath, 'utf8');
    const parsed = JSON.parse(raw);
    if (parsed.oAuthClientId) {
      googleClientId = parsed.oAuthClientId;
    }
  }
} catch {
  // Ignore
}

const app = express();
const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;

// Curated list of popular OpenRouter models
const CURATED_MODELS = [
  {
    id: 'openrouter/free',
    name: 'OpenRouter Free – Automation',
    provider: 'OpenRouter',
    description: 'Free tier router for general chat & automated tool execution without API credits',
    isFree: true,
    badge: 'Free Automation'
  },
  {
    id: 'anthropic/claude-opus-5.5',
    name: 'Claude Opus 5.5',
    provider: 'Anthropic',
    description: 'Frontier Anthropic flagship with peerless depth, reasoning, and coding precision',
    isFree: false,
    badge: 'Opus 5.5'
  },
  {
    id: 'openai/gpt-4o',
    name: 'GPT-4o',
    provider: 'OpenAI',
    description: 'Flagship omni model with high intelligence and vision',
    isFree: false,
    badge: 'Omni'
  },
  {
    id: 'openai/gpt-4o-mini',
    name: 'GPT-4o Mini',
    provider: 'OpenAI',
    description: 'Fast, cost-efficient, and intelligent OpenAI model',
    isFree: false,
    badge: 'Fast'
  },
  {
    id: 'deepseek/deepseek-chat',
    name: 'DeepSeek V3',
    provider: 'DeepSeek',
    description: 'Ultra-fast, state-of-the-art general purpose model',
    isFree: false,
    badge: 'Popular'
  },
  {
    id: 'deepseek/deepseek-r1',
    name: 'DeepSeek R1',
    provider: 'DeepSeek',
    description: 'Open reasoning model with chain-of-thought problem solving',
    isFree: false,
    isReasoning: true,
    badge: 'Reasoning'
  },
  {
    id: 'meta-llama/llama-3.3-70b-instruct',
    name: 'Llama 3.3 70B',
    provider: 'Meta',
    description: 'State of the art open weights model for complex workflows',
    isFree: false,
    badge: 'Open Weight'
  }
];

// Middleware
app.use(express.json({ limit: '10mb' }));
app.use(sessionMiddleware);

// =============================================================================
// Helper: Ensure User Session (Auto-creates guest session if not authenticated)
// =============================================================================
function ensureUserSession(req: Request): string {
  if (req.userId) return req.userId;

  // Generate anonymous guest user
  const guestId = `guest_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const user = dbCreateUser({
    id: guestId,
    displayName: 'Guest User',
    isAnonymous: true
  });
  req.userId = user.id;
  req.user = {
    id: user.id,
    displayName: user.displayName,
    isAnonymous: true
  };
  return user.id;
}

// =============================================================================
// Authentication Endpoints (Multi-Tenant User Management)
// =============================================================================

// Register with email and password
app.post('/api/auth/register', (req: Request, res: Response) => {
  const { email, password, displayName } = req.body || {};

  if (!email || typeof email !== 'string' || !email.includes('@')) {
    return res.status(400).json({ error: 'Valid email address is required.' });
  }
  if (!password || typeof password !== 'string' || password.length < 6) {
    return res.status(400).json({ error: 'Password must be at least 6 characters.' });
  }

  const existing = dbGetUserByEmail(email);
  if (existing) {
    return res.status(409).json({ error: 'An account with this email already exists. Please log in.' });
  }

  const userId = `usr_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const passwordHash = hashPassword(password);
  const user = dbCreateUser({
    id: userId,
    email: email.toLowerCase().trim(),
    passwordHash,
    displayName: displayName?.trim() || email.split('@')[0],
    isAnonymous: false
  });

  const token = signSessionToken({ userId: user.id, email: user.email, isAnonymous: false });
  logger.info('Security', `New user registered: ${user.email} (${user.id})`);

  return res.json({
    success: true,
    token,
    user: {
      id: user.id,
      email: user.email,
      displayName: user.displayName,
      isAnonymous: false
    }
  });
});

// Login with email and password
app.post('/api/auth/login', (req: Request, res: Response) => {
  const { email, password } = req.body || {};

  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required.' });
  }

  const user = dbGetUserByEmail(email);
  if (!user || !user.passwordHash || !verifyPassword(password, user.passwordHash)) {
    return res.status(401).json({ error: 'Invalid email or password.' });
  }

  const token = signSessionToken({ userId: user.id, email: user.email, isAnonymous: false });
  logger.info('Security', `User logged in: ${user.email} (${user.id})`);

  return res.json({
    success: true,
    token,
    user: {
      id: user.id,
      email: user.email,
      displayName: user.displayName,
      isAnonymous: user.isAnonymous
    }
  });
});

// Fast guest session for frictionless public onboarding
app.post('/api/auth/guest', (_req: Request, res: Response) => {
  const guestId = `guest_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const user = dbCreateUser({
    id: guestId,
    displayName: 'Guest User',
    isAnonymous: true
  });

  const token = signSessionToken({ userId: user.id, isAnonymous: true });
  logger.info('Security', `Guest session generated: ${user.id}`);

  return res.json({
    success: true,
    token,
    user: {
      id: user.id,
      displayName: user.displayName,
      isAnonymous: true
    }
  });
});

// Google Sign-In verification & account linking
app.post('/api/auth/google', async (req: Request, res: Response) => {
  const { accessToken } = req.body || {};
  if (!accessToken || typeof accessToken !== 'string') {
    return res.status(400).json({ error: 'Missing Google accessToken.' });
  }

  try {
    const userRes = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
      headers: { Authorization: `Bearer ${accessToken}` }
    });
    if (!userRes.ok) {
      return res.status(401).json({ error: 'Failed to verify Google access token.' });
    }

    const userData = (await userRes.json()) as { email?: string; name?: string; picture?: string };
    if (!userData.email) {
      return res.status(400).json({ error: 'No email returned from Google profile.' });
    }

    let user = dbGetUserByEmail(userData.email);
    if (!user) {
      const userId = `usr_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      user = dbCreateUser({
        id: userId,
        email: userData.email,
        displayName: userData.name || userData.email.split('@')[0],
        avatarUrl: userData.picture,
        isAnonymous: false
      });
    }

    const token = signSessionToken({ userId: user.id, email: user.email, isAnonymous: false });
    return res.json({
      success: true,
      token,
      user: {
        id: user.id,
        email: user.email,
        displayName: user.displayName,
        avatarUrl: user.avatarUrl,
        isAnonymous: false
      }
    });
  } catch (err: unknown) {
    return res.status(500).json({ error: 'Google sign-in verification failed.' });
  }
});

// Current User Profile & AI Usage Metrics
app.get('/api/auth/me', (req: Request, res: Response) => {
  const userId = ensureUserSession(req);
  const user = dbGetUserById(userId);
  const usage = dbCheckUserAiUsage(userId);

  return res.json({
    authenticated: Boolean(req.user && !req.user.isAnonymous),
    user: user || { id: userId, displayName: 'Guest User', isAnonymous: true },
    aiUsage: {
      requestsToday: usage.requestsToday,
      tokensUsedToday: usage.tokensUsedToday,
      dailyLimit: 100,
      remainingRequests: usage.remaining
    }
  });
});

// =============================================================================
// Integrations Endpoints (Strictly Tenant-Isolated)
// =============================================================================

// GET /api/integrations - List connectors with user-specific connection status
app.get('/api/integrations', (req: Request, res: Response) => {
  const userId = ensureUserSession(req);
  const userIntegrations = dbGetUserIntegrations(userId);
  const integrationMap = new Map(userIntegrations.map((i) => [i.provider, i]));

  const connectorsList = Object.values(CONNECTORS).map((c) => {
    const userAuth = integrationMap.get(c.id);
    const connected = Boolean(userAuth && userAuth.connectionStatus === 'connected');
    const isExpired = Boolean(userAuth?.tokenExpiry && Date.now() > userAuth.tokenExpiry);

    return {
      id: c.id,
      name: c.name,
      description: c.description,
      authType: c.authType,
      category: c.category || 'productivity',
      connected,
      status: userAuth ? userAuth.connectionStatus : 'disconnected',
      accountEmail: userAuth?.externalAccountId,
      scopes: userAuth?.scopes || c.requiredScopes,
      connectedAt: userAuth?.createdAt,
      isExpired,
      lastError: userAuth?.lastError,
      toolsCount: c.tools.length,
      availableTools: c.tools.map((t) => ({
        id: t.id,
        name: t.name,
        description: t.description,
        sensitivity: t.sensitivity
      }))
    };
  });

  return res.json({
    googleClientId,
    userId,
    connectors: connectorsList
  });
});

// GET /api/integrations/oauth-state - Generate CSRF state token tied to this user
app.get('/api/integrations/oauth-state', (req: Request, res: Response) => {
  const userId = ensureUserSession(req);
  const connectorId = String(req.query.connectorId || '');
  if (!connectorId || !CONNECTORS[connectorId]) {
    return res.status(400).json({ error: 'Valid connectorId is required.' });
  }

  const state = generateOAuthState(userId, connectorId);
  return res.json({ state });
});

// GET /api/integrations/google/oauth-url - Generate standard OAuth consent redirect URL
app.get('/api/integrations/google/oauth-url', (req: Request, res: Response) => {
  const userId = ensureUserSession(req);
  const connectorId = String(req.query.connectorId || 'gmail');
  const connector = CONNECTORS[connectorId];

  if (!connector) {
    return res.status(400).json({ error: 'Invalid connectorId.' });
  }

  const clientId = googleClientId || process.env.GOOGLE_CLIENT_ID;
  if (!clientId) {
    return res.status(500).json({ error: 'Google Client ID is not configured.' });
  }

  const state = generateOAuthState(userId, connectorId);
  const appUrl = process.env.APP_URL || 'http://localhost:3000';
  const redirectUri = `${appUrl}/api/integrations/google/callback`;
  const scopes = encodeURIComponent(connector.requiredScopes.join(' '));

  const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?client_id=${encodeURIComponent(
    clientId
  )}&redirect_uri=${encodeURIComponent(
    redirectUri
  )}&response_type=code&scope=${scopes}&access_type=offline&prompt=consent&state=${state}`;

  return res.json({ url: authUrl, state });
});

// GET /api/integrations/google/callback - Standard OAuth redirect callback handler
app.get('/api/integrations/google/callback', async (req: Request, res: Response) => {
  const { code, state, error } = req.query;
  const appUrl = process.env.APP_URL || 'http://localhost:3000';

  if (error || !code || !state) {
    return res.redirect(`${appUrl}/?oauth_error=${encodeURIComponent(String(error || 'Authorization was cancelled'))}`);
  }

  const stateStr = String(state);
  // Verify state and extract userId & connectorId from DB
  const db = (await import('./server/db')).getDb();
  const stateRow = db.prepare('SELECT user_id, connector_id FROM oauth_states WHERE state = ?;').get(stateStr) as any;

  if (!stateRow) {
    return res.redirect(`${appUrl}/?oauth_error=${encodeURIComponent('Invalid or expired OAuth state')}`);
  }

  db.prepare('DELETE FROM oauth_states WHERE state = ?;').run(stateStr);
  const { user_id: userId, connector_id: connectorId } = stateRow;

  const clientId = googleClientId || process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const redirectUri = `${appUrl}/api/integrations/google/callback`;

  if (!clientId || !clientSecret) {
    return res.redirect(`${appUrl}/?oauth_error=${encodeURIComponent('Server is missing GOOGLE_CLIENT_SECRET for code exchange.')}`);
  }

  try {
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code: String(code),
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
        grant_type: 'authorization_code'
      })
    });

    if (!tokenRes.ok) {
      const errText = await tokenRes.text();
      return res.redirect(`${appUrl}/?oauth_error=${encodeURIComponent('Google token exchange failed')}`);
    }

    const tokenData = (await tokenRes.json()) as any;
    await storeUserConnectorToken({
      userId,
      connectorId,
      accessToken: tokenData.access_token,
      refreshToken: tokenData.refresh_token,
      scopes: CONNECTORS[connectorId]?.requiredScopes || [],
      expiresIn: tokenData.expires_in
    });

    logger.info('OAuth', `OAuth callback completed for user "${userId}" connector "${connectorId}"`);
    return res.redirect(`${appUrl}/?integration_connected=${connectorId}`);
  } catch (err: unknown) {
    return res.redirect(`${appUrl}/?oauth_error=${encodeURIComponent('OAuth completion error')}`);
  }
});

// POST /api/integrations/:connectorId/connect - Connect via verified token (Firebase popup or client token)
app.post('/api/integrations/:connectorId/connect', async (req: Request, res: Response) => {
  const userId = ensureUserSession(req);
  const { connectorId } = req.params;
  const { accessToken, refreshToken, state, scopes, expiresIn } = req.body || {};

  if (!CONNECTORS[connectorId]) {
    return res.status(404).json({ error: `Unknown connector "${connectorId}".` });
  }
  if (!accessToken || typeof accessToken !== 'string') {
    return res.status(400).json({ error: 'Missing accessToken.' });
  }

  // Verify OAuth CSRF state if provided
  if (state && !verifyOAuthState(state, userId, connectorId)) {
    return res.status(403).json({ error: 'Invalid or expired OAuth state token (CSRF check failed).' });
  }

  try {
    const { accountEmail, connectedAt } = await storeUserConnectorToken({
      userId,
      connectorId,
      accessToken,
      refreshToken,
      scopes: Array.isArray(scopes) ? scopes : CONNECTORS[connectorId].requiredScopes,
      expiresIn: Number(expiresIn) || 3600
    });

    return res.json({
      success: true,
      connectorId,
      accountEmail,
      connectedAt
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Failed to connect integration';
    return res.status(500).json({ error: msg });
  }
});

// POST /api/integrations/:connectorId/disconnect - Disconnect and revoke user credentials
app.post('/api/integrations/:connectorId/disconnect', async (req: Request, res: Response) => {
  const userId = ensureUserSession(req);
  const { connectorId } = req.params;

  await revokeUserConnectorToken(userId, connectorId);
  return res.json({ success: true, connectorId });
});

// POST /api/integrations/:connectorId/api-key - Connect API-key based integrations (GitHub, Slack, Discord, Notion)
app.post('/api/integrations/:connectorId/api-key', (req: Request, res: Response) => {
  const userId = ensureUserSession(req);
  const { connectorId } = req.params;
  const { apiKey } = req.body || {};

  if (!CONNECTORS[connectorId]) {
    return res.status(404).json({ error: `Unknown connector "${connectorId}".` });
  }
  if (!apiKey || typeof apiKey !== 'string' || apiKey.trim().length < 4) {
    return res.status(400).json({ error: 'Valid API Key is required.' });
  }

  // Encrypt immediately with AES-256-GCM
  const encryptedKey = encryptString(apiKey.trim());
  const maskedKey = '••••••••' + apiKey.trim().slice(-4);

  dbStoreUserIntegration({
    userId,
    provider: connectorId,
    externalAccountId: maskedKey,
    encryptedAccessToken: encryptedKey,
    scopes: CONNECTORS[connectorId].requiredScopes,
    connectionStatus: 'connected'
  });

  logger.info('Vault', `API Key integration stored for user "${userId}" connector "${connectorId}"`);
  return res.json({
    success: true,
    connectorId,
    maskedKey
  });
});

// =============================================================================
// User Webhooks Endpoints (SSRF Protected & Multi-User)
// =============================================================================

app.get('/api/webhooks', (req: Request, res: Response) => {
  const userId = ensureUserSession(req);
  const webhooks = dbGetUserWebhooks(userId);
  return res.json({ webhooks });
});

app.post('/api/webhooks', (req: Request, res: Response) => {
  const userId = ensureUserSession(req);
  const { name, targetUrl, environment } = req.body || {};

  if (!name || typeof name !== 'string' || name.trim().length < 2) {
    return res.status(400).json({ error: 'Webhook name is required.' });
  }
  if (!targetUrl || typeof targetUrl !== 'string') {
    return res.status(400).json({ error: 'Target URL is required.' });
  }

  // Enforce strict SSRF protection
  try {
    validateSafeWebhookUrl(targetUrl.trim());
  } catch (err: unknown) {
    return res.status(400).json({ error: err instanceof Error ? err.message : 'Invalid Webhook URL' });
  }

  const id = `wh_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  const webhook = dbStoreUserWebhook({
    id,
    userId,
    name: name.trim(),
    targetUrl: targetUrl.trim(),
    environment: environment === 'production' ? 'production' : 'staging'
  });

  return res.json({ success: true, webhook });
});

app.delete('/api/webhooks/:id', (req: Request, res: Response) => {
  const userId = ensureUserSession(req);
  const deleted = dbDeleteUserWebhook(userId, req.params.id);
  return res.json({ success: deleted });
});

// =============================================================================
// Tool Execution & Audit Endpoints (Strictly Tenant-Isolated)
// =============================================================================

// POST /api/tools/execute
app.post('/api/tools/execute', async (req: Request, res: Response) => {
  const userId = ensureUserSession(req);
  const { toolName, arguments: toolArgs, confirmed, idempotencyKey } = req.body || {};
  const clientIp =
    (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() ||
    req.socket.remoteAddress ||
    '127.0.0.1';

  try {
    const result = await executeToolSecurely({
      userId,
      toolName: String(toolName || ''),
      arguments: toolArgs,
      confirmed: Boolean(confirmed),
      idempotencyKey: idempotencyKey ? String(idempotencyKey) : undefined,
      clientIp
    });

    return res.json(result);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Tool execution error';
    return res.status(500).json({
      state: 'failed',
      toolName,
      error: message
    });
  }
});

// GET /api/tools/audit-log - Retrieve user's isolated audit trail
app.get('/api/tools/audit-log', (req: Request, res: Response) => {
  const userId = ensureUserSession(req);
  return res.json({
    status: 'ok',
    userId,
    logs: getAuditLogs(userId)
  });
});

// =============================================================================
// Config & Models Endpoints
// =============================================================================

app.get('/api/config', (_req: Request, res: Response) => {
  const apiKey = process.env.OPENROUTER_API_KEY?.trim();
  const isKeyConfigured = Boolean(apiKey && !apiKey.startsWith('sk-or-v1-xxxx') && apiKey !== 'your_openrouter_api_key_here');

  return res.json({
    isKeyConfigured,
    defaultModel: process.env.DEFAULT_AI_MODEL || 'anthropic/claude-opus-5.5',
    googleClientId,
    availableTools: Object.keys(UNIFIED_TOOL_REGISTRY),
    availableModels: CURATED_MODELS.map((m) => m.id)
  });
});

// GET /api/download or /download - Direct Complete Project ZIP Download
app.get(['/api/download', '/download'], (_req: Request, res: Response) => {
  const zipPath = path.resolve(process.cwd(), 'public', 'nexusai-project.zip');
  if (fs.existsSync(zipPath)) {
    return res.download(zipPath, 'nexusai-project.zip');
  }
  return res.status(404).json({ error: 'Archive not found. Please refresh.' });
});

app.get('/api/models', async (_req: Request, res: Response) => {
  const apiKey = process.env.OPENROUTER_API_KEY?.trim();
  if (!apiKey || apiKey.startsWith('sk-or-v1-xxxx')) {
    return res.json({ models: CURATED_MODELS, source: 'curated' });
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 6000);

    const response = await fetch('https://openrouter.ai/api/v1/models', {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'HTTP-Referer': process.env.APP_URL || 'http://localhost:3000',
        'X-Title': 'NexusAI Platform'
      },
      signal: controller.signal
    });

    clearTimeout(timeout);
    if (response.ok) {
      const data = await response.json();
      return res.json({
        models: CURATED_MODELS,
        totalOpenRouterModels: Array.isArray(data?.data) ? data.data.length : undefined,
        source: 'openrouter'
      });
    }
    return res.json({ models: CURATED_MODELS, source: 'fallback' });
  } catch {
    return res.json({ models: CURATED_MODELS, source: 'fallback' });
  }
});

// =============================================================================
// POST /api/chat - Secure proxy for OpenRouter with Per-User Tenant Isolation
// =============================================================================
app.post('/api/chat', async (req: Request, res: Response) => {
  const userId = ensureUserSession(req);
  const apiKey = process.env.OPENROUTER_API_KEY?.trim() || '';

  if (!apiKey || apiKey === 'your_openrouter_api_key_here' || apiKey.startsWith('sk-or-v1-xxxx')) {
    return res.status(401).json({
      error: 'OPENROUTER_API_KEY is not configured on the server.',
      code: 'MISSING_API_KEY',
      details: 'Please add your OPENROUTER_API_KEY in the server environment variables (.env file).'
    });
  }

  // Enforce per-user AI usage limit
  const usage = dbCheckUserAiUsage(userId);
  if (!usage.allowed) {
    return res.status(429).json({
      error: `Daily AI usage limit reached (${usage.requestsToday} requests). Resets tomorrow.`,
      code: 'QUOTA_EXCEEDED'
    });
  }

  const { messages, model, temperature = 0.7, stream = true, tool_choice } = req.body || {};

  if (!Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({
      error: 'Invalid request: "messages" must be a non-empty array of chat messages.',
      code: 'INVALID_PAYLOAD'
    });
  }

  const selectedModel = model?.trim() || process.env.DEFAULT_AI_MODEL || 'anthropic/claude-opus-5.5';

  // Check user active integrations to enrich model system instructions
  const userIntegrations = dbGetUserIntegrations(userId);
  const activeIntegrations = userIntegrations.filter((i) => i.connectionStatus === 'connected');
  const activeDescriptions = activeIntegrations
    .map((i) => `${i.provider} (Account: ${i.externalAccountId || 'Connected'})`)
    .join(', ');

  const integrationNotice =
    activeIntegrations.length > 0
      ? `\n\n[Active Integrations Connected by User: ${activeDescriptions}. IMPORTANT: When the user asks about emails, unread counts, calendar events, or documents, DO NOT claim you cannot access them. You MUST automatically invoke the appropriate tool (such as gmail_get_unread_count) to retrieve the user's real live data.]`
      : `\n\n[Notice: User has not connected Gmail or Google Workspace yet. If they ask about emails or calendar, inform them they can connect their account in Settings → Integrations.]`;

  const defaultSystemPrompt =
    (process.env.SYSTEM_PROMPT ||
      'You are NexusAI, an advanced frontier AI assistant. You are thoughtful, precise, articulate, and skilled in deep reasoning and automation actions.') +
    integrationNotice;

  const sanitizedMessages = [...messages];
  const hasSystem = sanitizedMessages.some((m) => m && m.role === 'system');
  if (!hasSystem) {
    sanitizedMessages.unshift({
      role: 'system',
      content: defaultSystemPrompt
    });
  }

  const maxTokens = Math.min(4096, Math.max(50, Number(req.body.max_tokens) || 1500));

  const openRouterPayload: Record<string, unknown> = {
    model: selectedModel,
    messages: sanitizedMessages.map((m) => ({
      role: m.role === 'assistant' ? 'assistant' : m.role === 'system' ? 'system' : 'user',
      content: String(m.content || '')
    })),
    temperature: Math.max(0, Math.min(2, Number(temperature) || 0.7)),
    max_tokens: maxTokens,
    stream: Boolean(stream)
  };

  // Provide allowlisted tools schema to OpenRouter
  openRouterPayload.tools = getAllowlistedOpenRouterTools();
  openRouterPayload.tool_choice = tool_choice || 'auto';

  const isReasoningModel =
    selectedModel.includes('gpt-6') ||
    selectedModel.includes('luna') ||
    selectedModel.includes('r1') ||
    selectedModel.includes('o1') ||
    selectedModel.includes('o3');
  if (isReasoningModel) {
    openRouterPayload.reasoning = {};
  }

  const controller = new AbortController();
  res.on('close', () => {
    if (!res.writableEnded) {
      controller.abort();
    }
  });

  try {
    const appUrl = process.env.APP_URL || 'http://localhost:3000';
    logger.info('ToolRouter', `Chat completion request for user "${userId}" with model "${selectedModel}"`);

    const openRouterResponse = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
        'HTTP-Referer': appUrl,
        'X-Title': 'NexusAI Platform'
      },
      body: JSON.stringify(openRouterPayload),
      signal: controller.signal
    });

    if (!openRouterResponse.ok) {
      let errorBody: Record<string, unknown> = {};
      try {
        errorBody = (await openRouterResponse.json()) as Record<string, unknown>;
      } catch {
        errorBody = { error: await openRouterResponse.text() };
      }
      return res.status(openRouterResponse.status).json({
        error: 'OpenRouter API Error',
        code: 'OPENROUTER_ERROR',
        status: openRouterResponse.status,
        details: errorBody
      });
    }

    // Increment user usage count
    dbIncrementUserAiUsage(userId, 1, false);

    // Non-streaming response
    if (!stream) {
      const data = await openRouterResponse.json();
      return res.json(data);
    }

    // Streaming SSE response
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders?.();

    const responseBody = openRouterResponse.body;
    if (!responseBody) {
      res.write('data: [DONE]\n\n');
      return res.end();
    }

    const reader = (responseBody as any).getReader();
    const decoder = new TextDecoder('utf-8');

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunkText = decoder.decode(value, { stream: true });
      res.write(chunkText);
    }

    return res.end();
  } catch (err: unknown) {
    if ((err as any)?.name === 'AbortError') {
      return res.end();
    }
    const message = err instanceof Error ? err.message : 'Unknown chat proxy error';
    if (!res.headersSent) {
      return res.status(500).json({ error: message, code: 'CHAT_FAILED' });
    }
    res.write(`data: ${JSON.stringify({ error: message })}\n\n`);
    return res.end();
  }
});

// Vite middleware in dev or static files in production
async function startServer() {
  const isProduction = process.env.NODE_ENV === 'production';

  if (!isProduction) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa'
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    logger.info('Database', `NexusAI server running on http://localhost:${PORT}`);
  });
}

startServer().catch((err) => {
  logger.error('Security', 'Failed to start NexusAI server', err);
});
