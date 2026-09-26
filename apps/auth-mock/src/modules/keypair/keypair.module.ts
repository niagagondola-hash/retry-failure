import { Module } from '@nestjs/common';

import { JwksController } from './jwks.controller';
import { JwtSignerService } from './jwt-signer.service';
import { KeyPairService } from './key-pair.service';
import { TokenFactory } from './token-factory';

/**
 * KeyPairModule — provider untuk RS256 keypair + JWT signer + TokenFactory + JWKS endpoint.
 *
 * Exports:
 *   - KeyPairService   — RSA 2048 keypair management
 *   - JwtSignerService — low-level sign/verify (jose wrapper)
 *   - TokenFactory     — high-level token issuance (DRY refactor, CODING_STANDARDS.md)
 *
 * Consumers:
 *   - OAuthModule (AUTH-03) — issueTokenPair untuk OAuth2 flow
 *   - InternalModule (AUTH-05) — switchRole issue new pair
 *   - DevController (AUTH-05) — /dev/token dev shortcut
 */
@Module({
  providers: [KeyPairService, JwtSignerService, TokenFactory],
  controllers: [JwksController],
  exports: [KeyPairService, JwtSignerService, TokenFactory],
})
export class KeyPairModule {}
