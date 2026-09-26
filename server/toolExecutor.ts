import { z } from 'zod';
import {
  gmailTools,
  calendarTools,
  driveTools,
  webhookTools,
  CONNECTORS,
  PluginToolDefinition,
  ToolSensitivity,
  ToolExecutionContext
} from './pluginRegistry';
import { isUserConnectorConnected } from './integrationStore';
import {
  dbGetIdempotency,
  dbSetIdempotency,
  dbRecordAudit,
  dbGetAuditLogs,
  dbCheckRateLimit,
  dbCheckUserAiUsage,
  dbIncrementUserAiUsage,
  DbAuditLog
} from './db';
import { logger } from './logger';

export type ToolLifecycleState =
  | 'requested'
  | 'awaiting_confirmation'
  | 'running'
  | 'completed'
  | 'failed';

export interface AuditLogEntry {
  id: string;
  userId: string;
  timestamp: string;
  toolName: string;
  sensitivity: ToolSensitivity;
  idempotencyKey: string;
  parameters: Record<string, unknown>;
  status: 'completed' | 'failed' | 'awaiting_confirmation' | 'rejected';
  durationMs: number;
  result?: unknown;
  error?: string;
  clientIp?: string;
}

// Built-in System Tools
const CheckSystemStatusSchema = z.object({
  service: z.enum([
    'api_gateway',
    'database_cluster',
    'redis_cache',
    'task_queue',
    'auth_service',
    'storage_bucket'
  ]),
  detail_level: z.enum(['basic', 'full']).default('basic')
}).strict();

const CalculateMetricSchema = z.object({
  metric_type: z.enum([
    'average',
    'growth_rate',
    'conversion_rate',
    'percentile_95',
    'throughput',
    'error_rate'
  ]),
  values: z.array(z.number()).min(1, 'At least 1 numerical value is required').max(100),
  unit: z.string().max(20).optional().default('units')
}).strict();

const GenerateSummaryReportSchema = z.object({
  report_type: z.enum([
    'incident_postmortem',
    'performance_digest',
    'audit_summary',
    'daily_standup'
  ]),
  title: z.string().min(3).max(100),
  key_metrics: z.record(z.string(), z.union([z.string(), z.number()])).optional()
}).strict();

const SendNotificationSchema = z.object({
  channel: z.enum([
    'slack_alerts',
    'pagerduty',
    'security_team',
    'ops_discord',
    'executive_digest'
  ]),
  priority: z.enum(['low', 'medium', 'high', 'critical']),
  message: z.string().min(5, 'Notification message cannot be empty').max(500)
}).strict();

const DeleteDataSchema = z.object({
  target: z.enum([
    'temporary_cache',
    'staging_artifacts',
    'test_run_logs',
    'expired_session_records'
  ]),
  retention_days: z.number().int().min(0).max(365),
  reason: z.string().min(10, 'Audit reason is required for data purge').max(200)
}).strict();

