/**
 * ContractRunner — generic HTTP runner that drives an auth service
 * (auth-mock or auth asli) through the contract surface.
 *
 * Plan reference: PLAN2 Section 17.5, Section 25.7, AUTH-27 task spec §4.2.
 *
 * Design:
 *   - Stateless per-instance — caller creates one runner per target
 *     (auth-mock vs auth asli staging).
 *   - `validateStatus: () => true` so axios never throws on 4xx/5xx —
 *     the test inspects `status` + `body` directly.
 *   - Token acquisition uses `/dev/token` shortcut for auth-mock
 *     (plan2 §9.3.2). Real auth requires the full OAuth2 flow — caller
 *     must override by passing a pre-acquired token via `setTokens`.
 *   - No external deps beyond axios (already installed in payment-api).
 *
 * Coding standards: SOLID-S (this class only orchestrates HTTP), DRY
 * (all axios requests go through `request()`), JSDoc on public methods
 * per CODING_STANDARDS.md §Comments.
 */
import axios, {
  AxiosInstance,
  AxiosRequestConfig,
  AxiosResponse,
  Method,
} from 'axios';

/** Configuration for a ContractRunner instance. */
export interface ContractRunnerConfig {
  /** Base URL of the auth service under test. */
  baseUrl: string;
  /** OAuth client_id (default `payment-api` per AUTH_CONTRACT §10). */
  clientId: string;
  /** OAuth client_secret (not required for auth-mock, required for auth asli). */
  clientSecret: string;
  /** OAuth redirect_uri registered with the auth service. */
  redirectUri: string;
  /** Test user credentials — fixture user for auth-mock, real user for auth asli. */
  testUser: {
    username: string;
    password: string;
  };
  /** Per-request timeout in ms (default 10000). */
  timeoutMs?: number;
}

/** Token pair returned by `/dev/token` or full OAuth flow. */
export interface TokenPair {
  accessToken: string;
  refreshToken: string;
  /** OIDC id_token — may be empty string for non-OIDC auth. */
  idToken?: string;
}

/** Normalized HTTP response — what every runner method returns. */
export interface HttpResponse<T = unknown> {
  status: number;
  body: T;
  headers: Record<string, string>;
}

/**
 * ContractRunner — drives HTTP requests against an auth service.
 *
 * Instantiate once per target:
 * ```ts
 * const runner = new ContractRunner({
 *   baseUrl: 'http://localhost:4001',
 *   clientId: 'payment-api',
 *   clientSecret: '',
 *   redirectUri: 'http://localhost:3000/auth/callback',
 *   testUser: { username: 'budi_santoso', password: 'ChangeMe_123!' },
 * });
 * ```
 */
export class ContractRunner {
  private readonly client: AxiosInstance;
  private tokens: TokenPair | null = null;

  constructor(private readonly config: ContractRunnerConfig) {
    this.client = axios.create({
      baseURL: config.baseUrl,
      timeout: config.timeoutMs ?? 10000,
      // Never throw on HTTP error status — tests inspect status + body.
      validateStatus: () => true,
      // Don't auto-follow redirects — tests inspect 302 + Location header.
      maxRedirects: 0,
    });
  }

  /** Read-only access to the config (for tests that need baseUrl etc.). */
  getConfig(): Readonly<ContractRunnerConfig> {
    return this.config;
  }

  /** Override the cached tokens (used when caller does full OAuth flow externally). */
  setTokens(tokens: TokenPair): void {
    this.tokens = tokens;
  }

  /** Read currently cached tokens (null if not yet acquired). */
  getTokens(): TokenPair | null {
    return this.tokens;
  }

  /**
   * Acquire access + refresh tokens via `/dev/token` shortcut.
   *
   * Only auth-mock implements `/dev/token` (plan2 §9.3.2). For auth asli,
   * caller must do the full OAuth2 dance and inject via `setTokens()`.
   *
   * @returns Token pair (access + refresh)
   * @throws Error if `/dev/token` returns non-200 status
   */
  async acquireTokens(): Promise<TokenPair> {
    const res = await this.post<{
      accessToken: string;
      refreshToken: string;
      idToken?: string;
    }>('/dev/token', {
      username: this.config.testUser.username,
      password: this.config.testUser.password,
    });
    if (res.status !== 200) {
      throw new Error(
        `acquireTokens: /dev/token returned ${res.status}: ${JSON.stringify(res.body)}`,
      );
    }
    const tokens: TokenPair = {
      accessToken: res.body.accessToken,
      refreshToken: res.body.refreshToken,
      idToken: res.body.idToken,
    };
    this.tokens = tokens;
    return tokens;
  }

