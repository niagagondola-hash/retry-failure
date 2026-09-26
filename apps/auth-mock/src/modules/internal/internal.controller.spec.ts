/**
 * InternalController + DevController unit tests (AUTH-05).
 *
 * Verifies /api/v1/me/permissions + /api/v1/auth/switch-role + /dev/token.
 *
 * Plan reference: AUTH-05 task spec §8, PLAN2 §10.6, §5.6, §9.3.2.
 */
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { AppModule } from '../../app.module';

/**
 * Helper: spin up a full NestJS app with real KeyPairService + UserService
 * (seeded with fixtures). Tests issue dev tokens then call guarded endpoints
 * with the token — full roundtrip integration.
 */
async function buildApp(): Promise<INestApplication> {
  const mod = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();
  const app = mod.createNestApplication();
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  await app.init();
  return app;
}

describe('AUTH-05 internal endpoints (full app integration)', () => {
  let app: INestApplication;

  beforeEach(async () => {
    app = await buildApp();
  });

  afterEach(async () => {
    await app.close();
  });

  describe('POST /dev/token', () => {
    it('issues tokens for superadmin (NODE_ENV=test)', async () => {
      const res = await request(app.getHttpServer())
        .post('/dev/token')
        .send({ username: 'superadmin' })
        .expect(200);

      expect(res.body.accessToken).toMatch(/^eyJ/);
      expect(res.body.refreshToken).toMatch(/^eyJ/);
      expect(res.body.role.name).toBe('Super Admin');
      expect(res.body.user.username).toBe('superadmin');
      expect(res.body.user.isSuperAdmin).toBe(true);
    });

    it('issues tokens for budi_santoso with default first role (HRD)', async () => {
      const res = await request(app.getHttpServer())
        .post('/dev/token')
        .send({ username: 'budi_santoso' })
        .expect(200);

      expect(res.body.role.name).toBe('HRD');
      expect(res.body.role.id).toBe(
        '00000000-0000-1000-8000-000000000102',
      );
    });

    it('issues tokens for budi_santoso with explicit roleId (Finance)', async () => {
      const res = await request(app.getHttpServer())
        .post('/dev/token')
        .send({
          username: 'budi_santoso',
          roleId: '00000000-0000-1000-8000-000000000103',
        })
        .expect(200);

      expect(res.body.role.name).toBe('Finance');
      expect(res.body.role.id).toBe(
        '00000000-0000-1000-8000-000000000103',
      );
    });

    it('returns 403 for unknown user', async () => {
      await request(app.getHttpServer())
        .post('/dev/token')
        .send({ username: 'hacker' })
        .expect(403);
    });

    it('returns 400 for missing username', async () => {
      await request(app.getHttpServer())
        .post('/dev/token')
        .send({})
        .expect(400);
    });

    it('returns 400 when role does not belong to user (input validation error)', async () => {
      // superadmin does not have Finance role
      await request(app.getHttpServer())
        .post('/dev/token')
        .send({
          username: 'superadmin',
          roleId: '00000000-0000-1000-8000-000000000103',
        })
        .expect(400);
    });
  });

  describe('GET /api/v1/me/permissions', () => {
    it('returns 401 without Authorization header', async () => {
      await request(app.getHttpServer())
        .get('/api/v1/me/permissions')
        .expect(401);

      // Body should mention missing token
      const res2 = await request(app.getHttpServer())
        .get('/api/v1/me/permissions');
      expect(res2.body.message).toMatch(/Missing Bearer token/i);
    });

    it('returns 401 with malformed Authorization header', async () => {
      await request(app.getHttpServer())
        .get('/api/v1/me/permissions')
        .set('Authorization', 'NotBearer abc')
        .expect(401);
    });

    it('returns 401 with invalid token', async () => {
      await request(app.getHttpServer())
        .get('/api/v1/me/permissions')
        .set('Authorization', 'Bearer invalid.jwt.token')
        .expect(401);
    });

    it('returns user + role + permissionCodes for valid token (budi HRD)', async () => {
      // Get dev token for budi (default role HRD)
      const tokenRes = await request(app.getHttpServer())
        .post('/dev/token')
        .send({ username: 'budi_santoso' })
        .expect(200);
      const accessToken = tokenRes.body.accessToken;

      // Call /me/permissions
      const res = await request(app.getHttpServer())
        .get('/api/v1/me/permissions')
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data.user.username).toBe('budi_santoso');
      expect(res.body.data.user.isSuperAdmin).toBe(false);
      expect(res.body.data.role.name).toBe('HRD');
      expect(res.body.data.permissionCodes).toEqual(
        expect.arrayContaining(['dashboard', 'payment.read']),
      );
      expect(res.body.data.permissionCodes).toHaveLength(2);
    });

    it('returns all 5 codes for superadmin', async () => {
      const tokenRes = await request(app.getHttpServer())
        .post('/dev/token')
        .send({ username: 'superadmin' })
        .expect(200);

      const res = await request(app.getHttpServer())
        .get('/api/v1/me/permissions')
        .set('Authorization', `Bearer ${tokenRes.body.accessToken}`)
        .expect(200);

      expect(res.body.data.role.name).toBe('Super Admin');
      expect(res.body.data.permissionCodes).toHaveLength(5);
      expect(res.body.data.permissionCodes).toEqual(
        expect.arrayContaining([
          'dashboard',
          'payment.read',
          'payment.write',
          'payment.retry',
          'payment.admin',
        ]),
      );
    });
  });

  describe('POST /api/v1/auth/switch-role', () => {
    it('switches budi HRD → Finance + returns new tokens', async () => {
      // Get dev token for budi (default HRD)
      const tokenRes = await request(app.getHttpServer())
        .post('/dev/token')
        .send({ username: 'budi_santoso' })
        .expect(200);
      const accessToken = tokenRes.body.accessToken;

      // Switch to Finance
      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/switch-role')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ roleId: '00000000-0000-1000-8000-000000000103' })
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data.role.name).toBe('Finance');
      expect(res.body.data.accessToken).toMatch(/^eyJ/);
      expect(res.body.data.refreshToken).toMatch(/^eyJ/);
      // New access token != old
      expect(res.body.data.accessToken).not.toBe(accessToken);
    });

    it('returns 400 when role does not belong to user', async () => {
      const tokenRes = await request(app.getHttpServer())
        .post('/dev/token')
        .send({ username: 'budi_santoso' })
        .expect(200);

      // Super Admin role does not belong to budi
      await request(app.getHttpServer())
        .post('/api/v1/auth/switch-role')
        .set('Authorization', `Bearer ${tokenRes.body.accessToken}`)
        .send({ roleId: '00000000-0000-1000-8000-000000000101' })
        .expect(400);
    });

    it('returns 401 without Authorization', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/auth/switch-role')
        .send({ roleId: '00000000-0000-1000-8000-000000000103' })
        .expect(401);
    });

    it('returns 400 with missing roleId', async () => {
      const tokenRes = await request(app.getHttpServer())
        .post('/dev/token')
        .send({ username: 'budi_santoso' })
        .expect(200);

      await request(app.getHttpServer())
        .post('/api/v1/auth/switch-role')
        .set('Authorization', `Bearer ${tokenRes.body.accessToken}`)
        .send({})
        .expect(400);
    });

    it('roundtrip: switch role → new token works on /me/permissions', async () => {
      // Start as budi HRD
      const hrToken = (await request(app.getHttpServer())
        .post('/dev/token')
        .send({ username: 'budi_santoso' })
        .expect(200)).body.accessToken;

      // Verify HRD has 2 codes
      const hrPerms = (await request(app.getHttpServer())
        .get('/api/v1/me/permissions')
        .set('Authorization', `Bearer ${hrToken}`)
        .expect(200)).body;
      expect(hrPerms.data.permissionCodes).toHaveLength(2);

      // Switch to Finance
      const switchRes = await request(app.getHttpServer())
        .post('/api/v1/auth/switch-role')
        .set('Authorization', `Bearer ${hrToken}`)
        .send({ roleId: '00000000-0000-1000-8000-000000000103' })
        .expect(200);
      const financeToken = switchRes.body.data.accessToken;

      // Verify Finance has 4 codes
      const finPerms = (await request(app.getHttpServer())
        .get('/api/v1/me/permissions')
        .set('Authorization', `Bearer ${financeToken}`)
        .expect(200)).body;
      expect(finPerms.data.permissionCodes).toHaveLength(4);
      expect(finPerms.data.role.name).toBe('Finance');
    });
  });

  describe('NODE_ENV=production guards /dev/token', () => {
    let originalNodeEnv: string | undefined;

    beforeEach(() => {
      originalNodeEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'production';
    });

    afterEach(() => {
      process.env.NODE_ENV = originalNodeEnv;
    });

    it('returns 403 when NODE_ENV=production', async () => {
      await request(app.getHttpServer())
        .post('/dev/token')
        .send({ username: 'superadmin' })
        .expect(403);
    });
  });
});
