import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

/** Sellers' payment API keys are stored encrypted with AES-256-GCM under APP_SECRET. */
const keyFrom = (secret: string) => createHash('sha256').update(secret, 'utf8').digest();

export function encryptSecret(plain: string, appSecret: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', keyFrom(appSecret), iv);
  const body = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
  return ['v1', iv.toString('base64url'), c.getAuthTag().toString('base64url'), body.toString('base64url')].join('.');
}

export function decryptSecret(enc: string, appSecret: string): string {
  const [v, iv, tag, body] = enc.split('.');
  if (v !== 'v1') throw new Error('Unknown secret format.');
  const d = createDecipheriv('aes-256-gcm', keyFrom(appSecret), Buffer.from(iv, 'base64url'));
  d.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([d.update(Buffer.from(body, 'base64url')), d.final()]).toString('utf8');
}
