/**
 * OAuthController — `/oauth/authorize` + `/oauth/select-role` (AUTH-03 + AUTH-04).
 *
 * Plan reference: PLAN2 Section 4.1 (OAuth2 flow), Section 10.7.3 (controller),
 * Section 10.5 (multi-role flow), Section 10.7.5-7 (EJS templates),
 * CODING_STANDARDS.md §DRY, §SRP.
 *
 * Endpoints:
 *   GET  /oauth/authorize    — validate client + redirect_uri + PKCE; render
 *                              login page (or redirect if already auth'd).
 *   POST /oauth/authorize     — submit username/password; create auth session;
 *                              issue code (single-role) or render select-role.
 *   POST /oauth/select-role  — pick role from multi-role user; issue code + redirect.
 *
 * Login UI (EJS templates) built in AUTH-04:
 *   - views/login.ejs       — login form with 6 hidden OAuth fields + dev hint
 *   - views/select-role.ejs — radio button list of user roles
 *   - views/error.ejs        — generic error page
 *   - public/style.css      — minimal zero-build CSS
 *
 * DRY refactor (CODING_STANDARDS.md):
 *   - validateClient() helper — eliminates client validation duplication in 3 methods
 *   - toRoleDtos() helper     — eliminates role mapping duplication in 2 methods
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

import { ClientService } from '../client/client.service';
import { UserService , MockRole } from '../user/user.service';

import {
  AuthorizeQueryDto,
  AuthorizeSubmitDto,
  SelectRoleDto,
} from './dto';
import { OAuthService } from './oauth.service';

/** Role DTO shape for select-role.ejs template. */
interface RoleDto {
  id: string;
  name: string;
  description?: string;
}

@Controller('oauth')
export class OAuthController {
  private readonly logger = new Logger('OAuthController');

  constructor(
    private readonly oauth: OAuthService,
    private readonly clients: ClientService,
    private readonly users: UserService,
  ) {}

  // ----- Shared helpers (DRY refactor per CODING_STANDARDS.md §DRY) --------

  /**
   * Validate client_id + redirect_uri. Returns null if valid, or an error
   * response that should be sent immediately.
   *
   * Used by authorize(), submitLogin(), selectRole() — eliminates 3x duplication
   * of client validation logic.
   */
  private validateClient(
    clientId: string,
    redirectUri: string,
  ): { valid: true } | { valid: false; status: number; message: string } {
    const client = this.clients.findById(clientId);
    if (!client) {
      return {
        valid: false,
        status: HttpStatus.BAD_REQUEST,
        message: `Unknown client_id: ${clientId}`,
      };
    }
    if (!client.redirectUris.includes(redirectUri)) {
      return {
        valid: false,
        status: HttpStatus.BAD_REQUEST,
        message: 'redirect_uri not registered for client',
      };
    }
    return { valid: true };
  }

  /**
   * Map MockRole[] → RoleDto[] for select-role.ejs template.
   *
   * Eliminates 2x duplication of role mapping in authorize() + submitLogin().
   */
  private toRoleDtos(roles: MockRole[]): RoleDto[] {
    return roles.map((r) => ({
      id: r.id,
      name: r.name,
      description: r.description,
    }));
  }

  /** Render the error page with a message. */
  private renderError(res: Response, status: number, message: string) {
    return res.status(status).render('error', { message });
  }

  // ----- Step 1: GET /oauth/authorize --------------------------------

