import type { Request, Response } from 'express';
import { executeToolSecurely, getAuditLogs } from '../../server/toolExecutor';

export const config = {
  runtime: 'nodejs'
};

export default async function handler(req: Request | any, res: Response | any) {
  const userId = (req.headers['x-user-id'] as string) || 'default_user';

  if (req.method === 'GET') {
    return res.status(200).json({
      status: 'ok',
      logs: getAuditLogs(userId)
    });
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
  const { toolName, arguments: toolArgs, confirmed, idempotencyKey } = body;
  const clientIp = (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() || req.socket?.remoteAddress || '127.0.0.1';

  try {
    const result = await executeToolSecurely({
      userId,
      toolName: String(toolName || ''),
      arguments: toolArgs,
      confirmed: Boolean(confirmed),
      idempotencyKey: idempotencyKey ? String(idempotencyKey) : undefined,
      clientIp
    });

    return res.status(200).json(result);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Tool execution error';
    return res.status(500).json({
      state: 'failed',
      toolName,
      error: message
    });
  }
}
