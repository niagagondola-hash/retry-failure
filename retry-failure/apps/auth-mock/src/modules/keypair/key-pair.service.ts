import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import {
  importSPKI,
  importPKCS8,
  exportJWK,
  calculateJwkThumbprint,
  type KeyLike,
} from 'jose';
import { generateKeyPairSync } from 'node:crypto';
import { readFile, writeFile, mkdir, chmod } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Public JWK shape exposed via /.well-known/jwks.json
 * (RFC 7517 + RFC 7518 RS256 — kty/use/alg/kid/n/e).
 */
export interface PublicJwk {
  kty: 'RSA';
  kid: string;
  use: 'sig';
  alg: 'RS256';
  n: string;
  e: string;
}

interface LoadedKeyPair {
  privateKey: KeyLike;
  publicKey: KeyLike;
  publicJwk: PublicJwk;
  kid: string;
}

/**
 * KeyPairService — singleton yang load (atau auto-generate) RSA 2048 keypair
 * dev di `apps/auth-mock/keys/`. Compute `kid` via RFC 7638 thumbprint
 * (`jose.calculateJwkThumbprint`). Expose getter untuk privateKey/publicKey/
 * kid/publicJwk — dipakai oleh JwtSignerService (sign) + JwksController (JWKS).
 *
 * File path resolved relative ke compiled output:
 *   dist/modules/keypair/key-pair.service.js → ../../../keys → apps/auth-mock/keys/
 *   src/modules/keypair/key-pair.service.ts (ts-jest) → ../../../keys → apps/auth-mock/keys/
 */
@Injectable()
export class KeyPairService implements OnModuleInit {
  private readonly logger = new Logger('KeyPairService');
  private readonly keysDir = join(__dirname, '..', '..', '..', 'keys');
  private readonly privateKeyPath = join(this.keysDir, 'dev-private.pem');
  private readonly publicKeyPath = join(this.keysDir, 'dev-public.pem');
  private loaded!: LoadedKeyPair;

  async onModuleInit(): Promise<void> {
    this.loaded = await this.loadOrCreate();
    this.logger.log(`Loaded keypair kid=${this.loaded.kid}`);
  }

  get privateKey(): KeyLike {
    return this.loaded.privateKey;
  }

  get publicKey(): KeyLike {
    return this.loaded.publicKey;
  }

  get kid(): string {
    return this.loaded.kid;
  }

  get publicJwk(): PublicJwk {
    return this.loaded.publicJwk;
  }

  private async loadOrCreate(): Promise<LoadedKeyPair> {
    if (existsSync(this.privateKeyPath) && existsSync(this.publicKeyPath)) {
      const privPem = await readFile(this.privateKeyPath, 'utf8');
      const pubPem = await readFile(this.publicKeyPath, 'utf8');
      const privateKey = await importPKCS8(privPem, 'RS256');
      const publicKey = await importSPKI(pubPem, 'RS256');
      return await this.asLoaded(publicKey, privateKey);
    }

    this.logger.warn(
      'Keypair not found — generating new RSA 2048 keypair (dev only).',
    );
    if (!existsSync(this.keysDir)) await mkdir(this.keysDir, { recursive: true });

    const { privateKey, publicKey } = generateKeyPairSync('rsa', {
      modulusLength: 2048,
      publicKeyEncoding: { type: 'spki', format: 'pem' },
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    });

    // Mode 0o600 untuk private, 0o644 untuk public. chmod() eksplisit supaya
    // tidak tergantung umask saat writeFile (mode option ignores umask jika
    // file sudah ada — refresh safety).
    await writeFile(this.privateKeyPath, privateKey as string, { mode: 0o600 });
    await writeFile(this.publicKeyPath, publicKey as string, { mode: 0o644 });
    await chmod(this.privateKeyPath, 0o600);
    await chmod(this.publicKeyPath, 0o644);

    const importedPriv = await importPKCS8(privateKey as string, 'RS256');
    const importedPub = await importSPKI(publicKey as string, 'RS256');
    return await this.asLoaded(importedPub, importedPriv);
  }

  private async asLoaded(
    publicKey: KeyLike,
    privateKey: KeyLike,
  ): Promise<LoadedKeyPair> {
    const jwk = await exportJWK(publicKey);
    // RFC 7638: SHA-256 thumbprint of canonical JWK (kty, n, e sorted).
    const kid = await calculateJwkThumbprint(jwk);
    const publicJwk: PublicJwk = {
      kty: 'RSA',
      kid,
      use: 'sig',
      alg: 'RS256',
      n: jwk.n!,
      e: jwk.e!,
    };
    return { privateKey, publicKey, publicJwk, kid };
  }
}