  /**
   * Validate client_id, redirect_uri, PKCE. If the user is already auth'd
   * (auth_sid cookie), short-circuit to code issuance (or select-role).
   * Otherwise render the login page (EJS template — AUTH-04).
   *
   * Why `max-lines-per-function` is disabled here: this is the OAuth authorize
   * endpoint, whose spec (RFC 6749 §4.1.1 + OIDC §3.1.2.4) mandates a linear
   * sequence of validation steps each ending in a distinct user-facing
   * response (error / login page / role-select / code redirect). Each branch
   * is one HTTP response; extracting them to helpers would scatter the flow
   * without reducing real complexity.
   */
  // eslint-disable-next-line max-lines-per-function -- OAuth authorize: linear guard-clause flow per RFC 6749 §4.1.1
  @Get('authorize')
  // (disable directive must precede the @Get decorator — `max-lines-per-function` reports the decorator location as the function start)
  async authorize(
    @Query() query: AuthorizeQueryDto,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    const clientCheck = this.validateClient(
      query.client_id,
      query.redirect_uri,
    );
    if (!clientCheck.valid) {
      return this.renderError(res, clientCheck.status, clientCheck.message);
    }

    if (
      !query.code_challenge ||
      query.code_challenge_method !== 'S256'
    ) {
      return this.renderError(
        res,
        HttpStatus.BAD_REQUEST,
        'PKCE required (code_challenge_method=S256)',
      );
    }

    // Already-logged-in user? Skip the login page.
    const session = await this.oauth.getAuthSession(req);
    if (session) {
      const user = await this.users.findById(session.userId);
      if (!user) {
        // Session exists but user was deleted — clear cookie, force re-login.
        return this.renderError(
          res,
          HttpStatus.UNAUTHORIZED,
          'Session invalid — user no longer exists. Please login again.',
        );
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
      // Multi-role: render select-role page (AUTH-04).
      return res.status(HttpStatus.OK).render('select-role', {
        userId: user.id,
        clientId: query.client_id,
        redirectUri: query.redirect_uri,
        state: query.state,
        codeChallenge: query.code_challenge,
        codeChallengeMethod: query.code_challenge_method,
        scope: query.scope ?? '',
        roles: this.toRoleDtos(user.roles),
      });
    }

    // Not logged in: render login page (AUTH-04 EJS template).
    return res.status(HttpStatus.OK).render('login', {
      clientId: query.client_id,
      redirectUri: query.redirect_uri,
      state: query.state,
      codeChallenge: query.code_challenge,
      codeChallengeMethod: query.code_challenge_method,
      scope: query.scope ?? '',
      error: null,
    });
  }

  // ----- Step 2: POST /oauth/authorize (login submit) ----------------

  /**
   * Submit username + password. Validate via `UserService.validateCredentials`.
   * On success: create `auth_sid` cookie, then either issue code (single-role)
   * or render select-role (multi-role). On failure: re-render login with error.
   *
   * Same rationale as `authorize()` above: linear guard-clause flow where each
   * branch is a distinct HTTP response. Extracting helpers would scatter the
   * spec-mandated sequence without benefit.
   */
  // eslint-disable-next-line max-lines-per-function -- OAuth submit: linear guard-clause flow per RFC 6749 §4.1.3
  @Post('authorize')
  // (disable directive must precede the @Post decorator — `max-lines-per-function` reports the decorator location)
  @HttpCode(HttpStatus.OK)
  async submitLogin(
    @Body() body: AuthorizeSubmitDto,
    @Res() res: Response,
  ) {
    const clientCheck = this.validateClient(
      body.client_id,
      body.redirect_uri,
    );
    if (!clientCheck.valid) {
      return this.renderError(res, clientCheck.status, clientCheck.message);
    }

    const user = await this.users.validateCredentials(
      body.username,
      body.password,
    );
    if (!user) {
      // Re-render login page with error message (AUTH-04 AC #5).
      return res.status(HttpStatus.UNAUTHORIZED).render('login', {
        clientId: body.client_id,
        redirectUri: body.redirect_uri,
        state: body.state,
        codeChallenge: body.code_challenge,
        codeChallengeMethod: body.code_challenge_method,
        scope: body.scope ?? '',
        error: 'Username atau password salah',
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

    // Multi-role: render select-role page (AUTH-04).
    return res.status(HttpStatus.OK).render('select-role', {
      userId: user.id,
      clientId: body.client_id,
      redirectUri: body.redirect_uri,
      state: body.state,
      codeChallenge: body.code_challenge,
      codeChallengeMethod: body.code_challenge_method,
      scope: body.scope ?? '',
      roles: this.toRoleDtos(user.roles),
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
    const clientCheck = this.validateClient(
      body.client_id,
      body.redirect_uri,
    );
    if (!clientCheck.valid) {
      return this.renderError(res, clientCheck.status, clientCheck.message);
    }

    const user = await this.users.findById(body.user_id);
    if (!user) {
      return this.renderError(
        res,
        HttpStatus.BAD_REQUEST,
        'User not found — please login again.',
      );
    }

    const role = user.roles.find((r) => r.id === body.role_id);
    if (!role) {
      return this.renderError(
        res,
        HttpStatus.BAD_REQUEST,
        'Role does not belong to user',
      );
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
