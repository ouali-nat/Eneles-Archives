import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { lineChangeCounts } from './history-diff';

/** How long history is kept (unchanged from before the project-wide timeline). */
const RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

/** Saves of one file less than this far apart, by the same people, fold into one version rather than one each. */
const FOLD_MS = 60_000;

/** The most entries one page of the timeline returns. */
export const TIMELINE_MAX_PAGE = 100;

/** Someone named in the history: as their account is now, or as they were when they made the change if the account is gone. */
export interface HistoryPerson {
  id: number;
  name: string;
  avatarUrl: string | null;
  /** In the project now (its owner or a collaborator). */
  member: boolean;
  /** Their account has been deleted; the name is the one they had then. */
  gone: boolean;
}

export interface HistoryAuthor extends HistoryPerson {
  /** Changes their socket sent to this file since the version before; 0 when the change did not come through the live session. */
  edits: number;
}

export interface HistoryEntryView {
  id: number;
  version: number;
  filePath: string;
  label: string | null;
  createdAt: Date;
  updatedAt: Date;
  linesAdded: number;
  linesRemoved: number;
  restoredFromId: number | null;
  /** Who sent the save; null when the server wrote it as a live session closed. */
  savedBy: HistoryPerson | null;
  /** Who changed the file since the version before. Empty on versions from before authors were recorded. */
  authors: HistoryAuthor[];
}

export interface HistoryPathFacet {
  path: string;
  versions: number;
  lastChangedAt: Date | null;
  status: 'current' | 'renamed' | 'deleted';
  /** Where a renamed file is now. */
  renamedTo: string | null;
}

export interface HistoryAuthorFacet extends HistoryPerson {
  versions: number;
}

type Pending = Map<number, { edits: number; name: string }>;

interface SnapshotInput {
  projectId: number;
  projectUid: string;
  filePath: string;
  content: string;
  savedById: number | null;
  label?: string;
  restoredFromId?: number;
  /** Who made the change, given outright (a restore, a session closing); otherwise the live changes waiting for the file are taken. */
  authors?: Pending;
  /** Credit the saver when no live change is waiting (the default). Off for the copy kept just before a restore: the person restoring did not write that text. */
  creditSaver?: boolean;
  /** Write a version even when the text is the same as the latest one: a deleted file made again by a restore is an event worth seeing. */
  force?: boolean;
}

const ENTRY_SELECT = {
  id: true,
  version: true,
  filePath: true,
  label: true,
  userId: true,
  userName: true,
  linesAdded: true,
  linesRemoved: true,
  restoredFromId: true,
  createdAt: true,
  updatedAt: true,
  authors: { select: { userId: true, name: true, edits: true } },
} as const;

type EntryRow = {
  id: number;
  version: number;
  filePath: string;
  label: string | null;
  userId: number | null;
  userName: string | null;
  linesAdded: number | null;
  linesRemoved: number | null;
  restoredFromId: number | null;
  createdAt: Date;
  updatedAt: Date;
  authors: { userId: number; name: string; edits: number }[];
};

/**
 * The project's history across all its files, and who made it.
 *
 * Attribution. Several people's keystrokes merge into one live document, and a version is a snapshot of a whole file, so one version can hold several people's changes. The collaboration gateway tells this service whose socket sent each change to each file (`noteEdit`); those counts wait here, per project and file, until the next snapshot of that file takes them as its authors. A snapshot with no live changes waiting (a save from a browser with no live connection, an upload, a restore) is credited to whoever sent it. The person who sent a save is recorded apart from the authors: a collaborator's browser autosaving someone else's typing names the typist as the author and the collaborator as the saver.
 */
@Injectable()
export class HistoryService {
  private readonly logger = new Logger(HistoryService.name);

  /** `${projectUid}::${path}` → who has changed that file live since its last snapshot. In memory, like the live documents themselves. */
  private readonly pending = new Map<string, Pending>();

  /** Snapshots being written, per project and file, so they run one after another. */
  private readonly queues = new Map<string, Promise<void>>();

  constructor(private readonly prisma: PrismaService) {}

  // ─── Live changes waiting for a snapshot ───

  private key(projectUid: string, path: string) {
    return `${projectUid}::${path}`;
  }

  /** One change to one file, sent by this person's socket. */
  noteEdit(projectUid: string, path: string, userId: number, name: string) {
    const key = this.key(projectUid, path);
    let people = this.pending.get(key);
    if (!people) {
      people = new Map();
      this.pending.set(key, people);
    }
    const seen = people.get(userId);
    if (seen) {
      seen.edits += 1;
      seen.name = name || seen.name;
    } else people.set(userId, { edits: 1, name: name || 'Someone' });
  }

