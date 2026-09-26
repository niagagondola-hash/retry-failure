/**
 * Fixture users + roles + permissions (AUTH-06).
 *
 * Plan reference: PLAN2 Section 10.4 (fixture user), Section 6.1 (menu codes),
 * Section 5.2 (JWT payload), Section 10.6 (response /api/v1/me/permissions),
 * AUTH_CONTRACT.md section 4 + 6.
 *
 * Two fixture users per plan2 §10.4:
 *   - `superadmin`   / ChangeMe_123!  — single role (Super Admin), isSuperAdmin=true
 *   - `budi_santoso` / ChangeMe_123!  — multi role (HRD + Finance), isSuperAdmin=false
 *
 * Stable UUIDs so tests can hardcode user/role IDs across restarts.
 *
 * 5 menu codes per plan2 §6.1:
 *   - dashboard, payment.read, payment.write, payment.retry, payment.admin
 *
 * Passwords are stored as plaintext for dev mock (NOT for production). Catat
 * di TODO untuk production (bcrypt/argon2).
 */

import { MockUser } from './user.service';

/** Stable UUIDs for fixture users (plan2 §10.4). */
export const FIXTURE_USER_IDS = {
  superadmin: '00000000-0000-1000-8000-000000000001',
  budi: '00000000-0000-1000-8000-000000000002',
} as const;

/** Stable UUIDs for fixture roles. */
export const FIXTURE_ROLE_IDS = {
  superAdmin: '00000000-0000-1000-8000-000000000101',
  hrd: '00000000-0000-1000-8000-000000000102',
  finance: '00000000-0000-1000-8000-000000000103',
} as const;

/** Menu codes per plan2 §6.1 — used by MenuAccessGuard in payment-api. */
export const FIXTURE_MENU_CODES = [
  'dashboard',
  'payment.read',
  'payment.write',
  'payment.retry',
  'payment.admin',
] as const;

/** All permission codes — Super Admin has all of these. */
export const ALL_PERMISSION_CODES = [...FIXTURE_MENU_CODES];

/** Fixture users array — consumed by UserService.onModuleInit(). */
export const FIXTURE_USERS: MockUser[] = [
  {
    id: FIXTURE_USER_IDS.superadmin,
    username: 'superadmin',
    passwordHash: 'ChangeMe_123!',
    email: 'superadmin@mock.local',
    name: 'Super Admin',
    isSuperAdmin: true,
    roles: [
      {
        id: FIXTURE_ROLE_IDS.superAdmin,
        name: 'Super Admin',
        description: 'Full access (bypass all menu checks)',
        permissionCodes: ALL_PERMISSION_CODES,
      },
    ],
  },
  {
    id: FIXTURE_USER_IDS.budi,
    username: 'budi_santoso',
    passwordHash: 'ChangeMe_123!',
    email: 'budi@perusahaan.com',
    name: 'Budi Santoso',
    isSuperAdmin: false,
    roles: [
      {
        id: FIXTURE_ROLE_IDS.hrd,
        name: 'HRD',
        description: 'Human Resources — view payments only',
        permissionCodes: ['dashboard', 'payment.read'],
      },
      {
        id: FIXTURE_ROLE_IDS.finance,
        name: 'Finance',
        description: 'Finance — view + create + retry payments',
        permissionCodes: [
          'dashboard',
          'payment.read',
          'payment.write',
          'payment.retry',
        ],
      },
    ],
  },
];
