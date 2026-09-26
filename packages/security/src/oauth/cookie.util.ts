/**
 * Cookie utilities — build + parse session cookie (AUTH-12).
 *
 * Plan reference: PLAN2 Section 12.1 (cookie attributes), Section 10.7.9 (auth_sid),
 * AUTH-12 task spec §1.
 *
 * Cookie attributes per plan2 §12.1:
 *   - HttpOnly   (no JS access)
 *   - Secure     (HTTPS only — disabled in dev when AUTH_MOCK_TLS != on)
 *   - SameSite=Lax (allow top-level cross-site redirect from auth-mock)
 *   - Path=/
 *   - Max-Age=<seconds>
 *
 * Note: `cookie-parser` middleware already parses `req.cookies` object.
 * `parseSessionCookie` is a manual fallback for cases where middleware not applied.
 */
import type { Request, Response } from 'express';

/** Default cookie name for session ID (env: SESSION_COOKIE_NAME). */
export const DEFAULT_SESSION_COOKIE_NAME = 'sid';

/** Cookie options for building Set-Cookie header value. */
export interface CookieOptions {
  /** Cookie name — default 'sid' (env SESSION_COOKIE_NAME). */
  name?: string;
  /** Max age in milliseconds — converted to seconds for Max-Age attribute. */
  maxAgeMs: number;
  /** SameSite attribute — default 'lax' (env SESSION_COOKIE_SAMESITE). */
  sameSite?: 'lax' | 'strict' | 'none';
  /** Secure attribute — default true in production. */
  secure?: boolean;
  /** Path attribute — default '/'. */
  path?: string;
  /** Optional domain attribute. */
  domain?: string;
}

/**
 * Build a Set-Cookie header value for session cookie.
 *
 * Format: `sid=<value>; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=<sec>`
 *
 * @param sid - Session ID value
 * @param opts - Cookie options (maxAgeMs required, others optional)
 * @returns Set-Cookie header value string
 */
export function buildSessionCookie(sid: string, opts: CookieOptions): string {
  const name = opts.name ?? DEFAULT_SESSION_COOKIE_NAME;
  const sameSiteRaw = opts.sameSite ?? 'lax';
  // Capitalize first letter: 'lax' → 'Lax', 'strict' → 'Strict', 'none' → 'None'
  const sameSite =
    sameSiteRaw.charAt(0).toUpperCase() + sameSiteRaw.slice(1);
  const maxAgeSec = Math.floor(opts.maxAgeMs / 1000);
  const path = opts.path ?? '/';
  const secure = opts.secure ?? true;

  const parts: string[] = [
    `${name}=${sid}`,
    'HttpOnly',
    secure ? 'Secure' : '',
    `SameSite=${sameSite}`,
    `Path=${path}`,
    `Max-Age=${maxAgeSec}`,
  ].filter((part) => part !== '');

  if (opts.domain) {
    parts.push(`Domain=${opts.domain}`);
  }

  return parts.join('; ');
}

/**
 * Set session cookie on response via `Set-Cookie` header.
 *
 * @param res - Express response object
 * @param sid - Session ID value
 * @param opts - Cookie options (maxAgeMs required)
 */
export function setSessionCookie(
  res: Response,
  sid: string,
  opts: CookieOptions,
): void {
  res.setHeader('Set-Cookie', buildSessionCookie(sid, opts));
}

/**
 * Build a Set-Cookie header value that clears the session cookie.
 * Sets Max-Age=0 so browser immediately deletes the cookie.
 *
 * @param name - Cookie name (default 'sid')
 * @param path - Cookie path (default '/')
 * @returns Set-Cookie header value for clearing cookie
 */
export function clearSessionCookie(
  name: string = DEFAULT_SESSION_COOKIE_NAME,
  path: string = '/',
): string {
  return `${name}=; HttpOnly; Secure; SameSite=Lax; Path=${path}; Max-Age=0`;
}

/**
 * Clear session cookie on response.
 *
 * @param res - Express response object
 * @param name - Cookie name (default 'sid')
 * @param path - Cookie path (default '/')
 */
export function setClearSessionCookie(
  res: Response,
  name: string = DEFAULT_SESSION_COOKIE_NAME,
  path: string = '/',
): void {
  res.setHeader('Set-Cookie', clearSessionCookie(name, path));
}

/**
 * Parse session cookie from request.
 *
 * Prefers `req.cookies` (set by `cookie-parser` middleware). Falls back to
 * manual parsing of `req.headers.cookie` if middleware not applied.
 *
 * @param req - Express request object
 * @param name - Cookie name to extract (default 'sid')
 * @returns Session ID string, or null if cookie not present
 */
export function parseSessionCookie(
  req: Request,
  name: string = DEFAULT_SESSION_COOKIE_NAME,
): string | null {
  // Prefer cookie-parser middleware output
  const cookies = (req as Request & { cookies?: Record<string, string> })
    .cookies;
  if (cookies && typeof cookies === 'object') {
    const value = cookies[name];
    if (typeof value === 'string' && value.length > 0) {
      return value;
    }
  }

  // Fallback: manual parse from Cookie header
  const rawCookie = req.headers?.cookie ?? '';
  if (!rawCookie) return null;

  for (const part of rawCookie.split(';')) {
    const trimmed = part.trim();
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx === -1) continue;
    const k = trimmed.slice(0, eqIdx);
    const v = trimmed.slice(eqIdx + 1);
    if (k === name && v) {
      return v;
    }
  }
  return null;
}
