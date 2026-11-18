import { siteUrls } from '../common/site';
import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { randomBytes } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { EmailService } from '../email/email.service';
import { ConfigService } from '@nestjs/config';
import { FileVersionConflictError } from './file-version-conflict.error';
import { StorageService } from '../storage/storage.service';

/** Generate a 16-char alphanumeric project UID, e.g. "8kX4mN2vRqZw3pT1" */
function generateProjectUid(): string {
  const ALPHABET =
    'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  const bytes = randomBytes(16);
  let id = '';
  for (let i = 0; i < 16; i++) {
    id += ALPHABET[bytes[i] % ALPHABET.length];
  }
  return id;
}

/** Generate a secure invitation token */
function generateInviteToken(): string {
  return randomBytes(32).toString('hex');
}

@Injectable()
export class ProjectsService {
  private readonly logger = new Logger(ProjectsService.name);

  constructor(
    private prisma: PrismaService,
    private emailService: EmailService,
    private configService: ConfigService,
    private storage: StorageService,
  ) {}

  // ---------- Binary files (images, PDFs, fonts) ----------

  /**
   * Store an image or other binary file in the project. The bytes go to
   * storage; the row keeps the key and size, and no text. Replacing a file
   * at the same path replaces its bytes. Missing folders are created.
   */
  async putAsset(
    projectId: number,
    path: string,
    data: Buffer,
    contentType: string,
  ) {
    const existing = await this.prisma.client.projectFile.findUnique({
      where: { projectId_path: { projectId, path } },
    });
    if (existing?.isFolder)
      throw new BadRequestException('A folder already has that name');
    if (existing?.isMain)
      throw new BadRequestException(
        'The main document cannot be replaced by a binary file',
      );

    const name = (path.split('/').pop() || 'file')
      .replace(/[^\w.-]/g, '_')
      .slice(-80);
    const key = `projects/${projectId}/${randomBytes(8).toString('hex')}-${name}`;
    await this.storage.uploadFile(
      data,
      key,
      contentType || 'application/octet-stream',
    );

    for (const folder of ProjectsService.foldersFor([{ path }])) {
      await this.prisma.client.projectFile.upsert({
        where: { projectId_path: { projectId, path: folder } },
        create: { projectId, path: folder, isFolder: true },
        update: {},
      });
    }

    if (existing) {
      const file = await this.prisma.client.projectFile.update({
        where: { id: existing.id },
        data: {
          content: null,
          filePath: key,
          size: data.length,
          version: { increment: 1 },
        },
      });
      if (existing.filePath)
        await this.storage.deleteFile(existing.filePath).catch(() => undefined);
      return file;
    }
    return this.prisma.client.projectFile.create({
      data: { projectId, path, filePath: key, size: data.length },
    });
  }

  /**
   * Add text to the end of a text file, creating it (and its folders) when
   * it does not exist. A blank line separates the addition from what is
   * there. For files nobody has open; see the gateway for live ones.
   */
  async appendText(projectId: number, path: string, addition: string) {
    const existing = await this.prisma.client.projectFile.findUnique({
      where: { projectId_path: { projectId, path } },
    });
    if (existing?.isFolder || existing?.filePath) {
      throw new BadRequestException('That is not a text file');
    }
    if (existing) {
      const current = existing.content ?? '';
      const sep = !current
        ? ''
        : current.endsWith('\n\n')
          ? ''
          : current.endsWith('\n')
            ? '\n'
            : '\n\n';
      return this.prisma.client.projectFile.update({
        where: { id: existing.id },
        data: { content: current + sep + addition, version: { increment: 1 } },
      });
    }
    for (const folder of ProjectsService.foldersFor([{ path }])) {
      await this.prisma.client.projectFile.upsert({
        where: { projectId_path: { projectId, path: folder } },
        create: { projectId, path: folder, isFolder: true },
        update: {},
      });
    }
    return this.prisma.client.projectFile.create({
      data: { projectId, path, content: addition },
    });
  }