  /** Who has changed this file live since its last snapshot, without taking it. */
  pendingFor(
    projectUid: string,
    path: string,
  ): { userId: number; edits: number; name: string }[] {
    return [
      ...(this.pending.get(this.key(projectUid, path)) ??
        new Map<number, { edits: number; name: string }>()),
    ].map(([userId, p]) => ({ userId, ...p }));
  }

  /** The files of this project with live changes waiting. */
  pendingPaths(projectUid: string): string[] {
    const prefix = `${projectUid}::`;
    return [...this.pending.keys()]
      .filter((k) => k.startsWith(prefix))
      .map((k) => k.slice(prefix.length));
  }

  private take(projectUid: string, path: string): Pending {
    const key = this.key(projectUid, path);
    const people: Pending = this.pending.get(key) ?? (new Map() as Pending);
    this.pending.delete(key);
    return people;
  }

  /** A file or folder took a new path: what was waiting under the old one waits under the new one. */
  movePending(projectUid: string, from: string, to: string) {
    if (from === to) return;
    for (const path of this.pendingPaths(projectUid)) {
      const next =
        path === from
          ? to
          : path.startsWith(`${from}/`)
            ? to + path.slice(from.length)
            : null;
      if (next === null) continue;
      const moving = this.take(projectUid, path);
      const key = this.key(projectUid, next);
      const there: Pending = this.pending.get(key) ?? (new Map() as Pending);
      for (const [userId, p] of moving) {
        const seen = there.get(userId);
        if (seen) seen.edits += p.edits;
        else there.set(userId, { ...p });
      }
      this.pending.set(key, there);
    }
  }

  /** A file or folder was deleted (or a new file took its path): what was waiting for it is dropped. */
  forgetPending(projectUid: string, path: string) {
    for (const p of this.pendingPaths(projectUid))
      if (p === path || p.startsWith(`${path}/`))
        this.pending.delete(this.key(projectUid, p));
  }

  // ─── Writing versions ───

  /**
   * Record a version of a file. Content identical to the latest version is skipped. A save less than a minute after the latest version was made, by people who are all already its authors, folds into it (its text, line counts, and edit counts are brought up to date) instead of making a new one; a label or a restore always makes a new one.
   *
   * `authors` names who made the change outright (a restore names the person restoring); otherwise the live changes waiting for this file are taken, and when there are none, the saver is the author.
   */
  createSnapshot(input: SnapshotInput) {
    // One at a time per file: two browsers autosaving the same text at once would otherwise both take the next version number (one fails), and the live changes the failed one had taken would be lost.
    return this.serial(`${input.projectId}::${input.filePath}`, async () => {
      const taken = input.authors
        ? null
        : this.take(input.projectUid, input.filePath);
      try {
        return await this.writeSnapshot(input, new Map(input.authors ?? taken));
      } catch (err) {
        // Not written: the changes it would have credited wait for the next version.
        if (taken?.size) this.giveBack(input.projectUid, input.filePath, taken);
        throw err;
      }
    });
  }

  /** Runs `task` after every earlier task with the same key has settled. */
  private serial<T>(key: string, task: () => Promise<T>): Promise<T> {
    const before = this.queues.get(key) ?? Promise.resolve();
    const run = before.then(task);
    const settled = run.then(
      () => undefined,
      () => undefined,
    );
    this.queues.set(key, settled);
    void settled.then(() => {
      if (this.queues.get(key) === settled) this.queues.delete(key);
    });
    return run;
  }

  private giveBack(projectUid: string, path: string, people: Pending) {
    const key = this.key(projectUid, path);
    const there: Pending = this.pending.get(key) ?? (new Map() as Pending);
    for (const [userId, p] of people) {
      const seen = there.get(userId);
      if (seen) seen.edits += p.edits;
      else there.set(userId, { ...p });
    }
    this.pending.set(key, there);
  }

