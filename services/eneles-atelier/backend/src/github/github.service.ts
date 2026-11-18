import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { ProjectsService } from '../projects/projects.service';
import { CollaborationGateway } from '../collaboration/collaboration.gateway';
import { PROJECT_FILE_PATH } from '../projects/dto/file-path';

const MAX_FILE_BYTES = 10 * 1024 * 1024;
const TEXT_FILE =
  /\.(tex|ltx|bib|bst|bbx|cbx|lbx|cls|sty|clo|cfg|def|dtx|ins|ist|txt|md|markdown|csv|tsv|dat|json|ya?ml|xml|lua|py|m|r|tikz|pgf|gp|gnuplot|bbl|gitignore|latexmkrc)$/i;

/** The id git gives a file's contents. */
export function gitBlobSha(data: Buffer): string {
  return createHash('sha1')
    .update(`blob ${data.length}\0`)
    .update(data)
    .digest('hex');
}

/** Text is what decodes as UTF-8 and holds no NUL bytes. */
export function isTextFile(path: string, data: Buffer): boolean {
  if (TEXT_FILE.test(path)) return true;
  if (data.subarray(0, 8192).includes(0)) return false;
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(data.subarray(0, 65536));
    return true;
  } catch {
    return false;
  }
}

/** Where GitHub's copy goes when both sides changed a file: intro.tex -> intro.github.tex */
export function conflictCopyPath(path: string): string {
  const slash = path.lastIndexOf('/');
  const dot = path.lastIndexOf('.');
  return dot > slash + 1
    ? `${path.slice(0, dot)}.github${path.slice(dot)}`
    : `${path}.github`;
}

/** The parts of GitHub's replies this service reads. */
interface GhSha {
  sha: string;
}
interface GhRef {
  object?: { sha?: string };
}
interface GhRepo {
  default_branch?: string;
  permissions?: { push?: boolean };
}
interface GhCommit {
  sha: string;
  tree: { sha: string };
}
interface GhTreeEntry {
  path: string;
  type: string;
  mode: string;
  sha: string;
  size?: number;
}
interface GhTree {
  tree?: GhTreeEntry[];
  truncated?: boolean;
}

interface Link {
  id: number;
  projectId: number;
  repo: string;
  branch: string;
  token: string;
  lastCommitSha: string | null;
  fileShas: unknown;
  lastSyncedAt: Date | null;
}

/**
 * GitHub sync. The owner links a repository with a token that can write to
 * it; pushes and pulls then move the project's files over the git data API.
 * Each sync remembers which version of every file both sides agreed on, so
 * a pull only replaces files nobody changed here, and a push is refused
 * while GitHub has commits the project has not pulled.
 */
@Injectable()
export class GithubService {
  private readonly logger = new Logger(GithubService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly projects: ProjectsService,
    private readonly gateway: CollaborationGateway,
  ) {}

  // ── Token encryption ──

  private key(): Buffer | null {
    const own = this.config.get<string>('GITHUB_TOKEN_KEY');
    if (own && own.length >= 32)
      return createHash('sha256').update(own).digest();
    const jwt = this.config.get<string>('JWT_SECRET');
    if (jwt && jwt.length >= 16)
      return createHash('sha256').update(`texer-github-token:${jwt}`).digest();
    return null;
  }