  /** A binary file's bytes. */
  async readAsset(key: string): Promise<Buffer> {
    const { Body } = await this.storage.getObject(key);
    const chunks: Buffer[] = [];
    for await (const chunk of Body as AsyncIterable<
      Buffer | Uint8Array | string
    >) {
      chunks.push(
        typeof chunk === 'string' ? Buffer.from(chunk) : Buffer.from(chunk),
      );
    }
    return Buffer.concat(chunks);
  }

  /** Remove stored bytes, quietly: a missing object is already gone. */
  async dropAssets(keys: (string | null | undefined)[]) {
    await Promise.allSettled(
      keys
        .filter((k): k is string => !!k)
        .map((k) => this.storage.deleteFile(k)),
    );
  }

  // ---------- Access helpers ----------

  /**
   * Check what access a user has to a project.
   * Returns { canView, canEdit, isOwner, role, project, pendingInvitation? }.
   * Grants canView to owners, collaborators, and users with pending invitations.
   */
  /**
   * `files: false` leaves the project's files out of the answer (they are loaded with their full text otherwise): the collaboration socket checks access on every join and again every thirty seconds for everyone connected, and has no use for them.
   */
  async checkAccess(projectUid: string, userId: number, options: { files?: boolean } = {}) {
    const project = await this.prisma.client.project.findUnique({
      where: { uid: projectUid },
      include: {
        // No row has id 0, so this loads none while keeping the answer's shape.
        files: options.files === false ? { where: { id: 0 } } : true,
        collaborators: { where: { userId } },
      },
    });

    if (!project) {
      return {
        canView: false,
        canEdit: false,
        isOwner: false,
        role: null,
        project: null,
        pendingInvitation: null,
      };
    }

    // A reference paper has no collaborators of its own: whoever can open the project it is attached to can open it, with the same rights. Only its parent's owner (or whoever added it) counts as its owner.
    if (project.referenceOfId) {
      const parent = await this.prisma.client.project.findUnique({
        where: { id: project.referenceOfId },
        select: {
          userId: true,
          collaborators: { where: { userId }, select: { role: true } },
        },
      });
      const parentOwner = parent?.userId === userId;
      const parentRole = parent?.collaborators[0]?.role ?? null;
      const addedByUser = project.userId === userId;
      const canView = parentOwner || parentRole !== null || addedByUser;
      const canEdit = parentOwner || parentRole === 'editor' || addedByUser;
      return {
        canView,
        canEdit,
        isOwner: canView && (parentOwner || addedByUser),
        role: parentOwner || addedByUser ? 'owner' : parentRole,
        project,
        pendingInvitation: null,
      };
    }

    const isOwner = project.userId === userId;
    const collab = project.collaborators[0] ?? null;

    // User has accepted collaborator access
    if (isOwner || collab) {
      return {
        canView: true,
        canEdit: isOwner || collab?.role === 'editor',
        isOwner,
        role: isOwner ? 'owner' : (collab?.role ?? null),
        project,
        pendingInvitation: null,
      };
    }

    // Link sharing: the owner set the project to "anyone with the link can view" or "can edit". Anyone signed in who has the link gets that access, without being listed as a collaborator.
    if (project.access === 'view' || project.access === 'edit') {
      return {
        canView: true,
        canEdit: project.access === 'edit',
        isOwner: false,
        role: project.access === 'edit' ? 'editor' : 'viewer',
        project,
        pendingInvitation: null,
      };
    }

    // Check for pending invitation (user invited but not yet accepted)
    const user = await this.prisma.client.user.findUnique({
      where: { id: userId },
      select: { email: true },
    });
    if (!user) {
      return {
        canView: false,
        canEdit: false,
        isOwner: false,
        role: null,
        project,
        pendingInvitation: null,
      };
    }

    const pendingInv = await this.prisma.client.projectInvitation.findFirst({
      where: { projectId: project.id, email: user.email, status: 'pending' },
      select: { token: true, role: true },
    });

    if (pendingInv) {
      return {
        canView: true,
        canEdit: false, // Pending users cannot edit until they accept
        isOwner: false,
        role: pendingInv.role,
        project,
        pendingInvitation: {
          token: pendingInv.token,
          status: 'pending' as const,
          role: pendingInv.role,
        },
      };
    }

    return {
      canView: false,
      canEdit: false,
      isOwner: false,
      role: null,
      project,
      pendingInvitation: null,
    };
  }

