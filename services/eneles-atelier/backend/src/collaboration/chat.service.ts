import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ProjectsService } from '../projects/projects.service';

/** The project chat: everyone the project is shared with can read and post. */
@Injectable()
export class ChatService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly projects: ProjectsService,
  ) {}

  private async projectFor(projectUid: string, userId: number) {
    const access = await this.projects.checkAccess(projectUid, userId, { files: false });
    if (!access.project || !access.canView || access.pendingInvitation) {
      throw new NotFoundException('Project not found');
    }
    return access.project;
  }

  /** Newest `limit` messages before `before` (a message id), oldest first. */
  async history(
    projectUid: string,
    userId: number,
    before?: number,
    limit = 50,
  ) {
    const project = await this.projectFor(projectUid, userId);
    const take = Math.min(Math.max(limit, 1), 100);
    const rows = await this.prisma.client.projectChatMessage.findMany({
      where: {
        projectId: project.id,
        ...(before ? { id: { lt: before } } : {}),
      },
      include: { user: { select: { id: true, name: true, avatarUrl: true } } },
      orderBy: { id: 'desc' },
      take: take + 1,
    });
    const hasMore = rows.length > take;
    return { messages: rows.slice(0, take).reverse(), hasMore };
  }

  async post(projectUid: string, userId: number, content: string) {
    const project = await this.projectFor(projectUid, userId);
    return this.prisma.client.projectChatMessage.create({
      data: { projectId: project.id, userId, content },
      include: { user: { select: { id: true, name: true, avatarUrl: true } } },
    });
  }
}
