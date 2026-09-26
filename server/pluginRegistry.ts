import { z } from 'zod';
import { getUserConnectorAccessToken } from './integrationStore';
import { dbGetUserWebhookById, dbGetUserWebhooks } from './db';
import { logger } from './logger';

// =============================================================================
// Plugin & Tool Interfaces
// =============================================================================
export type ToolSensitivity = 'safe' | 'sensitive';

export interface ToolExecutionContext {
  userId: string;
  clientIp: string;
  idempotencyKey: string;
}

export interface PluginToolDefinition {
  id: string;
  name: string;
  description: string;
  sensitivity: ToolSensitivity;
  connectorId: string;
  schema: z.ZodObject<any>;
  openRouterSchema: {
    type: 'function';
    function: {
      name: string;
      description: string;
      parameters: Record<string, unknown>;
    };
  };
  execute: (args: any, context: ToolExecutionContext) => Promise<unknown>;
}

export interface ConnectorDefinition {
  id: string;
  name: string;
  description: string;
  authType: 'oauth2' | 'api_key' | 'webhook' | 'none';
  requiredScopes: string[];
  tools: PluginToolDefinition[];
  category?: 'productivity' | 'developer' | 'communication' | 'automation';
}

// =============================================================================
// Helper: Require Tenant-Isolated Auth Token
// =============================================================================
async function requireUserAuthToken(userId: string, connectorId: string): Promise<string> {
  const token = await getUserConnectorAccessToken(userId, connectorId);
  if (!token) {
    const name =
      connectorId === 'gmail'
        ? 'Gmail'
        : connectorId === 'google_calendar'
        ? 'Google Calendar'
        : connectorId === 'google_drive'
        ? 'Google Drive'
        : connectorId;
    logger.warn('ToolRouter', `Action rejected: ${name} is not connected for user "${userId}".`);
    throw new Error(
      `Integration Not Connected: ${name} is not connected for your account. Please connect your ${name} account in Settings → Integrations before using this tool.`
    );
  }
  return token;
}

// Helper to extract email header value
function getHeader(headers: Array<{ name: string; value: string }> | undefined, name: string): string {
  if (!headers) return '';
  const found = headers.find((h) => h.name.toLowerCase() === name.toLowerCase());
  return found ? found.value : '';
}

// SSRF Protection Validator for Webhooks
export function validateSafeWebhookUrl(urlStr: string): void {
  let parsed: URL;
  try {
    parsed = new URL(urlStr);
  } catch {
    throw new Error('Invalid Webhook URL format.');
  }

  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw new Error('SSRF Block: Only https:// or http:// protocols are allowed for webhooks.');
  }

  const host = parsed.hostname.toLowerCase();
  if (
    host === 'localhost' ||
    host === '127.0.0.1' ||
    host === '0.0.0.0' ||
    host === '::1' ||
    host === '169.254.169.254' || // AWS/GCP instance metadata endpoint
    host.startsWith('10.') ||
    host.startsWith('192.168.') ||
    host.endsWith('.internal') ||
    host.endsWith('.local') ||
    host.endsWith('.lan')
  ) {
    throw new Error(`SSRF Block: Webhook destination to private or metadata endpoint "${host}" is strictly forbidden.`);
  }
}

// =============================================================================
// 1. Gmail Connector Schemas & Implementation (Read-Only Minimum Privilege)
// =============================================================================

const GmailGetUnreadCountSchema = z.object({
  include_previews: z.boolean().optional().default(false),
  max_previews: z.number().int().min(1).max(10).optional().default(5)
}).strict();

const GmailSearchMessagesSchema = z.object({
  query: z.string().min(1, 'Search query cannot be empty').max(200),
  max_results: z.number().int().min(1).max(20).optional().default(5)
}).strict();

const GmailReadMessageSchema = z.object({
  message_id: z.string().min(1, 'Message ID is required').max(100)
}).strict();