  private async writeSnapshot(input: SnapshotInput, authors: Pending) {
    const { projectId, filePath, content, savedById } = input;
    const label = input.label?.trim() || undefined;
    const saver =
      savedById !== null
        ? await this.prisma.client.user.findUnique({
            where: { id: savedById },
            select: { id: true, name: true },
          })
        : null;

    if (authors.size === 0 && saver && input.creditSaver !== false)
      authors.set(saver.id, { edits: 0, name: saver.name });

    const latest = await this.prisma.client.fileHistory.findFirst({
      where: { projectId, filePath },
      orderBy: { version: 'desc' },
      select: {
        id: true,
        version: true,
        content: true,
        createdAt: true,
        label: true,
        restoredFromId: true,
        authors: { select: { userId: true } },
      },
    });

    if (latest?.content === content && !input.force)
      return { skipped: true as const, reason: 'content unchanged' };

    const now = new Date();
    const fold =
      !!latest &&
      !label &&
      !input.restoredFromId &&
      !latest.label &&
      !latest.restoredFromId &&
      now.getTime() - latest.createdAt.getTime() < FOLD_MS &&
      latest.authors.length > 0 &&
      [...authors.keys()].every((id) =>
        latest.authors.some((a) => a.userId === id),
      );

    if (fold && latest) {
      const previous = await this.prisma.client.fileHistory.findFirst({
        where: { projectId, filePath, version: { lt: latest.version } },
        orderBy: { version: 'desc' },
        select: { content: true },
      });
      const counts = lineChangeCounts(previous?.content ?? '', content);
      await this.prisma.client.$transaction([
        this.prisma.client.fileHistory.update({
          where: { id: latest.id },
          data: {
            content,
            updatedAt: now,
            linesAdded: counts.added,
            linesRemoved: counts.removed,
            ...(saver ? { userId: saver.id, userName: saver.name } : {}),
          },
        }),
        ...[...authors].map(([userId, p]) =>
          this.prisma.client.fileHistoryAuthor.update({
            where: { historyId_userId: { historyId: latest.id, userId } },
            data: { edits: { increment: p.edits }, name: p.name },
          }),
        ),
      ]);
      return {
        skipped: true as const,
        reason: 'throttled, updated latest snapshot',
        id: latest.id,
        version: latest.version,
      };
    }

    const counts = lineChangeCounts(latest?.content ?? '', content);
    return this.prisma.client.fileHistory.create({
      data: {
        projectId,
        filePath,
        version: (latest?.version ?? 0) + 1,
        content,
        label,
        userId: saver?.id ?? null,
        userName: saver?.name ?? null,
        linesAdded: counts.added,
        linesRemoved: counts.removed,
        restoredFromId: input.restoredFromId ?? null,
        expiresAt: new Date(now.getTime() + RETENTION_MS),
        createdAt: now,
        updatedAt: now,
        authors: {
          create: [...authors].map(([userId, p]) => ({
            projectId,
            userId,
            name: p.name,
            edits: p.edits,
          })),
        },
      },
      select: { id: true, version: true, label: true, createdAt: true },
    });
  }

