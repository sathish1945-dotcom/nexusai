import crypto from 'crypto';
import dotenv from 'dotenv';
dotenv.config();

// AES-256-GCM authenticated encryption parameters
const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;

/**
 * Derives the AES-256-GCM master key strictly from server environment variable ENCRYPTION_SECRET.
 * Invariant: Never hardcoded, never generated per restart, never logged, never exposed to frontend.
 */
function getMasterKey(): Buffer {
  const secret = process.env.ENCRYPTION_SECRET?.trim();
  if (!secret || secret.length < 32) {
    throw new Error(
      'FATAL CONFIGURATION ERROR: ENCRYPTION_SECRET must be configured as a valid 32+ character server-side environment variable. AES-256-GCM encryption key cannot be derived.'
    );
  }
  return crypto.createHash('sha256').update(secret).digest();
}

let cachedMasterKey: Buffer | null = null;
function masterKey(): Buffer {
  if (!cachedMasterKey) {
    cachedMasterKey = getMasterKey();
  }
  return cachedMasterKey;
}

export function encryptString(plaintext: string): string {
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, masterKey(), iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();

  // Format: iv:tag:encrypted (base64 encoded)
  return `${iv.toString('base64')}:${tag.toString('base64')}:${encrypted.toString('base64')}`;
}

export function decryptString(ciphertext: string): string {
  const parts = ciphertext.split(':');
  if (parts.length !== 3) {
    throw new Error('Invalid ciphertext format.');
  }

  const iv = Buffer.from(parts[0], 'base64');
  const tag = Buffer.from(parts[1], 'base64');
  const encrypted = Buffer.from(parts[2], 'base64');

  const decipher = crypto.createDecipheriv(ALGORITHM, masterKey(), iv);
  decipher.setAuthTag(tag);

  const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);
  return decrypted.toString('utf8');
}