const SYSTEM_TOOLS: PluginToolDefinition[] = [
  {
    id: 'check_system_status',
    name: 'Check System Health',
    description: 'Inspect service health, operational metrics, and telemetry for platform infrastructure.',
    sensitivity: 'safe',
    connectorId: 'system',
    schema: CheckSystemStatusSchema,
    openRouterSchema: {
      type: 'function',
      function: {
        name: 'check_system_status',
        description: 'Inspect service health, response latency, and operational telemetry for infrastructure components.',
        parameters: {
          type: 'object',
          properties: {
            service: {
              type: 'string',
              enum: ['api_gateway', 'database_cluster', 'redis_cache', 'task_queue', 'auth_service', 'storage_bucket'],
              description: 'Target infrastructure service to inspect'
            },
            detail_level: {
              type: 'string',
              enum: ['basic', 'full'],
              description: 'Level of telemetry detail to query'
            }
          },
          required: ['service']
        }
      }
    },
    execute: async (args: { service: string; detail_level?: string }) => {
      const mockMetrics: Record<string, { status: string; uptime: string; latencyMs: number; errorRate: string }> = {
        api_gateway: { status: 'healthy', uptime: '99.98%', latencyMs: 24, errorRate: '0.01%' },
        database_cluster: { status: 'healthy', uptime: '99.99%', latencyMs: 4, errorRate: '0.00%' },
        redis_cache: { status: 'healthy', uptime: '100%', latencyMs: 1, errorRate: '0.00%' },
        task_queue: { status: 'healthy', uptime: '99.95%', latencyMs: 12, errorRate: '0.02%' },
        auth_service: { status: 'healthy', uptime: '99.99%', latencyMs: 18, errorRate: '0.01%' },
        storage_bucket: { status: 'healthy', uptime: '99.99%', latencyMs: 45, errorRate: '0.00%' }
      };
      const info = mockMetrics[args.service] || { status: 'unknown', uptime: 'N/A', latencyMs: 0, errorRate: 'N/A' };
      return {
        service: args.service,
        status: info.status,
        timestamp: new Date().toISOString(),
        telemetry: {
          uptime: info.uptime,
          latencyMs: info.latencyMs,
          errorRate: info.errorRate,
          region: 'asia-east1',
          replicaCount: 3
        }
      };
    }
  },
  {
    id: 'calculate_metric',
    name: 'Calculate Metric',
    description: 'Safely evaluate statistical, analytical, or performance metrics.',
    sensitivity: 'safe',
    connectorId: 'system',
    schema: CalculateMetricSchema,
    openRouterSchema: {
      type: 'function',
      function: {
        name: 'calculate_metric',
        description: 'Safely evaluate statistical or analytical metrics.',
        parameters: {
          type: 'object',
          properties: {
            metric_type: {
              type: 'string',
              enum: ['average', 'growth_rate', 'conversion_rate', 'percentile_95', 'throughput', 'error_rate'],
              description: 'Statistical or mathematical operation'
            },
            values: { type: 'array', items: { type: 'number' }, description: 'Array of numbers' },
            unit: { type: 'string', description: 'Unit of measurement' }
          },
          required: ['metric_type', 'values']
        }
      }
    },
    execute: async (args: { metric_type: string; values: number[]; unit?: string }) => {
      const { metric_type, values, unit = 'units' } = args;
      let calculatedValue = 0;
      switch (metric_type) {
        case 'average':
          calculatedValue = values.reduce((a, b) => a + b, 0) / values.length;
          break;
        case 'growth_rate':
          calculatedValue = values.length >= 2 ? ((values[values.length - 1] - values[0]) / (values[0] || 1)) * 100 : 0;
          break;
        case 'percentile_95': {
          const sorted = [...values].sort((a, b) => a - b);
          const index = Math.ceil(0.95 * sorted.length) - 1;
          calculatedValue = sorted[Math.max(0, index)];
          break;
        }
        case 'conversion_rate':
          calculatedValue = values.length >= 2 ? (values[1] / (values[0] || 1)) * 100 : 0;
          break;
        default:
          calculatedValue = values.reduce((a, b) => a + b, 0);
      }
      return { metric: metric_type, result: parseFloat(calculatedValue.toFixed(4)), sampleSize: values.length, unit };
    }
  },
  {
    id: 'generate_summary_report',
    name: 'Generate Summary Report',
    description: 'Compile operational or system analytics into a formatted structured summary.',
    sensitivity: 'safe',
    connectorId: 'system',
    schema: GenerateSummaryReportSchema,
    openRouterSchema: {
      type: 'function',
      function: {
        name: 'generate_summary_report',
        description: 'Compile operational or system analytics into a formatted structured summary.',
        parameters: {
          type: 'object',
          properties: {
            report_type: {
              type: 'string',
              enum: ['incident_postmortem', 'performance_digest', 'audit_summary', 'daily_standup'],
              description: 'Standard report template'
            },
            title: { type: 'string', description: 'Headline title for the report' },
            key_metrics: { type: 'object', description: 'Key-value mapping of high level metrics' }
          },
          required: ['report_type', 'title']
        }
      }
    },
    execute: async (args: { report_type: string; title: string; key_metrics?: Record<string, unknown> }) => {
      return {
        reportId: `rep_${Date.now()}`,
        title: args.title,
        type: args.report_type,
        generatedAt: new Date().toISOString(),
        metrics: args.key_metrics || {},
        status: 'published'
      };
    }
  },
  {
    id: 'send_notification',
    name: 'Send Notification',
    description: 'Dispatch an external notification or broadcast to team communication channels (REQUIRES CONFIRMATION).',
    sensitivity: 'sensitive',
    connectorId: 'system',
    schema: SendNotificationSchema,
    openRouterSchema: {
      type: 'function',
      function: {
        name: 'send_notification',
        description: 'Dispatch an external notification to team channels (REQUIRES USER CONFIRMATION).',
        parameters: {
          type: 'object',
          properties: {
            channel: {
              type: 'string',
              enum: ['slack_alerts', 'pagerduty', 'security_team', 'ops_discord', 'executive_digest'],
              description: 'Target communication channel'
            },
            priority: { type: 'string', enum: ['low', 'medium', 'high', 'critical'] },
            message: { type: 'string', description: 'Message content' }
          },
          required: ['channel', 'priority', 'message']
        }
      }
    },
    execute: async (args: { channel: string; priority: string; message: string }) => {
      return {
        notificationId: `notif_${Date.now()}`,
        channel: args.channel,
        priority: args.priority,
        delivered: true,
        sentAt: new Date().toISOString()
      };
    }
  },
  {
    id: 'delete_data',
    name: 'Purge Staging Artifacts',
    description: 'Purge temporary cache, logs, or test artifacts (REQUIRES CONFIRMATION).',
    sensitivity: 'sensitive',
    connectorId: 'system',
    schema: DeleteDataSchema,
    openRouterSchema: {
      type: 'function',
      function: {
        name: 'delete_data',
        description: 'Purge temporary cache or test logs (REQUIRES USER CONFIRMATION).',
        parameters: {
          type: 'object',
          properties: {
            target: {
              type: 'string',
              enum: ['temporary_cache', 'staging_artifacts', 'test_run_logs', 'expired_session_records'],
              description: 'Target data category to purge'
            },
            retention_days: { type: 'number', description: 'Age in days of items to purge' },
            reason: { type: 'string', description: 'Mandatory justification' }
          },
          required: ['target', 'retention_days', 'reason']
        }
      }
    },
    execute: async (args: { target: string; retention_days: number; reason: string }) => {
      return {
        target: args.target,
        purgedCount: 14,
        retentionDays: args.retention_days,
        reason: args.reason,
        completedAt: new Date().toISOString()
      };
    }
  }
];

