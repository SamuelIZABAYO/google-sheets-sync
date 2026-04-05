import { describe, expect, it } from 'vitest';

process.env.JWT_SECRET = process.env.JWT_SECRET ?? 'test-secret-key-with-32-characters!!';
process.env.GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID ?? 'test-google-client-id';
process.env.GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET ?? 'test-google-client-secret';
process.env.TOKEN_ENCRYPTION_KEY = process.env.TOKEN_ENCRYPTION_KEY ?? '0123456789abcdef0123456789abcdef';

const { encryptToken, decryptToken } = await import('../src/services/token-crypto.js');

describe('token crypto', () => {
  it('encrypts and decrypts token values', () => {
    const plain = 'ya29.a0AfH6SMBexample';
    const encrypted = encryptToken(plain);

    expect(encrypted).not.toBe(plain);
    expect(decryptToken(encrypted)).toBe(plain);
  });
});
