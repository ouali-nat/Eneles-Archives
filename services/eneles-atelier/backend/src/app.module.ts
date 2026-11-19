// Requires: npm install @nestjs/schedule
import { Module } from '@nestjs/common';
import { ContactModule } from './contact/contact.module';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerModule } from '@nestjs/throttler';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { UsersModule } from './users/users.module';
import { SnipsModule } from './snips/snips.module';
import { PdfsModule } from './pdfs/pdfs.module';
import { PrismaModule } from './prisma/prisma.module';
import { EmailModule } from './email/email.module';
import { AuthModule } from './auth/auth.module';
import { JwtAuthGuard } from './common/guards/jwt-auth.guard';
import { SettingsModule } from './settings/settings.module';
import { BillingModule } from './billing/billing.module';
import { UsageModule } from './usage/usage.module';
import { StorageModule } from './storage/storage.module';
import { ApiKeysModule } from './api-keys/api-keys.module';
import { AiModule } from './ai/ai.module';
import { ProjectsModule } from './projects/projects.module';
import { CollaborationModule } from './collaboration/collaboration.module';
import { GithubModule } from './github/github.module';
import { ReferencesModule } from './references/references.module';
import { TikzModule } from './tikz/tikz.module';
import { TemplatesModule } from './templates/templates.module';
import { ExtractModule } from './extract/extract.module';
import { CompileModule } from './compile/compile.module';
import { AuditModule } from './audit/audit.module';
import { TasksModule } from './common/tasks/tasks.module';
import { RedisModule } from './common/redis';
import { ArxivModule } from './arxiv/arxiv.module';
import { AdminModule } from './admin/admin.module';
import { MetricsModule } from './metrics/metrics.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      // Per-environment file first so it wins on duplicate keys, then shared.
      envFilePath: [`.env.${process.env.NODE_ENV || 'development'}`, '.env'],
    }),
    ThrottlerModule.forRoot([
      {
        ttl: 60000, // 60 seconds
        limit: 60, // 60 requests per minute per IP (global default)
      },
    ]),
    ScheduleModule.forRoot(),
    RedisModule,
    PrismaModule,
    UsersModule,
    SnipsModule,
    PdfsModule,
    EmailModule,
    ContactModule,
    AuthModule,
    SettingsModule,
    BillingModule,
    UsageModule,
    StorageModule,
    ApiKeysModule,
    AiModule,
    ProjectsModule,
    CollaborationModule,
    GithubModule,
    ReferencesModule,
    TikzModule,
    TemplatesModule,
    ExtractModule,
    CompileModule,
    AuditModule,
    TasksModule,
    ArxivModule,
    MetricsModule,
    AdminModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    {
      provide: APP_GUARD,
      useClass: JwtAuthGuard,
    },
  ],
})
export class AppModule {}