  // ---------- Project CRUD ----------

  async findByUserId(userId: number) {
    // Shared select/include shape (no full files, list view just needs count)
    const projectInclude = {
      user: { select: { id: true, name: true, email: true, avatarUrl: true } },
      collaborators: {
        include: {
          user: {
            select: { id: true, name: true, email: true, avatarUrl: true },
          },
        },
      },
      _count: { select: { files: true } },
    } as const;

    // Fetch the user first (needed for invitation email lookup)
    const user = await this.prisma.client.user.findUnique({
      where: { id: userId },
    });

    // Fire all three data queries in parallel
    const [ownProjects, collabRecords, pendingInvites] = await Promise.all([
      // 1. Own projects
      this.prisma.client.project.findMany({
        // Reference papers live in their project's References panel, not in the list.
        where: { userId, referenceOfId: null },
        include: projectInclude,
        orderBy: { updatedAt: 'desc' },
      }),

      // 2. Projects shared with user
      this.prisma.client.projectCollaborator.findMany({
        where: { userId },
        include: {
          project: { include: projectInclude },
        },
      }),

      // 3. Pending invitations for this user's email
      user
        ? this.prisma.client.projectInvitation.findMany({
            where: {
              email: { equals: user.email, mode: 'insensitive' },
              status: 'pending',
            },
            include: {
              project: { include: projectInclude },
              inviter: { select: { id: true, name: true, email: true } },
            },
          })
        : Promise.resolve([]),
    ]);

    const pendingInviteProjects = pendingInvites.map((inv) => ({
      ...inv.project,
      isShared: true,
      myRole: inv.role,
      invitationToken: inv.token,
      invitationStatus: 'pending',
      ownerName: inv.project.user.name,
    }));

    const formatted = [
      ...ownProjects.map((p) => ({
        ...p,
        isShared: false,
        myRole: 'owner' as const,
        ownerName: p.user.name,
      })),
      ...collabRecords.map((c) => ({
        ...c.project,
        isShared: true,
        myRole: c.role,
        ownerName: c.project.user.name,
      })),
      ...pendingInviteProjects,
    ];

    // Deduplicate by project id (in case of both collab + pending invite)
    const seen = new Set<number>();
    const deduped = formatted.filter((p) => {
      if (seen.has(p.id)) return false;
      seen.add(p.id);
      return true;
    });

    return deduped.sort(
      (a, b) =>
        new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
    );
  }