// Unified Tool Directory
export const UNIFIED_TOOL_REGISTRY: Record<string, PluginToolDefinition> = {};

// Register all tools
[...SYSTEM_TOOLS, ...gmailTools, ...calendarTools, ...driveTools, ...webhookTools].forEach((tool) => {
  UNIFIED_TOOL_REGISTRY[tool.id] = tool;
});

// =============================================================================
// Primary Server-Side Tool Execution Function (Tenant-Isolated)
// =============================================================================
export interface ExecuteToolOptions {
  userId: string;
  toolName: string;
  arguments: unknown;
  confirmed?: boolean;
  idempotencyKey?: string;
  clientIp?: string;
}

export interface ExecuteToolResponse {
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

export async function executeToolSecurely(options: ExecuteToolOptions): Promise<ExecuteToolResponse> {
  const startTime = Date.now();
  const {
    userId,
    toolName,
    arguments: rawArguments,
    confirmed = false,
    idempotencyKey = `idemp_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
    clientIp = '127.0.0.1'
  } = options;

  logger.info('ToolRouter', `Tool execution requested: "${toolName}" for user "${userId}"`, {
    confirmed,
    idempotencyKey
  });

  // 1. Verify User Session is Authenticated
  if (!userId) {
    const errorMsg = 'Unauthorized: Tool execution requires an authenticated user session.';
    return {
      state: 'failed',
      toolName: toolName || 'unknown',
      sensitivity: 'sensitive',
      idempotencyKey,
      error: errorMsg,
      durationMs: Date.now() - startTime
    };
  }

  // 2. Verify Tool Exists in Allowlist
  const tool = UNIFIED_TOOL_REGISTRY[toolName];
  if (!tool) {
    const errorMsg = `Unauthorized action: Tool "${toolName}" is not registered in the allowlisted tool directory. Arbitrary execution is blocked.`;
    dbRecordAudit({
      id: `audit_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      userId,
      timestamp: new Date().toISOString(),
      toolName: toolName || 'unknown',
      sensitivity: 'sensitive',
      idempotencyKey,
      parameters: typeof rawArguments === 'object' && rawArguments !== null ? (rawArguments as Record<string, unknown>) : {},
      status: 'failed',
      durationMs: Date.now() - startTime,
      error: errorMsg,
      clientIp
    });

