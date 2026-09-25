import { Module } from '@nestjs/common';
import { KeyPairService } from './key-pair.service';
import { JwtSignerService } from './jwt-signer.service';
import { JwksController } from './jwks.controller';

/**
 * KeyPairModule — provider untuk RS256 keypair + JWT signer + JWKS endpoint.
 *
 * Exports KeyPairService + JwtSignerService supaya OAuthModule (AUTH-03)
 * bisa inject JwtSignerService untuk sign access + refresh token.
 */
@Module({
  providers: [KeyPairService, JwtSignerService],
  controllers: [JwksController],
  exports: [KeyPairService, JwtSignerService],
})
export class KeyPairModule {}
