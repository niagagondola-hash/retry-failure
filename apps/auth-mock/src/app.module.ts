import { Module } from '@nestjs/common';
import { OAuthModule } from './modules/oauth/oauth.module';
import { UserModule } from './modules/user/user.module';
import { ClientModule } from './modules/client/client.module';

@Module({
  imports: [OAuthModule, UserModule, ClientModule],
})
export class AppModule {}
