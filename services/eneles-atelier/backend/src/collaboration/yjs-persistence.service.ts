import { Injectable, Logger } from '@nestjs/common';
import * as Y from 'yjs';
import { PrismaService } from '../prisma/prisma.service';
import { ProjectsService } from '../projects/projects.service';
import { RESERVED_KEY } from './socket-guard';

/**
 * Pull a message off an unknown thrown value without an `any` cast.
 * Every failure path here logs and continues, so this only ever feeds a log line.
 */
export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Durable storage for the collaboration gateway's per-project Y.Doc.
 *
 * The gateway keeps one Y.Doc per open project room in memory. That document
 * is the authoritative copy while anyone is connected, but it used to be
 * thrown away the moment the room emptied, so the window between the last
 * keystroke and the client's next REST autosave was a data-loss window, and a
 * deploy or crash mid-session lost everything since the last autosave for
 * every open room at once.
 *
 * This service closes that gap on two levels:
 *
 *   1. `save` / `load` persist the encoded CRDT state, so a rehydrated room
 *      keeps its full history. A returning client's state vector then still
 *      produces a correct diff instead of being handed a brand-new document.
 *   2. `flushToFiles` writes the Y.Text content back into `project_files`, so
 *      the plain-text copy the compiler and the REST API read is current even
 *      if no client ever got round to autosaving.
 *
 * Both are best-effort by design: persistence failing must never take down a
 * live editing session, so every method swallows its errors after logging.
 */
@Injectable()
export class YjsPersistenceService {
  private readonly logger = new Logger(YjsPersistenceService.name);

  /**
   * Refuse to persist documents beyond this size. A Y.Doc grows with edit
   * history, and an unbounded blob in a hot table is a slow-motion outage.
   * Past the cap we drop the CRDT history and fall back to seeding from
   * `project_files` on the next join: content survives, history does not.
   */
  private static readonly MAX_STATE_BYTES = 8 * 1024 * 1024; // 8 MB

  constructor(
    private readonly prisma: PrismaService,
    private readonly projectsService: ProjectsService,
  ) {}

  /**
   * Apply any persisted state onto `doc`.
   *
   * Returns the set of file names (Y.Text keys) the restored document already
   * carries, so the gateway can skip re-seeding them from the database. A
   * restored Y.Text is newer than the row it was originally seeded from.
   */
  async load(projectUid: string, doc: Y.Doc): Promise<Set<string>> {
    try {
      const row = await this.prisma.client.yjsDocument.findUnique({
        where: { projectUid },
        select: { state: true },
      });
      if (!row?.state) return new Set();

      Y.applyUpdate(doc, new Uint8Array(row.state));

      // Y.Doc doesn't expose "which keys hold text" directly; `share` is the
      // map of top-level types and its keys are exactly the file names we
      // created via doc.getText(file).
      const restored = new Set<string>();
      doc.share.forEach((_type, key) => {
        // Suggestion maps (tc:<path>) and the document's own bookkeeping (texer:meta) are maps, not files. Asking for one as text would make it text for the life of the document, and the next getMap of it would throw (renaming or deleting a file with suggestions, for one).
        if (RESERVED_KEY.test(key)) return;
        try {
          if (doc.getText(key).length > 0) restored.add(key);
        } catch {
          // A top-level key that isn't a Y.Text. We never create those, but a
          // blob written by an older or third-party client could contain one,
          // and one odd key must not abort the whole restore.
        }
      });

      this.logger.log(
        `Restored Y.Doc for project ${projectUid} (${row.state.length} bytes, ${restored.size} non-empty file(s))`,
      );
      return restored;
    } catch (err: unknown) {
      // A corrupt or unreadable blob must not block the room from opening.
      // Falling through with an empty doc means the gateway seeds from
      // project_files instead, which is the pre-persistence behaviour.
      this.logger.error(
        `Failed to restore Y.Doc for project ${projectUid}: ${errorMessage(err)}`,
      );
      return new Set();
    }
  }

