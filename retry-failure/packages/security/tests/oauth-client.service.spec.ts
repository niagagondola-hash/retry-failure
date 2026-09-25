/**
 * OAuthClientService — unit tests with mocked openid-client + axios.
 *
 * Verifies:
 *  - getAuthorizationUrl → URL contains code_challenge + state + S256 method
 *  - exchangeCode success + PKCE mismatch error wrapping
 *  - refresh success + OPError wrapping
 *  - revoke success
 *  - switchRole proxy
 *  - fetchPermissions success + 401 wrapping
 *  - Discovery failure wrapping
 *
 * Plan reference: AUTH-09 acceptance criteria.
 */
import axios from 'axios';

import { OAuthClientService } from '../src/oauth/oauth-client.service';
import { SECURITY_OPTIONS } from '../src/oauth/oauth-client.service';
import type { SecurityOptions } from '../src/security.module';

const baseOptions: SecurityOptions = {
  authMode: 'oauth',
  sessionStore: 'memory',
  authBaseUrl: 'http://localhost:4001',
  authIssuer: 'http://localhost:4001',
  oauthClientId: 'payment-api',
  oauthClientSecret: 'dev-client-secret',
  oauthRedirectUri: 'http://localhost:3001/auth/callback',
  oauthScopes: 'openid profile',
};

// Mock axios.create → return a mock instance with get/post methods.
jest.mock('axios', () => {
  const mockAxiosInstance = {
    get: jest.fn(),
    post: jest.fn(),
  };
  return {
    __esModule: true,
    default: {
      create: jest.fn(() => mockAxiosInstance),
    },
    AxiosError: class AxiosError extends Error {
      status?: number;
      response?: { status: number; data?: unknown };
      constructor(message: string, status?: number, data?: unknown) {
        super(message);
        this.status = status;
        this.response = status !== undefined ? { status, data } : undefined;
      }
    },
  };
});

// Mock openid-client. The mock factory creates a fake Issuer + Client with
// jest.fn() methods that each test can configure per-case.
const mockClient = {
  authorizationUrl: jest.fn(),
  callback: jest.fn(),
  refresh: jest.fn(),
  revoke: jest.fn(),
};

const mockIssuer = {
  Client: jest.fn(() => mockClient),
  metadata: { issuer: 'http://localhost:4001' },
};

jest.mock('openid-client', () => {
  return {
    __esModule: true,
    Issuer: {
      discover: jest.fn(() => Promise.resolve(mockIssuer)),
    },
    errors: {
      OPError: class OPError extends Error {
        error?: string;
        error_description?: string;
        response?: { statusCode?: number };
        constructor(
          params: { error: string; error_description?: string },
          response?: { statusCode?: number },
        ) {
          super(params.error_description ?? params.error);
          this.error = params.error;
          this.error_description = params.error_description;
          this.response = response;
        }
      },
      RPError: class RPError extends Error {
        response?: { statusCode?: number };
        constructor(message: string, response?: { statusCode?: number }) {
          super(message);
          this.response = response;
        }
      },
    },
  };
});

const openidClient = require('openid-client') as {
  Issuer: { discover: jest.Mock };
  errors: {
    OPError: new (
      params: { error: string; error_description?: string },
      response?: { statusCode?: number },
    ) => Error;
    RPError: new (message: string, response?: { statusCode?: number }) => Error;
  };
};

function makeService(opts: Partial<SecurityOptions> = {}): OAuthClientService {
  return new OAuthClientService({ ...baseOptions, ...opts });
}

