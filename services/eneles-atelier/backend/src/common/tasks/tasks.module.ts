// Requires: npm install @nestjs/schedule
import { Module } from '@nestjs/common';
import { CleanupService } from './cleanup.service';
import { UsersModule } from '../../users/users.module';

@Module({
  imports: [UsersModule],
  providers: [CleanupService],
})
export class TasksModule {}
