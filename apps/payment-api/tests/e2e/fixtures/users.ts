/**
 * Fixture credentials + role UUIDs for E2E tests against the real auth-mock.
 *
 * Plan reference: PLAN2 Section 17.3 (E2E lintas service), Section 10.4
 * (fixture user), AUTH-26 task spec §1 (fixtures/users.ts).
 *
 * Single source of truth for E2E test credentials so tests don't drift from
 * the actual auth-mock fixture users (DRY per CODING_STANDARDS.md §DRY).
 *
 * UUIDs + permission codes are copied verbatim from
 * `apps/auth-mock/src/modules/user/fixtures.ts` — that file is the source of
 * truth at runtime (auth-mock reads it via `UserService.onModuleInit()`).
 *
 * ⚠️ Note: The AUTH-26 task spec assumed HRD role had `payment.write`, but
 * the actual auth-mock fixtures.ts assigns HRD = ['dashboard', 'payment.read']
 * (no write). Finance role has ['dashboard', 'payment.read', 'payment.write',
 * 'payment.retry']. Tests below use the ACTUAL fixture values, which is the
 * ground truth — documented as a spec deviation in the worklog.
 */

/**
 * E2E fixture user shape. `expectedPermissionCodes` is the canonical list the
 * session is expected to hold after login (used to assert session contents).
 */
export interface E2EUser {
  /** Fixture username (matches auth-mock `users.username`). */
  username: string;
  /** Fixture plaintext password (matches auth-mock `users.passwordHash`). */
  password: string;
  /** Stable UUID (matches `FIXTURE_USER_IDS` in auth-mock fixtures.ts). */
  userId: string;
  /** Stable UUID (matches `FIXTURE_ROLE_IDS` in auth-mock fixtures.ts). */
  roleId: string;
  /** Whether the user is a super admin (matches `users.isSuperAdmin`). */
  isSuperAdmin: boolean;
  /** Permission codes the session should hold after login with this role. */
  expectedPermissionCodes: string[];
}

/**
 * All E2E fixture users. Keys identify the user+role combination under test.
 *
 * - `superadmin`: single-role Super Admin (isSuperAdmin=true, wildcard perms).
 * - `budiHrd`: budi_santoso selecting HRD role (payment.read only — no write).
 * - `budiFinance`: budi_santoso selecting Finance role (read+write+retry).
 *
 * Why three entries (not two): HRD + Finance have DIFFERENT permission sets,
 * so we keep both for the multi-role tests (initial HRD login + switch-role
 * target Finance).
 */
export const E2E_USERS = {
  superadmin: {
    username: 'superadmin',
    password: 'ChangeMe_123!',
    userId: '00000000-0000-1000-8000-000000000001',
    roleId: '00000000-0000-1000-8000-000000000101',
    isSuperAdmin: true,
    expectedPermissionCodes: [
      'dashboard',
      'payment.read',
      'payment.write',
      'payment.retry',
      'payment.admin',
    ],
  },
  budiHrd: {
    username: 'budi_santoso',
    password: 'ChangeMe_123!',
    userId: '00000000-0000-1000-8000-000000000002',
    roleId: '00000000-0000-1000-8000-000000000102',
    isSuperAdmin: false,
    expectedPermissionCodes: ['dashboard', 'payment.read'],
  },
  budiFinance: {
    username: 'budi_santoso',
    password: 'ChangeMe_123!',
    userId: '00000000-0000-1000-8000-000000000002',
    roleId: '00000000-0000-1000-8000-000000000103',
    isSuperAdmin: false,
    expectedPermissionCodes: [
      'dashboard',
      'payment.read',
      'payment.write',
      'payment.retry',
    ],
  },
} as const satisfies Record<string, E2EUser>;

/** Type guard helper — ensures the const object above matches E2EUser shape. */
export type E2EUsers = typeof E2E_USERS;