  /**
   * A live session is closing (or the server is stopping): every file with live changes waiting gets a version of what the live document holds, credited to the people who made those changes. `textOf` reads a file's text from the live document, null when it holds none.
   */
  async flushPending(
    projectUid: string,
    textOf: (path: string) => string | null,
  ) {
    const paths = this.pendingPaths(projectUid);
    if (!paths.length) return 0;
    const project = await this.prisma.client.project.findUnique({
      where: { uid: projectUid },
      select: { id: true },
    });
    if (!project) {
      for (const path of paths) this.pending.delete(this.key(projectUid, path));
      return 0;
    }
    let written = 0;
    for (const path of paths) {
      const content = textOf(path);
      const authors = this.take(projectUid, path);
      if (content === null) continue;
      try {
        const result = await this.createSnapshot({
          projectId: project.id,
          projectUid,
          filePath: path,
          content,
          savedById: null,
          authors,
        });
        if (!('skipped' in result) || result.reason !== 'content unchanged')
          written++;
      } catch (err) {
        this.logger.error(
          `Could not record a version of "${path}" in ${projectUid}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
    return written;
  }

  /** A file or folder was renamed or moved. */
  async recordMove(projectId: number, fromPath: string, toPath: string) {
    if (fromPath === toPath) return;
    await this.prisma.client.filePathMove.create({
      data: { projectId, fromPath, toPath },
    });
  }

  // ─── Reading ───

  /** The project's versions across all files, newest first, a page at a time. `cursor` is the id of the last entry of the page before. */
  async timeline(
    projectId: number,
    options: {
      paths?: string[];
      authors?: number[];
      cursor?: number;
      limit?: number;
    },
  ) {
    const limit = Math.min(Math.max(options.limit ?? 50, 1), TIMELINE_MAX_PAGE);
    const rows: EntryRow[] = await this.prisma.client.fileHistory.findMany({
      where: {
        projectId,
        ...(options.paths?.length ? { filePath: { in: options.paths } } : {}),
        ...(options.authors?.length
          ? { authors: { some: { userId: { in: options.authors } } } }
          : {}),
        ...(options.cursor ? { id: { lt: options.cursor } } : {}),
      },
      orderBy: { id: 'desc' },
      take: limit + 1,
      select: ENTRY_SELECT,
    });
    const page = rows.slice(0, limit);
    await this.fillCounts(projectId, page);
    const people = await this.people(projectId, page);
    return {
      entries: page.map((row) => this.view(row, people)),
      nextCursor: rows.length > limit ? page[page.length - 1].id : null,
    };
  }

  /** One version, as the timeline shows it. */
  async entry(projectId: number, id: number) {
    const row: EntryRow | null = await this.prisma.client.fileHistory.findFirst(
      { where: { id, projectId }, select: ENTRY_SELECT },
    );
    if (!row) return null;
    await this.fillCounts(projectId, [row]);
    return this.view(row, await this.people(projectId, [row]));
  }

  /**
   * The two texts a version is compared by: against the version before it (what this version changed; empty before the first), or against the file as it is now (`current`, read from the live document when it is open). `after` is null when the file no longer exists.
   */
  async compare(
    projectId: number,
    id: number,
    against: 'previous' | 'current',
    currentText: (path: string) => Promise<string | null>,
  ) {
    const row = await this.prisma.client.fileHistory.findFirst({
      where: { id, projectId },
      select: { id: true, version: true, filePath: true, content: true },
    });
    if (!row) return null;
    const entry = await this.entry(projectId, id);
    if (against === 'current') {
      const now = await currentText(row.filePath);
      return {
        entry,
        against,
        before: row.content,
        after: now,
        previous: null,
      };
    }
    const previous = await this.prisma.client.fileHistory.findFirst({
      where: {
        projectId,
        filePath: row.filePath,
        version: { lt: row.version },
      },
      orderBy: { version: 'desc' },
      select: { id: true, version: true, content: true, updatedAt: true },
    });
    return {
      entry,
      against,
      before: previous?.content ?? '',
      after: row.content,
      previous: previous
        ? {
            id: previous.id,
            version: previous.version,
            updatedAt: previous.updatedAt,
          }
        : null,
    };
  }

  /** Everyone with history in the project (members or not, accounts or not), every path with history (and whether the file is still there, renamed, or deleted), and how many versions name no one. */
  async facets(projectId: number): Promise<{
    authors: HistoryAuthorFacet[];
    paths: HistoryPathFacet[];
    unattributed: number;
  }> {
    const [counts, names, unattributed, pathRows, files, moves] =
      await Promise.all([
        this.prisma.client.fileHistoryAuthor.groupBy({
          by: ['userId'],
          where: { projectId },
          _count: { _all: true },
        }),
        this.prisma.client.fileHistoryAuthor.findMany({
          where: { projectId },
          distinct: ['userId'],
          orderBy: { historyId: 'desc' },
          select: { userId: true, name: true },
        }),
        this.prisma.client.fileHistory.count({
          where: { projectId, authors: { none: {} } },
        }),
        this.prisma.client.fileHistory.groupBy({
          by: ['filePath'],
          where: { projectId },
          _count: { _all: true },
          _max: { updatedAt: true },
        }),
        this.prisma.client.projectFile.findMany({
          where: { projectId, isFolder: false },
          select: { path: true },
        }),
        this.prisma.client.filePathMove.findMany({
          where: { projectId },
          orderBy: { id: 'desc' },
          select: { fromPath: true, toPath: true },
        }),
      ]);
    const stored = new Map(names.map((n) => [n.userId, n.name]));
    const people = await this.resolvePeople(projectId, stored);
    const authors = counts
      .map((c) => ({ ...people.get(c.userId)!, versions: c._count._all }))
      .sort(
        (a, b) =>
          Number(b.member) - Number(a.member) || a.name.localeCompare(b.name),
      );

    const existing = new Set(files.map((f) => f.path));
    const paths = pathRows
      .map((p): HistoryPathFacet => {
        const status = existing.has(p.filePath)
          ? null
          : resolveMove(p.filePath, moves, existing);
        return {
          path: p.filePath,
          versions: p._count._all,
          lastChangedAt: p._max.updatedAt ?? null,
          status: status === null ? 'current' : status ? 'renamed' : 'deleted',
          renamedTo: status || null,
        };
      })
      .sort(
        (a, b) =>
          Number(a.status !== 'current') - Number(b.status !== 'current') ||
          a.path.localeCompare(b.path),
      );
    return { authors, paths, unattributed };
  }

  // ─── Helpers ───

  /** Line counts for versions written before they were recorded, measured once against the version before and kept. */
  private async fillCounts(projectId: number, rows: EntryRow[]) {
    for (const row of rows) {
      if (row.linesAdded !== null && row.linesRemoved !== null) continue;
      const [self, previous] = await Promise.all([
        this.prisma.client.fileHistory.findFirst({
          where: { id: row.id },
          select: { content: true },
        }),
        this.prisma.client.fileHistory.findFirst({
          where: {
            projectId,
            filePath: row.filePath,
            version: { lt: row.version },
          },
          orderBy: { version: 'desc' },
          select: { content: true },
        }),
      ]);
      const counts = lineChangeCounts(
        previous?.content ?? '',
        self?.content ?? '',
      );
      row.linesAdded = counts.added;
      row.linesRemoved = counts.removed;
      await this.prisma.client.fileHistory
        .update({
          where: { id: row.id },
          data: { linesAdded: counts.added, linesRemoved: counts.removed },
        })
        .catch(() => undefined);
    }
  }

  private async people(projectId: number, rows: EntryRow[]) {
    const stored = new Map<number, string>();
    for (const row of rows) {
      if (row.userId !== null)
        stored.set(
          row.userId,
          row.userName ?? stored.get(row.userId) ?? 'Someone',
        );
      for (const a of row.authors) stored.set(a.userId, a.name);
    }
    return this.resolvePeople(projectId, stored);
  }

  /** People by id, as their accounts are now, with whether they are in the project; the stored name stands in for an account that is gone. */
  private async resolvePeople(
    projectId: number,
    stored: Map<number, string>,
  ): Promise<Map<number, HistoryPerson>> {
    const ids = [...stored.keys()];
    if (!ids.length) return new Map();
    const [users, project, collaborators] = await Promise.all([
      this.prisma.client.user.findMany({
        where: { id: { in: ids } },
        select: { id: true, name: true, avatarUrl: true },
      }),
      this.prisma.client.project.findUnique({
        where: { id: projectId },
        select: { userId: true },
      }),
      this.prisma.client.projectCollaborator.findMany({
        where: { projectId, userId: { in: ids } },
        select: { userId: true },
      }),
    ]);
    const members = new Set([
      project?.userId,
      ...collaborators.map((c) => c.userId),
    ]);
    const accounts = new Map(users.map((u) => [u.id, u]));
    const out = new Map<number, HistoryPerson>();
    for (const id of ids) {
      const account = accounts.get(id);
      out.set(id, {
        id,
        name: account?.name || stored.get(id) || 'Someone',
        avatarUrl: account?.avatarUrl ?? null,
        member: members.has(id),
        gone: !account,
      });
    }
    return out;
  }

  private view(
    row: EntryRow,
    people: Map<number, HistoryPerson>,
  ): HistoryEntryView {
    const person = (id: number, name: string): HistoryPerson =>
      people.get(id) ?? {
        id,
        name,
        avatarUrl: null,
        member: false,
        gone: true,
      };
    return {
      id: row.id,
      version: row.version,
      filePath: row.filePath,
      label: row.label,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      linesAdded: row.linesAdded ?? 0,
      linesRemoved: row.linesRemoved ?? 0,
      restoredFromId: row.restoredFromId,
      savedBy:
        row.userId !== null
          ? person(row.userId, row.userName ?? 'Someone')
          : null,
      authors: row.authors
        .map((a) => ({ ...person(a.userId, a.name), edits: a.edits }))
        .sort((a, b) => b.edits - a.edits || a.name.localeCompare(b.name)),
    };
  }
}

/**
 * Where a path that is no longer a file went: the path it was renamed to (following later renames, of the file or of a folder above it) when that file still exists, '' when it was renamed and then deleted, and false when it was deleted outright. `moves` is newest first.
 */
export function resolveMove(
  path: string,
  moves: { fromPath: string; toPath: string }[],
  existing: Set<string>,
): string | false {
  let current = path;
  let moved = false;
  for (let hop = 0; hop < 20; hop++) {
    const move = moves.find(
      (m) => current === m.fromPath || current.startsWith(`${m.fromPath}/`),
    );
    if (!move) break;
    current = move.toPath + current.slice(move.fromPath.length);
    moved = true;
    if (existing.has(current)) return current;
  }
  return moved ? '' : false;
}
