import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { ProjectsService } from './projects.service';
import { StorageService } from '../storage/storage.service';
import { PrismaService } from '../prisma/prisma.service';
import { EmailService } from '../email/email.service';
import { mockPrisma, mockConfig, mockEmail } from '../test-utils';

/**
 * `checkAccess` is the single function every project endpoint relies on to
 * decide whether a caller may see or edit a project. If it is wrong, every
 * route that trusts it is wrong, so it gets the most thorough test in the
 * codebase.
 */
describe('ProjectsService.checkAccess', () => {
  let service: ProjectsService;
  let prisma: ReturnType<typeof mockPrisma>;

  const OWNER = 1;
  const EDITOR = 2;
  const VIEWER = 3;
  const STRANGER = 99;

  function project(collaboratorsForCaller: Array<{ userId: number; role: string }>) {
    return {
      id: 10,
      uid: 'abc123',
      userId: OWNER,
      files: [],
      collaborators: collaboratorsForCaller,
    };
  }

  beforeEach(async () => {
    prisma = mockPrisma();
    const module = await Test.createTestingModule({
      providers: [
        ProjectsService,
        { provide: PrismaService, useValue: prisma },
        { provide: EmailService, useValue: mockEmail() },
        { provide: ConfigService, useValue: mockConfig() },
        { provide: StorageService, useValue: {} },
      ],
    }).compile();
    service = module.get(ProjectsService);
  });

  it('grants the owner full access', async () => {
    prisma.client.project.findUnique.mockResolvedValue(project([]));

    const access = await service.checkAccess('abc123', OWNER);

    expect(access.canView).toBe(true);
    expect(access.canEdit).toBe(true);
    expect(access.isOwner).toBe(true);
    expect(access.role).toBe('owner');
  });

  it('grants an editor collaborator view and edit, but not ownership', async () => {
    prisma.client.project.findUnique.mockResolvedValue(
      project([{ userId: EDITOR, role: 'editor' }]),
    );

    const access = await service.checkAccess('abc123', EDITOR);

    expect(access.canView).toBe(true);
    expect(access.canEdit).toBe(true);
    expect(access.isOwner).toBe(false);
    expect(access.role).toBe('editor');
  });

  it('grants a viewer collaborator view only', async () => {
    prisma.client.project.findUnique.mockResolvedValue(
      project([{ userId: VIEWER, role: 'viewer' }]),
    );

    const access = await service.checkAccess('abc123', VIEWER);

    expect(access.canView).toBe(true);
    expect(access.canEdit).toBe(false);
    expect(access.role).toBe('viewer');
  });

  it('denies a user with no relationship to the project', async () => {
    prisma.client.project.findUnique.mockResolvedValue(project([]));
    prisma.client.user.findUnique.mockResolvedValue({ email: 'stranger@example.com' });
    prisma.client.projectInvitation.findFirst.mockResolvedValue(null);

    const access = await service.checkAccess('abc123', STRANGER);

    expect(access.canView).toBe(false);
    expect(access.canEdit).toBe(false);
    expect(access.isOwner).toBe(false);
    expect(access.role).toBeNull();
  });

  it('lets a pending invitee view but never edit', async () => {
    prisma.client.project.findUnique.mockResolvedValue(project([]));
    prisma.client.user.findUnique.mockResolvedValue({ email: 'invitee@example.com' });
    prisma.client.projectInvitation.findFirst.mockResolvedValue({
      token: 'tok',
      role: 'editor',
    });

    const access = await service.checkAccess('abc123', STRANGER);

    expect(access.canView).toBe(true);
    // Even an invitation for the editor role does not confer edit until accepted.
    expect(access.canEdit).toBe(false);
    expect(access.pendingInvitation?.status).toBe('pending');
  });

  it('denies everything for a project that does not exist', async () => {
    prisma.client.project.findUnique.mockResolvedValue(null);

    const access = await service.checkAccess('missing', OWNER);

    expect(access.canView).toBe(false);
    expect(access.canEdit).toBe(false);
    expect(access.project).toBeNull();
  });

  it('only loads the collaborator row for the calling user', async () => {
    prisma.client.project.findUnique.mockResolvedValue(project([]));
    prisma.client.user.findUnique.mockResolvedValue({ email: 'x@example.com' });
    prisma.client.projectInvitation.findFirst.mockResolvedValue(null);

    await service.checkAccess('abc123', STRANGER);

    // The query must scope collaborators to the caller. Loading every
    // collaborator and filtering in JS would leak the roster to the caller.
    const call = prisma.client.project.findUnique.mock.calls[0][0];
    expect(call.include.collaborators.where).toEqual({ userId: STRANGER });
  });
});

describe('ProjectsService.updateFile optimistic locking', () => {
  let service: ProjectsService;
  let prisma: ReturnType<typeof mockPrisma>;

  beforeEach(async () => {
    prisma = mockPrisma();
    const module = await Test.createTestingModule({
      providers: [
        ProjectsService,
        { provide: PrismaService, useValue: prisma },
        { provide: EmailService, useValue: mockEmail() },
        { provide: ConfigService, useValue: mockConfig() },
        { provide: StorageService, useValue: {} },
      ],
    }).compile();
    service = module.get(ProjectsService);
  });

  it('rejects a write whose expectedVersion is stale', async () => {
    prisma.client.projectFile.findUnique.mockResolvedValue({
      id: 5,
      isFolder: false,
      path: 'main.tex',
      version: 7,
      content: 'server copy',
    });
    // The conditional UPDATE matched no rows: someone else saved first.
    prisma.client.projectFile.updateMany.mockResolvedValue({ count: 0 });

    await expect(
      service.updateFile(5, { content: 'my copy', expectedVersion: 6 }),
    ).rejects.toMatchObject({
      name: 'FileVersionConflictError',
      expectedVersion: 6,
      actualVersion: 7,
      currentContent: 'server copy',
    });
  });

  it('applies a write whose expectedVersion matches, in one conditional update', async () => {
    prisma.client.projectFile.findUnique
      .mockResolvedValueOnce({ id: 5, isFolder: false, path: 'main.tex', version: 7 })
      .mockResolvedValueOnce({ id: 5, version: 8, content: 'my copy' });
    prisma.client.projectFile.updateMany.mockResolvedValue({ count: 1 });

    const result = await service.updateFile(5, {
      content: 'my copy',
      expectedVersion: 7,
    });

    expect(prisma.client.projectFile.updateMany).toHaveBeenCalledWith({
      where: { id: 5, version: 7 },
      data: { content: 'my copy', version: { increment: 1 } },
    });
    expect(result?.version).toBe(8);
  });

  it('keeps last-writer-wins for callers that send no version', async () => {
    prisma.client.projectFile.findUnique.mockResolvedValue({
      id: 5,
      isFolder: false,
      path: 'main.tex',
      version: 7,
    });
    prisma.client.projectFile.update.mockResolvedValue({ id: 5, version: 8 });

    await service.updateFile(5, { content: 'unguarded' });

    expect(prisma.client.projectFile.updateMany).not.toHaveBeenCalled();
    expect(prisma.client.projectFile.update).toHaveBeenCalled();
  });
});
