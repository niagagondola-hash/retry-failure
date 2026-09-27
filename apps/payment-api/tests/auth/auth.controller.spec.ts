/**
 * AuthController unit tests (AUTH-17).
 *
 * Plan reference: AUTH-17 task spec §9, PLAN2 §4.2.
 *
 * Tests AuthController with mocked AuthService — verifies HTTP responses,
 * cookie setting, redirect behavior, and AUTH_MODE=disabled handling.
 */
import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import cookieParser from 'cookie-parser';
import request from 'supertest';

import { AuthController } from '../../src/auth/auth.controller';
import { AuthService } from '../../src/auth/auth.service';

/** Mock AuthService — returns canned values for each method. */
function mockAuthService() {
  return {
    startLogin: jest.fn().mockResolvedValue({
      redirectUrl:
        'http://localhost:4001/oauth/authorize?code_challenge=abc',
      state: 'test-state-123',
      codeVerifier: 'test-verifier-456',
    }),
    handleCallback: jest.fn().mockResolvedValue({
      sid: 'test-sid-789',
      user: {
        userId: '00000000-0000-1000-8000-000000000002',
        username: 'budi_santoso',
        roleId: '00000000-0000-1000-8000-000000000102',
        isSuperAdmin: false,
      },
    }),
    logout: jest.fn().mockResolvedValue(undefined),
    refresh: jest.fn().mockResolvedValue(undefined),
    switchRole: jest.fn().mockResolvedValue({
      userId: '00000000-0000-1000-8000-000000000002',
      username: 'budi_santoso',
      roleId: '00000000-0000-1000-8000-000000000103',
      isSuperAdmin: false,
      permissionCodes: [
        'dashboard',
        'payment.read',
        'payment.write',
        'payment.retry',
      ],
    }),
  };
}

async function buildApp(
  authService: ReturnType<typeof mockAuthService>,
): Promise<INestApplication> {
  const mod = await Test.createTestingModule({
    controllers: [AuthController],
    providers: [{ provide: AuthService, useValue: authService }],
  }).compile();
  const app = mod.createNestApplication();
  app.use(cookieParser());
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, transform: true }),
  );
  await app.init();
  return app;
}