export const gmailTools: PluginToolDefinition[] = [
  {
    id: 'gmail_get_unread_count',
    name: 'Get Unread Emails Count',
    description: 'Check how many unread emails are currently in your Gmail inbox using instant Gmail label telemetry (fast, zero-message download).',
    sensitivity: 'safe',
    connectorId: 'gmail',
    schema: GmailGetUnreadCountSchema,
    openRouterSchema: {
      type: 'function',
      function: {
        name: 'gmail_get_unread_count',
        description: 'Get the user current unread emails count in Gmail directly from inbox telemetry. Only returns count by default.',
        parameters: {
          type: 'object',
          properties: {
            include_previews: {
              type: 'boolean',
              description: 'Whether to fetch recent message subject previews (default false for maximum speed)'
            },
            max_previews: {
              type: 'number',
              description: 'Maximum previews to fetch if include_previews is true (default 5)'
            }
          }
        }
      }
    },
    execute: async (args: { include_previews?: boolean; max_previews?: number }, context: ToolExecutionContext) => {
      const token = await requireUserAuthToken(context.userId, 'gmail');
      logger.info('GmailAPI', `Executing gmail_get_unread_count for user "${context.userId}" via direct Label Telemetry API`);

      let unreadCount = 0;
      let totalMessages = 0;
      let folderName = 'INBOX';

      // Primary: Query INBOX label telemetry directly
      const inboxRes = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/labels/INBOX', {
        headers: { Authorization: `Bearer ${token}` }
      });

      if (inboxRes.ok) {
        const inboxData = (await inboxRes.json()) as { messagesUnread?: number; messagesTotal?: number };
        unreadCount = typeof inboxData.messagesUnread === 'number' ? inboxData.messagesUnread : 0;
        totalMessages = typeof inboxData.messagesTotal === 'number' ? inboxData.messagesTotal : 0;
        logger.info('GmailAPI', `Queried user "${context.userId}" INBOX label: ${unreadCount} unread / ${totalMessages} total`);
      } else if (inboxRes.status === 401) {
        logger.warn('GmailAPI', `Gmail API 401 Unauthorized for user "${context.userId}"`);
        throw new Error('Gmail session expired. Please reconnect Gmail in Settings → Integrations.');
      } else {
        // Fallback: Query UNREAD label
        const unreadRes = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/labels/UNREAD', {
          headers: { Authorization: `Bearer ${token}` }
        });
        if (unreadRes.ok) {
          const unreadData = (await unreadRes.json()) as { messagesUnread?: number; messagesTotal?: number };
          unreadCount = typeof unreadData.messagesUnread === 'number' ? unreadData.messagesUnread : 0;
          totalMessages = typeof unreadData.messagesTotal === 'number' ? unreadData.messagesTotal : 0;
          folderName = 'UNREAD';
        } else if (unreadRes.status === 401) {
          throw new Error('Gmail session expired. Please reconnect Gmail in Settings → Integrations.');
        } else {
          const errText = await unreadRes.text();
          throw new Error(`Gmail API error (${unreadRes.status}): ${errText}`);
        }
      }

      // Fetch message previews ONLY when specifically requested
      let previews: Array<{ id: string; from: string; subject: string; date: string; snippet: string }> | undefined = undefined;

      if (args.include_previews && unreadCount > 0) {
        const maxPreviews = Math.min(10, Math.max(1, args.max_previews || 5));
        const listUrl = `https://gmail.googleapis.com/gmail/v1/users/me/messages?q=is:unread&maxResults=${maxPreviews}`;
        const listRes = await fetch(listUrl, { headers: { Authorization: `Bearer ${token}` } });
        if (listRes.ok) {
          const listData = (await listRes.json()) as { messages?: Array<{ id: string }> };
          const msgIds = listData.messages || [];
          const fetched = await Promise.all(
            msgIds.map(async (m) => {
              try {
                const msgRes = await fetch(
                  `https://gmail.googleapis.com/gmail/v1/users/me/messages/${m.id}?format=metadata&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Date`,
                  { headers: { Authorization: `Bearer ${token}` } }
                );
                if (msgRes.ok) {
                  const msgData = (await msgRes.json()) as any;
                  return {
                    id: msgData.id,
                    from: getHeader(msgData.payload?.headers, 'From'),
                    subject: getHeader(msgData.payload?.headers, 'Subject') || '(No Subject)',
                    date: getHeader(msgData.payload?.headers, 'Date'),
                    snippet: msgData.snippet || ''
                  };
                }
              } catch {}
              return null;
            })
          );
          previews = fetched.filter((p): p is NonNullable<typeof p> => p !== null);
        }
      }

      return {
        unreadCount,
        totalMessagesInInbox: totalMessages,
        folder: folderName,
        mechanism: 'Direct Gmail Label Telemetry API (instant zero-message download query)',
        previewsIncluded: Boolean(previews && previews.length > 0),
        previews,
        inspectedAt: new Date().toISOString()
      };
    }
  },

  {
    id: 'gmail_search_messages',
    name: 'Search Gmail Messages',
    description: 'Search user emails matching queries like from:person@company.com or subject:report.',
    sensitivity: 'safe',
    connectorId: 'gmail',
    schema: GmailSearchMessagesSchema,
    openRouterSchema: {
      type: 'function',
      function: {
        name: 'gmail_search_messages',
        description: 'Search user emails in Gmail matching a search query (supports operators like from:, subject:, has:attachment).',
        parameters: {
          type: 'object',
          properties: {
            query: {
              type: 'string',
              description: 'Search query string (e.g. "invoice", "from:colleague@company.com", "subject:meeting")'
            },
            max_results: {
              type: 'number',
              description: 'Maximum results to return (default 5, max 20)'
            }
          },
          required: ['query']
        }
      }
    },
    execute: async (args: { query: string; max_results?: number }, context: ToolExecutionContext) => {
      const token = await requireUserAuthToken(context.userId, 'gmail');
      const maxResults = Math.min(20, Math.max(1, args.max_results || 5));
      const url = `https://gmail.googleapis.com/gmail/v1/users/me/messages?q=${encodeURIComponent(args.query)}&maxResults=${maxResults}`;

      const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) {
        if (res.status === 401) {
          throw new Error('Gmail session expired. Please reconnect Gmail in Settings → Integrations.');
        }
        const errText = await res.text();
        throw new Error(`Gmail search error (${res.status}): ${errText}`);
      }

      const data = (await res.json()) as { messages?: Array<{ id: string }> };
      const messages = data.messages || [];

      const details = await Promise.all(
        messages.slice(0, maxResults).map(async (m) => {
          try {
            const msgRes = await fetch(
              `https://gmail.googleapis.com/gmail/v1/users/me/messages/${m.id}?format=metadata&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Date`,
              { headers: { Authorization: `Bearer ${token}` } }
            );
            if (msgRes.ok) {
              const msgData = (await msgRes.json()) as any;
              return {
                id: msgData.id,
                from: getHeader(msgData.payload?.headers, 'From'),
                subject: getHeader(msgData.payload?.headers, 'Subject') || '(No Subject)',
                date: getHeader(msgData.payload?.headers, 'Date'),
                snippet: msgData.snippet || ''
              };
            }
          } catch {}
          return null;
        })
      );

      return {
        query: args.query,
        count: messages.length,
        messages: details.filter((m): m is NonNullable<typeof m> => m !== null)
      };
    }
  },

  {
    id: 'gmail_read_message',
    name: 'Read Email Message Body',
    description: 'Read the full contents, headers, subject, and text body of a specific email by ID.',
    sensitivity: 'safe',
    connectorId: 'gmail',
    schema: GmailReadMessageSchema,
    openRouterSchema: {
      type: 'function',
      function: {
        name: 'gmail_read_message',
        description: 'Read the full details, headers, subject, and content body of a specific Gmail email by ID.',
        parameters: {
          type: 'object',
          properties: {
            message_id: {
              type: 'string',
              description: 'The unique Gmail message ID'
            }
          },
          required: ['message_id']
        }
      }
    },
    execute: async (args: { message_id: string }, context: ToolExecutionContext) => {
      const token = await requireUserAuthToken(context.userId, 'gmail');
      const url = `https://gmail.googleapis.com/gmail/v1/users/me/messages/${args.message_id}?format=full`;

      const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) {
        if (res.status === 401) {
          throw new Error('Gmail session expired. Please reconnect Gmail in Settings → Integrations.');
        }
        const errText = await res.text();
        throw new Error(`Failed to read email (${res.status}): ${errText}`);
      }

      const msg = (await res.json()) as any;
      const headers = msg.payload?.headers;

      // Extract body text
      let bodyText = '';
      if (msg.payload?.body?.data) {
        bodyText = Buffer.from(msg.payload.body.data, 'base64url').toString('utf8');
      } else if (Array.isArray(msg.payload?.parts)) {
        for (const part of msg.payload.parts) {
          if (part.mimeType === 'text/plain' && part.body?.data) {
            bodyText = Buffer.from(part.body.data, 'base64url').toString('utf8');
            break;
          }
        }
      }

      return {
        id: msg.id,
        threadId: msg.threadId,
        from: getHeader(headers, 'From'),
        to: getHeader(headers, 'To'),
        subject: getHeader(headers, 'Subject'),
        date: getHeader(headers, 'Date'),
        snippet: msg.snippet,
        bodyPreview: bodyText.slice(0, 3000)
      };
    }
  }
];

