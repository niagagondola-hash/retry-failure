/**
 * disabled-user — helper for AUTH_MODE=disabled (AUTH-13).
 *
 * Plan reference: PLAN2 Section 14.6 (disabled mode), AUTH-13 task spec §1.
 *
 * When `AUTH_MODE=disabled`, SessionGuard + MenuAccessGuard skip all checks
 * and use a fake AuthUser built from env vars. Useful for dev/test without
 * OAuth flow.
 *
 * Also provides `hasPermissionForMenu()` helper used by MenuAccessGuard.
 */
import { AuthUser } from '../types/auth-user';

/**
 * Build a fake AuthUser from env vars (for AUTH_MODE=disabled).
 *
 * Env vars (all optional — defaults provided):
 *   - AUTH_DISABLED_USER_ID
 *   - AUTH_DISABLED_USERNAME
 *   - AUTH_DISABLED_ROLE_ID
 *   - AUTH_DISABLED_IS_SUPER_ADMIN ("true" | "false")
 *   - AUTH_DISABLED_PERMISSION_CODES ("*" or comma-separated)
 */
export function buildDisabledUser(
  env: NodeJS.ProcessEnv = process.env,
): AuthUser {
  const permissionCodesRaw = env.AUTH_DISABLED_PERMISSION_CODES ?? '*';
  return {
    userId:
      env.AUTH_DISABLED_USER_ID ?? '00000000-0000-0000-0000-000000000001',
    username: env.AUTH_DISABLED_USERNAME ?? 'disabled-user',
    roleId:
      env.AUTH_DISABLED_ROLE_ID ?? '00000000-0000-0000-0000-000000000002',
    isSuperAdmin: env.AUTH_DISABLED_IS_SUPER_ADMIN === 'true',
    permissionCodes:
      permissionCodesRaw === '*'
        ? ['*']
        : permissionCodesRaw
            .split(',')
            .map((s) => s.trim())
            .filter((s) => s.length > 0),
  };
}

/**
 * Check if permissionCodes grants access to a menu code.
 *
 * Wildcard '*' in permissionCodes grants access to all menus.
 *
 * @param permissionCodes - User's permission codes from session
 * @param menuCode - Required menu code (e.g. 'payment.write')
 * @returns true if user has access, false otherwise
 */
export function hasPermissionForMenu(
  permissionCodes: string[],
  menuCode: string,
): boolean {
  if (permissionCodes.includes('*')) return true;
  return permissionCodes.includes(menuCode);
}
