import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { ProjectsModule } from '../projects/projects.module';
import { CollaborationModule } from '../collaboration/collaboration.module';
import { GithubController } from './github.controller';
import { GithubService } from './github.service';

@Module({
  imports: [PrismaModule, ProjectsModule, CollaborationModule],
  controllers: [GithubController],
  providers: [GithubService],
})
export class GithubModule {}