// =============================================================================
// 2. Google Calendar Connector Schemas & Implementation (Read-Only Minimum)
// =============================================================================

const CalendarListEventsSchema = z.object({
  time_min: z.string().optional(),
  time_max: z.string().optional(),
  max_results: z.number().int().min(1).max(25).optional().default(10)
}).strict();

const CalendarGetEventSchema = z.object({
  event_id: z.string().min(1, 'Event ID is required').max(100)
}).strict();

const CalendarCreateEventSchema = z.object({
  summary: z.string().min(1, 'Event title is required').max(100),
  start_time: z.string().min(10, 'Valid ISO 8601 start date-time required (e.g. 2026-09-25T10:00:00Z)'),
  end_time: z.string().min(10, 'Valid ISO 8601 end date-time required (e.g. 2026-09-25T11:00:00Z)'),
  description: z.string().max(500).optional(),
  location: z.string().max(200).optional()
}).strict();

export const calendarTools: PluginToolDefinition[] = [
  {
    id: 'calendar_list_events',
    name: 'List Calendar Events',
    description: 'Query upcoming calendar events and meetings from your primary Google Calendar.',
    sensitivity: 'safe',
    connectorId: 'google_calendar',
    schema: CalendarListEventsSchema,
    openRouterSchema: {
      type: 'function',
      function: {
        name: 'calendar_list_events',
        description: 'List upcoming events and meetings from the user Google Calendar.',
        parameters: {
          type: 'object',
          properties: {
            time_min: {
              type: 'string',
              description: 'ISO datetime string for start window (defaults to now)'
            },
            time_max: {
              type: 'string',
              description: 'ISO datetime string for end window'
            },
            max_results: {
              type: 'number',
              description: 'Max events to return (default 10)'
            }
          }
        }
      }
    },
    execute: async (args: { time_min?: string; time_max?: string; max_results?: number }, context: ToolExecutionContext) => {
      const token = await requireUserAuthToken(context.userId, 'google_calendar');
      const timeMin = args.time_min || new Date().toISOString();
      const maxResults = args.max_results || 10;
      let url = `https://www.googleapis.com/calendar/v3/calendars/primary/events?singleEvents=true&orderBy=startTime&timeMin=${encodeURIComponent(timeMin)}&maxResults=${maxResults}`;
      if (args.time_max) {
        url += `&timeMax=${encodeURIComponent(args.time_max)}`;
      }

      const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) {
        if (res.status === 401) {
          throw new Error('Google Calendar session expired. Please reconnect in Settings → Integrations.');
        }
        const errText = await res.text();
        throw new Error(`Google Calendar error (${res.status}): ${errText}`);
      }

      const data = (await res.json()) as any;
      const items = (data.items || []).map((e: any) => ({
        id: e.id,
        summary: e.summary || '(Untitled Event)',
        start: e.start?.dateTime || e.start?.date,
        end: e.end?.dateTime || e.end?.date,
        location: e.location || undefined,
        htmlLink: e.htmlLink
      }));

      return {
        count: items.length,
        events: items
      };
    }
  },

  {
    id: 'calendar_get_event',
    name: 'Get Calendar Event Details',
    description: 'Fetch complete details for a specific Google Calendar event by ID.',
    sensitivity: 'safe',
    connectorId: 'google_calendar',
    schema: CalendarGetEventSchema,
    openRouterSchema: {
      type: 'function',
      function: {
        name: 'calendar_get_event',
        description: 'Get details for a specific Google Calendar event by event ID.',
        parameters: {
          type: 'object',
          properties: {
            event_id: { type: 'string', description: 'Google Calendar event ID' }
          },
          required: ['event_id']
        }
      }
    },
    execute: async (args: { event_id: string }, context: ToolExecutionContext) => {
      const token = await requireUserAuthToken(context.userId, 'google_calendar');
      const url = `https://www.googleapis.com/calendar/v3/calendars/primary/events/${encodeURIComponent(args.event_id)}`;
      const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) {
        throw new Error(`Failed to retrieve calendar event (${res.status})`);
      }
      return await res.json();
    }
  },

  {
    id: 'calendar_create_event',
    name: 'Schedule Calendar Event',
    description: 'Create a new appointment or event on Google Calendar (MUTATING ACTION - REQUIRES USER CONFIRMATION).',
    sensitivity: 'sensitive',
    connectorId: 'google_calendar',
    schema: CalendarCreateEventSchema,
    openRouterSchema: {
      type: 'function',
      function: {
        name: 'calendar_create_event',
        description: 'Schedule an event on the user Google Calendar (MUTATING ACTION - REQUIRES CONFIRMATION).',
        parameters: {
          type: 'object',
          properties: {
            summary: { type: 'string', description: 'Headline title of the event' },
            start_time: { type: 'string', description: 'ISO 8601 start datetime string' },
            end_time: { type: 'string', description: 'ISO 8601 end datetime string' },
            description: { type: 'string', description: 'Event description' },
            location: { type: 'string', description: 'Physical address or virtual link' }
          },
          required: ['summary', 'start_time', 'end_time']
        }
      }
    },
    execute: async (
      args: { summary: string; start_time: string; end_time: string; description?: string; location?: string },
      context: ToolExecutionContext
    ) => {
      const token = await requireUserAuthToken(context.userId, 'google_calendar');
      const url = 'https://www.googleapis.com/calendar/v3/calendars/primary/events';
      const payload = {
        summary: args.summary,
        description: args.description,
        location: args.location,
        start: { dateTime: args.start_time },
        end: { dateTime: args.end_time }
      };

      const res = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload)
      });

      if (!res.ok) {
        const errText = await res.text();
        throw new Error(`Failed to create calendar event (${res.status}): ${errText}`);
      }

      const created = (await res.json()) as any;
      return {
        id: created.id,
        summary: created.summary,
        start: created.start?.dateTime,
        end: created.end?.dateTime,
        htmlLink: created.htmlLink,
        status: 'confirmed',
        createdTime: created.created
      };
    }
  }
];

