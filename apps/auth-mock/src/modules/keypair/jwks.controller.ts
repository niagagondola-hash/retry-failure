import { Controller, Get, Header } from '@nestjs/common';

import { KeyPairService } from './key-pair.service';

/**
 * JwksController — expose public RSA key sebagai JWK Set di
 * `/.well-known/jwks.json` per RFC 8414 / OIDC discovery convention.
 *
 * Response shape:
 *   { "keys": [ { kty, kid, use, alg, n, e } ] }
 *
 * Cache-Control: public, max-age=300 — verifier (payment-api) boleh cache
 * 5 menit (env `JWKS_CACHE_TTL_SEC=300` di payment-api, plan2 §5.1).
 */
@Controller()
export class JwksController {
  constructor(private readonly keyPair: KeyPairService) {}

  @Get('.well-known/jwks.json')
  @Header('Cache-Control', 'public, max-age=300')
  @Header('Content-Type', 'application/json; charset=utf-8')
  jwks() {
    return { keys: [this.keyPair.publicJwk] };
  }
}
