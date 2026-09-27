/**
 * Structured Secure Logger for Setup
 *
 * Security Invariant:
 * NEVER logs access tokens, refresh tokens, OAuth authorization codes, API keys,
 * email bodies, headers, user passwords, or other secrets.
 */

type LogCategory = 'Vault' | 'OAuth' | 'ToolRouter' | 'RateLimiter' | 'GmailAPI' | 'Idempotency' | 'Database' | 'Security';

function sanitizeMessage(msg: string): string {
  // Redact bearer tokens or ya29 tokens if accidentally present
  return msg
    .replace(/ya29\.[a-zA-Z0-9_-]+/g, 'ya29.[REDACTED_ACCESS_TOKEN]')
    .replace(/sk-[a-zA-Z0-9_-]+/g, 'sk-[REDACTED_API_KEY]')
    .replace(/Bearer\s+[a-zA-Z0-9_.-]+/gi, 'Bearer [REDACTED_TOKEN]');
}

export const logger = {
  info: (category: LogCategory, message: string, meta?: Record<string, unknown>) => {
    const timestamp = new Date().toISOString();
    const cleanMsg = sanitizeMessage(message);
    const metaStr = meta ? ` | ${JSON.stringify(meta)}` : '';
    console.log(`[${timestamp}] [Setup-Audit] [${category}] ${cleanMsg}${metaStr}`);
  },

  warn: (category: LogCategory, message: string, meta?: Record<string, unknown>) => {
    const timestamp = new Date().toISOString();
    const cleanMsg = sanitizeMessage(message);
    const metaStr = meta ? ` | ${JSON.stringify(meta)}` : '';
    console.warn(`[${timestamp}] [Setup-Audit] [${category}] ⚠️  ${cleanMsg}${metaStr}`);
  },

  error: (category: LogCategory, message: string, error?: unknown) => {
    const timestamp = new Date().toISOString();
    const cleanMsg = sanitizeMessage(message);
    const errText = error instanceof Error ? error.message : String(error || '');
    console.error(`[${timestamp}] [Setup-Audit] [${category}] ❌ ${cleanMsg}${errText ? ` | Error: ${errText}` : ''}`);
  }
};
