/**
 * OAuthController — `/oauth/authorize` + `/oauth/select-role` (AUTH-03).
 *
 * Plan reference: PLAN2 Section 4.1 (OAuth2 flow), Section 10.7.3 (controller),
 * Section 10.5 (multi-role flow), AUTH-03 task spec §7.
 *
 * Endpoints:
 *   GET  /oauth/authorize    — validate client + redirect_uri + PKCE; render
 *                              login page (or redirect if already auth'd).
 *   POST /oauth/authorize     — submit username/password; create auth session;
 *                              issue code (single-role) or render select-role.
 *   POST /oauth/select-role  — pick role from multi-role user; issue code + redirect.
 *
 * Login UI (EJS templates) is built in AUTH-04. For now GET returns a JSON
 * placeholder + POST redirects with `code` — sufficient to unblock payment-api
 * AUTH-17 integration tests.
 */
import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Logger,
  Post,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import type { Request, Response } from 'express';

import { OAuthService } from './oauth.service';
import { ClientService } from '../client/client.service';
import { UserService } from '../user/user.service';
import {
  AuthorizeQueryDto,
  AuthorizeSubmitDto,
  SelectRoleDto,
} from './dto';

@Controller('oauth')
export class OAuthController {
  private readonly logger = new Logger('OAuthController');

  constructor(
    private readonly oauth: OAuthService,
    private readonly clients: ClientService,
    private readonly users: UserService,
  ) {}

  // ----- Step 1: GET /oauth/authorize --------------------------------

  /**
   * Validate client_id, redirect_uri, PKCE. If the user is already auth'd
   * (auth_sid cookie), short-circuit to code issuance (or select-role).
   * Otherwise render the login page (placeholder JSON until AUTH-04 ships
   * the EJS templates).
   */
  @Get('authorize')
  async authorize(
    @Query() query: AuthorizeQueryDto,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    const client = this.clients.findById(query.client_id);
    if (!client) {
      return res.status(HttpStatus.BAD_REQUEST).json({
        error: 'invalid_client',
        error_description: `Unknown client_id: ${query.client_id}`,
      });
    }

    if (!client.redirectUris.includes(query.redirect_uri)) {
      return res.status(HttpStatus.BAD_REQUEST).json({
        error: 'invalid_request',
        error_description: 'redirect_uri not registered for client',
      });
    }

    if (
      !query.code_challenge ||
      query.code_challenge_method !== 'S256'
    ) {
      return res.status(HttpStatus.BAD_REQUEST).json({
        error: 'invalid_request',
        error_description: 'PKCE required (code_challenge_method=S256)',
      });
    }

    // Already-logged-in user? Skip the login page.
    const session = await this.oauth.getAuthSession(req);
    if (session) {
      const user = await this.users.findById(session.userId);
      if (!user) {
        // Session exists but user was deleted — clear cookie, force re-login.
        return res.status(HttpStatus.UNAUTHORIZED).json({
          error: 'invalid_session',
          error_description: 'user no longer exists',
        });
      }
      if (user.roles.length === 1) {
        // Single-role: issue code immediately.
        return this.oauth.issueCodeAndRedirect(res, {
          clientId: query.client_id,
          userId: user.id,
          roleId: user.roles[0].id,
          redirectUri: query.redirect_uri,
          codeChallenge: query.code_challenge,
          codeChallengeMethod: 'S256',
          scope: query.scope ?? '',
          state: query.state,
        });
      }
      // Multi-role: respond with role list so the client can POST /oauth/select-role.
      return res.status(HttpStatus.OK).json({
        status: 'select_role',
        user_id: user.id,
        roles: user.roles.map((r) => ({ id: r.id, name: r.name, description: r.description })),
        // Echo original OAuth params so the FE can re-submit them.
        authorize: {
          client_id: query.client_id,
          redirect_uri: query.redirect_uri,
          state: query.state,
          code_challenge: query.code_challenge,
          code_challenge_method: query.code_challenge_method,
          scope: query.scope ?? '',
        },
      });
    }

    // Not logged in: render login page.
    // AUTH-04 will ship EJS templates. For now, return a JSON placeholder.
    return res.status(HttpStatus.OK).json({
      message:
        'Login page not implemented yet. Use POST /oauth/authorize with username/password.',
      fixtures: [
        { username: 'superadmin', password: 'ChangeMe_123!', note: 'single role, super admin' },
        { username: 'budi_santoso', password: 'ChangeMe_123!', note: 'multi role' },
      ],
      authorize: {
        client_id: query.client_id,
        redirect_uri: query.redirect_uri,
        state: query.state,
        code_challenge: query.code_challenge,
        code_challenge_method: query.code_challenge_method,
        scope: query.scope ?? '',
      },
    });
  }

