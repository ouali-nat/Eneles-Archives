import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { ProjectsService } from '../projects/projects.service';
import { isTemplateReviewer } from '../common/guards/reviewer.guard';
import { TEMPLATE_LIMITS } from './dto/template-fields';

/** Distinct reports that take an approved template out of the library until it is reviewed again. */
export const REPORTS_TO_HIDE = 3;

/** What other people may see: shared and approved. */
const VISIBLE_TO_OTHERS = { isPublic: true, review: 'approved' as const };

@Injectable()
export class TemplatesService {
  private readonly logger = new Logger(TemplatesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly projects: ProjectsService,
  ) {}

  /** Whether this person may review shared templates. */
  canReview(userId: number) {
    return isTemplateReviewer(this.config, this.prisma, userId);
  }

  /** An author sees how many people reported a template, never who. */
  private forAuthor<T extends { reportedBy: number[] }>(template: T) {
    const { reportedBy, ...rest } = template;
    return { ...rest, reportCount: reportedBy.length };
  }

  /**
   * List approved shared templates + all of the current user's own.
   * Supports filtering by category and search term.
   */
  async findAll(query: {
    userId?: number;
    category?: string;
    search?: string;
    page?: number;
    limit?: number;
  }) {
    const { userId, category, search, page = 1, limit = 20 } = query;
    const skip = (page - 1) * limit;

    const where: any = {
      OR: [VISIBLE_TO_OTHERS, ...(userId ? [{ userId }] : [])],
    };

    if (category && category !== 'all') {
      where.category = category;
    }

    if (search) {
      where.AND = [
        {
          OR: [
            { name: { contains: search, mode: 'insensitive' } },
            { description: { contains: search, mode: 'insensitive' } },
            { tags: { hasSome: [search.toLowerCase()] } },
          ],
        },
      ];
    }

    const [data, total] = await Promise.all([
      this.prisma.client.template.findMany({
        where,
        select: {
          id: true,
          userId: true,
          name: true,
          description: true,
          category: true,
          isPublic: true,
          review: true,
          tags: true,
          usageCount: true,
          createdAt: true,
          updatedAt: true,
          user: { select: { id: true, name: true } },
        },
        orderBy: { updatedAt: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.client.template.count({ where }),
    ]);

    const totalPages = Math.ceil(total / limit);
    return {
      data,
      meta: {
        page,
        limit,
        total,
        totalPages,
        hasNext: page < totalPages,
        hasPrev: page > 1,
      },
    };
  }

  /**
   * Get a single template by ID.
   * Only the owner can see private templates.
   */
  async findOne(id: number, userId?: number) {
    const template = await this.prisma.client.template.findUnique({
      where: { id },
      include: {
        user: { select: { id: true, name: true } },
      },
    });

    if (!template) {
      throw new NotFoundException('Template not found');
    }

    const own = template.userId === userId;
    if (!own && !(template.isPublic && template.review === 'approved')) {
      throw new NotFoundException('Template not found');
    }

    if (own) return this.forAuthor(template);
    // Reviewers' notes and reporters are the author's business.
    const { reviewNote: _n, reportedBy: _r, ...shown } = template;
    return shown;
  }

  /**
   * List only the current user's custom templates.
   */
  async findMine(userId: number, query: { page?: number; limit?: number }) {
    const { page = 1, limit = 20 } = query;
    const skip = (page - 1) * limit;

    const where = { userId };

    const [data, total] = await Promise.all([
      this.prisma.client.template.findMany({
        where,
        orderBy: { updatedAt: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.client.template.count({ where }),
    ]);

    const totalPages = Math.ceil(total / limit);
    return {
      data: data.map((t) => this.forAuthor(t)),
      meta: { page, limit, total, totalPages, hasNext: page < totalPages, hasPrev: page > 1 },
    };
  }

  /**
   * Save a project's text files as a template: the main document becomes
   * the template's source and the rest its files. Images and other uploads
   * stay behind, and the reply says how many.
   */
  async fromProject(
    userId: number,
    projectUid: string,
    data: { name: string; description?: string; category?: string; isPublic?: boolean; tags?: string[] },
  ) {
    const access = await this.projects.checkAccess(projectUid, userId);
    if (!access.project || !access.canView || access.pendingInvitation) {
      throw new NotFoundException('Project not found');
    }
    if (!access.canEdit) {
      throw new ForbiddenException('Only the owner and editors can save a project as a template');
    }
    const settings = await this.prisma.client.projectSettings.findUnique({
      where: { projectId: access.project.id },
      select: { mainDocument: true },
    });
    const files = access.project.files;
    const text = files.filter((f) => !f.isFolder && f.content !== null && !f.filePath);
    const main =
      text.find((f) => f.path === settings?.mainDocument) ??
      text.find((f) => f.isMain) ??
      text.find((f) => f.path === 'main.tex');
    if (!main) {
      throw new BadRequestException('This project has no main .tex file to make a template from');
    }
    const rest = text.filter((f) => f.id !== main.id);
    if (rest.length > TEMPLATE_LIMITS.files) {
      throw new BadRequestException(`A template holds up to ${TEMPLATE_LIMITS.files} files besides the main one`);
    }
    const tooBig = [main, ...rest].find((f) => (f.content ?? '').length > TEMPLATE_LIMITS.content);
    if (tooBig) {
      throw new BadRequestException(`${tooBig.path} is too large for a template (1,000,000 characters at most)`);
    }
    const template = await this.create({
      userId,
      name: data.name,
      description: data.description,
      category: data.category,
      content: main.content ?? '',
      files: rest.map((f) => ({ path: f.path, content: f.content ?? '' })),
      isPublic: data.isPublic,
      tags: data.tags,
    });
    const leftOut = files.filter((f) => !f.isFolder && (f.content === null || !!f.filePath)).length;
    return { template: this.forAuthor(template), leftOut };
  }

  /** Start a new project from a template you own or an approved shared one. */
  async use(id: number, userId: number, title?: string) {
    const template = await this.prisma.client.template.findUnique({ where: { id } });
    const own = template?.userId === userId;
    if (!template || !(own || (template.isPublic && template.review === 'approved'))) {
      throw new NotFoundException('Template not found');
    }
    const files = Array.isArray(template.files)
      ? (template.files as { path?: unknown; content?: unknown }[])
          .filter((f) => typeof f?.path === 'string' && typeof f?.content === 'string')
          .map((f) => ({ path: f.path as string, content: f.content as string }))
      : [];
    const project = await this.projects.create({
      userId,
      title: (title?.trim() || template.name).slice(0, 200),
      templateContent: template.content,
      files,
    });
    if (!own) await this.incrementUsage(id);
    return { uid: project.uid, title: project.title };
  }

  /**
   * Create a new custom template.
   */
  async create(data: {
    userId: number;
    name: string;
    description?: string;
    category?: string;
    content: string;
    files?: { path: string; content: string }[];
    isPublic?: boolean;
    tags?: string[];
  }) {
    return this.prisma.client.template.create({
      data: {
        userId: data.userId,
        name: data.name,
        description: data.description,
        category: data.category || 'custom',
        content: data.content,
        files: data.files ?? undefined,
        isPublic: data.isPublic ?? false,
        review: data.isPublic ? 'pending' : 'none',
        tags: data.tags ?? [],
      },
    });
  }

  /**
   * Update a custom template. Only the owner can update.
   */
  async update(
    id: number,
    userId: number,
    data: {
      name?: string;
      description?: string;
      category?: string;
      content?: string;
      files?: { path: string; content: string }[];
      isPublic?: boolean;
      tags?: string[];
    },
  ) {
    const template = await this.prisma.client.template.findUnique({ where: { id } });

    if (!template) {
      throw new NotFoundException('Template not found');
    }
    if (template.userId !== userId) {
      throw new ForbiddenException('You can only edit your own templates');
    }

    // Shared templates go back for review after any change, so an approved
    // template cannot be swapped for something else afterwards.
    const shared = data.isPublic ?? template.isPublic;
    const review = shared ? 'pending' : 'none';

    return this.prisma.client.template.update({
      where: { id },
      data: {
        review,
        ...(review === 'pending' && { reviewNote: null, reviewedAt: null }),
        ...(data.name !== undefined && { name: data.name }),
        ...(data.description !== undefined && { description: data.description }),
        ...(data.category !== undefined && { category: data.category }),
        ...(data.content !== undefined && { content: data.content }),
        ...(data.files !== undefined && { files: data.files }),
        ...(data.isPublic !== undefined && { isPublic: data.isPublic }),
        ...(data.tags !== undefined && { tags: data.tags }),
      },
    });
  }

  /**
   * Delete a custom template. Only the owner can delete.
   */
  async remove(id: number, userId: number) {
    const template = await this.prisma.client.template.findUnique({ where: { id } });

    if (!template) {
      throw new NotFoundException('Template not found');
    }
    if (template.userId !== userId) {
      throw new ForbiddenException('You can only delete your own templates');
    }

    await this.prisma.client.template.delete({ where: { id } });
    return { success: true };
  }

  /**
   * Someone reports a shared template. One report per person; enough of them
   * take it out of the library until a reviewer looks at it again.
   */
  async report(id: number, userId: number, reason?: string) {
    const template = await this.prisma.client.template.findUnique({ where: { id } });
    if (!template || !(template.isPublic && template.review === 'approved')) {
      throw new NotFoundException('Template not found');
    }
    if (template.userId === userId) {
      throw new BadRequestException('You cannot report your own template');
    }
    if (template.reportedBy.includes(userId)) return { reported: true };

    const reportedBy = [...template.reportedBy, userId];
    const hide = reportedBy.length >= REPORTS_TO_HIDE;
    await this.prisma.client.template.update({
      where: { id },
      data: { reportedBy, ...(hide && { review: 'pending' }) },
    });
    this.logger.warn(
      `Template ${id} reported by user ${userId} (${reportedBy.length} reports)${hide ? ', hidden until reviewed' : ''}${reason ? `: ${reason.slice(0, 200)}` : ''}`,
    );
    return { reported: true };
  }

  /** Shared templates waiting for a reviewer, oldest first. */
  async reviewQueue(query: { page?: number; limit?: number }) {
    const { page = 1, limit = 20 } = query;
    const where = { isPublic: true, review: 'pending' as const };
    const [data, total] = await Promise.all([
      this.prisma.client.template.findMany({
        where,
        include: { user: { select: { id: true, name: true, email: true } } },
        orderBy: { updatedAt: 'asc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.client.template.count({ where }),
    ]);
    const totalPages = Math.ceil(total / limit);
    return {
      data: data.map((t) => this.forAuthor(t)),
      meta: { page, limit, total, totalPages, hasNext: page < totalPages, hasPrev: page > 1 },
    };
  }

  /** A reviewer approves or rejects a template waiting in the queue. */
  async decide(id: number, reviewerId: number, decision: 'approve' | 'reject', note?: string) {
    const template = await this.prisma.client.template.findUnique({ where: { id } });
    if (!template || !template.isPublic || template.review !== 'pending') {
      throw new NotFoundException('No template with that id is waiting for review');
    }
    const approved = decision === 'approve';
    this.logger.log(`Template ${id} ${approved ? 'approved' : 'rejected'} by user ${reviewerId}`);
    return this.prisma.client.template.update({
      where: { id },
      data: {
        review: approved ? 'approved' : 'rejected',
        reviewedAt: new Date(),
        reviewNote: note?.trim() || null,
        // A fresh approval starts the report count again.
        ...(approved && { reportedBy: [] }),
      },
    });
  }

  /**
   * Increment the usage counter when a template is used to create a project.
   */
  async incrementUsage(id: number) {
    await this.prisma.client.template.update({
      where: { id },
      data: { usageCount: { increment: 1 } },
    });
  }
}
