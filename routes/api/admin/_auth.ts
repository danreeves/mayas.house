import { type CloudContext, defineMiddleware } from 'void';

/**
 * Single-admin login for the moderation panel.
 *
 * There is no user system: the operator sets ADMIN_PASSWORD as a Worker secret
 * (or in `.env` locally) and signs in with it at /admin. The session is a signed,
 * HttpOnly cookie that carries only its own expiry, so no secret round-trips to
 * the browser.
 */

const COOKIE_NAME = 'mh_admin';
const SESSION_TTL_MS = 12 * 60 * 60 * 1000;

function configuredPassword(c: CloudContext): string {
  const value = (c.env as Record<string, unknown>).ADMIN_PASSWORD;
  return typeof value === 'string' ? value.trim() : '';
}

function encodeBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function sign(value: string, key: string): Promise<string> {
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(key),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign(
    'HMAC',
    cryptoKey,
    new TextEncoder().encode(value),
  );
  return encodeBase64Url(new Uint8Array(signature));
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function readCookie(header: string | undefined, name: string): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() === name) return part.slice(eq + 1).trim();
  }
  return undefined;
}

function cookieAttributes(c: CloudContext): string[] {
  const attributes = ['Path=/', 'HttpOnly', 'SameSite=Strict'];
  if (new URL(c.req.url).protocol === 'https:') attributes.push('Secure');
  return attributes;
}

export function checkPassword(c: CloudContext, password: string): boolean {
  const expected = configuredPassword(c);
  if (!expected) return false;
  return timingSafeEqual(password, expected);
}

export async function isSignedIn(c: CloudContext): Promise<boolean> {
  const key = configuredPassword(c);
  if (!key) return false;
  const token = readCookie(c.req.header('cookie'), COOKIE_NAME);
  if (!token) return false;
  const [expires, signature] = token.split('.');
  if (!expires || !signature || !/^\d+$/.test(expires)) return false;
  if (Number(expires) < Date.now()) return false;
  return timingSafeEqual(signature, await sign(expires, key));
}

export async function sessionCookie(c: CloudContext): Promise<string> {
  const key = configuredPassword(c);
  const expires = String(Date.now() + SESSION_TTL_MS);
  const token = `${expires}.${await sign(expires, key)}`;
  return [
    `${COOKIE_NAME}=${token}`,
    ...cookieAttributes(c),
    `Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}`,
  ].join('; ');
}

export function clearSessionCookie(c: CloudContext): string {
  return [`${COOKIE_NAME}=`, ...cookieAttributes(c), 'Max-Age=0'].join('; ');
}

/** Rejects unauthenticated requests to the admin API. */
export const requireAdmin = defineMiddleware(async (c, next) => {
  if (!(await isSignedIn(c))) {
    return c.json({ error: 'unauthorized' }, 401);
  }
  await next();
});
