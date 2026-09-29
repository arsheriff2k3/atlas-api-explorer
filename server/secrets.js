import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

// User API keys are encrypted here, on the Next.js server, before they reach Convex.
// ATLAS_ENCRYPTION_KEY never leaves the server; rotating it invalidates saved keys.
const secret = () => {
  const value = process.env.ATLAS_ENCRYPTION_KEY;
  return value && value.length >= 32 ? createHash('sha256').update(value).digest() : null;
};
export const encryptionReady = () => !!secret();

// `owner` (the Clerk user ID) is authenticated data: a ciphertext only decrypts for its owner.
export function encrypt(plaintext, owner) {
  const key = secret(); if (!key) throw new Error('Saved API keys are disabled: set ATLAS_ENCRYPTION_KEY on the server.');
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(Buffer.from(String(owner)));
  const data = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return ['v1', iv, cipher.getAuthTag(), data].map((part, index) => index ? part.toString('base64') : part).join(':');
}

export function decrypt(payload, owner) {
  const key = secret(); if (!key) return null;
  const [version, iv, tag, data] = String(payload).split(':');
  if (version !== 'v1' || !iv || !tag || !data) return null;
  try {
    const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64'));
    decipher.setAAD(Buffer.from(String(owner)));
    decipher.setAuthTag(Buffer.from(tag, 'base64'));
    return Buffer.concat([decipher.update(Buffer.from(data, 'base64')), decipher.final()]).toString('utf8');
  } catch { return null; }
}
