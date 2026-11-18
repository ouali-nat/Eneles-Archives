/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-argument, @typescript-eslint/require-await -- the Prisma double is deliberately loose */
import { HistoryService, resolveMove } from './history.service';
import { lineChangeCounts } from './history-diff';
import { mockPrisma } from '../test-utils';

const UID = 'proj1';
const PROJECT = 10;
const RAZZ = 1;
const ARIA = 2;
const KENJI = 3;

describe('lineChangeCounts', () => {
  it('counts nothing for identical texts', () => {
    expect(lineChangeCounts('a\nb\n', 'a\nb\n')).toEqual({
      added: 0,
      removed: 0,
    });
  });

  it('counts a changed line as one removed and one added', () => {
    expect(lineChangeCounts('a\nb\nc\n', 'a\nB\nc\n')).toEqual({
      added: 1,
      removed: 1,
    });
  });

  it('counts lines added and removed in the middle of a file', () => {
    const before = [
      '\\section{A}',
      'one',
      'two',
      'three',
      '\\end{document}',
    ].join('\n');
    const after = [
      '\\section{A}',
      'one',
      'one and a half',
      'three',
      'four',
      '\\end{document}',
    ].join('\n');
    expect(lineChangeCounts(before, after)).toEqual({ added: 2, removed: 1 });
  });

  it('counts a whole new file as added and an emptied one as removed', () => {
    expect(lineChangeCounts('', 'a\nb\nc')).toEqual({ added: 3, removed: 0 });
    expect(lineChangeCounts('a\nb\n', '')).toEqual({ added: 0, removed: 2 });
  });

  it('estimates, never over, when the exact count would take too long', () => {
    const before = Array.from({ length: 400 }, (_, i) => `old ${i}`).join('\n');
    const after = Array.from({ length: 400 }, (_, i) => `new ${i}`).join('\n');
    expect(lineChangeCounts(before, after, 10)).toEqual({
      added: 400,
      removed: 400,
    });
  });
});

describe('resolveMove', () => {
  const moves = [
    { fromPath: 'chapters', toPath: 'parts' },
    { fromPath: 'intro.tex', toPath: 'chapters/intro.tex' },
  ];

  it('follows a file rename and a later folder rename to where the file is now', () => {
    expect(resolveMove('intro.tex', moves, new Set(['parts/intro.tex']))).toBe(
      'parts/intro.tex',
    );
  });

  it('says a renamed file that was later deleted is gone, and a file never moved was deleted', () => {
    expect(resolveMove('intro.tex', moves, new Set())).toBe('');
    expect(resolveMove('old.tex', moves, new Set())).toBe(false);
  });
});

