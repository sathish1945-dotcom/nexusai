import {
  BackendConfig,
  ToolCall,
  ToolLifecycleState,
  ToolSensitivity,
  ConnectorInfo,
  UserProfile,
  UserAiUsage,
  RegisteredWebhook
} from '../types/chat';

export interface AutomationTool {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

// =============================================================================
// Session Management (Client-Side Storage of Cryptographic Session Token)
// =============================================================================
const SESSION_TOKEN_KEY = 'nexus_session_token';

export function getSessionToken(): string | null {
  try {
    return localStorage.getItem(SESSION_TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setSessionToken(token: string | null): void {
  try {
    if (token) {
      localStorage.setItem(SESSION_TOKEN_KEY, token);
    } else {
      localStorage.removeItem(SESSION_TOKEN_KEY);
    }
  } catch {
    // Ignore localStorage errors
  }
}

export function getAuthHeaders(): Record<string, string> {
  const token = getSessionToken();
  const headers: Record<string, string> = {};
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }
  return headers;
}

// =============================================================================
// User Authentication API
// =============================================================================

export async function registerUser(params: {
  email: string;
  password: string;
  displayName?: string;
}): Promise<{ user: UserProfile; token: string }> {
  const res = await fetch('/api/auth/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params)
  });

  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error || 'Registration failed');
  }

  setSessionToken(data.token);
  return data;
}

export async function loginUser(params: {
  email: string;
  password: string;
}): Promise<{ user: UserProfile; token: string }> {
  const res = await fetch('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params)
  });

  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error || 'Login failed');
  }

  setSessionToken(data.token);
  return data;
}

export async function createGuestSession(): Promise<{ user: UserProfile; token: string }> {
  const res = await fetch('/api/auth/guest', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' }
  });

  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error || 'Failed to initialize session');
  }

  setSessionToken(data.token);
  return data;
}

export async function getCurrentUser(): Promise<{
  authenticated: boolean;
  user: UserProfile;
  aiUsage: UserAiUsage;
}> {
  const res = await fetch('/api/auth/me', {
    headers: {
      ...getAuthHeaders(),
      Accept: 'application/json'
    },
    cache: 'no-store'
  });

  if (!res.ok) {
    throw new Error('Failed to load user profile');
  }

  return res.json();
}

export function logoutUser(): void {
  setSessionToken(null);
}

// =============================================================================
// Configuration & Integrations API (Multi-Tenant)
// =============================================================================

export async function getBackendConfig(): Promise<BackendConfig> {
  const response = await fetch('/api/config', {
    headers: {
      ...getAuthHeaders(),
      Accept: 'application/json'
    },
    cache: 'no-store'
  });

  if (!response.ok) {
    let errorText = `Failed to load server configuration (HTTP ${response.status})`;
    try {
      const err = await response.json();
      if (err.error) errorText = err.error;
    } catch {
      // Ignore
    }
    throw new Error(errorText);
  }

  return response.json();
}

export async function getConnectors(): Promise<{
  connectors: ConnectorInfo[];
  googleClientId?: string;
  userId?: string;
}> {
  const res = await fetch('/api/integrations', {
    headers: {
      ...getAuthHeaders(),
      Accept: 'application/json'
    },
    cache: 'no-store'
  });

  if (!res.ok) throw new Error('Failed to fetch integrations');
  return res.json();
}

export async function getOAuthState(connectorId: string): Promise<string> {
  const res = await fetch(`/api/integrations/oauth-state?connectorId=${encodeURIComponent(connectorId)}`, {
    headers: getAuthHeaders(),
    cache: 'no-store'
  });
  if (!res.ok) throw new Error('Failed to generate OAuth state');
  const data = await res.json();
  return data.state;
}

export async function connectConnector(params: {
  connectorId: string;
  accessToken: string;
  refreshToken?: string;
  state?: string;
  scopes?: string[];
  expiresIn?: number;
}): Promise<{ success: boolean; accountEmail?: string; connectedAt?: string }> {
  const res = await fetch(`/api/integrations/${encodeURIComponent(params.connectorId)}/connect`, {
    method: 'POST',
    headers: {
      ...getAuthHeaders(),
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(params)
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || 'Failed to connect integration');
  }
  return res.json();
}

export async function connectAllGoogle(params: {
  accessToken: string;
  scopes?: string[];
  expiresIn?: number;
}): Promise<{ success: boolean; accountEmail?: string; connectedConnectors: string[] }> {
  const connectors = ['gmail', 'google_calendar', 'google_drive'];
  let detectedEmail: string | undefined;
  for (const cId of connectors) {
    const res = await connectConnector({
      connectorId: cId,
      accessToken: params.accessToken,
      scopes: params.scopes,
      expiresIn: params.expiresIn
    });
    if (res.accountEmail) detectedEmail = res.accountEmail;
  }
  return { success: true, accountEmail: detectedEmail, connectedConnectors: connectors };
}

export async function disconnectConnector(connectorId: string): Promise<{ success: boolean }> {
  const res = await fetch(`/api/integrations/${encodeURIComponent(connectorId)}/disconnect`, {
    method: 'POST',
    headers: getAuthHeaders()
  });

  if (!res.ok) throw new Error('Failed to disconnect integration');
  return res.json();
}

export async function connectApiKey(params: {
  connectorId: string;
  apiKey: string;
}): Promise<{ success: boolean; maskedKey: string }> {
  const res = await fetch(`/api/integrations/${encodeURIComponent(params.connectorId)}/api-key`, {
    method: 'POST',
    headers: {
      ...getAuthHeaders(),
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ apiKey: params.apiKey })
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || 'Failed to save API key');
  }
  return res.json();
}