  /**
   * GET `/.well-known/jwks.json` — JWKS endpoint (AUTH_CONTRACT §5).
   *
   * Returns the raw response — caller asserts shape.
   */
  async getJwks(): Promise<HttpResponse<JwksResponse>> {
    return this.get<JwksResponse>('/.well-known/jwks.json');
  }

  /**
   * GET `/.well-known/openid-configuration` — OIDC discovery endpoint.
   *
   * Returns the raw response — caller asserts shape.
   */
  async getDiscovery(): Promise<HttpResponse<Record<string, unknown>>> {
    return this.get<Record<string, unknown>>(
      '/.well-known/openid-configuration',
    );
  }

  /**
   * GET `/api/v1/me/permissions` with a Bearer token (AUTH_CONTRACT §3 + §6).
   *
   * @param accessToken - JWT access token. If omitted, uses cached tokens.
   * @throws Error if no token available (not acquired + not set).
   */
  async getPermissions(
    accessToken?: string,
  ): Promise<HttpResponse<PermissionsResponse>> {
    const token = accessToken ?? this.tokens?.accessToken;
    if (!token) {
      throw new Error(
        'getPermissions: no access token — call acquireTokens() or setTokens() first',
      );
    }
    return this.get<PermissionsResponse>('/api/v1/me/permissions', {
      headers: { Authorization: `Bearer ${token}` },
    });
  }

  /**
   * POST `/api/v1/auth/switch-role` with a Bearer token + target role.
   *
   * @param roleId - Target role UUID.
   * @param accessToken - Optional override (defaults to cached access token).
   */
  async switchRole(
    roleId: string,
    accessToken?: string,
  ): Promise<HttpResponse<unknown>> {
    const token = accessToken ?? this.tokens?.accessToken;
    if (!token) {
      throw new Error(
        'switchRole: no access token — call acquireTokens() or setTokens() first',
      );
    }
    return this.post('/api/v1/auth/switch-role', { roleId }, {
      headers: { Authorization: `Bearer ${token}` },
    });
  }

  /**
   * POST `/oauth/token` with arbitrary body — used for error format tests.
   *
   * Caller controls the body so they can trigger 400 (missing fields),
   * 401 (invalid client), etc.
   */
  async postTokenEndpoint(
    body: Record<string, unknown>,
  ): Promise<HttpResponse<unknown>> {
    return this.post('/oauth/token', body);
  }

  /**
   * GET `/oauth/authorize` with query params — used for endpoint-paths test.
   *
   * `maxRedirects: 0` set at instance level so 302 is returned (not followed).
   */
  async getAuthorize(
    params: Record<string, string>,
  ): Promise<HttpResponse<unknown>> {
    return this.get('/oauth/authorize', { params });
  }

  /**
   * POST `/oauth/revoke` — used for endpoint-paths test (just verifies the
   * route exists, response status doesn't matter).
   */
  async postRevoke(
    body: Record<string, unknown>,
  ): Promise<HttpResponse<unknown>> {
    return this.post('/oauth/revoke', body);
  }

  // ----- Internal helpers --------------------------------------------------

  /**
   * Issue a GET request via the configured axios instance.
   * Returns normalized response — never throws on HTTP error status.
   */
  private async get<T>(
    url: string,
    config?: AxiosRequestConfig,
  ): Promise<HttpResponse<T>> {
    const res = await this.client.request<T>({
      method: 'get' as Method,
      url,
      ...config,
    });
    return this.normalize(res);
  }

  /**
   * Issue a POST request via the configured axios instance.
   * Returns normalized response — never throws on HTTP error status.
   */
  private async post<T>(
    url: string,
    body: unknown,
    config?: AxiosRequestConfig,
  ): Promise<HttpResponse<T>> {
    const res = await this.client.request<T>({
      method: 'post' as Method,
      url,
      data: body,
      ...config,
    });
    return this.normalize(res);
  }

  /** Convert AxiosResponse to normalized HttpResponse shape. */
  private normalize<T>(res: AxiosResponse<T>): HttpResponse<T> {
    return {
      status: res.status,
      body: res.data,
      headers: res.headers as Record<string, string>,
    };
  }
}

/** Expected JWKS response shape (AUTH_CONTRACT §5). */
export interface JwksResponse {
  keys: JwkKey[];
}

/** Individual JWK in the JWKS set. */
export interface JwkKey {
  kty: string;
  use: string;
  alg: string;
  kid: string;
  n: string;
  e: string;
}

/** Expected /api/v1/me/permissions response shape (AUTH_CONTRACT §6). */
export interface PermissionsResponse {
  success: boolean;
  data: {
    user: {
      id: string;
      username: string;
      email: string | null;
      name: string;
      isSuperAdmin: boolean;
    };
    role: { id: string; name: string };
    permissionCodes: string[];
  };
}
