import { CacheModule, Global, Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { CacheService } from './cache.service.js';
import { Crypto } from './crypto';
import { MailsService } from './mails.service.js';
import * as redisStore from 'cache-manager-redis-store';

@Global()
@Module({
  providers: [Crypto, MailsService, CacheService],
  exports: [Crypto, MailsService, CacheService],
  imports: [
    CacheModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        store: redisStore,
        host: config.get('REDIS_HOST'),
        port: config.get('REDIS_PORT'),
        ttl: 120,
      }),
    }),
  ],
})
export class UtilsModule {}
