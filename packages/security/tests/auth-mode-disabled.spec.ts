/**
 * AUTH_MODE=disabled behavior tests (AUTH-13).
 *
 * Plan reference: AUTH-13 task spec §7, PLAN2 §14.6 (disabled mode).
 *
 * Verifies the disabled-user helper + guard skip behavior.
 */
import { Reflector } from '@nestjs/core';

import { MenuAccessGuard } from '../src/guards/menu-access.guard';
import { SessionGuard } from '../src/guards/session.guard';
import { AuthUser } from '../src/types/auth-user';
import { buildDisabledUser, hasPermissionForMenu } from '../src/utils/disabled-user';

describe('AUTH_MODE=disabled', () => {
  describe('buildDisabledUser', () => {
    afterEach(() => {
      // Clean up env modifications
      delete process.env.AUTH_DISABLED_USER_ID;
      delete process.env.AUTH_DISABLED_USERNAME;
      delete process.env.AUTH_DISABLED_ROLE_ID;
      delete process.env.AUTH_DISABLED_IS_SUPER_ADMIN;
      delete process.env.AUTH_DISABLED_PERMISSION_CODES;
    });

    it('returns default fake user when no env set', () => {
      const user = buildDisabledUser({});
      expect(user.userId).toBe('00000000-0000-0000-0000-000000000001');
      expect(user.username).toBe('disabled-user');
      expect(user.roleId).toBe('00000000-0000-0000-0000-000000000002');
      expect(user.isSuperAdmin).toBe(false);
      expect(user.permissionCodes).toEqual(['*']);
    });

    it('returns user from env vars when set', () => {
      const user = buildDisabledUser({
        AUTH_DISABLED_USER_ID: 'custom-uuid',
        AUTH_DISABLED_USERNAME: 'custom-user',
        AUTH_DISABLED_ROLE_ID: 'custom-role',
        AUTH_DISABLED_IS_SUPER_ADMIN: 'true',
        AUTH_DISABLED_PERMISSION_CODES: 'dashboard,payment.read',
      });
      expect(user.userId).toBe('custom-uuid');
      expect(user.username).toBe('custom-user');
      expect(user.roleId).toBe('custom-role');
      expect(user.isSuperAdmin).toBe(true);
      expect(user.permissionCodes).toEqual(['dashboard', 'payment.read']);
    });

    it('handles wildcard "*" permission codes', () => {
      const user = buildDisabledUser({
        AUTH_DISABLED_PERMISSION_CODES: '*',
      });
      expect(user.permissionCodes).toEqual(['*']);
    });

    it('trims + filters empty entries in permission codes', () => {
      const user = buildDisabledUser({
        AUTH_DISABLED_PERMISSION_CODES: ' dashboard , ,payment.read ,',
      });
      expect(user.permissionCodes).toEqual(['dashboard', 'payment.read']);
    });

    it('treats isSuperAdmin flag as boolean true only for "true" string', () => {
      expect(
        buildDisabledUser({ AUTH_DISABLED_IS_SUPER_ADMIN: 'true' })
          .isSuperAdmin,
      ).toBe(true);
      expect(
        buildDisabledUser({ AUTH_DISABLED_IS_SUPER_ADMIN: 'false' })
          .isSuperAdmin,
      ).toBe(false);
      expect(
        buildDisabledUser({ AUTH_DISABLED_IS_SUPER_ADMIN: '1' })
          .isSuperAdmin,
      ).toBe(false);
      expect(
        buildDisabledUser({ AUTH_DISABLED_IS_SUPER_ADMIN: undefined })
          .isSuperAdmin,
      ).toBe(false);
    });
  });

  describe('hasPermissionForMenu', () => {
    it('returns true when wildcard "*" is in permissionCodes', () => {
      expect(hasPermissionForMenu(['*'], 'payment.write')).toBe(true);
      expect(hasPermissionForMenu(['*', 'dashboard'], 'payment.admin')).toBe(true);
    });

    it('returns true when menuCode is in permissionCodes', () => {
      expect(hasPermissionForMenu(['dashboard', 'payment.write'], 'payment.write')).toBe(true);
    });

    it('returns false when menuCode not in permissionCodes', () => {
      expect(hasPermissionForMenu(['dashboard'], 'payment.write')).toBe(false);
    });

    it('returns false for empty permissionCodes', () => {
      expect(hasPermissionForMenu([], 'dashboard')).toBe(false);
    });
  });

  describe('SessionGuard disabled mode integration', () => {
    it('sets req.user from env + returns true without reading cookie', async () => {
      const reflector = new Reflector();
      const sessionService = { get: jest.fn(), touch: jest.fn() };
      const cacheRepository = { findCachedUser: jest.fn() };
      const guard = new SessionGuard(
        sessionService as never,
        cacheRepository as never,
        reflector,
        { authMode: 'disabled', sessionStore: 'memory' },
      );

      const req: { user?: AuthUser } = {};
      const ctx = {
        switchToHttp: () => ({ getRequest: () => req }),
        getHandler: () => ({}),
        getClass: () => ({}),
      } as never;

      const result = await guard.canActivate(ctx);
      expect(result).toBe(true);
      expect(req.user).toBeDefined();
      expect(req.user!.username).toBe('disabled-user');
      expect(sessionService.get).not.toHaveBeenCalled();
      expect(cacheRepository.findCachedUser).not.toHaveBeenCalled();
    });
  });

  describe('MenuAccessGuard disabled mode integration', () => {
    it('returns true without checking metadata', () => {
      const reflector = new Reflector();
      const guard = new MenuAccessGuard(reflector, {
        authMode: 'disabled',
        sessionStore: 'memory',
      });
      const ctx = {
        switchToHttp: () => ({ getRequest: () => ({}) }),
        getHandler: () => ({}),
        getClass: () => ({}),
      } as never;
      expect(guard.canActivate(ctx)).toBe(true);
    });
  });
});
