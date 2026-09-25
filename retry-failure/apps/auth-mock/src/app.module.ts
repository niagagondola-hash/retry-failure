import { Module } from '@nestjs/common';
import { OAuthModule } from './modules/oauth/oauth.module';
import { UserModule } from './modules/user/user.module';
import { ClientModule } from './modules/client/client.module';
import { KeyPairModule } from './modules/keypair/keypair.module';

@Module({
  imports: [OAuthModule, UserModule, ClientModule, KeyPairModule],
})
export class AppModule {}