// =============================================================================
// 3. Google Drive Connector Schemas & Implementation (Read-Only Minimum)
// =============================================================================

const DriveSearchFilesSchema = z.object({
  query: z.string().min(1, 'Search term cannot be empty').max(200),
  page_size: z.number().int().min(1).max(25).optional().default(10)
}).strict();

const DriveReadFileSchema = z.object({
  file_id: z.string().min(1, 'File ID is required').max(100)
}).strict();

export const driveTools: PluginToolDefinition[] = [
  {
    id: 'drive_search_files',
    name: 'Search Drive Files',
    description: 'Search for files, documents, and spreadsheets across your Google Drive.',
    sensitivity: 'safe',
    connectorId: 'google_drive',
    schema: DriveSearchFilesSchema,
    openRouterSchema: {
      type: 'function',
      function: {
        name: 'drive_search_files',
        description: 'Search files and documents stored in user Google Drive.',
        parameters: {
          type: 'object',
          properties: {
            query: { type: 'string', description: 'File name keyword or search phrase' },
            page_size: { type: 'number', description: 'Maximum files to return (default 10)' }
          },
          required: ['query']
        }
      }
    },
    execute: async (args: { query: string; page_size?: number }, context: ToolExecutionContext) => {
      const token = await requireUserAuthToken(context.userId, 'google_drive');
      const pageSize = args.page_size || 10;
      const q = `name contains '${args.query.replace(/'/g, "\\'")}' and trashed = false`;
      const url = `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&pageSize=${pageSize}&fields=files(id,name,mimeType,modifiedTime,size,webViewLink)`;

      const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) {
        if (res.status === 401) {
          throw new Error('Google Drive session expired. Please reconnect in Settings → Integrations.');
        }
        const errText = await res.text();
        throw new Error(`Google Drive search failed (${res.status}): ${errText}`);
      }

      const data = (await res.json()) as any;
      const files = data.files || [];

      return {
        query: args.query,
        count: files.length,
        files
      };
    }
  },

  {
    id: 'drive_read_file',
    name: 'Read Drive File Content',
    description: 'Read the text content or metadata of a file stored in Google Drive.',
    sensitivity: 'safe',
    connectorId: 'google_drive',
    schema: DriveReadFileSchema,
    openRouterSchema: {
      type: 'function',
      function: {
        name: 'drive_read_file',
        description: 'Read the textual content or metadata of a file stored in Google Drive by file ID.',
        parameters: {
          type: 'object',
          properties: {
            file_id: { type: 'string', description: 'Google Drive file ID' }
          },
          required: ['file_id']
        }
      }
    },
    execute: async (args: { file_id: string }, context: ToolExecutionContext) => {
      const token = await requireUserAuthToken(context.userId, 'google_drive');

      // 1. Fetch file metadata
      const metaUrl = `https://www.googleapis.com/drive/v3/files/${args.file_id}?fields=id,name,mimeType,size,webViewLink`;
      const metaRes = await fetch(metaUrl, { headers: { Authorization: `Bearer ${token}` } });
      if (!metaRes.ok) {
        const errText = await metaRes.text();
        throw new Error(`Failed to find Drive file (${metaRes.status}): ${errText}`);
      }

      const meta = (await metaRes.json()) as any;
      let textContent = '';

      // 2. Fetch content based on mimeType
      if (meta.mimeType === 'application/vnd.google-apps.document') {
        const exportUrl = `https://www.googleapis.com/drive/v3/files/${args.file_id}/export?mimeType=text/plain`;
        const exportRes = await fetch(exportUrl, { headers: { Authorization: `Bearer ${token}` } });
        if (exportRes.ok) {
          textContent = await exportRes.text();
        }
      } else if (
        meta.mimeType?.startsWith('text/') ||
        meta.mimeType === 'application/json' ||
        meta.mimeType === 'application/xml' ||
        meta.mimeType === 'text/markdown'
      ) {
        const mediaUrl = `https://www.googleapis.com/drive/v3/files/${args.file_id}?alt=media`;
        const mediaRes = await fetch(mediaUrl, { headers: { Authorization: `Bearer ${token}` } });
        if (mediaRes.ok) {
          textContent = await mediaRes.text();
        }
      } else {
        textContent = `[Binary or non-text file: ${meta.mimeType}. File is viewable at: ${meta.webViewLink}]`;
      }

      return {
        id: meta.id,
        name: meta.name,
        mimeType: meta.mimeType,
        size: meta.size,
        webViewLink: meta.webViewLink,
        content: textContent.slice(0, 4000)
      };
    }
  }
];

