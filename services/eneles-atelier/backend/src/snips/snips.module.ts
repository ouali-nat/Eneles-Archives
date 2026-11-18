import { Module } from '@nestjs/common';
import { SnipsService } from './snips.service';
import { SnipsController } from './snips.controller';
import { PrismaModule } from '../prisma/prisma.module';
import { StorageModule } from '../storage/storage.module';
import { UsageModule } from '../usage/usage.module';
import { AiModule } from '../ai/ai.module';

@Module({
  imports: [PrismaModule, StorageModule, UsageModule, AiModule],
  providers: [SnipsService],
  exports: [SnipsService],
  controllers: [SnipsController],
})
export class SnipsModule {}