  /**
   * Empty the stored text (and suggestions) kept under these paths, for a project nobody has open. A deleted file's text must not come back when a new file takes its name, and a new file must start from the database, not from what an older file of that name left behind.
   */
  async dropPaths(
    projectUid: string,
    matches: (path: string) => boolean,
  ): Promise<void> {
    try {
      const row = await this.prisma.client.yjsDocument.findUnique({
        where: { projectUid },
        select: { state: true },
      });
      if (!row?.state) return;
      const doc = new Y.Doc();
      Y.applyUpdate(doc, new Uint8Array(row.state));
      if (!clearPaths(doc, matches)) return;
      await this.save(projectUid, doc);
      doc.destroy();
    } catch (err: unknown) {
      this.logger.error(
        `Failed to drop stored text for project ${projectUid}: ${errorMessage(err)}`,
      );
    }
  }

  /** Encode and upsert the current CRDT state. */
  async save(projectUid: string, doc: Y.Doc): Promise<void> {
    try {
      const state = Buffer.from(Y.encodeStateAsUpdate(doc));

      if (state.length > YjsPersistenceService.MAX_STATE_BYTES) {
        this.logger.warn(
          `Y.Doc for project ${projectUid} is ${state.length} bytes, over the ` +
            `${YjsPersistenceService.MAX_STATE_BYTES}-byte cap. Dropping persisted history. ` +
            `Content is still safe in project_files via flushToFiles().`,
        );
        await this.prisma.client.yjsDocument
          .delete({ where: { projectUid } })
          .catch(() => undefined); // nothing to delete on the first oversized save
        return;
      }

      await this.prisma.client.yjsDocument.upsert({
        where: { projectUid },
        create: { projectUid, state, sizeBytes: state.length },
        update: { state, sizeBytes: state.length },
      });
    } catch (err: unknown) {
      this.logger.error(
        `Failed to persist Y.Doc for project ${projectUid}: ${errorMessage(err)}`,
      );
    }
  }

  /**
   * Write each tracked file's Y.Text back into `project_files`, skipping any
   * whose stored content already matches.
   *
   * `files` is the set of file paths the gateway has actually seeded or
   * restored for this room. Iterating `doc.share` instead would risk writing
   * stray top-level keys, and writing every file in the project would clobber
   * files nobody opened.
   */
  async flushToFiles(
    projectUid: string,
    doc: Y.Doc,
    files: Iterable<string>,
  ): Promise<number> {
    let written = 0;

    for (const path of files) {
      try {
        // `toJSON()` on a Y.Text is its plain string contents: same result as
        // toString(), but properly typed as string.
        const content = doc.getText(path).toJSON();

        // An empty Y.Text is ambiguous: it means either "the user deleted
        // everything" or "this file never actually synced". Treating the
        // second case as the first would blank the file, so require that the
        // document genuinely holds the key before writing an empty string.
        if (content.length === 0 && !doc.share.has(path)) continue;

        const current = await this.projectsService.getFileContentByPath(
          projectUid,
          path,
        );
        if (current === content) continue;

        const ok = await this.projectsService.writeFileContentByPath(
          projectUid,
          path,
          content,
        );
        if (ok) written++;
      } catch (err: unknown) {
        this.logger.error(
          `Failed to flush "${path}" for project ${projectUid}: ${errorMessage(err)}`,
        );
      }
    }

    if (written > 0) {
      this.logger.log(
        `Flushed ${written} file(s) from Y.Doc to database for project ${projectUid}`,
      );
    }
    return written;
  }

  /** Drop persisted state, e.g. once a room's content is fully reconciled. */
  async remove(projectUid: string): Promise<void> {
    try {
      await this.prisma.client.yjsDocument.delete({ where: { projectUid } });
    } catch {
      // Already gone, nothing to do.
    }
  }
}

/** Empties every text (and its suggestions map) whose path matches. True when something was emptied. */
export function clearPaths(
  doc: Y.Doc,
  matches: (path: string) => boolean,
): boolean {
  const paths = [...doc.share.keys()].filter(
    (key) => !key.startsWith('tc:') && matches(key),
  );
  let changed = false;
  doc.transact(() => {
    for (const path of paths) {
      const text = doc.getText(path);
      if (text.length > 0) {
        text.delete(0, text.length);
        changed = true;
      }
      const suggestions = doc.getMap(`tc:${path}`);
      if (suggestions.size > 0) {
        suggestions.clear();
        changed = true;
      }
    }
  }, 'server');
  return changed;
}
