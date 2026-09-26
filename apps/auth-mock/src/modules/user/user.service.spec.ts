/**
 * UserService unit tests (AUTH-06).
 *
 * Verifies fixture seeding + login validation + role lookup.
 *
 * Plan reference: AUTH-06 task spec §5, PLAN2 §10.4.
 */
import { Test } from '@nestjs/testing';

import {
  FIXTURE_USER_IDS,
  FIXTURE_ROLE_IDS,
  FIXTURE_MENU_CODES,
  FIXTURE_USERS,
} from './fixtures';
import { UserService } from './user.service';

describe('UserService', () => {
  let svc: UserService;

  beforeEach(async () => {
    const mod = await Test.createTestingModule({
      providers: [UserService],
    }).compile();
    svc = mod.get(UserService);
    await svc.onModuleInit();
  });

  describe('fixture seeding', () => {
    it('seeds 2 fixture users on onModuleInit', async () => {
      const superadmin = await svc.findById(FIXTURE_USER_IDS.superadmin);
      const budi = await svc.findById(FIXTURE_USER_IDS.budi);
      expect(superadmin).toBeDefined();
      expect(budi).toBeDefined();
      expect(superadmin!.username).toBe('superadmin');
      expect(budi!.username).toBe('budi_santoso');
    });

    it('UUIDs are stable across restarts (hardcoded)', () => {
      expect(FIXTURE_USER_IDS.superadmin).toBe(
        '00000000-0000-1000-8000-000000000001',
      );
      expect(FIXTURE_USER_IDS.budi).toBe(
        '00000000-0000-1000-8000-000000000002',
      );
      expect(FIXTURE_ROLE_IDS.superAdmin).toBe(
        '00000000-0000-1000-8000-000000000101',
      );
      expect(FIXTURE_ROLE_IDS.hrd).toBe(
        '00000000-0000-1000-8000-000000000102',
      );
      expect(FIXTURE_ROLE_IDS.finance).toBe(
        '00000000-0000-1000-8000-000000000103',
      );
    });
  });

  describe('validateCredentials', () => {
    it('validates budi_santoso + ChangeMe_123!', async () => {
      const u = await svc.validateCredentials('budi_santoso', 'ChangeMe_123!');
      expect(u).not.toBeNull();
      expect(u!.username).toBe('budi_santoso');
      expect(u!.id).toBe(FIXTURE_USER_IDS.budi);
    });

    it('validates superadmin + ChangeMe_123!', async () => {
      const u = await svc.validateCredentials('superadmin', 'ChangeMe_123!');
      expect(u).not.toBeNull();
      expect(u!.username).toBe('superadmin');
    });

    it('rejects wrong password', async () => {
      const u = await svc.validateCredentials('budi_santoso', 'wrong-password');
      expect(u).toBeNull();
    });

    it('rejects unknown user', async () => {
      const u = await svc.validateCredentials('hacker', 'ChangeMe_123!');
      expect(u).toBeNull();
    });
  });

  describe('superadmin fixture', () => {
    it('has single role (Super Admin) + isSuperAdmin=true + all 5 codes', async () => {
      const u = await svc.findByUsername('superadmin');
      expect(u).not.toBeNull();
      expect(u!.roles).toHaveLength(1);
      expect(u!.roles[0].name).toBe('Super Admin');
      expect(u!.roles[0].id).toBe(FIXTURE_ROLE_IDS.superAdmin);
      expect(u!.isSuperAdmin).toBe(true);
      // All 5 menu codes
      expect(u!.roles[0].permissionCodes).toHaveLength(5);
      expect(u!.roles[0].permissionCodes).toEqual(
        expect.arrayContaining([...FIXTURE_MENU_CODES]),
      );
    });
  });

  describe('budi_santoso fixture', () => {
    it('has 2 roles: HRD + Finance + isSuperAdmin=false', async () => {
      const u = await svc.findByUsername('budi_santoso');
      expect(u).not.toBeNull();
      expect(u!.roles).toHaveLength(2);
      expect(u!.isSuperAdmin).toBe(false);
      const names = u!.roles.map((r) => r.name);
      expect(names).toEqual(expect.arrayContaining(['HRD', 'Finance']));
    });

    it('HRD role has [dashboard, payment.read] only', async () => {
      const u = await svc.findByUsername('budi_santoso');
      const hrd = u!.roles.find((r) => r.name === 'HRD');
      expect(hrd).toBeDefined();
      expect(hrd!.id).toBe(FIXTURE_ROLE_IDS.hrd);
      expect(hrd!.permissionCodes).toEqual(
        expect.arrayContaining(['dashboard', 'payment.read']),
      );
      expect(hrd!.permissionCodes).toHaveLength(2);
      // Must NOT have write/retry/admin
      expect(hrd!.permissionCodes).not.toContain('payment.write');
      expect(hrd!.permissionCodes).not.toContain('payment.retry');
      expect(hrd!.permissionCodes).not.toContain('payment.admin');
    });

    it('Finance role has [dashboard, payment.read, payment.write, payment.retry]', async () => {
      const u = await svc.findByUsername('budi_santoso');
      const fin = u!.roles.find((r) => r.name === 'Finance');
      expect(fin).toBeDefined();
      expect(fin!.id).toBe(FIXTURE_ROLE_IDS.finance);
      expect(fin!.permissionCodes).toEqual(
        expect.arrayContaining([
          'dashboard',
          'payment.read',
          'payment.write',
          'payment.retry',
        ]),
      );
      expect(fin!.permissionCodes).toHaveLength(4);
      // Must NOT have admin
      expect(fin!.permissionCodes).not.toContain('payment.admin');
    });

    it('first role is HRD (for /dev/token default role)', async () => {
      const u = await svc.findByUsername('budi_santoso');
      expect(u!.roles[0].name).toBe('HRD');
      expect(u!.roles[0].id).toBe(FIXTURE_ROLE_IDS.hrd);
    });
  });

  describe('findRole', () => {
    it('returns role when roleId belongs to user', async () => {
      const u = await svc.findByUsername('budi_santoso');
      const hrd = await svc.findRole(u!, FIXTURE_ROLE_IDS.hrd);
      expect(hrd).toBeDefined();
      expect(hrd!.name).toBe('HRD');
      expect(hrd!.permissionCodes).toEqual(['dashboard', 'payment.read']);
    });

    it('returns undefined when roleId does NOT belong to user', async () => {
      const u = await svc.findByUsername('budi_santoso');
      // Super Admin role does not belong to budi
      const notFound = await svc.findRole(u!, FIXTURE_ROLE_IDS.superAdmin);
      expect(notFound).toBeUndefined();
    });

    it('returns undefined for invalid role ID', async () => {
      const u = await svc.findByUsername('budi_santoso');
      const notFound = await svc.findRole(u!, 'invalid-role-id');
      expect(notFound).toBeUndefined();
    });
  });

  describe('fixtures.ts integrity', () => {
    it('FIXTURE_USERS has 2 users', () => {
      expect(FIXTURE_USERS).toHaveLength(2);
    });

    it('FIXTURE_MENU_CODES has 5 codes', () => {
      expect(FIXTURE_MENU_CODES).toHaveLength(5);
      expect([...FIXTURE_MENU_CODES]).toEqual([
        'dashboard',
        'payment.read',
        'payment.write',
        'payment.retry',
        'payment.admin',
      ]);
    });

    it('all fixture users use passwordHash field (not password)', () => {
      for (const u of FIXTURE_USERS) {
        expect(u.passwordHash).toBe('ChangeMe_123!');
        // password field should NOT exist (renamed to passwordHash per AUTH-06 spec)
        expect((u as unknown as { password?: string }).password).toBeUndefined();
      }
    });
  });
});
