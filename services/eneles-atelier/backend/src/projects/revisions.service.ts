import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

/** Max undo entries per project. Older entries are pruned on insert. */
const MAX_UNDO_ENTRIES = 50;

@Injectable()
export class RevisionsService {
  private readonly logger = new Logger(RevisionsService.name);

  constructor(private readonly prisma: PrismaService) {}

  // ─── Revisions (published checkpoints) ──────────────────────

  /**
   * List all revisions for a project, newest first.
   */
  async listRevisions(projectId: number) {
    return this.prisma.client.projectRevision.findMany({
      where: { projectId },
      orderBy: { sequence: 'desc' },
      select: {
        id: true,
        sequence: true,
        message: true,
        createdAt: true,
      },
    });
  }

  /**
   * Get a single revision with its full delta payload.
   */
  async getRevision(projectId: number, revisionId: number) {
    const revision = await this.prisma.client.projectRevision.findFirst({
      where: { id: revisionId, projectId },
    });

    if (!revision) {
      throw new NotFoundException('Revision not found');
    }

    return revision;
  }

  /**
   * Create a new revision (publish checkpoint).
   * Delta should be a JSON snapshot of all project files at this point.
   */
  async createRevision(projectId: number, data: { message?: string; delta: any }) {
    // Get the next sequence number
    const latest = await this.prisma.client.projectRevision.findFirst({
      where: { projectId },
      orderBy: { sequence: 'desc' },
      select: { sequence: true },
    });

    const sequence = (latest?.sequence ?? 0) + 1;

    return this.prisma.client.projectRevision.create({
      data: {
        projectId,
        sequence,
        message: data.message,
        delta: data.delta,
      },
    });
  }

  /**
   * Restore a project to a specific revision.
   * Returns the delta (file snapshot) that should be applied.
   */
  async restoreRevision(projectId: number, revisionId: number) {
    const revision = await this.getRevision(projectId, revisionId);

    // The delta contains the file state at that revision.
    // The caller (controller) is responsible for applying this to the project files.
    return {
      revision,
      files: revision.delta as Array<{ path: string; content: string }>,
    };
  }

  // ─── Undo Stack ──────────────────────────────────────────────

  /**
   * Push an undo entry onto the stack.
   * Automatically prunes entries beyond MAX_UNDO_ENTRIES.
   */
  async pushUndo(
    projectId: number,
    data: {
      filePath: string;
      beforeContent: string;
      afterContent: string;
      source?: 'user' | 'ai';
    },
  ) {
    // Get next sequence
    const latest = await this.prisma.client.undoEntry.findFirst({
      where: { projectId },
      orderBy: { sequence: 'desc' },
      select: { sequence: true },
    });

    const sequence = (latest?.sequence ?? 0) + 1;

    // Create the new entry
    const entry = await this.prisma.client.undoEntry.create({
      data: {
        projectId,
        filePath: data.filePath,
        beforeContent: data.beforeContent,
        afterContent: data.afterContent,
        source: data.source || 'user',
        sequence,
      },
    });

    // Prune old entries if we exceed the cap
    const count = await this.prisma.client.undoEntry.count({ where: { projectId } });
    if (count > MAX_UNDO_ENTRIES) {
      const toDelete = await this.prisma.client.undoEntry.findMany({
        where: { projectId },
        orderBy: { sequence: 'asc' },
        take: count - MAX_UNDO_ENTRIES,
        select: { id: true },
      });

      if (toDelete.length > 0) {
        await this.prisma.client.undoEntry.deleteMany({
          where: { id: { in: toDelete.map((e) => e.id) } },
        });
      }
    }

    return entry;
  }

  /**
   * Pop the most recent undo entry (returns beforeContent to restore).
   * Deletes the entry from the stack.
   */
  async popUndo(projectId: number) {
    const latest = await this.prisma.client.undoEntry.findFirst({
      where: { projectId },
      orderBy: { sequence: 'desc' },
    });

    if (!latest) {
      return null;
    }

    // Delete the entry
    await this.prisma.client.undoEntry.delete({ where: { id: latest.id } });

    return {
      filePath: latest.filePath,
      beforeContent: latest.beforeContent,
      afterContent: latest.afterContent,
      source: latest.source,
    };
  }

  /**
   * Get the undo stack for a project (newest first).
   */
  async getUndoStack(projectId: number, limit = 50) {
    return this.prisma.client.undoEntry.findMany({
      where: { projectId },
      orderBy: { sequence: 'desc' },
      take: limit,
      select: {
        id: true,
        filePath: true,
        source: true,
        sequence: true,
        createdAt: true,
      },
    });
  }

  /**
   * Clear the undo stack for a project.
   */
  async clearUndoStack(projectId: number) {
    await this.prisma.client.undoEntry.deleteMany({ where: { projectId } });
    return { success: true };
  }
}
