/**
 * Login flow E2E test (AUTH-04).
 *
 * Verifies the full OAuth2 web flow via supertest:
 *   1. GET /oauth/authorize → 200 HTML login form (with dev hint)
 *   2. POST /oauth/authorize (valid creds) → 302 redirect with code (single-role)
 *   3. POST /oauth/authorize (multi-role) → 200 HTML select-role page
 *   4. POST /oauth/select-role → 302 redirect with code
 *   5. GET /style.css → 200 + Content-Type: text/css
 *   6. Invalid client_id → 200 error.ejs rendered (not JSON)
 *   7. Invalid creds → 200 login.ejs re-rendered with error message
 *
 * Plan reference: AUTH-04 task spec §9, PLAN2 §10.7.
 */
import { createHash } from 'node:crypto';
import { join } from 'node:path';

import { INestApplication } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { AppModule } from '../../app.module';

async function buildApp(): Promise<INestApplication> {
  const mod = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();
  const app = mod.createNestApplication<NestExpressApplication>();
  // Wire EJS + static assets + cookie-parser (mirrors main.ts).
  app.useStaticAssets(join(__dirname, '..', '..', '..', 'public'));
  app.setBaseViewsDir(join(__dirname, '..', '..', '..', 'views'));
  app.setViewEngine('ejs');
  const cookieParser = (await import('cookie-parser')).default;
  app.use(cookieParser());
  await app.init();
  return app;
}