  async findByUserIdPaginated(
    userId: number,
    query: { page: number; limit: number; sort: string; order: 'asc' | 'desc' },
  ) {
    const { page, limit, sort, order } = query;

    // Get all projects (reuse existing method)
    const all = await this.findByUserId(userId);

    // Sort
    const allowedSorts = ['title', 'createdAt', 'updatedAt'];
    const sortField = allowedSorts.includes(sort) ? sort : 'updatedAt';
    const sorted = all.sort((a: any, b: any) => {
      const aVal = a[sortField];
      const bVal = b[sortField];
      if (aVal == null && bVal == null) return 0;
      if (aVal == null) return 1;
      if (bVal == null) return -1;
      const cmp = aVal < bVal ? -1 : aVal > bVal ? 1 : 0;
      return order === 'asc' ? cmp : -cmp;
    });

    // Paginate
    const total = sorted.length;
    const totalPages = Math.ceil(total / limit);
    const start = (page - 1) * limit;
    const data = sorted.slice(start, start + limit);

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

  async findTitleById(id: number) {
    return this.prisma.client.project.findUnique({
      where: { id },
      select: { uid: true, title: true },
    });
  }

  async findByUid(uid: string) {
    return this.prisma.client.project.findUnique({
      where: { uid },
      include: {
        files: true,
        user: {
          select: { id: true, name: true, email: true, avatarUrl: true },
        },
        collaborators: {
          include: {
            user: {
              select: { id: true, name: true, email: true, avatarUrl: true },
            },
          },
        },
        invitations: {
          where: { status: 'pending' },
          select: {
            id: true,
            email: true,
            role: true,
            status: true,
            createdAt: true,
          },
        },
      },
    });
  }

  async create(data: {
    userId: number;
    title: string;
    templateContent?: string;
    /** More files besides main.tex, from a template. Folders are added for nested paths. */
    files?: { path: string; content: string }[];
    /** The project this one is a reference paper for. */
    referenceOfId?: number;
    arxivId?: string;
  }) {
    const defaultContent =
      data.templateContent ||
      `\\documentclass{article}
\\usepackage[utf8]{inputenc}
\\usepackage{amsmath, amssymb, amsthm}
\\usepackage{geometry}
\\geometry{margin=1in}

\\title{${data.title}}
\\author{}
\\date{\\today}

\\begin{document}
\\maketitle

\\section{Introduction}
Hello, world!

\\end{document}
`;

    const extra = (data.files ?? []).filter((f) => f.path !== 'main.tex');

    return this.prisma.client.project.create({
      data: {
        uid: generateProjectUid(),
        userId: data.userId,
        title: data.title,
        status: 'pending',
        referenceOfId: data.referenceOfId,
        arxivId: data.arxivId,
        files: {
          create: [
            { path: 'main.tex', content: defaultContent, isMain: true },
            ...ProjectsService.foldersFor(extra).map((path) => ({
              path,
              isFolder: true,
            })),
            ...extra.map((f) => ({ path: f.path, content: f.content })),
          ],
        },
      },
      include: { files: true },
    });
  }

  /** Every folder the given files sit in, parents first. */
  static foldersFor(files: { path: string }[]): string[] {
    const folders = new Set<string>();
    for (const f of files) {
      const parts = f.path.split('/');
      for (let i = 1; i < parts.length; i++)
        folders.add(parts.slice(0, i).join('/'));
    }
    return [...folders].sort(
      (a, b) => a.split('/').length - b.split('/').length,
    );
  }

  async update(
    uid: string,
    data: {
      title?: string;
      tags?: string[];
      color?: string;
      archived?: boolean;
      access?: 'private' | 'view' | 'edit';
      pendingAiDiff?: {
        edits: Array<{ path: string; oldContent: string; newContent: string }>;
        message?: string;
      } | null;
    },
  ) {
    return this.prisma.client.project.update({
      where: { uid },
      data: {
        ...(data.title !== undefined && { title: data.title }),
        ...(data.tags !== undefined && { tags: data.tags }),
        ...(data.color !== undefined && { color: data.color }),
        ...(data.archived !== undefined && { archived: data.archived }),
        ...(data.access !== undefined && { access: data.access }),
        ...(data.pendingAiDiff !== undefined && {
          pendingAiDiff: data.pendingAiDiff as object,
        }),
      },
      include: { files: true },
    });
  }

  async remove(uid: string) {
    // Deleting a project deletes its reference papers with it (cascade), so their stored files go too.
    const assets = await this.prisma.client.projectFile.findMany({
      where: {
        filePath: { not: null },
        OR: [{ project: { uid } }, { project: { referenceOf: { uid } } }],
      },
      select: { filePath: true },
    });
    const removed = await this.prisma.client.project.delete({
      where: { uid },
    });
    await this.dropAssets(assets.map((a) => a.filePath));
    return removed;
  }

  // ---------- References ----------

  /** The reference papers attached to a project, oldest first, each with its file list (no contents). */
  async listReferences(projectId: number) {
    const rows = await this.prisma.client.project.findMany({
      where: { referenceOfId: projectId },
      orderBy: { createdAt: 'asc' },
      select: {
        uid: true,
        title: true,
        arxivId: true,
        createdAt: true,
        files: {
          where: { isFolder: false },
          orderBy: { path: 'asc' },
          select: {
            id: true,
            path: true,
            isMain: true,
            filePath: true,
            size: true,
          },
        },
      },
    });
    return rows.map((r) => ({
      uid: r.uid,
      title: r.title,
      arxivId: r.arxivId,
      createdAt: r.createdAt,
      files: r.files.map((f) => ({
        id: f.id,
        path: f.path,
        isMain: f.isMain,
        isBinary: f.filePath !== null,
        size: f.size,
      })),
    }));
  }

  /**
   * The text files of a project's reference papers, for the assistant to read. Paths are prefixed `references/<arXiv id or uid>/` so they cannot collide with the project's own files. Capped so a shelf of long papers cannot grow without bound.
   */
  async referenceTexts(
    projectId: number,
    maxChars = 2_000_000,
  ): Promise<{ path: string; content: string }[]> {
    const rows = await this.prisma.client.project.findMany({
      where: { referenceOfId: projectId },
      orderBy: { createdAt: 'asc' },
      select: {
        uid: true,
        arxivId: true,
        files: {
          where: { isFolder: false, content: { not: null } },
          orderBy: { path: 'asc' },
          select: { path: true, content: true },
        },
      },
    });
    const out: { path: string; content: string }[] = [];
    let used = 0;
    for (const r of rows) {
      const prefix = `references/${(r.arxivId ?? r.uid).replace(/\//g, '_')}/`;
      for (const f of r.files) {
        const content = f.content ?? '';
        if (used + content.length > maxChars) continue;
        used += content.length;
        out.push({ path: prefix + f.path, content });
      }
    }
    return out;
  }

  // ---------- Collaboration ----------

  /** The project owner, as the Share dialog shows them. */
  async getOwner(userId: number) {
    return this.prisma.client.user.findUnique({
      where: { id: userId },
      select: { id: true, name: true, email: true, avatarUrl: true },
    });
  }

  async getCollaborators(projectId: number) {
    const collaborators = await this.prisma.client.projectCollaborator.findMany(
      {
        where: { projectId },
        include: {
          user: {
            select: { id: true, name: true, email: true, avatarUrl: true },
          },
        },
        orderBy: { addedAt: 'asc' },
      },
    );

    const pendingInvitations =
      await this.prisma.client.projectInvitation.findMany({
        where: { projectId, status: 'pending' },
        select: {
          id: true,
          email: true,
          role: true,
          status: true,
          createdAt: true,
        },
        orderBy: { createdAt: 'asc' },
      });

    return { collaborators, pendingInvitations };
  }

  async inviteCollaborator(
    projectId: number,
    email: string,
    role: 'viewer' | 'editor',
    invitedByUserId: number,
    projectTitle: string,
  ) {
    // Check if already a collaborator
    const existingUser = await this.prisma.client.user.findFirst({
      where: { email: { equals: email, mode: 'insensitive' } },
    });
    if (existingUser) {
      const existingCollab =
        await this.prisma.client.projectCollaborator.findUnique({
          where: { projectId_userId: { projectId, userId: existingUser.id } },
        });
      if (existingCollab) {
        throw new Error('User is already a collaborator on this project');
      }
      // Check if they're the owner
      const project = await this.prisma.client.project.findUnique({
        where: { id: projectId },
      });
      if (project && project.userId === existingUser.id) {
        throw new Error('Cannot invite the project owner');
      }
    }

    // Upsert invitation (handles resending)
    const token = generateInviteToken();
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days

    const invitation = await this.prisma.client.projectInvitation.upsert({
      where: { projectId_email: { projectId, email } },
      update: { role, token, status: 'pending', expiresAt },
      create: {
        projectId,
        email,
        role,
        token,
        invitedBy: invitedByUserId,
        expiresAt,
      },
    });

    // Get inviter info
    const inviter = await this.prisma.client.user.findUnique({
      where: { id: invitedByUserId },
      select: { name: true },
    });

    // Send invite email
    const frontendUrl = siteUrls().frontend;
    if (!frontendUrl) {
      this.logger.warn('Neither DOMAIN_NAME nor FRONTEND_URL is set: the invitation email link will be broken');
    }
    const acceptUrl = `${frontendUrl}/invite/${token}`;

    await this.emailService.sendProjectInviteEmail(
      email,
      inviter?.name || 'A Eneles user',
      projectTitle,
      role,
      acceptUrl,
    );

    this.logger.log(
      `Invitation sent to ${email} for project ${projectId} with role ${role}`,
    );

    return invitation;
  }

  async acceptInvitation(token: string, userId: number) {
    const invitation = await this.prisma.client.projectInvitation.findUnique({
      where: { token },
    });

    if (!invitation) {
      throw new Error('Invitation not found');
    }

    if (invitation.status !== 'pending') {
      throw new Error('Invitation has already been ' + invitation.status);
    }

    if (new Date() > invitation.expiresAt) {
      throw new Error('Invitation has expired');
    }

    // Verify the accepting user's email matches the invitation
    const user = await this.prisma.client.user.findUnique({
      where: { id: userId },
    });
    if (!user || user.email.toLowerCase() !== invitation.email.toLowerCase()) {
      throw new Error('This invitation was sent to a different email address');
    }

    // Create collaborator and mark invitation as accepted in one transaction
    const [collaborator] = await this.prisma.client.$transaction([
      // An upsert, not a create: someone already on the project (added directly, or accepting a second invitation) takes the invitation's role instead of hitting a unique-constraint error.
      this.prisma.client.projectCollaborator.upsert({
        where: { projectId_userId: { projectId: invitation.projectId, userId } },
        create: {
          projectId: invitation.projectId,
          userId,
          role: invitation.role,
        },
        update: { role: invitation.role },
        include: {
          user: {
            select: { id: true, name: true, email: true, avatarUrl: true },
          },
        },
      }),
      this.prisma.client.projectInvitation.update({
        where: { id: invitation.id },
        data: { status: 'accepted' },
      }),
    ]);

    this.logger.log(
      `User ${userId} accepted invitation for project ${invitation.projectId}`,
    );
    return collaborator;
  }

  async declineInvitation(token: string, userId: number) {
    const invitation = await this.prisma.client.projectInvitation.findUnique({
      where: { token },
    });

    if (!invitation) {
      throw new Error('Invitation not found');
    }

    const user = await this.prisma.client.user.findUnique({
      where: { id: userId },
    });
    if (!user || user.email.toLowerCase() !== invitation.email.toLowerCase()) {
      throw new Error('This invitation was sent to a different email address');
    }

    await this.prisma.client.projectInvitation.update({
      where: { id: invitation.id },
      data: { status: 'declined' },
    });

    return { success: true };
  }

  async cancelInvitation(projectId: number, invitationId: number) {
    const invitation = await this.prisma.client.projectInvitation.findFirst({
      where: { id: invitationId, projectId },
    });

    if (!invitation) {
      throw new Error('Invitation not found');
    }

    if (invitation.status !== 'pending') {
      throw new Error('Invitation has already been ' + invitation.status);
    }

    await this.prisma.client.projectInvitation.delete({
      where: { id: invitation.id },
    });

    this.logger.log(
      `Invitation ${invitationId} for project ${projectId} was cancelled`,
    );

    return { success: true };
  }

  async removeCollaborator(projectId: number, targetUserId: number) {
    await this.prisma.client.projectCollaborator.delete({
      where: { projectId_userId: { projectId, userId: targetUserId } },
    });
    return { success: true };
  }

  async updateCollaboratorRole(
    projectId: number,
    targetUserId: number,
    role: 'viewer' | 'editor',
  ) {
    return this.prisma.client.projectCollaborator.update({
      where: { projectId_userId: { projectId, userId: targetUserId } },
      data: { role },
      include: {
        user: {
          select: { id: true, name: true, email: true, avatarUrl: true },
        },
      },
    });
  }

  // ---------- File operations ----------

  async getFile(projectId: number, fileId: number) {
    return this.prisma.client.projectFile.findFirst({
      where: { id: fileId, projectId },
    });
  }

  /** Makes one file the project's main document and clears the flag on the rest. */
  async markMainFile(projectId: number, fileId: number) {
    await this.prisma.client.$transaction([
      this.prisma.client.projectFile.updateMany({
        where: { projectId, isMain: true, NOT: { id: fileId } },
        data: { isMain: false },
      }),
      this.prisma.client.projectFile.update({
        where: { id: fileId },
        data: { isMain: true },
      }),
    ]);
  }

  async getFileByPath(projectId: number, path: string) {
    return this.prisma.client.projectFile.findUnique({
      where: { projectId_path: { projectId, path } },
    });
  }

  /**
   * Fetch a single file's text content by project UID + path.
   * Used by the collaboration gateway to seed the server-authoritative
   * Y.Text exactly once from disk. Returns null when the file is missing or
   * is a folder.
   */
  async getFileContentByPath(
    projectUid: string,
    path: string,
  ): Promise<string | null> {
    const file = await this.prisma.client.projectFile.findFirst({
      where: { project: { uid: projectUid }, path, isFolder: false },
      select: { content: true },
    });
    return file?.content ?? null;
  }

  /**
   * Write a file's text content by project UID + path.
   *
   * Used by the collaboration gateway to flush the server-authoritative
   * Y.Text back to the database when a room empties or the process shuts
   * down, so content survives even if no client managed a REST autosave.
   *
   * This deliberately bypasses the `expectedVersion` check in `updateFile`:
   * the CRDT has already reconciled every concurrent edit, so its content is
   * by definition the merged result and there is nothing to conflict with.
   * The version counter is still bumped so REST clients holding a stale
   * version find out.
   *
   * Returns false when the file no longer exists (deleted mid-session).
   */
  async writeFileContentByPath(
    projectUid: string,
    path: string,
    content: string,
  ): Promise<boolean> {
    const file = await this.prisma.client.projectFile.findFirst({
      where: { project: { uid: projectUid }, path, isFolder: false },
      select: { id: true, filePath: true },
    });
    // A binary file has no text to write.
    if (!file || file.filePath) return false;

    await this.prisma.client.projectFile.update({
      where: { id: file.id },
      data: { content, version: { increment: 1 } },
    });
    return true;
  }

  async createFile(
    projectId: number,
    data: {
      path: string;
      content?: string;
      filePath?: string;
      isMain?: boolean;
      isFolder?: boolean;
    },
  ) {
    return this.prisma.client.projectFile.create({
      data: {
        projectId,
        path: data.path,
        content: data.isFolder ? null : (data.content ?? ''),
        filePath: data.filePath,
        isMain: data.isMain || false,
        isFolder: data.isFolder || false,
      },
    });
  }

  async updateFile(
    fileId: number,
    data: {
      path?: string;
      content?: string;
      filePath?: string;
      expectedVersion?: number;
    },
  ) {
    const { expectedVersion, ...fields } = data;

    const file = await this.prisma.client.projectFile.findUnique({
      where: { id: fileId },
    });
    if (!file) return null;
    if (file.isFolder && fields.path && fields.path !== file.path) {
      const oldPrefix = file.path + '/';
      const newPrefix = fields.path + '/';
      const children = await this.prisma.client.projectFile.findMany({
        where: { projectId: file.projectId, path: { startsWith: oldPrefix } },
      });
      await this.prisma.client.$transaction([
        this.prisma.client.projectFile.update({
          where: { id: fileId },
          data: { path: fields.path },
        }),
        ...children.map((c) =>
          this.prisma.client.projectFile.update({
            where: { id: c.id },
            data: { path: newPrefix + c.path.slice(oldPrefix.length) },
          }),
        ),
      ]);
      const updated = await this.prisma.client.projectFile.findUnique({
        where: { id: fileId },
      });
      return updated as NonNullable<typeof updated>;
    }

    const isContentWrite = fields.content !== undefined;

    // Optimistic locking. Only enforced when the caller states which version it
    // read, so existing clients keep working unchanged. The check and the write
    // share one conditional UPDATE. Doing it as read-then-write would
    // reintroduce exactly the race it exists to close.
    if (isContentWrite && expectedVersion !== undefined) {
      const result = await this.prisma.client.projectFile.updateMany({
        where: { id: fileId, version: expectedVersion },
        data: { ...fields, version: { increment: 1 } },
      });

      if (result.count === 0) {
        throw new FileVersionConflictError(
          expectedVersion,
          file.version,
          file.content ?? '',
        );
      }

      return this.prisma.client.projectFile.findUnique({
        where: { id: fileId },
      });
    }

    return this.prisma.client.projectFile.update({
      where: { id: fileId },
      data: isContentWrite ? { ...fields, version: { increment: 1 } } : fields,
    });
  }

  async deleteFile(fileId: number, projectId: number) {
    const file = await this.prisma.client.projectFile.findFirst({
      where: { id: fileId, projectId },
    });
    if (!file) return;
    if (file.isFolder) {
      // Delete all files and folders under this path, then the folder itself
      const under = {
        projectId,
        OR: [{ path: file.path }, { path: { startsWith: `${file.path}/` } }],
      };
      const assets = await this.prisma.client.projectFile.findMany({
        where: { ...under, filePath: { not: null } },
        select: { filePath: true },
      });
      await this.prisma.client.projectFile.deleteMany({ where: under });
      await this.dropAssets(assets.map((a) => a.filePath));
    } else {
      await this.prisma.client.projectFile.delete({ where: { id: fileId } });
      await this.dropAssets([file.filePath]);
    }
  }

  // ---- Compilation helpers ----

  async getProjectFiles(projectId: number) {
    return this.prisma.client.projectFile.findMany({
      where: { projectId, isFolder: false },
      select: { id: true, path: true, content: true, filePath: true },
    });
  }

  // ---- File History (Overleaf-style, 30-day TTL) ----

  /** List history snapshots for a file, newest first. Omits content for list performance. */
  async getFileHistory(projectId: number, filePath: string) {
    return this.prisma.client.fileHistory.findMany({
      where: { projectId, filePath },
      orderBy: { version: 'desc' },
      select: {
        id: true,
        version: true,
        label: true,
        userId: true,
        createdAt: true,
        expiresAt: true,
        // content intentionally omitted, fetched only on restore
      },
    });
  }

  // Versions are written by HistoryService (history.service.ts), which also records who made them.

  /** Fetch a single history entry with full content (for restore). */
  async getHistoryEntry(projectId: number, id: number) {
    return this.prisma.client.fileHistory.findFirst({
      where: { id, projectId },
    });
  }

  /** Add or update a user label on a history snapshot. */
  async labelHistoryEntry(projectId: number, id: number, label: string) {
    // Verify the entry belongs to this project
    const entry = await this.prisma.client.fileHistory.findFirst({
      where: { id, projectId },
    });
    if (!entry) return null;
    return this.prisma.client.fileHistory.update({
      where: { id },
      data: { label },
      select: { id: true, version: true, label: true },
    });
  }
}
