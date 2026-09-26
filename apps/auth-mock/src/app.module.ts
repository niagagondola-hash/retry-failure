import { Module } from '@nestjs/common';

import { ClientModule } from './modules/client/client.module';
import { DiscoveryModule } from './modules/discovery/discovery.module';
import { InternalModule } from './modules/internal/internal.module';
import { KeyPairModule } from './modules/keypair/keypair.module';
import { OAuthModule } from './modules/oauth/oauth.module';
import { UserModule } from './modules/user/user.module';

@Module({
  imports: [
    OAuthModule,
    UserModule,
    ClientModule,
    KeyPairModule,
    DiscoveryModule,
    InternalModule,
  ],
})
export class AppModule {}
