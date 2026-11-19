import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AiService } from './ai.service';
import { AiChatService } from './ai-chat.service';
import { AiUsageService } from './ai-usage.service';
import { AiKeysService } from './ai-keys.service';
import { PlatformAiService } from './platform-ai.service';
import { AiController } from './ai.controller';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [ConfigModule, AuthModule],
  controllers: [AiController],
  providers: [
    AiService,
    AiChatService,
    AiUsageService,
    AiKeysService,
    PlatformAiService,
  ],
  exports: [
    AiService,
    AiChatService,
    AiUsageService,
    AiKeysService,
    PlatformAiService,
  ],
})
export class AiModule {}
