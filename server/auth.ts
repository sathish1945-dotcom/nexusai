import crypto from 'crypto';
import { Request, Response, NextFunction } from 'express';
import dotenv from 'dotenv';
import { dbGetUserById, dbCreateUser } from './db';
import { logger } from './logger';

dotenv.config();

export interface SessionPayload {
  userId: string;
  email?: string;
  isAnonymous?: boolean;
  exp: number;
}

export interface AuthenticatedUser {
  id: string;
  email?: string;
  displayName?: string;
  isAnonymous: boolean;
}

declare global {
  namespace Express {
    interface Request {
      userId?: string;
      user?: AuthenticatedUser;
    }
  }
}

function getAuthSecret(): string {
  const secret = process.env.AUTH_SECRET || process.env.ENCRYPTION_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error('FATAL CONFIGURATION ERROR: AUTH_SECRET or ENCRYPTION_SECRET must be at least 32 characters long.');
  }
  return secret;
}

/**
 * Creates a cryptographically signed HMAC-SHA256 session token.
 */
export function signSessionToken(payload: Omit<SessionPayload, 'exp'>, expiresInDays = 7): string {
  const exp = Date.now() + expiresInDays * 24 * 60 * 60 * 1000;
  const data: SessionPayload = { ...payload, exp };
  const jsonStr = JSON.stringify(data);
  const base64Data = Buffer.from(jsonStr, 'utf8').toString('base64url');

  const signature = crypto
    .createHmac('sha256', getAuthSecret())
    .update(base64Data)
    .digest('base64url');

  return `${base64Data}.${signature}`;
}

/**
 * Verifies the HMAC-SHA256 session token signature and expiration.
 */
export function verifySessionToken(token: string): SessionPayload | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 2) return null;

    const [base64Data, expectedSignature] = parts;
    const actualSignature = crypto
      .createHmac('sha256', getAuthSecret())
      .update(base64Data)
      .digest('base64url');

    const expectedBuf = Buffer.from(expectedSignature);
    const actualBuf = Buffer.from(actualSignature);

    if (expectedBuf.length !== actualBuf.length || !crypto.timingSafeEqual(expectedBuf, actualBuf)) {
      return null;
    }

    const jsonStr = Buffer.from(base64Data, 'base64url').toString('utf8');
    const payload = JSON.parse(jsonStr) as SessionPayload;

    if (!payload.userId || !payload.exp || Date.now() > payload.exp) {
      return null;
    }

    return payload;
  } catch {
    return null;
  }
}

/**
 * Hash password using crypto scrypt.
 */
export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${derived}`;
}

/**
 * Verify password against stored scrypt hash.
 */
export function verifyPassword(password: string, storedHash: string): boolean {
  try {
    const [salt, key] = storedHash.split(':');
    if (!salt || !key) return false;

    const derived = crypto.scryptSync(password, salt, 64).toString('hex');
    return crypto.timingSafeEqual(Buffer.from(key, 'hex'), Buffer.from(derived, 'hex'));
  } catch {
    return false;
  }
}

/**
 * Express middleware that extracts authenticated session from Authorization header or cookie.
 * Supports both permanent users and automatic guest sessions for frictionless instant use.
 */
export async function sessionMiddleware(req: Request, _res: Response, next: NextFunction): Promise<void> {
  const authHeader = req.headers.authorization;
  let token: string | null = null;

  if (authHeader && authHeader.startsWith('Bearer ')) {
    token = authHeader.slice(7).trim();
  } else if (req.headers.cookie) {
    const match = req.headers.cookie.match(/nexus_session=([^;]+)/);
    if (match) token = match[1];
  }

  if (token) {
    const payload = verifySessionToken(token);
    if (payload) {
      const user = (await dbGetUserById(payload.userId));
      if (user) {
        req.userId = user.id;
        req.user = {
          id: user.id,
          email: user.email,
          displayName: user.displayName,
          isAnonymous: user.isAnonymous
        };
        return next();
      }
    }
  }

  // Not authenticated
  req.userId = undefined;
  req.user = undefined;
  next();
}

/**
 * Middleware that strictly enforces authenticated session.
 */
export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  if (!req.userId || !req.user) {
    res.status(401).json({
      error: 'Authentication Required: You must be logged in to perform this action.',
      code: 'UNAUTHENTICATED'
    });
    return;
  }
  next();
}
