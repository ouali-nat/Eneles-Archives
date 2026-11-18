import { Module } from '@nestjs/common';
import { AiModule } from '../ai/ai.module';
import { AuthModule } from '../auth/auth.module';
import { BillingModule } from '../billing/billing.module';
import { CollaborationModule } from '../collaboration/collaboration.module';
import { UsersModule } from '../users/users.module';
import { AdminActionsService } from './admin-actions.service';
import { AdminAuthController } from './admin-auth.controller';
import { AdminController } from './admin.controller';
import { AdminGuard } from './admin.guard';
import { AdminService } from './admin.service';
import { RootAdmin } from './root-admin';

@Module({
  imports: [
    AuthModule,
    UsersModule,
    BillingModule,
    CollaborationModule,
    AiModule,
  ],
  controllers: [AdminAuthController, AdminController],
  providers: [AdminService, AdminActionsService, AdminGuard, RootAdmin],
})
export class AdminModule {}