describe('AuthController', () => {
  let authService: ReturnType<typeof mockAuthService>;
  let app: INestApplication;

  beforeEach(async () => {
    authService = mockAuthService();
    delete process.env.AUTH_MODE;
    app = await buildApp(authService);
  }, 15000); // 15s timeout for app init

  afterEach(async () => {
    await app.close();
  }, 30000); // 30s timeout for app close (handles async cleanup)

  describe('GET /auth/session', () => {
    it('returns 200 with user null when req.user not set', async () => {
      const res = await request(app.getHttpServer())
        .get('/auth/session')
        .expect(200);
      expect(res.body.user).toBeNull();
    });
  });

  describe('GET /auth/login', () => {
    it('returns 501 when AUTH_MODE=disabled', async () => {
      process.env.AUTH_MODE = 'disabled';
      const res = await request(app.getHttpServer())
        .get('/auth/login')
        .expect(501);
      expect(res.body.message).toMatch(/disabled/i);
    });

    it('redirects 302 to auth authorize URL + sets oauth_state cookie', async () => {
      process.env.AUTH_MODE = 'mock';
      const res = await request(app.getHttpServer())
        .get('/auth/login')
        .expect(302);
      expect(res.headers.location).toMatch(/oauth\/authorize/);
      const setCookie = res.headers['set-cookie'];
      expect(setCookie).toBeDefined();
      const cookieStr = Array.isArray(setCookie) ? setCookie[0] : setCookie;
      expect(cookieStr).toMatch(/oauth_state=test-state-123/);
      expect(cookieStr).toMatch(/HttpOnly/i);
      expect(authService.startLogin).toHaveBeenCalled();
    });
  });

  describe('GET /auth/callback', () => {
    it('returns 501 when AUTH_MODE=disabled', async () => {
      process.env.AUTH_MODE = 'disabled';
      await request(app.getHttpServer())
        .get('/auth/callback')
        .expect(501);
    });

    it('returns 400 when code or state missing', async () => {
      process.env.AUTH_MODE = 'mock';
      await request(app.getHttpServer())
        .get('/auth/callback?code=abc')
        .expect(400);
    });

    it('returns 400 when oauth cookies missing', async () => {
      process.env.AUTH_MODE = 'mock';
      await request(app.getHttpServer())
        .get('/auth/callback?code=abc&state=xyz')
        .expect(400);
    });

    it('redirects 302 to / + sets sid cookie on success', async () => {
      process.env.AUTH_MODE = 'mock';
      const res = await request(app.getHttpServer())
        .get('/auth/callback?code=test-code&state=test-state-123')
        .set('Cookie', [
          'oauth_state=test-state-123',
          'oauth_verifier=test-verifier-456',
        ])
        .expect(302);
      expect(res.headers.location).toBe('/');
      const setCookie = res.headers['set-cookie'];
      expect(setCookie).toBeDefined();
      const cookieStr = Array.isArray(setCookie) ? setCookie[0] : setCookie;
      expect(cookieStr).toMatch(/sid=test-sid-789/);
      expect(cookieStr).toMatch(/HttpOnly/i);
      expect(authService.handleCallback).toHaveBeenCalledWith(
        'test-code',
        'test-state-123',
        'test-state-123',
        'test-verifier-456',
      );
    });

    it('returns 401 when handleCallback throws', async () => {
      process.env.AUTH_MODE = 'mock';
      authService.handleCallback.mockRejectedValue(
        new Error('state mismatch'),
      );
      await request(app.getHttpServer())
        .get('/auth/callback?code=bad&state=bad')
        .set('Cookie', ['oauth_state=expected', 'oauth_verifier=v'])
        .expect(401);
    });
  });

  describe('POST /auth/logout', () => {
    it('returns 200 + clears sid cookie', async () => {
      const res = await request(app.getHttpServer())
        .post('/auth/logout')
        .set('Cookie', 'sid=test-sid')
        .expect(200);
      expect(res.body.message).toBe('OK');
      expect(authService.logout).toHaveBeenCalledWith('test-sid');
    });

    it('returns 200 even without sid cookie (no-op)', async () => {
      await request(app.getHttpServer())
        .post('/auth/logout')
        .expect(200);
      expect(authService.logout).not.toHaveBeenCalled();
    });
  });

  describe('POST /auth/refresh', () => {
    it('returns 200 when sid cookie present', async () => {
      const res = await request(app.getHttpServer())
        .post('/auth/refresh')
        .set('Cookie', 'sid=test-sid')
        .expect(200);
      expect(res.body).toEqual({ ok: true });
      expect(authService.refresh).toHaveBeenCalledWith('test-sid');
    });

    it('returns 401 when sid cookie missing', async () => {
      await request(app.getHttpServer())
        .post('/auth/refresh')
        .expect(401);
    });
  });

  describe('POST /auth/switch-role', () => {
    const financeRoleId = '00000000-0000-1000-8000-000000000103';

    it('returns 501 when AUTH_MODE=disabled', async () => {
      process.env.AUTH_MODE = 'disabled';
      await request(app.getHttpServer())
        .post('/auth/switch-role')
        .send({ roleId: financeRoleId })
        .expect(501);
    });

    it('returns 401 when sid cookie missing', async () => {
      process.env.AUTH_MODE = 'mock';
      await request(app.getHttpServer())
        .post('/auth/switch-role')
        .send({ roleId: financeRoleId })
        .expect(401);
    });

    it('returns 200 with updated user on success', async () => {
      process.env.AUTH_MODE = 'mock';
      const res = await request(app.getHttpServer())
        .post('/auth/switch-role')
        .set('Cookie', 'sid=test-sid')
        .send({ roleId: financeRoleId })
        .expect(200);
      expect(res.body.user.roleId).toBe(financeRoleId);
      expect(res.body.user.permissionCodes).toHaveLength(4);
      expect(authService.switchRole).toHaveBeenCalledWith(
        'test-sid',
        financeRoleId,
      );
    });

    it('returns 400 when roleId missing in body', async () => {
      process.env.AUTH_MODE = 'mock';
      await request(app.getHttpServer())
        .post('/auth/switch-role')
        .set('Cookie', 'sid=test-sid')
        .send({})
        .expect(400);
    });
  });

  describe('GET /auth/csrf', () => {
    it('returns 200 with csrfToken (empty when not set)', async () => {
      const res = await request(app.getHttpServer())
        .get('/auth/csrf')
        .expect(200);
      expect(res.body).toHaveProperty('csrfToken');
      expect(typeof res.body.csrfToken).toBe('string');
    });
  });
});
