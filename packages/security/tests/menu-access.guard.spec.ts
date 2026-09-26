/**
 * MenuAccessGuard unit tests (AUTH-13).
 *
 * Plan reference: AUTH-13 task spec §8, PLAN2 §6.4, §6.3, §14.6.
 */
import { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import { IS_PUBLIC_KEY } from '../src/decorators/public.decorator';
import { REQUIRE_MENU_KEY } from '../src/decorators/require-menu.decorator';
import { MenuAccessGuard } from '../src/guards/menu-access.guard';
import { AuthUser } from '../src/types/auth-user';

function mockExecutionContext(user?: AuthUser): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => ({ user }),
    }),
    getHandler: () => ({}),
    getClass: () => ({}),
  } as unknown as ExecutionContext;
}

const userWithCodes = (codes: string[]): AuthUser => ({
  userId: 'u1',
  username: 'tester',
  roleId: 'r1',
  isSuperAdmin: false,
  permissionCodes: codes,
});

describe('MenuAccessGuard', () => {
  let guard: MenuAccessGuard;
  let reflector: Reflector;

  beforeEach(() => {
    reflector = new Reflector();
    guard = new MenuAccessGuard(reflector, {
      authMode: 'mock',
      sessionStore: 'memory',
    });
  });

  describe('AUTH_MODE=disabled', () => {
    it('returns true (skip all menu checks)', () => {
      guard = new MenuAccessGuard(reflector, {
        authMode: 'disabled',
        sessionStore: 'memory',
      });
      const ctx = mockExecutionContext();
      expect(guard.canActivate(ctx)).toBe(true);
    });
  });

  describe('@Public() decorator', () => {
    it('returns true without checking menu', () => {
      jest.spyOn(reflector, 'getAllAndOverride').mockImplementation((key) =>
        key === IS_PUBLIC_KEY ? true : undefined,
      );
      const ctx = mockExecutionContext();
      expect(guard.canActivate(ctx)).toBe(true);
    });
  });

  describe('no @RequireMenu metadata', () => {
    it('returns true (no menu required → allow)', () => {
      jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(undefined);
      const ctx = mockExecutionContext();
      expect(guard.canActivate(ctx)).toBe(true);
    });
  });

  describe('@RequireMenu with user having required code', () => {
    it('returns true when user has payment.write', () => {
      jest.spyOn(reflector, 'getAllAndOverride').mockImplementation((key) =>
        key === REQUIRE_MENU_KEY ? ['payment.write'] : undefined,
      );
      const ctx = mockExecutionContext(userWithCodes(['payment.write']));
      expect(guard.canActivate(ctx)).toBe(true);
    });

    it('returns true when user has one of multiple required codes (OR logic)', () => {
      jest.spyOn(reflector, 'getAllAndOverride').mockImplementation((key) =>
        key === REQUIRE_MENU_KEY
          ? ['payment.write', 'payment.admin']
          : undefined,
      );
      const ctx = mockExecutionContext(userWithCodes(['payment.admin']));
      expect(guard.canActivate(ctx)).toBe(true);
    });
  });

  describe('@RequireMenu with user NOT having required code', () => {
    it('throws 403 Forbidden', () => {
      jest.spyOn(reflector, 'getAllAndOverride').mockImplementation((key) =>
        key === REQUIRE_MENU_KEY ? ['payment.write'] : undefined,
      );
      const ctx = mockExecutionContext(
        userWithCodes(['dashboard', 'payment.read']),
      );
      expect(() => guard.canActivate(ctx)).toThrow('Missing required menu');
    });

    it('throws 403 when user has none of multiple required codes', () => {
      jest.spyOn(reflector, 'getAllAndOverride').mockImplementation((key) =>
        key === REQUIRE_MENU_KEY
          ? ['payment.write', 'payment.admin']
          : undefined,
      );
      const ctx = mockExecutionContext(userWithCodes(['dashboard']));
      expect(() => guard.canActivate(ctx)).toThrow('Missing required menu');
    });
  });

  describe('isSuperAdmin bypass', () => {
    it('returns true when user.isSuperAdmin=true (no required code in permissionCodes)', () => {
      jest.spyOn(reflector, 'getAllAndOverride').mockImplementation((key) =>
        key === REQUIRE_MENU_KEY ? ['payment.write'] : undefined,
      );
      const ctx = mockExecutionContext({
        ...userWithCodes([]),
        isSuperAdmin: true,
      });
      expect(guard.canActivate(ctx)).toBe(true);
    });
  });

  describe('wildcard permission', () => {
    it('returns true when user.permissionCodes includes "*"', () => {
      jest.spyOn(reflector, 'getAllAndOverride').mockImplementation((key) =>
        key === REQUIRE_MENU_KEY ? ['payment.write'] : undefined,
      );
      const ctx = mockExecutionContext(userWithCodes(['*']));
      expect(guard.canActivate(ctx)).toBe(true);
    });
  });

  describe('req.user not set (SessionGuard skipped)', () => {
    it('returns true (defer to next guard)', () => {
      jest.spyOn(reflector, 'getAllAndOverride').mockImplementation((key) =>
        key === REQUIRE_MENU_KEY ? ['payment.write'] : undefined,
      );
      const ctx = mockExecutionContext(undefined);
      expect(guard.canActivate(ctx)).toBe(true);
    });
  });

  describe('empty @RequireMenu() array', () => {
    it('returns true (no menu required)', () => {
      jest.spyOn(reflector, 'getAllAndOverride').mockImplementation((key) =>
        key === REQUIRE_MENU_KEY ? [] : undefined,
      );
      const ctx = mockExecutionContext(userWithCodes([]));
      expect(guard.canActivate(ctx)).toBe(true);
    });
  });
});