// =============================================================================
// Webhooks API
// =============================================================================

export async function getWebhooks(): Promise<{ webhooks: RegisteredWebhook[] }> {
  const res = await fetch('/api/webhooks', {
    headers: getAuthHeaders(),
    cache: 'no-store'
  });
  if (!res.ok) throw new Error('Failed to fetch webhooks');
  return res.json();
}

export async function createWebhook(params: {
  name: string;
  targetUrl: string;
  environment?: string;
}): Promise<{ success: boolean; webhook: RegisteredWebhook }> {
  const res = await fetch('/api/webhooks', {
    method: 'POST',
    headers: {
      ...getAuthHeaders(),
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(params)
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || 'Failed to register webhook');
  }
  return res.json();
}

export async function deleteWebhook(id: string): Promise<{ success: boolean }> {
  const res = await fetch(`/api/webhooks/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    headers: getAuthHeaders()
  });
  if (!res.ok) throw new Error('Failed to delete webhook');
  return res.json();
}

// =============================================================================
// Tool Execution & Audit API
// =============================================================================

export interface ExecuteToolApiParams {
  toolName: string;
  arguments: unknown;
  confirmed?: boolean;
  idempotencyKey?: string;
}

export interface ExecuteToolApiResponse {
  state: ToolLifecycleState;
  toolName: string;
  sensitivity: ToolSensitivity;
  idempotencyKey: string;
  requiresConfirmation?: boolean;
  result?: unknown;
  error?: string;
  cached?: boolean;
  durationMs?: number;
}

export async function executeToolApi(params: ExecuteToolApiParams): Promise<ExecuteToolApiResponse> {
  const response = await fetch('/api/tools/execute', {
    method: 'POST',
    headers: {
      ...getAuthHeaders(),
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(params)
  });

  if (!response.ok) {
    let errorDetail = `Tool execution failed with HTTP ${response.status}`;
    try {
      const errJson = await response.json();
      if (errJson.error) errorDetail = errJson.error;
    } catch {
      // Ignore
    }
    return {
      state: 'failed',
      toolName: params.toolName,
      sensitivity: 'sensitive',
      idempotencyKey: params.idempotencyKey || `err_${Date.now()}`,
      error: errorDetail
    };
  }

  return response.json();
}

export async function getAuditLogs(): Promise<{ logs: any[] }> {
  const res = await fetch('/api/tools/audit-log', {
    headers: getAuthHeaders(),
    cache: 'no-store'
  });
  if (!res.ok) throw new Error('Failed to load audit logs');
  return res.json();
}

// =============================================================================
// Streaming Chat API (SSE with Multi-Tenant Headers & Tool Calls)
// =============================================================================

export interface StreamChatOptions {
  model: string;
  messages: Array<{ role: 'user' | 'assistant' | 'system'; content: string }>;
  temperature?: number;
  max_tokens?: number;
  tools?: unknown[];
  tool_choice?: unknown;
  signal?: AbortSignal;
  onDelta: (textChunk: string) => void;
  onReasoningDelta?: (reasoningChunk: string) => void;
  onToolCalls?: (toolCalls: ToolCall[]) => void;
}

export class ApiStreamError extends Error {
  statusCode?: number;
  is402Error?: boolean;

  constructor(message: string, statusCode?: number, is402Error?: boolean) {
    super(message);
    this.name = 'ApiStreamError';
    this.statusCode = statusCode;
    this.is402Error = is402Error;
  }
}

export async function streamChatCompletion(options: StreamChatOptions): Promise<void> {
  const {
    model,
    messages,
    temperature = 0.7,
    max_tokens = 2000,
    tools,
    tool_choice,
    signal,
    onDelta,
    onReasoningDelta,
    onToolCalls
  } = options;

  const response = await fetch('/api/chat', {
    method: 'POST',
    headers: {
      ...getAuthHeaders(),
      'Content-Type': 'application/json',
      Accept: 'text/event-stream'
    },
    body: JSON.stringify({
      model,
      messages,
      temperature,
      max_tokens,
      tools,
      tool_choice,
      stream: true
    }),
    signal
  });

  if (!response.ok) {
    let errorDetail = `Request failed with HTTP status ${response.status}`;
    let is402 = response.status === 402;
    try {
      const errorJson = await response.json();
      if (errorJson.error) {
        errorDetail = typeof errorJson.error === 'string' ? errorJson.error : JSON.stringify(errorJson.error);
      }
      if (errorJson.code === 'INSUFFICIENT_CREDITS' || errorJson.code === 402) {
        is402 = true;
      }
    } catch {
      // Ignore
    }
    throw new ApiStreamError(errorDetail, response.status, is402);
  }

  const responseBody = response.body;
  if (!responseBody) {
    throw new ApiStreamError('ReadableStream not supported or empty response body returned from server.');
  }

  const reader = responseBody.getReader();
  const decoder = new TextDecoder('utf-8');
  let buffer = '';
  const accumulatedToolCalls: ToolCall[] = [];

  const processJsonLine = (jsonStr: string) => {
    let parsed: any;
    try {
      parsed = JSON.parse(jsonStr);
    } catch {
      return;
    }

    if (parsed.error) {
      const streamErrMsg =
        (typeof parsed.error === 'object' && parsed.error !== null && parsed.error.message) ||
        (typeof parsed.error === 'string' && parsed.error) ||
        'OpenRouter API returned an error during generation.';
      const is402 =
        parsed.error?.code === 402 ||
        streamErrMsg.includes('402') ||
        streamErrMsg.toLowerCase().includes('credit') ||
        streamErrMsg.toLowerCase().includes('afford');
      throw new ApiStreamError(streamErrMsg, parsed.error?.code || 500, is402);
    }

    const choice = parsed.choices?.[0];
    if (!choice) return;

    const delta = choice.delta;
    if (!delta) return;

    if (delta.reasoning || delta.reasoning_content) {
      const reasoningChunk = delta.reasoning || delta.reasoning_content;
      if (typeof reasoningChunk === 'string' && onReasoningDelta) {
        onReasoningDelta(reasoningChunk);
      }
    }

    if (delta.content && typeof delta.content === 'string') {
      onDelta(delta.content);
    }

    if (delta.tool_calls && Array.isArray(delta.tool_calls)) {
      for (const tc of delta.tool_calls) {
        const idx = tc.index ?? 0;
        if (!accumulatedToolCalls[idx]) {
          const fnName = tc.function?.name || '';
          const isSensitive = [
            'send_notification',
            'delete_data',
            'calendar_create_event',
            'webhook_trigger'
          ].includes(fnName);

          accumulatedToolCalls[idx] = {
            id: tc.id || `call_${Date.now()}_${idx}`,
            type: 'function',
            function: {
              name: fnName,
              arguments: tc.function?.arguments || ''
            },
            state: 'requested',
            sensitivity: isSensitive ? 'sensitive' : 'safe',
            idempotencyKey: `idemp_${Date.now()}_${idx}_${Math.random().toString(36).slice(2, 8)}`
          };
        } else {
          if (tc.id) accumulatedToolCalls[idx].id = tc.id;
          if (tc.function?.name) {
            accumulatedToolCalls[idx].function.name += tc.function.name;
            const fullName = accumulatedToolCalls[idx].function.name;
            if (['send_notification', 'delete_data', 'calendar_create_event', 'webhook_trigger'].includes(fullName)) {
              accumulatedToolCalls[idx].sensitivity = 'sensitive';
            }
          }
          if (tc.function?.arguments) {
            accumulatedToolCalls[idx].function.arguments += tc.function.arguments;
          }
        }
      }
      if (onToolCalls) {
        onToolCalls([...accumulatedToolCalls.filter(Boolean)]);
      }
    }
  };

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';

    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line || line.startsWith(':')) continue;

      if (line === 'data: [DONE]' || line === 'data:[DONE]' || line.endsWith('[DONE]')) {
        return;
      }

      if (line.startsWith('data:')) {
        const jsonStr = line.replace(/^data:\s*/, '').trim();
        if (!jsonStr || jsonStr === '[DONE]') return;
        processJsonLine(jsonStr);
      }
    }
  }

  if (buffer.trim()) {
    const line = buffer.trim();
    if (line.startsWith('data:') && !line.includes('[DONE]')) {
      const jsonStr = line.replace(/^data:\s*/, '').trim();
      if (jsonStr) processJsonLine(jsonStr);
    }
  }
}
