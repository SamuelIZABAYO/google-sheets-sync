import crypto from 'node:crypto';
import { env } from '../config/env.js';

const ALGORITHM = 'aes-256-gcm';

function resolveEncryptionKey(raw: string): Buffer {
  const trimmed = raw.trim();

  if (/^[0-9a-fA-F]{64}$/.test(trimmed)) {
    return Buffer.from(trimmed, 'hex');
  }

  try {
    const b64 = Buffer.from(trimmed, 'base64');
    if (b64.length === 32) {
      return b64;
    }
  } catch {
    // noop
  }

  const utf8 = Buffer.from(trimmed, 'utf8');
  if (utf8.length === 32) {
    return utf8;
  }

  throw new Error('TOKEN_ENCRYPTION_KEY must be 32-byte utf8, 64-char hex, or base64 for 32 bytes');
}

const ENCRYPTION_KEY = resolveEncryptionKey(env.TOKEN_ENCRYPTION_KEY);

export type EncryptedTokenPayload = {
  iv: string;
  authTag: string;
  ciphertext: string;
};

export function encryptToken(plainText: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGORITHM, ENCRYPTION_KEY, iv);

  const encrypted = Buffer.concat([cipher.update(plainText, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();

  const payload: EncryptedTokenPayload = {
    iv: iv.toString('base64'),
    authTag: authTag.toString('base64'),
    ciphertext: encrypted.toString('base64')
  };

  return Buffer.from(JSON.stringify(payload)).toString('base64');
}

export function decryptToken(encryptedPayload: string): string {
  const payloadRaw = Buffer.from(encryptedPayload, 'base64').toString('utf8');
  const payload = JSON.parse(payloadRaw) as EncryptedTokenPayload;

  if (!payload.iv || !payload.authTag || !payload.ciphertext) {
    throw new Error('Invalid encrypted payload format');
  }

  const decipher = crypto.createDecipheriv(
    ALGORITHM,
    ENCRYPTION_KEY,
    Buffer.from(payload.iv, 'base64')
  );
  decipher.setAuthTag(Buffer.from(payload.authTag, 'base64'));

  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(payload.ciphertext, 'base64')),
    decipher.final()
  ]);

  return decrypted.toString('utf8');
}
