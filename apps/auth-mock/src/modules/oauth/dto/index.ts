/**
 * DTOs for OAuth2 endpoints (AUTH-03).
 *
 * Plan reference: AUTH-03 task spec §1 (DTOs list).
 * RFC reference: RFC 6749 (Authorization Code grant), RFC 7636 (PKCE),
 * RFC 7009 (Token Revocation).
 *
 * Note: form-urlencoded POST bodies from OAuth2 clients don't always set
 * `Content-Type: application/json`, so controllers use `@Body()` with no
 * `ValidationPipe` whitelist — class-validator fields here double as the
 * documented contract.
 */
import { IsIn, IsOptional, IsString, MinLength } from 'class-validator';

/** `GET /oauth/authorize` query string (RFC 6749 §4.1.1 + RFC 7636 §4.3). */
export class AuthorizeQueryDto {
  @IsString()
  @IsIn(['code'])
  response_type!: string;

  @IsString()
  client_id!: string;

  @IsString()
  redirect_uri!: string;

  @IsString()
  @IsIn(['S256'])
  code_challenge_method!: string;

  @IsString()
  @MinLength(43)
  code_challenge!: string;

  @IsString()
  @IsOptional()
  state?: string;

  @IsString()
  @IsOptional()
  scope?: string;
}

/** `POST /oauth/authorize` (login submit). */
export class AuthorizeSubmitDto {
  @IsString()
  username!: string;

  @IsString()
  password!: string;

  @IsString()
  client_id!: string;

  @IsString()
  redirect_uri!: string;

  @IsString()
  @IsIn(['S256'])
  code_challenge_method!: string;

  @IsString()
  code_challenge!: string;

  @IsString()
  @IsOptional()
  state?: string;

  @IsString()
  @IsOptional()
  scope?: string;
}

/** `POST /oauth/select-role` body. */
export class SelectRoleDto {
  @IsString()
  user_id!: string;

  @IsString()
  role_id!: string;

  @IsString()
  client_id!: string;

  @IsString()
  redirect_uri!: string;

  @IsString()
  @IsIn(['S256'])
  code_challenge_method!: string;

  @IsString()
  code_challenge!: string;

  @IsString()
  @IsOptional()
  state?: string;

  @IsString()
  @IsOptional()
  scope?: string;
}

/**
 * `POST /oauth/token` body — supports both `authorization_code` and
 * `refresh_token` grants. Fields are union of both; controller dispatches
 * on `grant_type`.
 */
export class TokenRequestDto {
  @IsString()
  @IsIn(['authorization_code', 'refresh_token'])
  grant_type!: 'authorization_code' | 'refresh_token';

  /** authorization_code grant only. */
  @IsString()
  @IsOptional()
  code?: string;

  /** authorization_code grant only. */
  @IsString()
  @IsOptional()
  code_verifier?: string;

  /** authorization_code grant only (RFC 6749 §4.1.3 — must match the one in /authorize). */
  @IsString()
  @IsOptional()
  redirect_uri?: string;

  /** refresh_token grant only. */
  @IsString()
  @IsOptional()
  refresh_token?: string;

  @IsString()
  client_id!: string;

  @IsString()
  client_secret!: string;

  /** Optional — RFC 6749 §3.3. */
  @IsString()
  @IsOptional()
  scope?: string;
}

/** `POST /oauth/revoke` body (RFC 7009 §2.1). */
export class RevokeDto {
  @IsString()
  token!: string;

  @IsString()
  @IsIn(['access_token', 'refresh_token'])
  @IsOptional()
  token_type_hint?: 'access_token' | 'refresh_token';

  @IsString()
  client_id!: string;

  @IsString()
  client_secret!: string;
}

/** Parse space-delimited scope string into array. */
export function parseScopes(scope?: string): string[] {
  if (!scope) return [];
  return scope.split(/\s+/).filter(Boolean);
}

/** Filter requested scopes against the client's allowed list. */
export function filterScopes(scope: string, allowed: string[]): string[] {
  const requested = parseScopes(scope);
  return requested.filter((s) => allowed.includes(s));
}
