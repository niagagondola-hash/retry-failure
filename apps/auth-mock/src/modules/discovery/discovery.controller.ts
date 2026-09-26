/**
 * DiscoveryController — OIDC discovery endpoint (AUTH-07).
 *
 * Plan reference: PLAN2 Section 25.3.H, AUTH-07 task spec §3.
 *
 * Exposes `GET /.well-known/openid-configuration` returning the discovery
 * document per OIDC Discovery 1.0 / RFC 8414. Used by `openid-client` v5 in
 * payment-api to auto-discover endpoints.
 *
 * Cache: `Cache-Control: public, max-age=3600` (1 hour — discovery rarely
 * changes; compare with JWKS max-age=300 in AUTH-02).
 */
import { Controller, Get, Header } from '@nestjs/common';

import { DiscoveryService } from './discovery.service';

@Controller()
export class DiscoveryController {
  constructor(private readonly discovery: DiscoveryService) {}

  /**
   * GET /.well-known/openid-configuration — discovery document.
   *
   * Headers:
   *   Cache-Control: public, max-age=3600  (1 hour cache)
   *   Content-Type:  application/json; charset=utf-8
   */
  @Get('.well-known/openid-configuration')
  @Header('Cache-Control', 'public, max-age=3600')
  @Header('Content-Type', 'application/json; charset=utf-8')
  getDiscovery() {
    return this.discovery.buildDiscovery();
  }
}
