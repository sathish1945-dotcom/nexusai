export type MessageRole = 'user' | 'assistant' | 'system' | 'tool';

export type ToolLifecycleState =
  | 'requested'
  | 'awaiting_confirmation'
  | 'running'
  | 'completed'
  | 'failed';

export type ToolSensitivity = 'safe' | 'sensitive';

export type ConnectionStatus =
  | 'connected'
  | 'disconnected'
  | 'reconnect_required'
  | 'permission_required'
  | 'error';

export interface ToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string;
  };
  state: ToolLifecycleState;
  sensitivity?: ToolSensitivity;
  idempotencyKey?: string;
  result?: unknown;
  error?: string;
  durationMs?: number;
  cached?: boolean;
}

export interface ChatMessage {
  id: string;
  role: MessageRole;
  content: string;
  reasoning?: string;
  toolCalls?: ToolCall[];
  createdAt: number;
  model?: string;
  status?: 'sending' | 'streaming' | 'complete' | 'error';
  error?: string;
  is402Error?: boolean;
}

export interface Conversation {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  model: string;
  messages: ChatMessage[];
  pinned?: boolean;
}

export interface ModelInfo {
  id: string;
  name: string;
  provider: string;
  description: string;
  isFree?: boolean;
  isReasoning?: boolean;
  badge?: string;
}

export interface AvailableTool {
  id: string;
  name: string;
  description: string;
  sensitivity: ToolSensitivity;
  connectorId?: string;
}

export interface ConnectorInfo {
  id: string;
  name: string;
  description: string;
  authType: 'oauth2' | 'api_key' | 'webhook' | 'none';
  category?: 'productivity' | 'developer' | 'communication' | 'automation';
  requiredScopes: string[];
  scopes?: string[];
  connected: boolean;
  status: ConnectionStatus;
  accountEmail?: string;
  connectedAt?: string;
  isExpired?: boolean;
  lastError?: string;
  toolsCount?: number;
  availableTools: AvailableTool[];
}

export interface UserProfile {
  id: string;
  email?: string;
  displayName?: string;
  avatarUrl?: string;
  isAnonymous: boolean;
}

export interface UserAiUsage {
  requestsToday: number;
  tokensUsedToday: number;
  dailyLimit: number;
  remainingRequests: number;
}

export interface RegisteredWebhook {
  id: string;
  userId: string;
  name: string;
  targetUrl: string;
  environment: string;
  createdAt: string;
}

export interface BackendConfig {
  status: string;
  isKeyConfigured: boolean;
  defaultModel: string;
  systemPrompt: string;
  googleClientId?: string;
  curatedModels: ModelInfo[];
  availableTools?: AvailableTool[];
  version?: string;
  deploymentPlatform?: string;
}