describe('OAuthClientService', () => {
  let service: OAuthClientService;
  let httpClient: {
    get: jest.Mock;
    post: jest.Mock;
  };

  beforeEach(() => {
    jest.clearAllMocks();
    service = makeService();
    httpClient = (axios.create as jest.Mock)();
  });

  describe('getAuthorizationUrl', () => {
    it('returns URL with state + S256 code_challenge + redirect_uri + scope', async () => {
      const fakeUrl =
        'http://localhost:4001/oauth/authorize?response_type=code&client_id=payment-api&state=abc&code_challenge=xyz&code_challenge_method=S256';
      mockClient.authorizationUrl.mockReturnValue(fakeUrl);

      const result = await service.getAuthorizationUrl('state-123');

      expect(mockClient.authorizationUrl).toHaveBeenCalledWith(
        expect.objectContaining({
          redirect_uri: 'http://localhost:3001/auth/callback',
          scope: 'openid profile',
          state: 'state-123',
          code_challenge_method: 'S256',
        }),
      );
      expect(result.url).toContain('code_challenge_method=S256');
      expect(result.state).toEqual('state-123');
      expect(result.codeVerifier).toHaveLength(64);
      expect(result.codeChallenge).toMatch(/^[A-Za-z0-9_-]+$/);
    });

    it('wraps discovery failures into OAuthClientError(discovery_failed)', async () => {
      openidClient.Issuer.discover.mockRejectedValueOnce(new Error('network down'));
      await expect(service.getAuthorizationUrl('s')).rejects.toMatchObject({
        name: 'OAuthClientError',
        code: 'discovery_failed',
      });
    });

    it('throws config_missing when authIssuer is not set', async () => {
      const svc = makeService({ authIssuer: undefined });
      await expect(svc.getAuthorizationUrl('s')).rejects.toMatchObject({
        code: 'config_missing',
      });
    });

    it('throws config_missing when client_id/secret/redirect is unset', async () => {
      const svc = makeService({ oauthClientId: undefined });
      await expect(svc.getAuthorizationUrl('s')).rejects.toMatchObject({
        code: 'config_missing',
      });
    });
  });

  describe('exchangeCode', () => {
    it('returns normalized TokenSet on success', async () => {
      const now = Math.floor(Date.now() / 1000);
      mockClient.callback.mockResolvedValue({
        access_token: 'access-1',
        refresh_token: 'refresh-1',
        expires_at: now + 900,
        token_type: 'Bearer',
        scope: 'openid profile',
      });

      const ts = await service.exchangeCode('code-1', 'verifier-1');

      expect(mockClient.callback).toHaveBeenCalledWith(
        'http://localhost:3001/auth/callback',
        { code: 'code-1' },
        { code_verifier: 'verifier-1' },
      );
      expect(ts.accessToken).toEqual('access-1');
      expect(ts.refreshToken).toEqual('refresh-1');
      expect(ts.tokenType).toEqual('Bearer');
      expect(ts.expiresAt).toEqual(now + 900);
    });

    it('wraps OPError (e.g. invalid_grant) into OAuthClientError', async () => {
      type OPErrorCtor = new (
        params: { error: string; error_description?: string },
        response?: { statusCode?: number },
      ) => Error & { error: string; error_description?: string; response?: { statusCode?: number } };
      const OPError = openidClient.errors.OPError as OPErrorCtor;
      const opErr = new OPError(
        { error: 'invalid_grant', error_description: 'PKCE mismatch' },
        { statusCode: 400 },
      );
      mockClient.callback.mockRejectedValue(opErr);

      await expect(service.exchangeCode('c', 'v')).rejects.toMatchObject({
        name: 'OAuthClientError',
        code: 'invalid_grant',
        status: 400,
      });
    });

    it('wraps RPError into OAuthClientError(rp_error)', async () => {
      type RPErrorCtor = new (message: string, response?: { statusCode?: number }) => Error;
      const RPError = openidClient.errors.RPError as RPErrorCtor;
      mockClient.callback.mockRejectedValue(new RPError('parse failed'));
      await expect(service.exchangeCode('c', 'v')).rejects.toMatchObject({
        code: 'rp_error',
      });
    });
  });

  describe('refresh', () => {
    it('returns new TokenSet (rotation)', async () => {
      const now = Math.floor(Date.now() / 1000);
      mockClient.refresh.mockResolvedValue({
        access_token: 'access-2',
        refresh_token: 'refresh-2',
        expires_at: now + 900,
        token_type: 'Bearer',
      });
      const ts = await service.refresh('refresh-1');
      expect(mockClient.refresh).toHaveBeenCalledWith('refresh-1');
      expect(ts.accessToken).toEqual('access-2');
      expect(ts.refreshToken).toEqual('refresh-2');
    });

    it('wraps OPError on reuse (auth detects rotation violation)', async () => {
      type OPErrorCtor = new (
        params: { error: string; error_description?: string },
        response?: { statusCode?: number },
      ) => Error;
      const OPError = openidClient.errors.OPError as OPErrorCtor;
      const opErr = new OPError(
        { error: 'invalid_grant', error_description: 'refresh token reused' },
        { statusCode: 400 },
      );
      mockClient.refresh.mockRejectedValue(opErr);
      await expect(service.refresh('stale')).rejects.toMatchObject({
        code: 'invalid_grant',
      });
    });
  });

  describe('revoke', () => {
    it('resolves void on success', async () => {
      mockClient.revoke.mockResolvedValue(undefined);
      await expect(service.revoke('token-1')).resolves.toBeUndefined();
      expect(mockClient.revoke).toHaveBeenCalledWith('token-1', undefined);
    });

    it('passes token_type_hint', async () => {
      mockClient.revoke.mockResolvedValue(undefined);
      await service.revoke('token-1', 'refresh_token');
      expect(mockClient.revoke).toHaveBeenCalledWith('token-1', 'refresh_token');
    });

    it('wraps revoke errors into OAuthClientError', async () => {
      mockClient.revoke.mockRejectedValue(new Error('network'));
      await expect(service.revoke('t')).rejects.toMatchObject({
        code: 'unknown',
      });
    });
  });

  describe('switchRole', () => {
    it('returns new tokens + role on success', async () => {
      const role = { id: 'role-2', name: 'Admin' };
      httpClient.post.mockResolvedValue({
        data: {
          data: {
            accessToken: 'new-access',
            refreshToken: 'new-refresh',
            role,
          },
        },
      });
      const result = await service.switchRole('access-1', 'role-2');
      expect(httpClient.post).toHaveBeenCalledWith(
        '/api/v1/auth/switch-role',
        { roleId: 'role-2' },
        { headers: { Authorization: 'Bearer access-1' } },
      );
      expect(result.accessToken).toEqual('new-access');
      expect(result.role).toEqual(role);
    });

    it('throws on missing accessToken in response', async () => {
      httpClient.post.mockResolvedValue({ data: { data: {} } });
      await expect(service.switchRole('a', 'r')).rejects.toMatchObject({
        code: 'invalid_response',
      });
    });

    it('wraps 403 (role not assigned) into OAuthClientError', async () => {
      type AxiosErrorCtor = new (
        message: string,
        status: number,
        data: unknown,
      ) => Error & { status: number; response: { status: number; data?: unknown } };
      const AxiosErrorCtor = (require('axios') as { AxiosError: AxiosErrorCtor }).AxiosError;
      const err = new AxiosErrorCtor('Forbidden', 403, {
        error: 'role_not_assigned',
        error_description: 'User does not have role',
      });
      httpClient.post.mockRejectedValue(err);
      await expect(service.switchRole('a', 'r')).rejects.toMatchObject({
        code: 'role_not_assigned',
        status: 403,
      });
    });
  });

  describe('fetchPermissions', () => {
    it('returns user + role + permissionCodes on success', async () => {
      const payload = {
        data: {
          user: { id: 'u-1', username: 'budi', name: 'Budi', isSuperAdmin: false },
          role: { id: 'r-1', name: 'Operator' },
          permissionCodes: ['payment.read'],
        },
      };
      httpClient.get.mockResolvedValue({ data: payload });
      const result = await service.fetchPermissions('access-1');
      expect(httpClient.get).toHaveBeenCalledWith('/api/v1/me/permissions', {
        headers: { Authorization: 'Bearer access-1' },
      });
      expect(result.user.username).toEqual('budi');
      expect(result.role.name).toEqual('Operator');
      expect(result.permissionCodes).toEqual(['payment.read']);
    });

    it('throws invalid_response when shape is wrong', async () => {
      httpClient.get.mockResolvedValue({ data: { data: { user: {} } } });
      await expect(service.fetchPermissions('a')).rejects.toMatchObject({
        code: 'invalid_response',
      });
    });

    it('wraps 401 into OAuthClientError with status', async () => {
      type AxiosErrorCtor = new (
        message: string,
        status: number,
        data: unknown,
      ) => Error & { status: number; response: { status: number; data?: unknown } };
      const AxiosErrorCtor = (require('axios') as { AxiosError: AxiosErrorCtor }).AxiosError;
      httpClient.get.mockRejectedValue(
        new AxiosErrorCtor('Unauthorized', 401, {
          error: 'invalid_token',
          error_description: 'access token expired',
        }),
      );
      await expect(service.fetchPermissions('a')).rejects.toMatchObject({
        code: 'invalid_token',
        status: 401,
      });
    });
  });

  describe('DI token', () => {
    it('exports SECURITY_OPTIONS string token', () => {
      expect(SECURITY_OPTIONS).toEqual('SECURITY_OPTIONS');
    });
  });
});
