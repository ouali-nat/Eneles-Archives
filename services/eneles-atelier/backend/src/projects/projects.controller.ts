import { siteUrls } from '../common/site';
import {
  Body,
  Controller,
  Delete,
  Get,
  Logger,
  Param,
  Patch,
  Post,
  Put,
  Query,
  Headers,
  Res,
  Req,
  HttpException,
  HttpStatus,
  UseGuards,
  UseInterceptors,
  UploadedFile,
  Body as FormBody,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { UsageService } from '../usage/usage.service';
import { PROJECT_FILE_PATH } from './dto/file-path';

/** The compiler takes files up to 10 MB. */
const MAX_PROJECT_ASSET_BYTES = 10 * 1024 * 1024;
import type { Request as ExpressRequest, Response as ExpressResponse } from 'express';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { ConfigService } from '@nestjs/config';
import { ProjectsService } from './projects.service';
import { SettingsService } from '../settings/settings.service';
import { StorageService } from '../storage/storage.service';
import { AiChatService } from '../ai/ai-chat.service';
import { AiChatDto } from './dto/ai-chat.dto';
import { chatInput, streamChat } from '../ai/ai-chat-http';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { RevisionsService } from './revisions.service';
import { HistoryService } from './history.service';
import { FileVersionConflictError } from './file-version-conflict.error';
import { compiledSourcesFor } from './compiled-sources';
import {
  CreateProjectDto,
  UpdateProjectDto,
  InviteCollaboratorDto,
  UpdateCollaboratorRoleDto,
  CreateFileDto,
  UpdateFileDto,
  UpdateProjectSettingsDto,
} from './dto';
import { CreateRevisionDto, PushUndoDto } from './dto/revision.dto';
import { PaginationQueryDto } from '../common/dto/pagination.dto';
import { ModuleRef } from '@nestjs/core';
import { CollaborationGateway } from '../collaboration/collaboration.gateway';

/** How many reference papers one project can hold. */
const MAX_REFERENCES = 30;

@Controller('projects')
export class ProjectsController {
  private readonly logger = new Logger(ProjectsController.name);

  constructor(
    private readonly projectsService: ProjectsService,
    private readonly configService: ConfigService,
    private readonly settingsService: SettingsService,
    private readonly storageService: StorageService,
    private readonly usageService: UsageService,
    private readonly aiChatService: AiChatService,
    private readonly revisionsService: RevisionsService,
    private readonly historyService: HistoryService,
    private readonly moduleRef: ModuleRef,
  ) {}

  /** The collaboration gateway, looked up when needed: its module already depends on this one, so it cannot be injected here. */
  private get live(): CollaborationGateway {
    return this.moduleRef.get(CollaborationGateway, { strict: false });
  }

  /**
   * Require at least view access. Returns { project, isOwner, canEdit, role }.
   */
  private async requireAccess(userId: number, uid: string, needEdit = false) {
    const access = await this.projectsService.checkAccess(uid, userId);

    if (!access.canView) {
      throw new HttpException('Project not found', HttpStatus.NOT_FOUND);
    }
    if (needEdit && !access.canEdit) {
      throw new HttpException(
        'You do not have edit access to this project',
        HttpStatus.FORBIDDEN,
      );
    }

    return { userId, ...access };
  }

  // ---- Project CRUD ----

  @Get()
  async findAll(
    @CurrentUser() userId: number,
    @Query() query: PaginationQueryDto,
  ) {
    return this.projectsService.findByUserIdPaginated(userId, {
      page: query.page ?? 1,
      limit: query.limit ?? 20,
      sort: query.sort ?? 'updatedAt',
      order: query.order ?? 'desc',
    });
  }

  @Get(':uid')
  async findOne(@CurrentUser() userId: number, @Param('uid') uid: string) {
    const { project, role, isOwner, pendingInvitation } =
      await this.requireAccess(userId, uid);
    // Fetch full project with owner, collaborators (with user), and invitations for complete response
    const fullProject = await this.projectsService.findByUid(uid);
    if (!fullProject) {
      throw new HttpException('Project not found', HttpStatus.NOT_FOUND);
    }
    // For a reference paper, name the project it belongs to so the editor can link back.
    const referenceOf = fullProject.referenceOfId
      ? await this.projectsService.findTitleById(fullProject.referenceOfId)
      : null;
    return {
      ...fullProject,
      referenceOf,
      myRole: role,
      isShared: !isOwner,
      ...(pendingInvitation && {
        invitationToken: pendingInvitation.token,
        invitationStatus: pendingInvitation.status,
      }),
    };
  }

  @Post()
  async create(@CurrentUser() userId: number, @Body() body: CreateProjectDto) {
    // A reference paper is attached to a project the caller can edit, and never to another reference.
    let referenceOfId: number | undefined;
    if (body.referenceOf) {
      const parent = await this.requireAccess(userId, body.referenceOf, true);
      if (parent.project!.referenceOfId) {
        throw new HttpException(
          'A reference paper cannot have references of its own',
          HttpStatus.BAD_REQUEST,
        );
      }
      const count = await this.projectsService.listReferences(
        parent.project!.id,
      );
      if (count.length >= MAX_REFERENCES) {
        throw new HttpException(
          `A project can hold up to ${MAX_REFERENCES} reference papers`,
          HttpStatus.BAD_REQUEST,
        );
      }
      referenceOfId = parent.project!.id;
    }

    return this.projectsService.create({
      userId,
      title: body.title || 'Untitled Document',
      templateContent: body.templateContent,
      referenceOfId,
      arxivId: referenceOfId ? body.arxivId : undefined,
    });
  }

  // ---- References ----

  /** The reference papers attached to a project, with their file lists. */
  @Get(':uid/references')
  async listReferences(
    @CurrentUser() userId: number,
    @Param('uid') uid: string,
  ) {
    const { project } = await this.requireAccess(userId, uid);
    return this.projectsService.listReferences(project!.id);
  }

  /** Detach and delete a reference paper. Anyone who can edit the project can. */
  @Delete(':uid/references/:refUid')
  async removeReference(
    @CurrentUser() userId: number,
    @Param('uid') uid: string,
    @Param('refUid') refUid: string,
  ) {
    const { project } = await this.requireAccess(userId, uid, true);
    const reference = await this.projectsService.findByUid(refUid);
    if (!reference || reference.referenceOfId !== project!.id) {
      throw new HttpException('Reference not found', HttpStatus.NOT_FOUND);
    }
    await this.projectsService.remove(refUid);
    return { success: true };
  }

  @Put(':uid')
  async update(
    @CurrentUser() userId: number,
    @Param('uid') uid: string,
    @Body() body: UpdateProjectDto,
  ) {
    const access = await this.projectsService.checkAccess(uid, userId);

    if (!access.canView) {
      throw new HttpException('Project not found', HttpStatus.NOT_FOUND);
    }

    const hasNonTitleChanges =
      body.tags !== undefined ||
      body.color !== undefined ||
      body.archived !== undefined ||
      body.access !== undefined;
    if (hasNonTitleChanges && !access.isOwner) {
      throw new HttpException(
        'Only the project owner can change tags, color, archive status, or link sharing',
        HttpStatus.FORBIDDEN,
      );
    }
    if (
      (body.title !== undefined || body.pendingAiDiff !== undefined) &&
      !access.canEdit
    ) {
      throw new HttpException(
        'You do not have edit access',
        HttpStatus.FORBIDDEN,
      );
    }

    return this.projectsService.update(uid, body);
  }

  @Delete(':uid')
  async remove(@CurrentUser() userId: number, @Param('uid') uid: string) {
    const access = await this.projectsService.checkAccess(uid, userId);

    if (!access.isOwner) {
      throw new HttpException(
        'Only the project owner can delete a project',
        HttpStatus.FORBIDDEN,
      );
    }

    return this.projectsService.remove(uid);
  }

  // ---- Export ----

  @Get(':uid/export')
  async exportProject(
    @CurrentUser() userId: number,
    @Param('uid') uid: string,
  ) {
    const { project } = await this.requireAccess(userId, uid);
    const files = project!.files.filter((f: any) => !f.isFolder);
    return {
      name: project!.title,
      files: await Promise.all(
        files.map(async (f: any) => {
          if (!f.filePath) return { path: f.path, content: f.content ?? '' };
          try {
            const data = await this.projectsService.readAsset(f.filePath);
            return {
              path: f.path,
              content: data.toString('base64'),
              encoding: 'base64',
            };
          } catch {
            return { path: f.path, content: '', missing: true };
          }
        }),
      ),
    };
  }

  // ---- Collaboration ----

  @Get(':uid/collaborators')
  async getCollaborators(
    @CurrentUser() userId: number,
    @Param('uid') uid: string,
  ) {
    const { project } = await this.requireAccess(userId, uid);
    const [people, owner] = await Promise.all([
      this.projectsService.getCollaborators(project!.id),
      this.projectsService.getOwner(project!.userId),
    ]);
    // Everything the Share dialog shows, in one answer: who owns the project, who is on it, who is invited, and the link-sharing setting.
    return { ...people, owner, access: project!.access };
  }

  @Post(':uid/collaborators')
  async inviteCollaborator(
    @CurrentUser() userId: number,
    @Param('uid') uid: string,
    @Body() body: InviteCollaboratorDto,
  ) {
    const {
      userId: ownerId,
      project,
      isOwner,
    } = await this.requireAccess(userId, uid);

    if (!isOwner) {
      throw new HttpException(
        'Only the project owner can invite collaborators',
        HttpStatus.FORBIDDEN,
      );
    }

    try {
      return await this.projectsService.inviteCollaborator(
        project!.id,
        body.email,
        body.role ?? 'viewer',
        ownerId,
        project!.title,
      );
    } catch (err: any) {
      throw new HttpException(
        err.message || 'Failed to invite collaborator',
        HttpStatus.BAD_REQUEST,
      );
    }
  }

  @Delete(':uid/invitations/:invitationId')
  async cancelInvitation(
    @CurrentUser() userId: number,
    @Param('uid') uid: string,
    @Param('invitationId') invitationId: string,
  ) {
    const { project, isOwner } = await this.requireAccess(userId, uid);

    if (!isOwner) {
      throw new HttpException(
        'Only the project owner can cancel invitations',
        HttpStatus.FORBIDDEN,
      );
    }

    try {
      return await this.projectsService.cancelInvitation(
        project!.id,
        +invitationId,
      );
    } catch (err: any) {
      throw new HttpException(
        err.message || 'Failed to cancel invitation',
        HttpStatus.BAD_REQUEST,
      );
    }
  }

  @Patch(':uid/collaborators/:collaboratorUserId')
  async updateCollaboratorRole(
    @CurrentUser() userId: number,
    @Param('uid') uid: string,
    @Param('collaboratorUserId') collaboratorUserId: string,
    @Body() body: UpdateCollaboratorRoleDto,
  ) {
    const { project, isOwner } = await this.requireAccess(userId, uid);

    if (!isOwner) {
      throw new HttpException(
        'Only the project owner can change roles',
        HttpStatus.FORBIDDEN,
      );
    }

    try {
      return await this.projectsService.updateCollaboratorRole(
        project!.id,
        +collaboratorUserId,
        body.role,
      );
    } catch (err: any) {
      throw new HttpException(
        err.message || 'Failed to update role',
        HttpStatus.BAD_REQUEST,
      );
    }
  }

  @Delete(':uid/collaborators/:collaboratorUserId')
  async removeCollaborator(
    @CurrentUser() userId: number,
    @Param('uid') uid: string,
    @Param('collaboratorUserId') collaboratorUserId: string,
  ) {
    const access = await this.projectsService.checkAccess(uid, userId);

    if (!access.canView) {
      throw new HttpException('Project not found', HttpStatus.NOT_FOUND);
    }

    const targetUserId = +collaboratorUserId;
    if (!access.isOwner && userId !== targetUserId) {
      throw new HttpException(
        'Only the project owner can remove other collaborators',
        HttpStatus.FORBIDDEN,
      );
    }

    try {
      return await this.projectsService.removeCollaborator(
        access.project!.id,
        targetUserId,
      );
    } catch (err: any) {
      throw new HttpException(
        err.message || 'Failed to remove collaborator',
        HttpStatus.BAD_REQUEST,
      );
    }
  }

  // ---- Invitation acceptance ----

  @Post('invitations/:token/accept')
  async acceptInvitation(
    @CurrentUser() userId: number,
    @Param('token') token: string,
  ) {
    try {
      return await this.projectsService.acceptInvitation(token, userId);
    } catch (err: any) {
      throw new HttpException(
        err.message || 'Failed to accept invitation',
        HttpStatus.BAD_REQUEST,
      );
    }
  }

  @Post('invitations/:token/decline')
  async declineInvitation(
    @CurrentUser() userId: number,
    @Param('token') token: string,
  ) {
    try {
      return await this.projectsService.declineInvitation(token, userId);
    } catch (err: any) {
      throw new HttpException(
        err.message || 'Failed to decline invitation',
        HttpStatus.BAD_REQUEST,
      );
    }
  }

  // ---- File CRUD ----

  @Get(':uid/files')
  async getFiles(@CurrentUser() userId: number, @Param('uid') uid: string) {
    const { project } = await this.requireAccess(userId, uid);
    return project!.files;
  }

  @Post(':uid/files')
  async createFile(
    @CurrentUser() userId: number,
    @Param('uid') uid: string,
    @Body() body: CreateFileDto,
  ) {
    const { project } = await this.requireAccess(userId, uid, true);
    const created = await this.projectsService.createFile(project!.id, body);
    // A new file starts from what was just written, not from text an older file of the same name left in the shared document.
    if (body.path) await this.live.forgetPaths(uid, body.path);
    this.live.announce(uid, 'files-changed', { reason: 'tree', by: userId });
    return created;
  }

  /**
   * POST /projects/:uid/files/upload: an image, PDF, font, or other binary
   * file. Multipart, field `file`; optional `path` (defaults to the file's
   * name). Counts against the project owner's upload storage.
   */
  @Post(':uid/files/upload')
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { ttl: 60000, limit: 60 } })
  @UseInterceptors(
    FileInterceptor('file', { limits: { fileSize: MAX_PROJECT_ASSET_BYTES } }),
  )
  async uploadFile(
    @CurrentUser() userId: number,
    @Param('uid') uid: string,
    @UploadedFile()
    file:
      | { buffer: Buffer; size: number; originalname: string; mimetype: string }
      | undefined,
    @FormBody('path') pathField?: string,
  ) {
    const { project } = await this.requireAccess(userId, uid, true);
    if (!file?.buffer)
      throw new HttpException('No file was sent', HttpStatus.BAD_REQUEST);
    const path = (pathField || file.originalname || '').trim();
    if (!path || path.length > 500 || !PROJECT_FILE_PATH.test(path)) {
      throw new HttpException(
        'That file name or path is not allowed',
        HttpStatus.BAD_REQUEST,
      );
    }
    await this.usageService.assertUploadFits(
      project!.userId,
      file.size || file.buffer.length,
    );
    const saved = await this.projectsService.putAsset(
      project!.id,
      path,
      file.buffer,
      file.mimetype,
    );
    const { content: _c, ...rest } = saved;
    return rest;
  }

  /** GET /projects/:uid/files/:fileId/raw: a binary file's bytes. */
  @Get(':uid/files/:fileId/raw')
  async rawFile(
    @CurrentUser() userId: number,
    @Param('uid') uid: string,
    @Param('fileId') fileId: string,
    @Res() res: ExpressResponse,
  ) {
    const { project } = await this.requireAccess(userId, uid);
    const file = await this.projectsService.getFile(project!.id, +fileId);
    if (!file || !file.filePath)
      throw new HttpException('File not found', HttpStatus.NOT_FOUND);
    const data = await this.projectsService.readAsset(file.filePath);
    const ext = file.path.split('.').pop()?.toLowerCase() ?? '';
    const types: Record<string, string> = {
      png: 'image/png',
      jpg: 'image/jpeg',
      jpeg: 'image/jpeg',
      gif: 'image/gif',
      webp: 'image/webp',
      pdf: 'application/pdf',
    };
    // SVG and anything unknown are sent as downloads, never rendered from
    // this origin, so a file cannot run script here.
    res.setHeader('Content-Type', types[ext] ?? 'application/octet-stream');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader(
      'Content-Security-Policy',
      "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox",
    );
    res.setHeader('Cache-Control', 'private, max-age=60');
    // The editor shows images from here; it is a different origin on the same site.
    res.setHeader('Cross-Origin-Resource-Policy', 'same-site');
    if (!types[ext]) {
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="${(file.path.split('/').pop() || 'file').replace(/["\\]/g, '_')}"`,
      );
    }
    res.send(data);
  }

  @Put(':uid/files/:fileId')
  async updateFile(
    @CurrentUser() userId: number,
    @Param('uid') uid: string,
    @Param('fileId') fileId: string,
    @Body() body: UpdateFileDto,
  ) {
    const { project } = await this.requireAccess(userId, uid, true);

    const file = await this.projectsService.getFile(project!.id, +fileId);
    if (!file) {
      throw new HttpException('File not found', HttpStatus.NOT_FOUND);
    }

    try {
      const updated = await this.projectsService.updateFile(+fileId, body);
      // A rename or a move of the main document (or of a folder above it) takes the compiler's entry point with it.
      if (body.path && body.path !== file.path) {
        const settings = await this.settingsService.getProjectSettings(
          project!.id,
        );
        const main = settings.mainDocument;
        const moved =
          main === file.path
            ? body.path
            : file.isFolder && main.startsWith(file.path + '/')
              ? body.path + main.slice(file.path.length)
              : null;
        if (moved)
          await this.settingsService.updateProjectSettings(project!.id, {
            mainDocument: moved,
          });
        // The text people are editing live is keyed by path: it moves too, and everyone else's file list follows.
        this.live.movePaths(uid, file.path, body.path);
        // History stays under the path each version was saved at; the move is recorded so the History panel can say where the file went.
        await this.historyService.recordMove(project!.id, file.path, body.path);
        this.live.announce(uid, 'files-changed', { reason: 'tree', by: userId });
      }
      return updated;
    } catch (err) {
      if (err instanceof FileVersionConflictError) {
        // 409 with the current server state attached, so the client can show a
        // diff and let the user merge instead of silently losing a save.
        throw new HttpException(
          {
            statusCode: HttpStatus.CONFLICT,
            error: 'File version conflict',
            message:
              'This file was changed by someone else while you were editing.',
            expectedVersion: err.expectedVersion,
            currentVersion: err.actualVersion,
            currentContent: err.currentContent,
          },
          HttpStatus.CONFLICT,
        );
      }
      throw err;
    }
  }

  @Delete(':uid/files/:fileId')
  async deleteFile(
    @CurrentUser() userId: number,
    @Param('uid') uid: string,
    @Param('fileId') fileId: string,
  ) {
    const { project } = await this.requireAccess(userId, uid, true);

    const file = await this.projectsService.getFile(project!.id, +fileId);
    if (!file) {
      throw new HttpException('File not found', HttpStatus.NOT_FOUND);
    }

    if (file.isMain) {
      throw new HttpException(
        'Cannot delete the main file',
        HttpStatus.BAD_REQUEST,
      );
    }

    await this.projectsService.deleteFile(+fileId, project!.id);
    // The deleted file's live text goes with it, and everyone else's file list follows.
    await this.live.forgetPaths(uid, file.path);
    this.live.announce(uid, 'files-changed', { reason: 'tree', by: userId });
    return { success: true };
  }

  // ---- Project Settings ----

  @Get(':uid/settings')
  async getProjectSettings(
    @CurrentUser() userId: number,
    @Param('uid') uid: string,
  ) {
    const { project } = await this.requireAccess(userId, uid);
    return this.settingsService.getProjectSettings(project!.id);
  }

  @Put(':uid/settings')
  async updateProjectSettings(
    @CurrentUser() userId: number,
    @Param('uid') uid: string,
    @Body() body: UpdateProjectSettingsDto,
  ) {
    const { project } = await this.requireAccess(userId, uid, true);
    // The main document is two facts that must agree: the path in the settings (what the compiler starts from) and the flag on the file (which the tree marks and which cannot be deleted).
    if (body.mainDocument !== undefined) {
      const file = await this.projectsService.getFileByPath(
        project!.id,
        body.mainDocument,
      );
      if (!file || file.isFolder || file.filePath || !/\.(tex|ltx)$/i.test(file.path)) {
        throw new HttpException(
          'The main document must be a .tex file in this project',
          HttpStatus.BAD_REQUEST,
        );
      }
      await this.projectsService.markMainFile(project!.id, file.id);
    }
    return this.settingsService.updateProjectSettings(project!.id, body);
  }

  // ---- Compilation ----

  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { ttl: 60000, limit: 10 } }) // 10 compiles per minute per IP
  @Post(':uid/compile')
  async compile(
    @CurrentUser() userId: number,
    @Param('uid') uid: string,
    @Body()
    body: {
      engine?: string;
      compileMode?: string;
      stopOnFirstError?: boolean;
      mainFile?: string;
    },
  ) {
    const { project } = await this.requireAccess(userId, uid);

    // The compiler is at compile.<DOMAIN_NAME>, or wherever COMPILER_URL says (localhost in development, a private address in production).
    const compilerUrl = siteUrls().compiler;
    if (!compilerUrl) {
      throw new HttpException(
        'The compiler is not set up on this server: set DOMAIN_NAME or COMPILER_URL.',
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }

    // Fetch all project files. Binary ones (images, PDFs) are read from
    // storage and sent as base64.
    const storedFiles = await this.projectsService.getProjectFiles(project!.id);
    const projectFiles = await Promise.all(
      storedFiles.map(async (f) => {
        if (!f.filePath)
          return { ...f, encoding: undefined as 'base64' | undefined };
        try {
          const data = await this.projectsService.readAsset(f.filePath);
          return {
            ...f,
            content: data.toString('base64'),
            encoding: 'base64' as const,
          };
        } catch {
          return null;
        }
      }),
    ).then((list) =>
      list.filter((f): f is NonNullable<typeof f> => f !== null),
    );
    if (!projectFiles.length) {
      throw new HttpException('No files in project', HttpStatus.BAD_REQUEST);
    }

    // Get project settings for defaults
    const settings = (await this.settingsService.getProjectSettings(
      project!.id,
    )) as {
      mainDocument: string;
      compiler: string;
      texLiveVersion: string;
      compileMode: string;
      stopOnFirstError: boolean;
      autoCompile: boolean;
      tabSize: number;
      macrosEnabled: boolean;
      snippetsEnabled: boolean;
    };

    // ── Preamble injection: user macros + standard theorem environments ──
    const mainFileName = body.mainFile || settings.mainDocument;

    // Concatenate all file contents once, used for "is it used?" checks below
    const allContent = projectFiles
      .filter((f) => !f.encoding)
      .map((f) => f.content || '')
      .join('\n');

    // Built-in LaTeX commands that must NEVER be overridden via \providecommand.
    // These already exist in the LaTeX kernel or standard packages.
    const BUILTIN_COMMANDS = new Set([
      'hat',
      'tilde',
      'bar',
      'vec',
      'dot',
      'ddot',
      'breve',
      'check',
      'acute',
      'grave',
      'log',
      'lg',
      'ln',
      'exp',
      'sin',
      'cos',
      'tan',
      'sec',
      'csc',
      'cot',
      'sinh',
      'cosh',
      'tanh',
      'arcsin',
      'arccos',
      'arctan',
      'det',
      'dim',
      'gcd',
      'hom',
      'ker',
      'inf',
      'sup',
      'lim',
      'max',
      'min',
      'Pr',
      'deg',
      'arg',
      'mod',
      'bmod',
      'pmod',
      'alpha',
      'beta',
      'gamma',
      'delta',
      'epsilon',
      'varepsilon',
      'zeta',
      'eta',
      'theta',
      'vartheta',
      'iota',
      'kappa',
      'lambda',
      'mu',
      'nu',
      'xi',
      'pi',
      'varpi',
      'rho',
      'varrho',
      'sigma',
      'varsigma',
      'tau',
      'upsilon',
      'phi',
      'varphi',
      'chi',
      'psi',
      'omega',
      'Gamma',
      'Delta',
      'Theta',
      'Lambda',
      'Xi',
      'Pi',
      'Sigma',
      'Upsilon',
      'Phi',
      'Psi',
      'Omega',
      'hbar',
      'dagger',
      'times',
      'div',
      'pm',
      'mp',
      'cdot',
      'left',
      'right',
      'big',
      'Big',
      'bigg',
      'Bigg',
      'it',
      'bf',
      'rm',
      'sf',
      'tt',
      'em',
      'sl',
      'quad',
      'qquad',
      'hfill',
      'vfill',
      'par',
      'item',
    ]);

    let macroBlock = '';
    if (settings.macrosEnabled !== false) {
      try {
        const userMacros = await this.settingsService.getMacros(userId);
        if (userMacros.length > 0) {
          const lines: string[] = [];
          lines.push('% ── Eneles auto-injected macros ──');
          for (const m of userMacros) {
            // Skip names that aren't valid LaTeX command names (must be purely a-zA-Z)
            if (!/^[a-zA-Z]+$/.test(m.name)) continue;

            // Short macro names (1-2 chars like R, N, al, cO, be, de, dd, etc.)
            // are editor typing shortcuts, NOT meant to be \providecommand defs.
            // Only inject them if the user has explicitly customized them.
            if (m.name.length <= 2 && !m.isCustom) continue;

            // Skip built-in LaTeX commands, since overriding them would break things
            if (BUILTIN_COMMANDS.has(m.name)) continue;

            // Only inject macros that are actually used in the document
            // (look for \name followed by a non-letter, or at end of string)
            const usageRe = new RegExp(`\\\\${m.name}(?![a-zA-Z])`);
            if (!usageRe.test(allContent)) continue;

            // Skip macros the user has already defined manually in their files.
            // Their \newcommand / \renewcommand / \def always takes priority.
            const userDefinedRe = new RegExp(
              `\\\\(?:new|renew|provide)command\\*?\\s*\\{\\\\${m.name}\\}` +
                `|\\\\def\\s*\\\\${m.name}(?![a-zA-Z])`,
            );
            if (userDefinedRe.test(allContent)) continue;

            // Count the highest #N argument placeholder in the expansion
            let argCount = 0;
            const argRe = /#(\d+)/g;
            let am: RegExpExecArray | null;
            while ((am = argRe.exec(m.expansion)) !== null) {
              const n = parseInt(am[1], 10);
              if (n > argCount) argCount = n;
            }
            const argSpec = argCount > 0 ? `[${argCount}]` : '';
            lines.push(
              `\\providecommand{\\${m.name}}${argSpec}{${m.expansion}}`,
            );
          }
          if (lines.length > 1) {
            // Only add the block if we actually have macros to inject
            macroBlock = lines.join('\n') + '\n';
          }
        }
      } catch (err) {
        this.logger.warn(
          'Failed to load user macros for preamble injection',
          err,
        );
      }
    }

    // Standard theorem-like environments, only injected when snippets are enabled
    // and the environment is used but not already defined by the user.
    const THEOREM_ENVS: [string, string][] = [
      ['definition', 'Definition'],
      ['theorem', 'Theorem'],
      ['lemma', 'Lemma'],
      ['corollary', 'Corollary'],
      ['proposition', 'Proposition'],
      ['example', 'Example'],
      ['remark', 'Remark'],
      ['note', 'Note'],
      ['conjecture', 'Conjecture'],
      ['notation', 'Notation'],
      ['observation', 'Observation'],
      ['assumption', 'Assumption'],
      ['axiom', 'Axiom'],
      ['property', 'Property'],
      ['claim', 'Claim'],
      ['exercise', 'Exercise'],
      ['problem', 'Problem'],
      ['solution', 'Solution'],
      ['question', 'Question'],
    ];

    // Check if amsthm is already loaded
    const hasAmsthm = /\\usepackage(?:\[.*?\])?\{.*?amsthm.*?\}/.test(
      allContent,
    );
    const hasAmsmath = /\\usepackage(?:\[.*?\])?\{.*?amsmath.*?\}/.test(
      allContent,
    );

    // Build theorem environment definitions for environments that are
    // actually used in the document but not yet defined
    const thmLines: string[] = [];
    if (settings.snippetsEnabled !== false) {
      for (const [envName, displayName] of THEOREM_ENVS) {
        const isUsed = allContent.includes(`\\begin{${envName}}`);
        // Skip if the user has their own \newtheorem{name} definition
        const isDefined = new RegExp(`\\\\newtheorem\\*?\\{${envName}\\}`).test(
          allContent,
        );
        if (isUsed && !isDefined) {
          thmLines.push(`\\newtheorem{${envName}}{${displayName}}`);
        }
      }
    }

    // Inject into the main file's preamble (right before \begin{document})
    const compiledFiles = projectFiles.map((f) => {
      let content = f.content || '';
      if (f.path === mainFileName) {
        const beginDocIdx = content.indexOf('\\begin{document}');
        if (beginDocIdx >= 0) {
          let injection = '';

          // Add amsmath/amsthm if needed and not present
          if (thmLines.length > 0 || macroBlock) {
            if (!hasAmsmath) injection += '\\usepackage{amsmath}\n';
            if (!hasAmsthm && thmLines.length > 0)
              injection += '\\usepackage{amsthm}\n';
          }

          if (macroBlock) injection += macroBlock;

          if (thmLines.length > 0) {
            injection +=
              '% ── Eneles auto-injected theorem environments ──\n' +
              thmLines.join('\n') +
              '\n';
          }

          if (injection) {
            content =
              content.slice(0, beginDocIdx) +
              injection +
              content.slice(beginDocIdx);
          }
        }
      }
      return f.encoding
        ? { path: f.path, content: f.content, encoding: f.encoding }
        : { path: f.path, content };
    });

    // Build the compile request
    const compilePayload = {
      files: compiledFiles,
      mainFile: mainFileName,
      engine: body.engine || settings.compiler,
      compileMode: body.compileMode || settings.compileMode,
      stopOnFirstError: body.stopOnFirstError ?? settings.stopOnFirstError,
    };

    const COMPILER_TIMEOUT_MS = 120000;
    const RATE_LIMIT_RETRY_DELAY_MS = 1100; // slightly over 1 req/sec
    const MAX_RATE_LIMIT_RETRIES = 90; // ~99s max wait

    try {
      let response: Response;
      let rateLimitRetries = 0;

      while (true) {
        response = await fetch(`${compilerUrl}/compile`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(compilePayload),
          signal: AbortSignal.timeout(COMPILER_TIMEOUT_MS),
        });

        if (
          response.status === 429 &&
          rateLimitRetries < MAX_RATE_LIMIT_RETRIES
        ) {
          rateLimitRetries++;
          await new Promise((r) => setTimeout(r, RATE_LIMIT_RETRY_DELAY_MS));
          continue;
        }

        break;
      }

      if (!response.ok) {
        // The compiler refuses some requests with its own explanation (a forbidden command, too many compiles at once, a full queue). That is a failed compile, not a broken server: it goes back as one, so the editor shows the reason in the log like any other error.
        const refusal = (await response.json().catch(() => null)) as { errors?: unknown; log?: unknown } | null;
        const reasons = Array.isArray(refusal?.errors) ? refusal.errors.filter((e): e is string => typeof e === 'string' && e.length > 0) : [];
        if (reasons.length) {
          return { success: false, pdf: null, log: typeof refusal?.log === 'string' ? refusal.log : reasons.join('\n'), errors: reasons, duration: 0 };
        }
        throw new HttpException('The compiler could not handle this request. Try again in a moment.', HttpStatus.BAD_GATEWAY);
      }

      const result = await response.json();

      // The text TeX read, for the files SyncTeX names. Its line numbers count these texts, not the editor's: the injection above adds lines to the main file, and people type while a compile runs.
      const compiled = result as {
        success?: boolean;
        synctex?: unknown;
        sources?: Record<string, string>;
      };
      if (compiled.success && typeof compiled.synctex === 'string') {
        compiled.sources = compiledSourcesFor(compiled.synctex, compiledFiles);
      }

      // Upload PDF to builds bucket (archival) but keep base64 in the response
      // so the frontend can display it without any cross-origin fetch to S3.
      if (result.success && result.pdf) {
        try {
          const buffer = Buffer.from(result.pdf, 'base64');
          const key = `builds/${project!.id}/${Date.now()}_output.pdf`;
          await this.storageService.uploadBuild(buffer, key, 'application/pdf');
          // Expose the bucket key so the frontend can download the archived
          // PDF via the authenticated /projects/:uid/pdf?key=... proxy.
          // This gives the download button a "true snapshot" source that
          // isn't tied to the in-memory Uint8Array (which pdf.js detaches).
          result.buildKey = key;
        } catch (uploadError) {
          this.logger.error('Failed to upload build artifact:', uploadError);
        }
        // Always keep result.pdf (base64). The frontend converts it to a
        // blob URL. No signed URL needed, no CORS issues.
        delete result.url;
      }

      return result;
    } catch (err: any) {
      if (err instanceof HttpException) throw err;
      this.logger.error(`Compile request failed: ${err?.message}`);
      if (err?.name === 'TimeoutError' || err?.name === 'AbortError') {
        throw new HttpException('The compile took too long and was stopped. Large documents can take a while: try draft mode, or compile again.', HttpStatus.GATEWAY_TIMEOUT);
      }
      throw new HttpException('The compiler is not answering. Try again in a moment.', HttpStatus.BAD_GATEWAY);
    }
  }

  // ---- PDF build proxy (avoids S3 CORS issues for react-pdf) ----

  // ---- SyncTeX reverse-sync (PDF coordinate -> source file/line) ----
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { ttl: 60000, limit: 120 } }) // generous: one per double-click
  @Post(':uid/synctex')
  async resolveSyncTex(
    @CurrentUser() userId: number,
    @Param('uid') uid: string,
    @Body()
    body: {
      synctex?: string;
      mainFile?: string;
      page?: number;
      x?: number;
      y?: number;
    },
  ) {
    await this.requireAccess(userId, uid);

    if (!body?.synctex || typeof body.synctex !== 'string') {
      throw new HttpException('Missing synctex data', HttpStatus.BAD_REQUEST);
    }
    if (
      !Number.isFinite(body.page) ||
      !Number.isFinite(body.x) ||
      !Number.isFinite(body.y)
    ) {
      throw new HttpException(
        'Invalid page or coordinates',
        HttpStatus.BAD_REQUEST,
      );
    }

    // The compiler is at compile.<DOMAIN_NAME>, or wherever COMPILER_URL says (localhost in development, a private address in production).
    const compilerUrl = siteUrls().compiler;
    if (!compilerUrl) {
      throw new HttpException(
        'The compiler is not set up on this server: set DOMAIN_NAME or COMPILER_URL.',
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }

    try {
      const response = await fetch(`${compilerUrl}/synctex`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          synctex: body.synctex,
          mainFile: body.mainFile || 'main.tex',
          page: body.page,
          x: body.x,
          y: body.y,
        }),
        signal: AbortSignal.timeout(15000),
      });

      if (!response.ok) {
        const errorBody = await response.text();
        throw new HttpException(
          `SyncTeX service error: ${errorBody}`,
          HttpStatus.BAD_GATEWAY,
        );
      }

      const data = (await response.json()) as {
        success: boolean;
        file?: string;
        line?: number;
        column?: number;
        error?: string;
      };
      return data;
    } catch (err: any) {
      if (err instanceof HttpException) throw err;
      throw new HttpException(
        `Failed to reach compiler service: ${err.message}`,
        HttpStatus.BAD_GATEWAY,
      );
    }
  }

  @Get(':uid/pdf')
  async getPdf(
    @CurrentUser() userId: number,
    @Param('uid') uid: string,
    @Query('key') key: string,
    @Res() res: ExpressResponse,
  ) {
    if (!key || !key.startsWith('builds/')) {
      throw new HttpException('Invalid build key', HttpStatus.BAD_REQUEST);
    }

    // Verify the user has access to this project
    const { project } = await this.requireAccess(userId, uid);

    // Verify the key belongs to this project (key format: builds/{projectId}/...)
    const expectedPrefix = `builds/${project!.id}/`;
    if (!key.startsWith(expectedPrefix)) {
      throw new HttpException('Build not found', HttpStatus.NOT_FOUND);
    }

    try {
      const { Body, ContentType } = await this.storageService.getObject(
        key,
        'builds',
      );
      res.setHeader('Content-Type', ContentType || 'application/pdf');
      res.setHeader('Content-Disposition', 'inline; filename="output.pdf"');
      res.setHeader('Cache-Control', 'private, max-age=3600');
      (Body as NodeJS.ReadableStream).pipe(res);
    } catch (err: any) {
      this.logger.error(`Failed to stream build PDF: ${err.message}`);
      throw new HttpException('Build not found', HttpStatus.NOT_FOUND);
    }
  }

  /** Checks one assistant request before anything is sent: edit access, then the question itself (ai-chat-http.ts). The input carries the reference papers the assistant may read. */
  private async prepareAiChat(userId: number, uid: string, body: AiChatDto) {
    const { canEdit, project } = await this.requireAccess(userId, uid, true);
    if (!canEdit) throw new HttpException('You need edit access to use AI chat', HttpStatus.FORBIDDEN);
    const input = chatInput(userId, body);
    // Reference papers attached to the project: the assistant can read them for context but never change them.
    input.references = await this.projectsService.referenceTexts(project!.id);
    return input;
  }

  /** The whole answer at once, for API clients. The editor uses the stream below. */
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { ttl: 60000, limit: 30 } })
  @Post(':uid/ai/chat')
  async aiChat(@CurrentUser() userId: number, @Param('uid') uid: string, @Body() body: AiChatDto) {
    const input = await this.prepareAiChat(userId, uid, body);
    return this.aiChatService.chat({ ...input, provider: body.provider, model: body.model });
  }

  /** The assistant's answer as server-sent events (streamChat in ai-chat-http.ts says what is sent). A project that is not on Eneles asks at `POST /ai/chat/stream` instead. */
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { ttl: 60000, limit: 30 } }) // per address; the assistant also limits each person (ai-limits.ts)
  @Post(':uid/ai/chat/stream')
  async aiChatStream(@CurrentUser() userId: number, @Param('uid') uid: string, @Body() body: AiChatDto, @Req() req: ExpressRequest, @Res() res: ExpressResponse) {
    const input = await this.prepareAiChat(userId, uid, body);
    await streamChat(this.aiChatService, body, input, req, res);
  }

  // ---- File History ----

  /** Access for the history routes: the same rule as every project route (viewers read, editors write), without loading every file's text to decide it. */
  private async historyAccess(userId: number, uid: string, needEdit = false) {
    const access = await this.projectsService.checkAccess(uid, userId, {
      files: false,
    });
    if (!access.canView || !access.project) {
      throw new HttpException('Project not found', HttpStatus.NOT_FOUND);
    }
    if (needEdit && !access.canEdit) {
      throw new HttpException(
        'You do not have edit access to this project',
        HttpStatus.FORBIDDEN,
      );
    }
    return access.project;
  }

  /** A file's text as it is now: what people are editing live when it is open, else what is stored; null when there is no such file. */
  private async currentText(uid: string, path: string) {
    return (
      this.live.liveText(uid, path) ??
      (await this.projectsService.getFileContentByPath(uid, path))
    );
  }

  /**
   * The project's history. With an `x-file-path` header and no query (what older clients send), that one file's versions as a plain list, as before. Otherwise the timeline across every file, newest first, a page at a time: `path` and `author` (each may repeat) narrow it to those files and those people, `cursor` is the `nextCursor` of the page before, and `limit` is the page size (at most 100).
   */
  @Get(':uid/history')
  async getHistory(
    @CurrentUser() userId: number,
    @Param('uid') uid: string,
    @Headers('x-file-path') filePath: string | undefined,
    @Query('path') path?: string | string[],
    @Query('author') author?: string | string[],
    @Query('cursor') cursor?: string,
    @Query('limit') limit?: string,
  ) {
    const project = await this.historyAccess(userId, uid);
    const list = (v?: string | string[]) =>
      (Array.isArray(v) ? v : v ? [v] : []).filter(Boolean);
    const paths = list(path);
    const authors = list(author)
      .map(Number)
      .filter((n) => Number.isInteger(n) && n > 0);
    if (filePath && !paths.length && !authors.length && !cursor && !limit) {
      return this.projectsService.getFileHistory(project.id, filePath);
    }
    const after = cursor ? Number(cursor) : undefined;
    return this.historyService.timeline(project.id, {
      paths,
      authors,
      cursor: after && Number.isInteger(after) ? after : undefined,
      limit: limit ? Number(limit) || undefined : undefined,
    });
  }

  /** Everyone who has history in the project (people who have left it, and accounts since deleted, too), and every path with history (deleted and renamed files marked so). */
  @Get(':uid/history/facets')
  async getHistoryFacets(
    @CurrentUser() userId: number,
    @Param('uid') uid: string,
  ) {
    const project = await this.historyAccess(userId, uid);
    return this.historyService.facets(project.id);
  }

  /** One version with the texts to compare: against the version before it (`against=previous`, the default), or against the file as it is now (`against=current`). */
  @Get(':uid/history/:historyId/compare')
  async compareHistory(
    @CurrentUser() userId: number,
    @Param('uid') uid: string,
    @Param('historyId') historyId: string,
    @Query('against') against?: string,
  ) {
    const project = await this.historyAccess(userId, uid);
    const result = await this.historyService.compare(
      project.id,
      +historyId,
      against === 'current' ? 'current' : 'previous',
      (p) => this.currentText(uid, p),
    );
    if (!result) {
      throw new HttpException('History entry not found', HttpStatus.NOT_FOUND);
    }
    return result;
  }

  /** Create a history snapshot for a file (called on every save and autosave). Its authors are the people whose live changes to the file it carries, or the saver when there are none. */
  @Post(':uid/history')
  async createHistorySnapshot(
    @CurrentUser() userId: number,
    @Param('uid') uid: string,
    @Body() body: { filePath: string; content: string; label?: string },
  ) {
    const project = await this.historyAccess(userId, uid, true);
    if (!body.filePath || typeof body.content !== 'string') {
      throw new HttpException(
        'filePath and content are required',
        HttpStatus.BAD_REQUEST,
      );
    }
    return this.historyService.createSnapshot({
      projectId: project.id,
      projectUid: uid,
      filePath: body.filePath,
      content: body.content,
      savedById: userId,
      label: body.label,
    });
  }

  /**
   * Restore a version. Without `apply`, only returns its text (what older clients do with it is theirs). With `apply`, the server restores it: the file's text as it is now is kept as a version first (with whoever changed it live since the last one), then the file is set to the restored text through the live document, so everyone with it open sees the change at once, and in the stored file (made again if it was deleted); the restore is a version of its own, credited to the person restoring.
   */
  @Post(':uid/history/:historyId/restore')
  async restoreHistorySnapshot(
    @CurrentUser() userId: number,
    @Param('uid') uid: string,
    @Param('historyId') historyId: string,
    @Body() body?: { apply?: boolean },
  ) {
    const project = await this.historyAccess(userId, uid, true);
    const entry = await this.projectsService.getHistoryEntry(
      project.id,
      +historyId,
    );
    if (!entry) {
      throw new HttpException('History entry not found', HttpStatus.NOT_FOUND);
    }
    if (!body?.apply) {
      return {
        content: entry.content,
        filePath: entry.filePath,
        version: entry.version,
      };
    }

    const path = entry.filePath;
    const before = await this.currentText(uid, path);
    if (before !== null) {
      await this.historyService.createSnapshot({
        projectId: project.id,
        projectUid: uid,
        filePath: path,
        content: before,
        savedById: userId,
        creditSaver: false,
      });
    }
    let file = await this.projectsService.getFileByPath(project.id, path);
    if (file?.isFolder || file?.filePath) {
      throw new HttpException(
        'Something else now has this path, so this version cannot be restored there.',
        HttpStatus.CONFLICT,
      );
    }
    const created = !file;
    if (!file) {
      file = await this.projectsService.createFile(project.id, {
        path,
        content: entry.content,
      });
      await this.live.forgetPaths(uid, path);
    } else {
      file = await this.projectsService.updateFile(file.id, {
        content: entry.content,
      });
    }
    const live = await this.live.replaceLiveText(uid, path, entry.content);
    const restorer = await this.projectsService.getOwner(userId);
    await this.historyService.createSnapshot({
      projectId: project.id,
      projectUid: uid,
      filePath: path,
      content: entry.content,
      savedById: userId,
      restoredFromId: entry.id,
      force: created,
      authors: new Map([
        [userId, { edits: 0, name: restorer?.name ?? 'Someone' }],
      ]),
    });
    // Everyone reloads the file list (and its stored versions), the restorer included: a file made again is new to all of them.
    this.live.announce(uid, 'files-changed', { reason: 'restore', by: userId });
    return {
      content: entry.content,
      filePath: path,
      version: entry.version,
      fileId: file?.id ?? null,
      fileVersion: file?.version ?? null,
      created,
      live,
    };
  }

  /** Add a user label to a history snapshot ("Submitted to journal"). */
  @Patch(':uid/history/:historyId/label')
  async labelHistorySnapshot(
    @CurrentUser() userId: number,
    @Param('uid') uid: string,
    @Param('historyId') historyId: string,
    @Body() body: { label: string },
  ) {
    const { project } = await this.requireAccess(userId, uid, true);
    return this.projectsService.labelHistoryEntry(
      project!.id,
      +historyId,
      body.label,
    );
  }

  // ---- Revisions (published checkpoints) ----

  /** List all revisions for a project. */
  @Get(':uid/revisions')
  async listRevisions(
    @CurrentUser() userId: number,
    @Param('uid') uid: string,
  ) {
    const { project } = await this.requireAccess(userId, uid);
    return this.revisionsService.listRevisions(project!.id);
  }

  /** Get a single revision with full delta. */
  @Get(':uid/revisions/:revisionId')
  async getRevision(
    @CurrentUser() userId: number,
    @Param('uid') uid: string,
    @Param('revisionId') revisionId: string,
  ) {
    const { project } = await this.requireAccess(userId, uid);
    return this.revisionsService.getRevision(project!.id, +revisionId);
  }

  /** Create a revision (publish checkpoint). Snapshots all current project files. */
  @Post(':uid/revisions')
  async createRevision(
    @CurrentUser() userId: number,
    @Param('uid') uid: string,
    @Body() body: CreateRevisionDto,
  ) {
    const { project } = await this.requireAccess(userId, uid, true);
    // Snapshot all current file contents as the delta
    const files = project!.files
      .filter((f: any) => !f.isFolder)
      .map((f: any) => ({ path: f.path, content: f.content ?? '' }));
    return this.revisionsService.createRevision(project!.id, {
      message: body.message,
      delta: files,
    });
  }

  /** Restore a project to a specific revision. */
  @Post(':uid/revisions/:revisionId/restore')
  async restoreRevision(
    @CurrentUser() userId: number,
    @Param('uid') uid: string,
    @Param('revisionId') revisionId: string,
  ) {
    const { project } = await this.requireAccess(userId, uid, true);
    return this.revisionsService.restoreRevision(project!.id, +revisionId);
  }

  // ---- Undo Stack ----

  /** Get the undo stack for a project. */
  @Get(':uid/undo')
  async getUndoStack(@CurrentUser() userId: number, @Param('uid') uid: string) {
    const { project } = await this.requireAccess(userId, uid);
    return this.revisionsService.getUndoStack(project!.id);
  }

  /** Push an undo entry. */
  @Post(':uid/undo')
  async pushUndo(
    @CurrentUser() userId: number,
    @Param('uid') uid: string,
    @Body() body: PushUndoDto,
  ) {
    const { project } = await this.requireAccess(userId, uid, true);
    return this.revisionsService.pushUndo(project!.id, body);
  }

  /** Pop the latest undo entry (undo the last edit). */
  @Post(':uid/undo/pop')
  async popUndo(@CurrentUser() userId: number, @Param('uid') uid: string) {
    const { project } = await this.requireAccess(userId, uid, true);
    const entry = await this.revisionsService.popUndo(project!.id);
    if (!entry) {
      throw new HttpException('Nothing to undo', HttpStatus.NOT_FOUND);
    }
    return entry;
  }

  /** Clear the undo stack. */
  @Delete(':uid/undo')
  async clearUndoStack(
    @CurrentUser() userId: number,
    @Param('uid') uid: string,
  ) {
    const { project } = await this.requireAccess(userId, uid, true);
    return this.revisionsService.clearUndoStack(project!.id);
  }
}
