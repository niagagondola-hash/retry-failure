/**
 * TokenController — `/oauth/token` + `/oauth/revoke` (AUTH-03).
 *
 * Plan reference: PLAN2 Section 4.1 (OAuth2 flow), Section 5.3 (expiry),
 * Section 5.4 (refresh rotation), Section 5.5 (revoke), AUTH-03 task spec §8,
 * OIDC Core 1.0 §3.1.3.3 (token response with id_token).
 *
 * Endpoints:
 *   POST /oauth/token    — grant_type=authorization_code: code → access + id + refresh.
 *                          grant_type=refresh_token: refresh rotation.
 *   POST /oauth/revoke   — RFC 7009 token revocation (always 200).
 *
 * Response shape for /oauth/token (OIDC Core §3.1.3.3 + RFC 6749 §5.1):
 *   {
 *     "access_token": "eyJ...",      ← API access token
 *     "id_token": "eyJ...",          ← OIDC identity token (scope=openid only)
 *     "token_type": "Bearer",
 *     "expires_in": 900,
 *     "refresh_token": "eyJ...",
 *     "scope": "openid profile"
 *   }
 *
 * Error responses follow RFC 6749 §5.2 — `{ error, error_description }`.
 */
import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Logger,
  Post,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';

import { RevokeDto, TokenRequestDto } from './dto';
import {
  InvalidClientError,
  InvalidGrantError,
  mapOAuthError,
  OAuthService,
} from './oauth.service';

@Controller('oauth')
export class TokenController {
  private readonly logger = new Logger('TokenController');

  constructor(private readonly oauth: OAuthService) {}

  // ----- POST /oauth/token -------------------------------------------

  /**
   * OAuth 2.1 token endpoint. Handles `authorization_code` + `refresh_token`
   * grant types per RFC 6749 §4.1.3 (auth code) and §6 (refresh).
   *
   * Why `max-lines-per-function` is disabled: the OAuth token endpoint is
   * inherently a grant-type dispatcher with input validation per branch
   * (RFC 6749 §5.2 error responses). Extracting per-grant helpers would
   * scatter the spec's dispatch table without reducing real complexity.
   */
  // eslint-disable-next-line max-lines-per-function, complexity -- OAuth token endpoint: 3-branch dispatcher (auth_code / refresh / default) + log statements; inherent to RFC 6749 §4.1.3 + §6
  @Post('token')
  async token(@Body() body: TokenRequestDto, @Res() res: Response) {
    this.logger.debug(`POST /oauth/token — grant_type=${body.grant_type} client_id=${body.client_id ?? '(none)'}`);
    try {
      if (body.grant_type === 'authorization_code') {
        this.logger.debug('POST /oauth/token — authorization_code grant: verify code + code_verifier + redirect_uri');
        if (!body.code || !body.code_verifier || !body.redirect_uri) {
          this.logger.warn('POST /oauth/token — authorization_code grant missing required params, return invalid_request');
          return res.status(HttpStatus.BAD_REQUEST).json({
            error: 'invalid_request',
            error_description:
              'authorization_code grant requires code, code_verifier, redirect_uri',
          });
        }
        this.logger.debug('POST /oauth/token — exchange code via oauth.exchangeCode()');
        const pair = await this.oauth.exchangeCode({
          code: body.code,
          codeVerifier: body.code_verifier,
          clientId: body.client_id,
          clientSecret: body.client_secret,
          redirectUri: body.redirect_uri,
        });
        this.logger.debug('POST /oauth/token — code exchanged, return access+id+refresh tokens');
        return res.status(HttpStatus.OK).json({
          access_token: pair.accessToken,
          id_token: pair.idToken,
          token_type: pair.tokenType,
          expires_in: pair.expiresIn,
          refresh_token: pair.refreshToken,
          scope: pair.scope,
        });
      }

      // grant_type === 'refresh_token'
      if (!body.refresh_token) {
        return res.status(HttpStatus.BAD_REQUEST).json({
          error: 'invalid_request',
          error_description: 'refresh_token grant requires refresh_token',
        });
      }
      const pair = await this.oauth.refresh({
        refreshToken: body.refresh_token,
        clientId: body.client_id,
        clientSecret: body.client_secret,
      });
      return res.status(HttpStatus.OK).json({
        access_token: pair.accessToken,
        id_token: pair.idToken,
        token_type: pair.tokenType,
        expires_in: pair.expiresIn,
        refresh_token: pair.refreshToken,
        scope: pair.scope,
      });
    } catch (err) {
      const { error, description, status } = mapOAuthError(err);
      // RFC 6749 §5.2: invalid_client MAY return 401 with WWW-Authenticate.
      if (err instanceof InvalidClientError) {
        res.setHeader('WWW-Authenticate', 'Basic realm="oauth"');
      }
      // Refresh reuse already triggered the panic-revoke inside OAuthService.
      if (
        err instanceof InvalidGrantError &&
        description.includes('reuse')
      ) {
        this.logger.warn(
          `Refresh reuse detected — all user sessions revoked.`,
        );
      }
      return res.status(status).json({
        error,
        error_description: description,
      });
    }
  }

  // ----- POST /oauth/revoke ------------------------------------------

  /**
   * RFC 7009 token revocation. The server returns 200 OK regardless of
   * whether the token was known — leaking that information would be a
   * security issue. Invalid client credentials still produce 401 (RFC 7009 §2.2).
   */
  @Post('revoke')
  @HttpCode(HttpStatus.OK)
  async revoke(@Body() body: RevokeDto, @Res() res: Response) {
    try {
      await this.oauth.revoke({
        token: body.token,
        tokenTypeHint: body.token_type_hint,
        clientId: body.client_id,
        clientSecret: body.client_secret,
      });
      return res.status(HttpStatus.OK).send();
    } catch (err) {
      const { error, description, status } = mapOAuthError(err);
      if (error === 'invalid_client') {
        res.setHeader('WWW-Authenticate', 'Basic realm="oauth"');
      }
      return res.status(status).json({ error, error_description: description });
    }
  }
}