    return {
      state: 'failed',
      toolName: toolName || 'unknown',
      sensitivity: 'sensitive',
      idempotencyKey,
      error: errorMsg,
      durationMs: Date.now() - startTime
    };
  }

  // 3. Persistent Rate Limiting Check (Per User and Per IP)
  const userRate = dbCheckRateLimit(`user:${userId}`, 30, 60000);
  const ipRate = dbCheckRateLimit(`ip:${clientIp}`, 45, 60000);
  if (!userRate.allowed || !ipRate.allowed) {
    const rateLimitError = 'Rate limit exceeded: Too many automated tool executions. Please wait 60 seconds.';
    dbRecordAudit({
      id: `audit_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      userId,
      timestamp: new Date().toISOString(),
      toolName,
      sensitivity: tool.sensitivity,
      idempotencyKey,
      parameters: {},
      status: 'failed',
      durationMs: Date.now() - startTime,
      error: rateLimitError,
      clientIp
    });

    return {
      state: 'failed',
      toolName,
      sensitivity: tool.sensitivity,
      idempotencyKey,
      error: rateLimitError,
      durationMs: Date.now() - startTime
    };
  }

  // 4. Per-User AI Usage & Quota Check
  const aiUsage = dbCheckUserAiUsage(userId);
  if (!aiUsage.allowed) {
    const quotaError = `Daily AI usage limit reached (${aiUsage.requestsToday} requests). Limit resets tomorrow.`;
    return {
      state: 'failed',
      toolName,
      sensitivity: tool.sensitivity,
      idempotencyKey,
      error: quotaError,
      durationMs: Date.now() - startTime
    };
  }

  // 5. Tenant-Isolated Connector Authorization Check
  const connectorId = tool.connectorId;
  if (connectorId && connectorId !== 'system' && connectorId !== 'webhook') {
    if (!isUserConnectorConnected(userId, connectorId)) {
      const connectorName = CONNECTORS[connectorId]?.name || connectorId;
      const errorMsg = `Integration Not Connected: ${connectorName} is not connected for your account. Please connect ${connectorName} in Settings → Integrations before using this tool.`;

      dbRecordAudit({
        id: `audit_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
        userId,
        timestamp: new Date().toISOString(),
        toolName,
        sensitivity: tool.sensitivity,
        idempotencyKey,
        parameters: {},
        status: 'failed',
        durationMs: Date.now() - startTime,
        error: errorMsg,
        clientIp
      });

      return {
        state: 'failed',
        toolName,
        sensitivity: tool.sensitivity,
        idempotencyKey,
        error: errorMsg,
        durationMs: Date.now() - startTime
      };
    }
  }

  // 6. Schema Validation with Zod
  let parsedArguments: unknown;
  try {
    let argsToValidate = rawArguments;
    if (typeof rawArguments === 'string') {
      try {
        argsToValidate = JSON.parse(rawArguments);
      } catch {
        throw new Error('Arguments must be valid JSON.');
      }
    }
    parsedArguments = tool.schema.parse(argsToValidate || {});
  } catch (err: unknown) {
    let validationErrorMsg = 'Schema validation failed.';
    if (err instanceof z.ZodError) {
      validationErrorMsg = err.issues.map((e: any) => `${e.path.join('.') || 'param'}: ${e.message}`).join('; ');
    } else if (err instanceof Error) {
      validationErrorMsg = err.message;
    }

    dbRecordAudit({
      id: `audit_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      userId,
      timestamp: new Date().toISOString(),
      toolName,
      sensitivity: tool.sensitivity,
      idempotencyKey,
      parameters: {},
      status: 'failed',
      durationMs: Date.now() - startTime,
      error: `Validation rejected: ${validationErrorMsg}`,
      clientIp
    });

    return {
      state: 'failed',
      toolName,
      sensitivity: tool.sensitivity,
      idempotencyKey,
      error: `Validation error: ${validationErrorMsg}`,
      durationMs: Date.now() - startTime
    };
  }

  const sanitizedParams =
    typeof parsedArguments === 'object' && parsedArguments !== null
      ? { ...(parsedArguments as Record<string, unknown>) }
      : {};

  // Redact potential secrets from parameters before audit logging
  for (const key of Object.keys(sanitizedParams)) {
    if (/password|secret|key|token|auth|credential/i.test(key)) {
      sanitizedParams[key] = '***REDACTED***';
    }
  }

  // 7. Sensitive Operations User Confirmation Check
  if (tool.sensitivity === 'sensitive' && !confirmed) {
    dbRecordAudit({
      id: `audit_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      userId,
      timestamp: new Date().toISOString(),
      toolName,
      sensitivity: tool.sensitivity,
      idempotencyKey,
      parameters: sanitizedParams,
      status: 'awaiting_confirmation',
      durationMs: Date.now() - startTime,
      clientIp
    });

    return {
      state: 'awaiting_confirmation',
      toolName,
      sensitivity: tool.sensitivity,
      idempotencyKey,
      requiresConfirmation: true,
      result: {
        message: 'This is a sensitive operational action. Please review parameters and confirm execution.',
        parameters: sanitizedParams
      },
      durationMs: Date.now() - startTime
    };
  }

  // 8. Idempotency Check (Tenant-Isolated)
  const cachedExecution = dbGetIdempotency(idempotencyKey, userId);
  if (cachedExecution) {
    return {
      state: cachedExecution.status,
      toolName,
      sensitivity: tool.sensitivity,
      idempotencyKey,
      result: cachedExecution.result,
      error: cachedExecution.error,
      cached: true,
      durationMs: Date.now() - startTime
    };
  }

  // 9. Execute with strict 15000ms Timeout
  const EXECUTION_TIMEOUT_MS = 15000;
  const context: ToolExecutionContext = { userId, clientIp, idempotencyKey };

  try {
    const timeoutPromise = new Promise((_, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`Execution timeout: Tool "${toolName}" exceeded ${EXECUTION_TIMEOUT_MS}ms limit.`));
      }, EXECUTION_TIMEOUT_MS);
      if (typeof timer.unref === 'function') timer.unref();
    });

    const executionPromise = tool.execute(parsedArguments, context);
    const result = await Promise.race([executionPromise, timeoutPromise]);
    const durationMs = Date.now() - startTime;

    // Persist idempotency record
    dbSetIdempotency({
      idempotencyKey,
      userId,
      toolName,
      result,
      status: 'completed'
    });

    // Record persistent audit log
    dbRecordAudit({
      id: `audit_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      userId,
      timestamp: new Date().toISOString(),
      toolName,
      sensitivity: tool.sensitivity,
      idempotencyKey,
      parameters: sanitizedParams,
      status: 'completed',
      durationMs,
      result,
      clientIp
    });

    // Track user tool call in usage metrics
    dbIncrementUserAiUsage(userId, 0, true);

    return {
      state: 'completed',
      toolName,
      sensitivity: tool.sensitivity,
      idempotencyKey,
      result,
      durationMs
    };
  } catch (err: unknown) {
    const durationMs = Date.now() - startTime;
    const executionError = err instanceof Error ? err.message : 'Unknown execution failure';

    dbSetIdempotency({
      idempotencyKey,
      userId,
      toolName,
      result: null,
      status: 'failed',
      error: executionError
    });

    dbRecordAudit({
      id: `audit_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      userId,
      timestamp: new Date().toISOString(),
      toolName,
      sensitivity: tool.sensitivity,
      idempotencyKey,
      parameters: sanitizedParams,
      status: 'failed',
      durationMs,
      error: executionError,
      clientIp
    });

    return {
      state: 'failed',
      toolName,
      sensitivity: tool.sensitivity,
      idempotencyKey,
      error: executionError,
      durationMs
    };
  }
}

// Retrieve audit logs for a specific user
export function getAuditLogs(userId: string, limit = 50): DbAuditLog[] {
  return dbGetAuditLogs(userId, limit);
}

// Get the OpenRouter tools schema for allowlisted tools
export function getAllowlistedOpenRouterTools() {
  return Object.values(UNIFIED_TOOL_REGISTRY).map((tool) => tool.openRouterSchema);
}
