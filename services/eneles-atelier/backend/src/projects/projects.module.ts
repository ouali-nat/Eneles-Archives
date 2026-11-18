import { Module } from '@nestjs/common';
import { ProjectsController } from './projects.controller';
import { ProjectsService } from './projects.service';
import { PrismaModule } from '../prisma/prisma.module';
import { AuthModule } from '../auth/auth.module';
import { AiModule } from '../ai/ai.module';
import { EmailModule } from '../email/email.module';
import { ConfigModule } from '@nestjs/config';
import { SettingsModule } from '../settings/settings.module';
import { StorageModule } from '../storage/storage.module';
import { UsageModule } from '../usage/usage.module';
import { RevisionsService } from './revisions.service';
import { HistoryService } from './history.service';

@Module({
  imports: [
    PrismaModule,
    AuthModule,
    AiModule,
    EmailModule,
    ConfigModule,
    SettingsModule,
    StorageModule,
    UsageModule,
  ],
  controllers: [ProjectsController],
  providers: [ProjectsService, RevisionsService, HistoryService],
  exports: [ProjectsService, RevisionsService, HistoryService],
})
export class ProjectsModule {}
