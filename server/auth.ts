import { createHmac, timingSafeEqual } from 'node:crypto';

export const SESSION_COOKIE = 'hc_session';
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

const sign = (secret: string, payload: string) =>
  createHmac('sha256', secret).update(payload).digest('base64url');

const safeEqual = (a: string, b: string) => {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
};

export function createSessionToken(secret: string, now = Date.now()): string {
  const expires = String(now + SESSION_TTL_MS);
  return `${expires}.${sign(secret, expires)}`;
}

export function verifySessionToken(
  secret: string,
  token: string | undefined,
  now = Date.now()
): boolean {
  if (!token) return false;
  const [expires, signature] = token.split('.');
  if (!expires || !signature || !/^\d+$/.test(expires)) return false;
  if (Number(expires) < now) return false;
  return safeEqual(signature, sign(secret, expires));
}

export function passwordMatches(expected: string, given: unknown): boolean {
  if (typeof given !== 'string') return false;
  // Compare HMACs so the comparison is constant-time regardless of length.
  return safeEqual(sign('password', expected), sign('password', given));
}
