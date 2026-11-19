import { Module } from '@nestjs/common';
import { CollaborationGateway } from './collaboration.gateway';
import { YjsPersistenceService } from './yjs-persistence.service';
import { AuthModule } from '../auth/auth.module';
import { ProjectsModule } from '../projects/projects.module';
import { CollaborationController } from './collaboration.controller';
import { CommentsService } from './comments.service';
import { ChatService } from './chat.service';

@Module({
  imports: [AuthModule, ProjectsModule],
  controllers: [CollaborationController],
  providers: [CollaborationGateway, YjsPersistenceService, CommentsService, ChatService],
  exports: [CollaborationGateway],
})
export class CollaborationModule {}