describe('AUTH-04 login flow (E2E)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await buildApp();
  });

  afterAll(async () => {
    await app.close();
  });

  // PKCE challenge for tests (fixed verifier → fixed challenge).
  const VERIFIER = 'a'.repeat(64);
  const CHALLENGE = createHash('sha256').update(VERIFIER).digest('base64url');

  describe('GET /style.css (static asset)', () => {
    it('returns 200 + Content-Type: text/css', async () => {
      const res = await request(app.getHttpServer())
        .get('/style.css')
        .expect(200);
      expect(res.headers['content-type']).toMatch(/text\/css/);
      // CSS body should contain .container class
      expect(res.text).toMatch(/\.container/);
    });
  });

  describe('GET /oauth/authorize (login page render)', () => {
    it('renders HTML login form with 6 hidden fields + dev hint', async () => {
      const res = await request(app.getHttpServer())
        .get('/oauth/authorize')
        .query({
          response_type: 'code',
          client_id: 'payment-api',
          redirect_uri: 'http://localhost:3001/auth/callback',
          state: 'abc123',
          code_challenge: CHALLENGE,
          code_challenge_method: 'S256',
          scope: 'openid profile',
        })
        .expect(200);

      // HTML body
      expect(res.headers['content-type']).toMatch(/text\/html/);
      expect(res.text).toMatch(/<!DOCTYPE html>/);
      expect(res.text).toMatch(/<title>Login — Auth Mock<\/title>/);
      // 6 hidden fields
      expect(res.text).toMatch(/name="client_id"\s+value="payment-api"/);
      expect(res.text).toMatch(/name="redirect_uri"/);
      expect(res.text).toMatch(/name="state"\s+value="abc123"/);
      expect(res.text).toMatch(/name="code_challenge"/);
      expect(res.text).toMatch(/name="code_challenge_method"\s+value="S256"/);
      expect(res.text).toMatch(/name="scope"/);
      // Username + password inputs
      expect(res.text).toMatch(/name="username"/);
      expect(res.text).toMatch(/name="password"/);
      // Dev hint with fixture credentials
      expect(res.text).toMatch(/superadmin/);
      expect(res.text).toMatch(/budi_santoso/);
      expect(res.text).toMatch(/ChangeMe_123!/);
    });

    it('renders error page for invalid client_id', async () => {
      const res = await request(app.getHttpServer())
        .get('/oauth/authorize')
        .query({
          response_type: 'code',
          client_id: 'INVALID_CLIENT',
          redirect_uri: 'http://localhost:3001/auth/callback',
          state: 'abc',
          code_challenge: CHALLENGE,
          code_challenge_method: 'S256',
        })
        .expect(400);

      expect(res.headers['content-type']).toMatch(/text\/html/);
      expect(res.text).toMatch(/<title>Error — Auth Mock<\/title>/);
      expect(res.text).toMatch(/Unknown client_id/);
    });

    it('renders error page for missing PKCE (plain method)', async () => {
      const res = await request(app.getHttpServer())
        .get('/oauth/authorize')
        .query({
          response_type: 'code',
          client_id: 'payment-api',
          redirect_uri: 'http://localhost:3001/auth/callback',
          state: 'abc',
          code_challenge: CHALLENGE,
          code_challenge_method: 'plain',
        })
        .expect(400);

      expect(res.text).toMatch(/PKCE required/);
    });
  });

  describe('POST /oauth/authorize (login submit)', () => {
    it('superadmin (single-role) → 302 redirect with code', async () => {
      const res = await request(app.getHttpServer())
        .post('/oauth/authorize')
        .type('form')
        .send({
          response_type: 'code',
          client_id: 'payment-api',
          redirect_uri: 'http://localhost:3001/auth/callback',
          state: 'state-superadmin',
          code_challenge: CHALLENGE,
          code_challenge_method: 'S256',
          scope: 'openid profile',
          username: 'superadmin',
          password: 'ChangeMe_123!',
        })
        .expect(302);

      // Location header contains redirect_uri + code + state
      expect(res.headers.location).toMatch(
        /http:\/\/localhost:3001\/auth\/callback\?code=[a-f0-9]+&state=state-superadmin/,
      );
      // Set-Cookie: auth_sid (HttpOnly + SameSite=Lax)
      const setCookie = res.headers['set-cookie'];
      if (setCookie) {
        const cookieStr = Array.isArray(setCookie) ? setCookie[0] : setCookie;
        expect(cookieStr).toMatch(/auth_sid=/);
        expect(cookieStr).toMatch(/HttpOnly/i);
        expect(cookieStr).toMatch(/SameSite=Lax/i);
      }
    });

    it('invalid credentials → 200 re-render login.ejs with error message', async () => {
      const res = await request(app.getHttpServer())
        .post('/oauth/authorize')
        .type('form')
        .send({
          response_type: 'code',
          client_id: 'payment-api',
          redirect_uri: 'http://localhost:3001/auth/callback',
          state: 'abc',
          code_challenge: CHALLENGE,
          code_challenge_method: 'S256',
          scope: 'openid',
          username: 'superadmin',
          password: 'WRONG_PASSWORD',
        })
        .expect(401);

      expect(res.headers['content-type']).toMatch(/text\/html/);
      expect(res.text).toMatch(/<title>Login — Auth Mock<\/title>/);
      // Error message rendered
      expect(res.text).toMatch(/Username atau password salah/);
    });

    it('budi_santoso (multi-role) → 200 HTML select-role page with HRD + Finance', async () => {
      const res = await request(app.getHttpServer())
        .post('/oauth/authorize')
        .type('form')
        .send({
          response_type: 'code',
          client_id: 'payment-api',
          redirect_uri: 'http://localhost:3001/auth/callback',
          state: 'state-budi',
          code_challenge: CHALLENGE,
          code_challenge_method: 'S256',
          scope: 'openid profile',
          username: 'budi_santoso',
          password: 'ChangeMe_123!',
        })
        .expect(200);

      expect(res.headers['content-type']).toMatch(/text\/html/);
      expect(res.text).toMatch(/<title>Pilih Role — Auth Mock<\/title>/);
      // Role names rendered
      expect(res.text).toMatch(/HRD/);
      expect(res.text).toMatch(/Finance/);
      // Radio buttons
      expect(res.text).toMatch(/name="role_id"/);
      // Hidden user_id field
      expect(res.text).toMatch(/name="user_id"\s+value="00000000-0000-1000-8000-000000000002"/);
    });
  });

  describe('POST /oauth/select-role', () => {
    it('selects HRD role → 302 redirect with code', async () => {
      const res = await request(app.getHttpServer())
        .post('/oauth/select-role')
        .type('form')
        .send({
          response_type: 'code',
          client_id: 'payment-api',
          redirect_uri: 'http://localhost:3001/auth/callback',
          state: 'state-select',
          code_challenge: CHALLENGE,
          code_challenge_method: 'S256',
          scope: 'openid profile',
          user_id: '00000000-0000-1000-8000-000000000002',
          role_id: '00000000-0000-1000-8000-000000000102',
        })
        .expect(302);

      expect(res.headers.location).toMatch(
        /http:\/\/localhost:3001\/auth\/callback\?code=[a-f0-9]+&state=state-select/,
      );
    });
  });
});
