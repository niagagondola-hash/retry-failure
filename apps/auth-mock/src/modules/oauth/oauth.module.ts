/**
 * OAuthModule — wire OAuth2 endpoints (AUTH-03).
 *
 * Plan reference: AUTH-03 task spec §9.
 *
 * Providers:
 *   - OAuthService          — business logic
 *   - AuthSessionService    — `auth_sid` cookie session
 *   - AuthCodeStore         — in-memory auth code store (TTL 60s)
 *   - TokenStore             — refresh rotation + reuse detection
 *
 * Controllers:
 *   - OAuthController       — GET/POST /oauth/authorize, POST /oauth/select-role
 *   - TokenController       — POST /oauth/token, POST /oauth/revoke
 *
 * Imports: KeyPairModule (for JwtSignerService), ClientModule, UserModule.
 *
 * After module init, OAuthService.userLookup is wired to UserService.findById
 * so the refresh flow (which only has userId from JWT) can resolve the user
 * record (used for re-signing with the current username).
 */
import { Module, OnModuleInit } from '@nestjs/common';
import { KeyPairModule } from '../keypair/keypair.module';
import { ClientModule } from '../client/client.module';
import { UserModule } from '../user/user.module';
import { UserService } from '../user/user.service';
import { OAuthController } from './oauth.controller';
import { TokenController } from './token.controller';
import { OAuthService } from './oauth.service';
import { AuthSessionService } from './auth-session.service';
import { AuthCodeStore } from './auth-code.store';
import { TokenStore } from './token.store';

@Module({
  imports: [KeyPairModule, ClientModule, UserModule],
  providers: [OAuthService, AuthSessionService, AuthCodeStore, TokenStore],
  controllers: [OAuthController, TokenController],
  exports: [OAuthService, TokenStore, AuthCodeStore],
})
export class OAuthModule implements OnModuleInit {
  constructor(
    private readonly oauth: OAuthService,
    private readonly users: UserService,
  ) {}

  onModuleInit(): void {
    // Wire user-lookup callback so OAuthService.refresh() can resolve a fresh
    // user record without a direct UserService import (avoids circular deps).
    this.oauth.setUserLookup((userId) => this.users.findById(userId));
  }
}
