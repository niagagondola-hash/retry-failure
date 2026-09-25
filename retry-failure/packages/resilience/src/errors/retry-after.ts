/**
 * Parse `Retry-After` header (plan section 6).
 *
 * Header dapat berupa:
 *   - delta-seconds (integer base 10, e.g. "10")
 *   - HTTP-date (RFC 7231, e.g. "Wed, 21 Oct 2015 07:28:00 GMT")
 *
 * Return value: milliseconds (number) atau null bila tidak ada / invalid.
 *
 * NEVER sum Retry-After + exponential backoff. Pilih salah satu:
 *   - jika Retry-After ada -> pakai Retry-After (server-directed)
 *   - jika tidak ada -> pakai Cockatiel backoff (default)
 */

/**
 * Check if a string looks like a valid HTTP-date (RFC 7231) or ISO 8601 date.
 *
 * Accepted formats:
 *   - RFC 7231: "Wed, 21 Oct 2025 07:28:00 GMT" (IMF-fixdate)
 *   - RFC 7231 obsolete: "Wednesday, 21-Oct-25 07:28:00 GMT" (RFC 850)
 *   - RFC 7231 asctime: "Wed Oct 21 07:28:00 2025"
 *   - ISO 8601: "2025-10-21T07:28:00Z" or "2025-10-21T07:28:00.000Z"
 *
 * Heuristic: contains at least 2 spaces OR is ISO 8601 format (starts with YYYY-MM-DD),
 * AND contains a colon (time separator), AND contains alphabetic characters.
 */
function looksLikeHttpDate(value: string): boolean {
  const hasColon = value.includes(':');
  const hasAlpha = /[a-zA-Z]/.test(value);

  // ISO 8601 format: starts with YYYY-MM-DD
  const isIso8601 = /^\d{4}-\d{2}-\d{2}[T ]/.test(value);

  // RFC 7231 / asctime: has multiple spaces
  const hasMultipleSpaces = (value.match(/ /g) ?? []).length >= 2;

  return hasColon && hasAlpha && (isIso8601 || hasMultipleSpaces);
}

/**
 * @param value Header value (string | null | undefined)
 * @param now Reference time (default: new Date()). Inject untuk testability.
 * @returns Delay in milliseconds, atau null bila invalid / missing.
 */
export function parseRetryAfter(
  value: string | null | undefined,
  now: Date = new Date(),
): number | null {
  if (value === null || value === undefined) return null;

  const trimmed = String(value).trim();
  if (trimmed === '') return null;

  // Try delta-seconds (non-negative integer, base 10 only)
  // Regex /^\d+$/ sudah menolak negative ("-5") dan float ("5.5").
  if (/^\d+$/.test(trimmed)) {
    const seconds = parseInt(trimmed, 10);
    if (!Number.isFinite(seconds) || seconds < 0) return null;
    return seconds * 1000;
  }

  // Try HTTP-date (RFC 7231).
  // Penting: cek heuristic dulu, karena `new Date("-5")` valid (returns 1969-12-31).
  if (!looksLikeHttpDate(trimmed)) return null;

  const date = new Date(trimmed);
  const time = date.getTime();
  if (!Number.isNaN(time)) {
    const diff = time - now.getTime();
    return Math.max(0, diff);
  }

  // Invalid format
  return null;
}