  // ----- Step 2: POST /oauth/authorize (login submit) ----------------

  /**
   * Submit username + password. Validate via `UserService.validateCredentials`.
   * On success: create `auth_sid` cookie, then either issue code (single-role)
   * or render select-role (multi-role). On failure: 401 + error message.
   */
  @Post('authorize')
  @HttpCode(HttpStatus.OK)
  async submitLogin(
    @Body() body: AuthorizeSubmitDto,
    @Res() res: Response,
  ) {
    const client = this.clients.findById(body.client_id);
    if (!client) {
      return res.status(HttpStatus.BAD_REQUEST).json({
        error: 'invalid_client',
        error_description: `Unknown client_id: ${body.client_id}`,
      });
    }
    if (!client.redirectUris.includes(body.redirect_uri)) {
      return res.status(HttpStatus.BAD_REQUEST).json({
        error: 'invalid_request',
        error_description: 'redirect_uri not registered for client',
      });
    }

    const user = await this.users.validateCredentials(
      body.username,
      body.password,
    );
    if (!user) {
      return res.status(HttpStatus.UNAUTHORIZED).json({
        error: 'invalid_credentials',
        error_description: 'username atau password salah',
      });
    }

    // Create auth_sid cookie (so subsequent /oauth/authorize skips login).
    await this.oauth.createAuthSession(res, user);

    if (user.roles.length === 1) {
      // Single-role: issue code + redirect immediately.
      return this.oauth.issueCodeAndRedirect(res, {
        clientId: body.client_id,
        userId: user.id,
        roleId: user.roles[0].id,
        redirectUri: body.redirect_uri,
        codeChallenge: body.code_challenge,
        codeChallengeMethod: 'S256',
        scope: body.scope ?? '',
        state: body.state,
      });
    }

    // Multi-role: respond with role list so the FE can POST /oauth/select-role.
    return res.status(HttpStatus.OK).json({
      status: 'select_role',
      user_id: user.id,
      roles: user.roles.map((r) => ({ id: r.id, name: r.name, description: r.description })),
      authorize: {
        client_id: body.client_id,
        redirect_uri: body.redirect_uri,
        state: body.state,
        code_challenge: body.code_challenge,
        code_challenge_method: body.code_challenge_method,
        scope: body.scope ?? '',
      },
    });
  }

  // ----- Step 3: POST /oauth/select-role ----------------------------

  /**
   * Multi-role user picked a role. Validate it belongs to the user, then
   * issue the authorization code + redirect to redirect_uri.
   */
  @Post('select-role')
  @HttpCode(HttpStatus.OK)
  async selectRole(
    @Body() body: SelectRoleDto,
    @Res() res: Response,
  ) {
    const client = this.clients.findById(body.client_id);
    if (!client) {
      return res.status(HttpStatus.BAD_REQUEST).json({
        error: 'invalid_client',
        error_description: `Unknown client_id: ${body.client_id}`,
      });
    }
    if (!client.redirectUris.includes(body.redirect_uri)) {
      return res.status(HttpStatus.BAD_REQUEST).json({
        error: 'invalid_request',
        error_description: 'redirect_uri not registered for client',
      });
    }

    const user = await this.users.findById(body.user_id);
    if (!user) {
      return res.status(HttpStatus.BAD_REQUEST).json({
        error: 'invalid_request',
        error_description: 'user not found',
      });
    }

    const role = user.roles.find((r) => r.id === body.role_id);
    if (!role) {
      return res.status(HttpStatus.BAD_REQUEST).json({
        error: 'invalid_request',
        error_description: 'role does not belong to user',
      });
    }

    return this.oauth.issueCodeAndRedirect(res, {
      clientId: body.client_id,
      userId: user.id,
      roleId: role.id,
      redirectUri: body.redirect_uri,
      codeChallenge: body.code_challenge,
      codeChallengeMethod: 'S256',
      scope: body.scope ?? '',
      state: body.state,
    });
  }
}
