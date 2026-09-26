/**
 * DiscoveryController + DiscoveryService unit tests (AUTH-07).
 *
 * Verifies discovery document shape + headers + issuer env handling.
 *
 * Plan reference: AUTH-07 task spec §5.
 */
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { DiscoveryController } from './discovery.controller';
import { DiscoveryService } from './discovery.service';

describe('DiscoveryService', () => {
  let svc: DiscoveryService;

  beforeEach(async () => {
    const mod = await Test.createTestingModule({
      providers: [DiscoveryService],
    }).compile();
    svc = mod.get(DiscoveryService);
  });

  it('builds discovery with default issuer http://localhost:4001', () => {
    const doc = svc.buildDiscovery();
    expect(doc.issuer).toBe('http://localhost:4001');
  });

  it('strips trailing slash from issuer', () => {
    const doc = svc.buildDiscovery('http://localhost:4001/');
    expect(doc.issuer).toBe('http://localhost:4001');
    expect(doc.authorization_endpoint).toBe('http://localhost:4001/oauth/authorize');
    // No double slash
    expect(doc.authorization_endpoint).not.toContain('//oauth');
  });

  it('strips multiple trailing slashes', () => {
    const doc = svc.buildDiscovery('https://auth.example.com///');
    expect(doc.issuer).toBe('https://auth.example.com');
    expect(doc.jwks_uri).toBe('https://auth.example.com/.well-known/jwks.json');
  });

  it('uses custom issuer when provided', () => {
    const doc = svc.buildDiscovery('https://auth.example.com');
    expect(doc.issuer).toBe('https://auth.example.com');
    expect(doc.authorization_endpoint).toBe('https://auth.example.com/oauth/authorize');
    expect(doc.token_endpoint).toBe('https://auth.example.com/oauth/token');
    expect(doc.revocation_endpoint).toBe('https://auth.example.com/oauth/revoke');
    expect(doc.jwks_uri).toBe('https://auth.example.com/.well-known/jwks.json');
  });

  it('all endpoint URLs are absolute (not relative)', () => {
    const doc = svc.buildDiscovery('https://auth.example.com');
    expect(doc.issuer).toMatch(/^https?:\/\//);
    expect(doc.authorization_endpoint).toMatch(/^https?:\/\//);
    expect(doc.token_endpoint).toMatch(/^https?:\/\//);
    expect(doc.revocation_endpoint).toMatch(/^https?:\/\//);
    expect(doc.jwks_uri).toMatch(/^https?:\/\//);
    expect(doc.userinfo_endpoint).toMatch(/^https?:\/\//);
  });

  it('supports only S256 PKCE (not plain)', () => {
    const doc = svc.buildDiscovery();
    expect(doc.code_challenge_methods_supported).toEqual(['S256']);
    expect(doc.code_challenge_methods_supported).not.toContain('plain');
  });

  it('supports authorization_code + refresh_token grant types', () => {
    const doc = svc.buildDiscovery();
    expect(doc.grant_types_supported).toEqual(
      expect.arrayContaining(['authorization_code', 'refresh_token']),
    );
  });

  it('supports only code response_type', () => {
    const doc = svc.buildDiscovery();
    expect(doc.response_types_supported).toEqual(['code']);
  });

  it('supports RS256 signing alg', () => {
    const doc = svc.buildDiscovery();
    expect(doc.id_token_signing_alg_values_supported).toEqual(['RS256']);
  });

  it('claims_supported covers all 8 required claims', () => {
    const doc = svc.buildDiscovery();
    expect(doc.claims_supported).toEqual(
      expect.arrayContaining([
        'sub',
        'username',
        'roleId',
        'iss',
        'aud',
        'exp',
        'iat',
        'jti',
      ]),
    );
  });

  it('scopes_supported has openid + profile + payment.read + payment.write', () => {
    const doc = svc.buildDiscovery();
    expect(doc.scopes_supported).toEqual(
      expect.arrayContaining([
        'openid',
        'profile',
        'payment.read',
        'payment.write',
      ]),
    );
  });

  it('token_endpoint_auth_methods_supported includes post + basic', () => {
    const doc = svc.buildDiscovery();
    expect(doc.token_endpoint_auth_methods_supported).toEqual(
      expect.arrayContaining(['client_secret_post', 'client_secret_basic']),
    );
  });

  it('subject_types_supported is public', () => {
    const doc = svc.buildDiscovery();
    expect(doc.subject_types_supported).toEqual(['public']);
  });

  it('uses AUTH_ISSUER env when set', () => {
    process.env.AUTH_ISSUER = 'https://env.example.com';
    const doc = svc.buildDiscovery();
    expect(doc.issuer).toBe('https://env.example.com');
    delete process.env.AUTH_ISSUER;
  });
});

describe('DiscoveryController (e2e via supertest)', () => {
  let app: INestApplication;

  beforeEach(async () => {
    const mod = await Test.createTestingModule({
      controllers: [DiscoveryController],
      providers: [DiscoveryService],
    }).compile();
    app = mod.createNestApplication();
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  it('GET /.well-known/openid-configuration returns 200 + JSON', async () => {
    const res = await request(app.getHttpServer())
      .get('/.well-known/openid-configuration')
      .expect(200);

    expect(res.body.issuer).toBeDefined();
    expect(res.body.authorization_endpoint).toMatch(/\/oauth\/authorize$/);
    expect(res.body.token_endpoint).toMatch(/\/oauth\/token$/);
    expect(res.body.jwks_uri).toMatch(/\.well-known\/jwks\.json$/);
  });

  it('sets Cache-Control: public, max-age=3600 header', async () => {
    const res = await request(app.getHttpServer())
      .get('/.well-known/openid-configuration')
      .expect(200);
    expect(res.headers['cache-control']).toBe('public, max-age=3600');
  });

  it('sets Content-Type: application/json; charset=utf-8', async () => {
    const res = await request(app.getHttpServer())
      .get('/.well-known/openid-configuration')
      .expect(200);
    expect(res.headers['content-type']).toMatch(/^application\/json; charset=utf-8/i);
  });
});
