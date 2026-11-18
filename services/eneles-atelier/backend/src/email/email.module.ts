import { Module } from '@nestjs/common';
import { EmailService } from './email.service';
import { EmailWebhookController } from './email-webhook.controller';
import { ConfigModule } from '@nestjs/config';

@Module({
  imports: [ConfigModule],
  controllers: [EmailWebhookController],
  providers: [EmailService],
  exports: [EmailService],
})
export class EmailModule {}