describe('HistoryService', () => {
  let prisma: ReturnType<typeof mockPrisma>;
  let service: HistoryService;

  beforeEach(() => {
    prisma = mockPrisma();
    service = new HistoryService(prisma as any);
    prisma.client.user.findUnique.mockImplementation(({ where }: any) => ({
      id: where.id,
      name: { [RAZZ]: 'Razz', [ARIA]: 'Aria', [KENJI]: 'Kenji' }[
        where.id as number
      ],
    }));
    prisma.client.fileHistory.create.mockImplementation(({ data }: any) => ({
      id: 99,
      version: data.version,
    }));
  });

  describe('attribution', () => {
    it('names everyone who changed the file live since the last version, and the person whose save sent it', async () => {
      service.noteEdit(UID, 'main.tex', ARIA, 'Aria');
      service.noteEdit(UID, 'main.tex', ARIA, 'Aria');
      service.noteEdit(UID, 'main.tex', KENJI, 'Kenji');
      service.noteEdit(UID, 'refs.bib', RAZZ, 'Razz');
      prisma.client.fileHistory.findFirst.mockResolvedValue({
        id: 5,
        version: 4,
        content: 'a\n',
        createdAt: new Date(Date.now() - 600_000),
        label: null,
        restoredFromId: null,
        authors: [{ userId: RAZZ }],
      });

      await service.createSnapshot({
        projectId: PROJECT,
        projectUid: UID,
        filePath: 'main.tex',
        content: 'a\nb\nc\n',
        savedById: RAZZ,
      });

      const data = prisma.client.fileHistory.create.mock.calls[0][0].data;
      expect(data.version).toBe(5);
      expect(data.userId).toBe(RAZZ);
      expect(data.userName).toBe('Razz');
      expect(data.linesAdded).toBe(2);
      expect(data.linesRemoved).toBe(0);
      expect(data.authors.create).toEqual([
        { projectId: PROJECT, userId: ARIA, name: 'Aria', edits: 2 },
        { projectId: PROJECT, userId: KENJI, name: 'Kenji', edits: 1 },
      ]);
      // Only this file's waiting changes were taken.
      expect(service.pendingFor(UID, 'main.tex')).toEqual([]);
      expect(service.pendingFor(UID, 'refs.bib')).toHaveLength(1);
    });

    it('credits the saver when no live change is waiting', async () => {
      prisma.client.fileHistory.findFirst.mockResolvedValue(null);
      await service.createSnapshot({
        projectId: PROJECT,
        projectUid: UID,
        filePath: 'main.tex',
        content: 'x',
        savedById: KENJI,
      });
      expect(
        prisma.client.fileHistory.create.mock.calls[0][0].data.authors.create,
      ).toEqual([
        { projectId: PROJECT, userId: KENJI, name: 'Kenji', edits: 0 },
      ]);
    });

    it('skips an unchanged text', async () => {
      service.noteEdit(UID, 'main.tex', ARIA, 'Aria');
      prisma.client.fileHistory.findFirst.mockResolvedValue({
        id: 5,
        version: 4,
        content: 'same',
        createdAt: new Date(),
        label: null,
        restoredFromId: null,
        authors: [],
      });
      const result = await service.createSnapshot({
        projectId: PROJECT,
        projectUid: UID,
        filePath: 'main.tex',
        content: 'same',
        savedById: RAZZ,
      });
      expect(result).toEqual({ skipped: true, reason: 'content unchanged' });
      expect(prisma.client.fileHistory.create).not.toHaveBeenCalled();
    });

    it('folds a save within a minute by the same people into the latest version, and keeps someone new apart', async () => {
      const latest = {
        id: 5,
        version: 4,
        content: 'a\n',
        createdAt: new Date(Date.now() - 20_000),
        label: null,
        restoredFromId: null,
        authors: [{ userId: ARIA }],
      };
      prisma.client.fileHistory.findFirst.mockImplementation(
        ({ where }: any) => (where.version ? { content: '' } : latest),
      );

      service.noteEdit(UID, 'main.tex', ARIA, 'Aria');
      const folded = await service.createSnapshot({
        projectId: PROJECT,
        projectUid: UID,
        filePath: 'main.tex',
        content: 'a\nb\n',
        savedById: ARIA,
      });
      expect(folded).toMatchObject({ skipped: true, id: 5 });
      expect(prisma.client.fileHistory.update.mock.calls[0][0]).toMatchObject({
        where: { id: 5 },
        data: { content: 'a\nb\n', linesAdded: 2, linesRemoved: 0 },
      });
      expect(
        prisma.client.fileHistoryAuthor.update.mock.calls[0][0],
      ).toMatchObject({
        where: { historyId_userId: { historyId: 5, userId: ARIA } },
        data: { edits: { increment: 1 } },
      });
      expect(prisma.client.fileHistory.create).not.toHaveBeenCalled();

      service.noteEdit(UID, 'main.tex', KENJI, 'Kenji');
      await service.createSnapshot({
        projectId: PROJECT,
        projectUid: UID,
        filePath: 'main.tex',
        content: 'a\nb\nc\n',
        savedById: ARIA,
      });
      expect(prisma.client.fileHistory.create).toHaveBeenCalledTimes(1);
    });

    it('writes one version of a file at a time, and keeps waiting credit when a write fails', async () => {
      const order: string[] = [];
      prisma.client.fileHistory.findFirst.mockImplementation(async () => {
        order.push('read');
        return null;
      });
      prisma.client.fileHistory.create.mockImplementationOnce(async () => {
        await new Promise((r) => setTimeout(r, 20));
        order.push('write');
        throw new Error('unique constraint');
      });
      prisma.client.fileHistory.create.mockImplementationOnce(async () => {
        order.push('write');
        return { id: 1, version: 1 };
      });
      service.noteEdit(UID, 'main.tex', ARIA, 'Aria');
      const first = service.createSnapshot({
        projectId: PROJECT,
        projectUid: UID,
        filePath: 'main.tex',
        content: 'a',
        savedById: RAZZ,
      });
      const second = service.createSnapshot({
        projectId: PROJECT,
        projectUid: UID,
        filePath: 'main.tex',
        content: 'a',
        savedById: RAZZ,
      });
      await expect(first).rejects.toThrow('unique constraint');
      await second;
      expect(order).toEqual(['read', 'write', 'read', 'write']);
      // The failed write gave Aria's change back, so the second one credits her.
      expect(
        prisma.client.fileHistory.create.mock.calls[1][0].data.authors.create,
      ).toEqual([{ projectId: PROJECT, userId: ARIA, name: 'Aria', edits: 1 }]);
    });

    it('turns waiting live changes into versions when a session closes', async () => {
      prisma.client.project.findUnique.mockResolvedValue({ id: PROJECT });
      prisma.client.fileHistory.findFirst.mockResolvedValue(null);
      service.noteEdit(UID, 'main.tex', ARIA, 'Aria');
      const written = await service.flushPending(UID, (path) =>
        path === 'main.tex' ? 'typed before closing' : null,
      );
      expect(written).toBe(1);
      const data = prisma.client.fileHistory.create.mock.calls[0][0].data;
      expect(data.userId).toBeNull();
      expect(data.authors.create).toEqual([
        { projectId: PROJECT, userId: ARIA, name: 'Aria', edits: 1 },
      ]);
      expect(service.pendingPaths(UID)).toEqual([]);
    });
  });

  describe('timeline', () => {
    const row = (
      id: number,
      filePath: string,
      authors: { userId: number; name: string; edits: number }[],
    ) => ({
      id,
      version: 1,
      filePath,
      label: null,
      userId: authors[0]?.userId ?? null,
      userName: authors[0]?.name ?? null,
      linesAdded: 3,
      linesRemoved: 1,
      restoredFromId: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      authors,
    });

    it('filters by file and by person, pages by cursor, and keeps people who left or whose account is gone', async () => {
      prisma.client.fileHistory.findMany.mockResolvedValue([
        row(30, 'main.tex', [{ userId: ARIA, name: 'Aria then', edits: 4 }]),
        row(29, 'refs.bib', [{ userId: 77, name: 'Deleted person', edits: 1 }]),
        row(28, 'main.tex', [{ userId: RAZZ, name: 'Razz', edits: 2 }]),
      ]);
      prisma.client.user.findMany.mockResolvedValue([
        { id: ARIA, name: 'Aria Nakamura', avatarUrl: null },
        { id: RAZZ, name: 'Razz', avatarUrl: null },
      ]);
      prisma.client.project.findUnique.mockResolvedValue({ userId: RAZZ });
      // Aria has been removed from the project: no collaborator row.
      prisma.client.projectCollaborator.findMany.mockResolvedValue([]);

      const page = await service.timeline(PROJECT, {
        paths: ['main.tex', 'refs.bib'],
        authors: [ARIA, 77],
        cursor: 31,
        limit: 2,
      });

      expect(prisma.client.fileHistory.findMany.mock.calls[0][0]).toMatchObject(
        {
          where: {
            projectId: PROJECT,
            filePath: { in: ['main.tex', 'refs.bib'] },
            authors: { some: { userId: { in: [ARIA, 77] } } },
            id: { lt: 31 },
          },
          orderBy: { id: 'desc' },
          take: 3,
        },
      );
      expect(page.entries.map((e) => e.id)).toEqual([30, 29]);
      expect(page.nextCursor).toBe(29);
      expect(page.entries[0].authors[0]).toMatchObject({
        id: ARIA,
        name: 'Aria Nakamura',
        member: false,
        gone: false,
        edits: 4,
      });
      expect(page.entries[1].authors[0]).toMatchObject({
        id: 77,
        name: 'Deleted person',
        member: false,
        gone: true,
      });
      expect(page.entries[0].linesAdded).toBe(3);
    });

    it('has no next page when the last one is short', async () => {
      prisma.client.fileHistory.findMany.mockResolvedValue([
        row(3, 'main.tex', []),
      ]);
      const page = await service.timeline(PROJECT, {});
      expect(page.nextCursor).toBeNull();
      expect(page.entries[0].authors).toEqual([]);
      expect(prisma.client.fileHistory.findMany.mock.calls[0][0].where).toEqual(
        { projectId: PROJECT },
      );
    });
  });
});