// =============================================================================
// 4. User-Specific Webhooks Connector (SSRF Protected)
// =============================================================================

const WebhookTriggerSchema = z.object({
  webhook_id: z.string().min(1, 'Webhook ID is required').max(100),
  payload: z.record(z.string(), z.unknown()).optional(),
  reason: z.string().min(5, 'Execution reason is required for auditing').max(200)
}).strict();

export const webhookTools: PluginToolDefinition[] = [
  {
    id: 'webhook_trigger',
    name: 'Trigger Automation Webhook',
    description: 'Trigger a user registered automation webhook or operational pipeline (REQUIRES USER CONFIRMATION).',
    sensitivity: 'sensitive',
    connectorId: 'webhook',
    schema: WebhookTriggerSchema,
    openRouterSchema: {
      type: 'function',
      function: {
        name: 'webhook_trigger',
        description: 'Trigger an authorized user-registered automation webhook (REQUIRES CONFIRMATION). Arbitrary unregistered URLs are blocked.',
        parameters: {
          type: 'object',
          properties: {
            webhook_id: {
              type: 'string',
              description: 'The registered webhook ID'
            },
            payload: {
              type: 'object',
              description: 'Optional JSON payload to send with the webhook'
            },
            reason: {
              type: 'string',
              description: 'Reason for triggering this webhook'
            }
          },
          required: ['webhook_id', 'reason']
        }
      }
    },
    execute: async (args: { webhook_id: string; payload?: Record<string, unknown>; reason: string }, context: ToolExecutionContext) => {
      // Find registered webhook belonging to this specific user
      const registered = dbGetUserWebhookById(context.userId, args.webhook_id);
      if (!registered) {
        throw new Error(
          `Registered webhook "${args.webhook_id}" not found for your account. Register webhooks in Settings → Integrations.`
        );
      }

      // Enforce strict SSRF protection
      validateSafeWebhookUrl(registered.targetUrl);

      logger.info('ToolRouter', `Dispatching user webhook "${registered.name}" to safe endpoint`, {
        userId: context.userId,
        webhookId: registered.id
      });

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10000);

      try {
        const res = await fetch(registered.targetUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'User-Agent': 'NexusAI-Webhook-Dispatcher/1.0',
            'X-NexusAI-Reason': encodeURIComponent(args.reason),
            'X-NexusAI-Idempotency': context.idempotencyKey
          },
          body: JSON.stringify(args.payload || {}),
          signal: controller.signal
        });

        clearTimeout(timeout);

        return {
          executionId: `exec_wh_${Date.now()}`,
          webhookName: registered.name,
          environment: registered.environment,
          httpStatus: res.status,
          success: res.ok,
          reason: args.reason,
          dispatchedAt: new Date().toISOString()
        };
      } catch (err: unknown) {
        clearTimeout(timeout);
        throw new Error(`Webhook dispatch failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }
];

// =============================================================================
// All Registered Connectors (Extensible Multi-User Architecture)
// =============================================================================

export const CONNECTORS: Record<string, ConnectorDefinition> = {
  gmail: {
    id: 'gmail',
    name: 'Gmail',
    description: 'Read and search your emails, inspect unread counts, and retrieve message details.',
    authType: 'oauth2',
    category: 'productivity',
    requiredScopes: ['https://www.googleapis.com/auth/gmail.readonly'],
    tools: gmailTools
  },
  google_calendar: {
    id: 'google_calendar',
    name: 'Google Calendar',
    description: 'View upcoming events and meetings or schedule appointments on your primary calendar.',
    authType: 'oauth2',
    category: 'productivity',
    requiredScopes: ['https://www.googleapis.com/auth/calendar.events.readonly'],
    tools: calendarTools
  },
  google_drive: {
    id: 'google_drive',
    name: 'Google Drive',
    description: 'Search documents, files, and read content stored in your Google Drive.',
    authType: 'oauth2',
    category: 'productivity',
    requiredScopes: ['https://www.googleapis.com/auth/drive.readonly'],
    tools: driveTools
  },
  webhook: {
    id: 'webhook',
    name: 'Generic Webhooks',
    description: 'Trigger pre-configured automation webhooks and operational workflows safely.',
    authType: 'webhook',
    category: 'automation',
    requiredScopes: [],
    tools: webhookTools
  },
  github: {
    id: 'github',
    name: 'GitHub',
    description: 'Inspect repositories, issues, pull requests, and commit activity.',
    authType: 'api_key',
    category: 'developer',
    requiredScopes: ['repo', 'read:user'],
    tools: []
  },
  slack: {
    id: 'slack',
    name: 'Slack',
    description: 'Read channel conversations and broadcast alerts to workspace channels.',
    authType: 'api_key',
    category: 'communication',
    requiredScopes: ['channels:read', 'chat:write'],
    tools: []
  },
  discord: {
    id: 'discord',
    name: 'Discord',
    description: 'Dispatch notifications and manage automated server channel broadcasts.',
    authType: 'api_key',
    category: 'communication',
    requiredScopes: ['bot', 'messages.read'],
    tools: []
  },
  notion: {
    id: 'notion',
    name: 'Notion',
    description: 'Search workspaces, retrieve page contents, and update team documentation.',
    authType: 'api_key',
    category: 'productivity',
    requiredScopes: ['read_content', 'update_content'],
    tools: []
  }
};