  private seal(token: string): string {
    const key = this.key();
    if (!key)
      throw new HttpException(
        'GitHub sync is not set up on this server',
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', key, iv);
    const body = Buffer.concat([cipher.update(token, 'utf8'), cipher.final()]);
    return [iv, cipher.getAuthTag(), body]
      .map((b) => b.toString('base64'))
      .join('.');
  }

  private open(sealed: string): string {
    const key = this.key();
    const [iv, tag, body] = sealed
      .split('.')
      .map((p) => Buffer.from(p, 'base64'));
    if (!key || !iv || !tag || !body)
      throw new BadRequestException(
        'Link GitHub again: the saved token cannot be read',
      );
    try {
      const decipher = createDecipheriv('aes-256-gcm', key, iv);
      decipher.setAuthTag(tag);
      return Buffer.concat([decipher.update(body), decipher.final()]).toString(
        'utf8',
      );
    } catch {
      throw new BadRequestException(
        'Link GitHub again: the saved token cannot be read',
      );
    }
  }

  // ── GitHub API ──

  private get apiBase(): string {
    return (
      this.config.get<string>('GITHUB_API_URL') || 'https://api.github.com'
    ).replace(/\/+$/, '');
  }

  private async gh<T = Record<string, unknown>>(
    token: string,
    method: string,
    path: string,
    body?: unknown,
    allow: number[] = [],
  ): Promise<{ status: number; data: T }> {
    let res: Response;
    try {
      res = await fetch(`${this.apiBase}${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
          'User-Agent': 'Eneles',
          ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(30_000),
      });
    } catch {
      throw new HttpException(
        'GitHub could not be reached. Try again in a moment.',
        HttpStatus.BAD_GATEWAY,
      );
    }
    const data = (await res.json().catch(() => ({}))) as T & {
      message?: string;
    };
    if (res.ok || allow.includes(res.status))
      return { status: res.status, data };
    if (res.status === 401)
      throw new BadRequestException(
        'GitHub did not accept the token. Link GitHub again with a new one.',
      );
    if (res.status === 403 && /rate limit/i.test(data?.message ?? '')) {
      throw new HttpException(
        'GitHub is limiting requests right now. Try again in a few minutes.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    if (res.status === 403 || res.status === 404) {
      throw new BadRequestException(
        'The token cannot reach that repository, or cannot write to it. Give it read and write access to Contents.',
      );
    }
    this.logger.warn(
      `GitHub ${method} ${path} -> ${res.status}: ${data?.message ?? ''}`,
    );
    throw new HttpException(
      `GitHub refused the request: ${data?.message ?? res.status}`,
      HttpStatus.BAD_GATEWAY,
    );
  }

  /** The branch's latest commit, or null for an empty repository or a missing branch. */
  private async head(
    token: string,
    link: { repo: string; branch: string },
  ): Promise<string | null> {
    const { status, data } = await this.gh<GhRef>(
      token,
      'GET',
      `/repos/${link.repo}/git/ref/heads/${encodeURIComponent(link.branch)}`,
      undefined,
      [404, 409],
    );
    return status === 200 ? (data?.object?.sha ?? null) : null;
  }

  // ── Access ──

  private async owned(projectUid: string, userId: number) {
    const access = await this.projects.checkAccess(projectUid, userId);
    if (!access.project || !access.canView || access.pendingInvitation)
      throw new NotFoundException('Project not found');
    return access;
  }

  private async linkFor(projectId: number): Promise<Link> {
    const link = await this.prisma.client.projectGitHubLink.findUnique({
      where: { projectId },
    });
    if (!link)
      throw new BadRequestException('This project is not linked to GitHub');
    return link;
  }

  private shown(link: Link | null, canSync: boolean) {
    if (!link) return { linked: false, canSync };
    return {
      linked: true,
      canSync,
      repo: link.repo,
      branch: link.branch,
      lastCommitSha: link.lastCommitSha,
      lastSyncedAt: link.lastSyncedAt,
      url: `https://github.com/${link.repo}/tree/${encodeURIComponent(link.branch)}`,
    };
  }

  // ── Routes ──

  async status(projectUid: string, userId: number) {
    const access = await this.owned(projectUid, userId);
    const link = await this.prisma.client.projectGitHubLink.findUnique({
      where: { projectId: access.project.id },
    });
    return this.shown(link, access.isOwner);
  }

  async link(
    projectUid: string,
    userId: number,
    data: { repo: string; branch?: string; token: string },
  ) {
    const access = await this.owned(projectUid, userId);
    if (!access.isOwner)
      throw new ForbiddenException('Only the project owner can link GitHub');
    const repo = data.repo
      .trim()
      .replace(/^https?:\/\/github\.com\//i, '')
      .replace(/\.git$/i, '')
      .replace(/\/+$/, '');
    if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo)) {
      throw new BadRequestException('Name the repository as owner/name');
    }
    const token = data.token.trim();
    const { data: info } = await this.gh<GhRepo>(
      token,
      'GET',
      `/repos/${repo}`,
    );
    if (info?.permissions && info.permissions.push === false) {
      throw new BadRequestException(
        'The token can read that repository but not write to it',
      );
    }
    const branch = (
      data.branch?.trim() ||
      info?.default_branch ||
      'main'
    ).slice(0, 200);
    const head = await this.head(token, { repo, branch });
    const sealed = this.seal(token);
    const link = await this.prisma.client.projectGitHubLink.upsert({
      where: { projectId: access.project.id },
      create: {
        projectId: access.project.id,
        repo,
        branch,
        token: sealed,
        linkedById: userId,
      },
      update: {
        repo,
        branch,
        token: sealed,
        linkedById: userId,
        lastCommitSha: null,
        fileShas: {},
        lastSyncedAt: null,
      },
    });
    return { ...this.shown(link, true), remoteHasCommits: !!head };
  }

  async unlink(projectUid: string, userId: number) {
    const access = await this.owned(projectUid, userId);
    if (!access.isOwner)
      throw new ForbiddenException('Only the project owner can unlink GitHub');
    await this.prisma.client.projectGitHubLink.deleteMany({
      where: { projectId: access.project.id },
    });
    return { linked: false };
  }

  /** The project's files as bytes, with their git ids. */
  private async localFiles(projectId: number) {
    const rows = await this.prisma.client.projectFile.findMany({
      where: { projectId, isFolder: false },
    });
    const out = new Map<
      string,
      { row: (typeof rows)[number]; data: Buffer; sha: string }
    >();
    for (const row of rows) {
      const data = row.filePath
        ? await this.projects.readAsset(row.filePath).catch(() => null)
        : Buffer.from(row.content ?? '', 'utf8');
      if (data) out.set(row.path, { row, data, sha: gitBlobSha(data) });
    }
    return out;
  }

  async push(projectUid: string, userId: number, message?: string) {
    const access = await this.owned(projectUid, userId);
    if (!access.isOwner)
      throw new ForbiddenException('Only the project owner can push to GitHub');
    const link = await this.linkFor(access.project.id);
    const token = this.open(link.token);
    const base = (link.fileShas ?? {}) as Record<string, string>;

    await this.gateway.flushFiles(projectUid);
    let head = await this.head(token, link);
    if (head && head !== link.lastCommitSha) {
      throw new ConflictException(
        'GitHub has commits this project has not pulled. Pull first, then push.',
      );
    }

    const files = await this.localFiles(access.project.id);
    const shas: Record<string, string> = {};
    for (const [path, f] of files) shas[path] = f.sha;
    // With a commit to build on, only what changed since the last sync goes
    // up; files GitHub has that never came here are left alone.
    let changed = [...files.entries()].filter(
      ([path, f]) => !head || base[path] !== f.sha,
    );
    const deleted = head ? Object.keys(base).filter((p) => !(p in shas)) : [];
    if (head && !changed.length && !deleted.length) {
      return { upToDate: true, commit: head };
    }

    const commitMessage = (message?.trim() || `Update from Eneles`).slice(
      0,
      500,
    );
    const pushed = changed.length;

    // An empty repository has no git database yet; the contents API can
    // make its first commit, and the rest builds on that.
    if (!head) {
      const { status } = await this.gh(
        token,
        'GET',
        `/repos/${link.repo}/git/ref/heads/${encodeURIComponent(link.branch)}`,
        undefined,
        [404, 409],
      );
      if (status === 409) {
        const [firstPath, first] =
          changed.find(([p]) => p === 'main.tex') ?? changed[0];
        const { data } = await this.gh<{ commit?: { sha?: string } }>(
          token,
          'PUT',
          `/repos/${link.repo}/contents/${firstPath.split('/').map(encodeURIComponent).join('/')}`,
          {
            message: commitMessage,
            content: first.data.toString('base64'),
            branch: link.branch,
          },
        );
        head = data?.commit?.sha ?? null;
        changed = changed.filter(([p]) => p !== firstPath);
      }
    }

    const tree: {
      path: string;
      mode: string;
      type: 'blob';
      sha: string | null;
    }[] = [];
    for (let i = 0; i < changed.length; i += 4) {
      const batch = await Promise.all(
        changed.slice(i, i + 4).map(async ([path, f]) => {
          const { data } = await this.gh<GhSha>(
            token,
            'POST',
            `/repos/${link.repo}/git/blobs`,
            {
              content: f.data.toString('base64'),
              encoding: 'base64',
            },
          );
          return {
            path,
            mode: '100644',
            type: 'blob' as const,
            sha: data.sha,
          };
        }),
      );
      tree.push(...batch);
    }
    for (const path of deleted)
      tree.push({ path, mode: '100644', type: 'blob', sha: null });

    let commitSha = head;
    if (tree.length) {
      const baseTree = head
        ? (
            await this.gh<GhCommit>(
              token,
              'GET',
              `/repos/${link.repo}/git/commits/${head}`,
            )
          ).data?.tree?.sha
        : undefined;
      const { data: newTree } = await this.gh<GhSha>(
        token,
        'POST',
        `/repos/${link.repo}/git/trees`,
        {
          ...(baseTree ? { base_tree: baseTree } : {}),
          tree,
        },
      );
      const { data: commit } = await this.gh<GhSha>(
        token,
        'POST',
        `/repos/${link.repo}/git/commits`,
        {
          message: commitMessage,
          tree: newTree.sha,
          parents: head ? [head] : [],
        },
      );
      commitSha = commit.sha;
      if (head) {
        await this.gh(
          token,
          'PATCH',
          `/repos/${link.repo}/git/refs/heads/${encodeURIComponent(link.branch)}`,
          { sha: commitSha, force: false },
        );
      } else {
        await this.gh(token, 'POST', `/repos/${link.repo}/git/refs`, {
          ref: `refs/heads/${link.branch}`,
          sha: commitSha,
        });
      }
    }

    await this.prisma.client.projectGitHubLink.update({
      where: { id: link.id },
      data: {
        lastCommitSha: commitSha,
        fileShas: shas,
        lastSyncedAt: new Date(),
      },
    });
    this.logger.log(
      `Pushed project ${projectUid} to ${link.repo}@${link.branch}: ${pushed} changed, ${deleted.length} deleted`,
    );
    return {
      upToDate: false,
      commit: commitSha,
      changed: pushed,
      deleted: deleted.length,
    };
  }

  /**
   * Bring GitHub's changes in. On the first pull after linking, nothing has
   * been agreed yet; `preferGithub` then takes GitHub's version of files
   * both sides have (a new project pulling an existing repository) instead
   * of saving it beside this project's.
   */
  async pull(projectUid: string, userId: number, preferGithub = false) {
    const access = await this.owned(projectUid, userId);
    if (!access.isOwner)
      throw new ForbiddenException(
        'Only the project owner can pull from GitHub',
      );
    const projectId = access.project.id;
    const link = await this.linkFor(projectId);
    const token = this.open(link.token);
    const base = (link.fileShas ?? {}) as Record<string, string>;

    const head = await this.head(token, link);
    if (!head)
      throw new BadRequestException(
        'That branch has no commits yet. Push first.',
      );
    if (head === link.lastCommitSha)
      return {
        upToDate: true,
        updated: [],
        added: [],
        removed: [],
        conflicts: [],
        skipped: [],
      };

    await this.gateway.flushFiles(projectUid);
    const { data: commit } = await this.gh<GhCommit>(
      token,
      'GET',
      `/repos/${link.repo}/git/commits/${head}`,
    );
    const { data: remoteTree } = await this.gh<GhTree>(
      token,
      'GET',
      `/repos/${link.repo}/git/trees/${commit.tree.sha}?recursive=1`,
    );
    const local = await this.localFiles(projectId);

    const updated: string[] = [];
    const added: string[] = [];
    const removed: string[] = [];
    const conflicts: { path: string; copy?: string; reason: string }[] = [];
    const skipped: { path: string; reason: string }[] = [];
    const nextBase: Record<string, string> = {};
    const remotePaths = new Set<string>();

    const blob = async (sha: string) => {
      const { data } = await this.gh<{ content?: string }>(
        token,
        'GET',
        `/repos/${link.repo}/git/blobs/${sha}`,
      );
      return Buffer.from(
        String(data.content ?? '').replace(/\n/g, ''),
        'base64',
      );
    };

    for (const entry of remoteTree.tree ?? []) {
      if (entry.type !== 'blob' || entry.mode === '120000') continue;
      const path = entry.path;
      if (!PROJECT_FILE_PATH.test(path) || path.length > 500) {
        skipped.push({ path, reason: 'its name is not allowed here' });
        continue;
      }
      remotePaths.add(path);
      if ((entry.size ?? 0) > MAX_FILE_BYTES) {
        skipped.push({ path, reason: 'larger than 10 MB' });
        continue;
      }
      const mine = local.get(path);
      if (entry.sha === base[path] || mine?.sha === entry.sha) {
        nextBase[path] = entry.sha;
        continue;
      }
      const firstPull = !link.lastCommitSha && preferGithub;
      if (!mine || mine.sha === base[path] || firstPull) {
        await this.writeFile(
          projectUid,
          projectId,
          path,
          await blob(entry.sha),
          mine?.row,
        );
        (mine ? updated : added).push(path);
      } else {
        // Changed on both sides: this project keeps its version, and GitHub's
        // sits beside it to compare.
        const copy = conflictCopyPath(path);
        await this.writeFile(
          projectUid,
          projectId,
          copy,
          await blob(entry.sha),
          local.get(copy)?.row,
        );
        conflicts.push({ path, copy, reason: 'changed here and on GitHub' });
      }
      nextBase[path] = entry.sha;
    }

    for (const path of Object.keys(base)) {
      if (remotePaths.has(path)) continue;
      const mine = local.get(path);
      if (!mine) continue;
      if (mine.sha === base[path] && !mine.row.isMain) {
        await this.projects.deleteFile(mine.row.id, projectId);
        removed.push(path);
      } else {
        conflicts.push({
          path,
          reason: mine.row.isMain
            ? 'deleted on GitHub, but it is the main document'
            : 'deleted on GitHub, changed here',
        });
      }
    }

    await this.prisma.client.projectGitHubLink.update({
      where: { id: link.id },
      data: {
        lastCommitSha: head,
        fileShas: nextBase,
        lastSyncedAt: new Date(),
      },
    });
    if (updated.length || added.length || removed.length || conflicts.length) {
      this.gateway.announce(projectUid, 'files-changed', {
        reason: 'github-pull',
      });
    }
    if (remoteTree.truncated)
      skipped.push({
        path: '…',
        reason: 'GitHub listed only part of a very large repository',
      });
    this.logger.log(
      `Pulled ${link.repo}@${link.branch} into ${projectUid}: ${updated.length} updated, ${added.length} added, ${removed.length} removed, ${conflicts.length} conflicts`,
    );
    return {
      upToDate: false,
      commit: head,
      updated,
      added,
      removed,
      conflicts,
      skipped,
    };
  }

  /** Put GitHub's bytes at a path: text into the file (and the live document), the rest into storage. */
  private async writeFile(
    projectUid: string,
    projectId: number,
    path: string,
    data: Buffer,
    existing?: { id: number; filePath: string | null; isMain: boolean },
  ) {
    if (!isTextFile(path, data)) {
      await this.projects.putAsset(
        projectId,
        path,
        data,
        'application/octet-stream',
      );
      return;
    }
    const content = data.toString('utf8');
    if (existing && !existing.filePath) {
      await this.projects.writeFileContentByPath(projectUid, path, content);
      await this.gateway.replaceLiveText(projectUid, path, content);
      return;
    }
    if (existing?.filePath)
      await this.projects.deleteFile(existing.id, projectId);
    for (const folder of ProjectsService.foldersFor([{ path }])) {
      await this.prisma.client.projectFile.upsert({
        where: { projectId_path: { projectId, path: folder } },
        create: { projectId, path: folder, isFolder: true },
        update: {},
      });
    }
    await this.prisma.client.projectFile.create({
      data: { projectId, path, content },
    });
  }
}
