import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ProjectsService } from '../projects/projects.service';

const AUTHOR = { select: { id: true, name: true, avatarUrl: true } } as const;

/** The hues a comment's highlight may take: the interface's named hue tokens (--hue-amber and the rest in the frontend's globals.css). Null stands for the default, amber. */
export const COMMENT_HUES = [
  'grey',
  'red',
  'orange',
  'amber',
  'green',
  'teal',
  'blue',
  'indigo',
  'purple',
  'pink',
] as const;
export type CommentHue = (typeof COMMENT_HUES)[number];

/**
 * Comments on project files. Everyone the project is shared with can read
 * and write them, viewers included, so a supervisor with view access can
 * still leave notes. Resolving needs edit rights or the thread's author;
 * deleting a thread needs its author or the project owner; a message can
 * only be changed by whoever wrote it.
 */
@Injectable()
export class CommentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly projects: ProjectsService,
  ) {}

  private async access(projectUid: string, userId: number) {
    const access = await this.projects.checkAccess(projectUid, userId);
    if (!access.project || !access.canView || access.pendingInvitation) {
      throw new NotFoundException('Project not found');
    }
    return access;
  }

  private async thread(projectId: number, threadId: number) {
    const thread = await this.prisma.client.commentThread.findFirst({
      where: { id: threadId, projectId },
    });
    if (!thread) throw new NotFoundException('Comment not found');
    return thread;
  }

  private full(projectId: number, threadId?: number) {
    return {
      where: threadId ? { id: threadId, projectId } : { projectId },
      include: {
        createdBy: AUTHOR,
        messages: {
          include: { author: AUTHOR },
          orderBy: { createdAt: 'asc' as const },
        },
      },
      orderBy: [{ path: 'asc' as const }, { offset: 'asc' as const }],
    };
  }

  async list(projectUid: string, userId: number) {
    const { project } = await this.access(projectUid, userId);
    return this.prisma.client.commentThread.findMany(this.full(project.id));
  }

  async create(
    projectUid: string,
    userId: number,
    data: {
      path: string;
      anchorStart?: string;
      anchorEnd?: string;
      quote: string;
      offset: number;
      content: string;
      color?: string | null;
    },
  ) {
    const { project } = await this.access(projectUid, userId);
    if (!project.files.some((f) => f.path === data.path && !f.isFolder)) {
      throw new NotFoundException('That file is not in this project');
    }
    const thread = await this.prisma.client.commentThread.create({
      data: {
        projectId: project.id,
        path: data.path,
        anchorStart: data.anchorStart ?? null,
        anchorEnd: data.anchorEnd ?? null,
        quote: data.quote,
        offset: Math.max(0, data.offset),
        color: data.color ?? null,
        createdById: userId,
        messages: { create: { authorId: userId, content: data.content } },
      },
    });
    return {
      projectUid,
      path: thread.path,
      thread: await this.one(project.id, thread.id),
    };
  }

  private one(projectId: number, threadId: number) {
    const q = this.full(projectId, threadId);
    return this.prisma.client.commentThread.findFirst({
      where: q.where,
      include: q.include,
    });
  }

  async reply(
    projectUid: string,
    userId: number,
    threadId: number,
    content: string,
  ) {
    const { project } = await this.access(projectUid, userId);
    const thread = await this.thread(project.id, threadId);
    await this.prisma.client.commentMessage.create({
      data: { threadId: thread.id, authorId: userId, content },
    });
    // A reply to a resolved thread reopens it.
    await this.prisma.client.commentThread.update({
      where: { id: thread.id },
      data: { resolved: false, resolvedAt: null, resolvedById: null },
    });
    return { path: thread.path, thread: await this.one(project.id, thread.id) };
  }

  /** Resolves or reopens a thread, or changes its highlight's color: both need edit rights or the thread's author. */
  async update(
    projectUid: string,
    userId: number,
    threadId: number,
    changes: { resolved?: boolean; color?: string | null },
  ) {
    const access = await this.access(projectUid, userId);
    const thread = await this.thread(access.project.id, threadId);
    if (!access.canEdit && thread.createdById !== userId) {
      throw new ForbiddenException(
        'Only editors and the person who started this comment can change it',
      );
    }
    const data: {
      resolved?: boolean;
      resolvedAt?: Date | null;
      resolvedById?: number | null;
      color?: string | null;
    } = {};
    if (changes.resolved !== undefined) {
      Object.assign(
        data,
        changes.resolved
          ? { resolved: true, resolvedAt: new Date(), resolvedById: userId }
          : { resolved: false, resolvedAt: null, resolvedById: null },
      );
    }
    if (changes.color !== undefined) data.color = changes.color;
    await this.prisma.client.commentThread.update({
      where: { id: thread.id },
      data,
    });
    return {
      path: thread.path,
      thread: await this.one(access.project.id, thread.id),
    };
  }

  async removeThread(projectUid: string, userId: number, threadId: number) {
    const access = await this.access(projectUid, userId);
    const thread = await this.thread(access.project.id, threadId);
    if (!access.isOwner && thread.createdById !== userId) {
      throw new ForbiddenException(
        'Only the project owner and the person who started this comment can delete it',
      );
    }
    await this.prisma.client.commentThread.delete({ where: { id: thread.id } });
    return { path: thread.path };
  }

  async editMessage(
    projectUid: string,
    userId: number,
    messageId: number,
    content: string,
  ) {
    const { project } = await this.access(projectUid, userId);
    const message = await this.prisma.client.commentMessage.findFirst({
      where: { id: messageId, thread: { projectId: project.id } },
      include: { thread: true },
    });
    if (!message) throw new NotFoundException('Comment not found');
    if (message.authorId !== userId)
      throw new ForbiddenException('You can only edit your own comments');
    await this.prisma.client.commentMessage.update({
      where: { id: messageId },
      data: { content, editedAt: new Date() },
    });
    return {
      path: message.thread.path,
      thread: await this.one(project.id, message.threadId),
    };
  }

  async removeMessage(projectUid: string, userId: number, messageId: number) {
    const { project } = await this.access(projectUid, userId);
    const message = await this.prisma.client.commentMessage.findFirst({
      where: { id: messageId, thread: { projectId: project.id } },
      include: {
        thread: { include: { _count: { select: { messages: true } } } },
      },
    });
    if (!message) throw new NotFoundException('Comment not found');
    if (message.authorId !== userId)
      throw new ForbiddenException('You can only delete your own comments');
    // The first message is the thread: removing the last one removes it all.
    if (message.thread._count.messages <= 1) {
      await this.prisma.client.commentThread.delete({
        where: { id: message.threadId },
      });
    } else {
      await this.prisma.client.commentMessage.delete({
        where: { id: messageId },
      });
    }
    return { path: message.thread.path };
  }
}
