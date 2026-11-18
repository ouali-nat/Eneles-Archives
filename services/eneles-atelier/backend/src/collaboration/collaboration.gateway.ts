import { registerCollabStats } from '../metrics/runtime';
import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  OnGatewayConnection,
  OnGatewayDisconnect,
  ConnectedSocket,
  MessageBody,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import {
  Logger,
  OnModuleDestroy,
  Optional,
  UnauthorizedException,
} from '@nestjs/common';
import { AuthService } from '../auth/auth.service';
import { ProjectsService } from '../projects/projects.service';
import { HistoryService } from '../projects/history.service';
import {
  YjsPersistenceService,
  clearPaths,
  errorMessage,
} from './yjs-persistence.service';
import * as Y from 'yjs';
import { corsOriginCallback } from '../common/cors';
import {
  SESSION_COOKIE,
  hasOwnOrigin,
  readCookie,
} from '../common/session-cookie';
import { randomBytes } from 'crypto';
import {
  RateLimiter,
  SOCKET_LIMITS,
  bytesOf,
  cursorMove,
  filePath,
  projectUid as validProjectUid,
  wire,
  type RateKind,
} from './socket-guard';

/** Per-user presence state within a project room */
interface UserPresence {
  userId: number;
  socketId: string;
  name: string;
  email: string;
  avatarUrl?: string;
  color: string;
  /** Currently-selected file path */
  activeFile: string | null;
  /** Cursor position in the file */
  cursor: { line: number; ch: number } | null;
  /** Selection range (if any) */
  selection: {
    fromLine: number;
    fromCh: number;
    toLine: number;
    toCh: number;
  } | null;
  lastActivity: number;
}

// Deterministic color assignment per user so colors are consistent
const CURSOR_COLORS = [
  '#f87171', // red
  '#60a5fa', // blue
  '#34d399', // green
  '#fbbf24', // amber
  '#a78bfa', // violet
  '#f472b6', // pink
  '#38bdf8', // sky
  '#fb923c', // orange
  '#2dd4bf', // teal
  '#e879f9', // fuchsia
];

/** Where the document keeps its own bookkeeping, apart from the files' texts (see `epochOf`). */
const META_KEY = 'texer:meta';

@WebSocketGateway({
  namespace: '/collaboration',
  cors: {
    origin: corsOriginCallback,
    credentials: true,
  },
  // Socket.IO's own limit on one message (1 MB by default): over it, the socket is dropped without a word, and the change in it is lost. Updates travel as binary, so this is the size of the largest paste the editor can carry in one change.
  maxHttpBufferSize: SOCKET_LIMITS.maxMessageBytes,
})
export class CollaborationGateway
  implements OnGatewayConnection, OnGatewayDisconnect, OnModuleDestroy
{
  @WebSocketServer()
  server: Server;

  private readonly logger = new Logger(CollaborationGateway.name);

  /** projectUid → Map<socketId, UserPresence> */
  private rooms = new Map<string, Map<string, UserPresence>>();

  /** socketId → projectUid (for fast cleanup on disconnect) */
  private socketToProject = new Map<string, string>();

  /** socketId → a join that has been asked for and has not finished. */
  private joining = new Map<string, Promise<void>>();

  /**
   * Whether each socket may change the document, decided at join from the
   * project role. Viewers receive updates but never send them: the REST API
   * already refuses their writes, and the socket must not be a side door.
   */
  private socketCanEdit = new Map<string, boolean>();

  /** projectUid → Y.Doc (server-side CRDT document per project) */
  private yjsDocs = new Map<string, Y.Doc>();

  /**
   * Set of `${projectUid}::${file}` keys whose Y.Text has already been seeded
   * from the database. Seeding happens exactly ONCE per file per Y.Doc
   * lifetime. This is the single, server-authoritative seeding point that
   * replaces the old (racy) client-side seeding.
   */
  private seededFiles = new Set<string>();

  /**
   * In-flight seeding promises keyed by `${projectUid}::${file}`. Concurrent
   * sync requests for the same not-yet-seeded file await the same promise so
   * they all respond with the seeded state (no empty-then-content window).
   */
  private seedingInFlight = new Map<string, Promise<void>>();

  /** userId → assigned color index (global, persists across reconnects) */
  private userColorIndex = new Map<number, number>();
  private nextColorIndex = 0;

  /**
   * projectUid → in-flight hydration of the Y.Doc from persisted state.
   * Awaited before the first sync response so a rejoining client diffs against
   * the restored document rather than an empty one.
   */
  private hydrating = new Map<string, Promise<Set<string>>>();

  /**
   * projectUid → in-flight teardown (flush + destroy). A client joining while
   * the previous session is still being written out must wait, otherwise it
   * would hydrate from pre-flush state and lose the final edits.
   */
  private teardowns = new Map<string, Promise<void>>();

  /** projectUids whose Y.Doc has changes not yet persisted */
  private dirtyDocs = new Set<string>();

  /** projectUid → scheduled periodic flush */
  private flushTimers = new Map<string, NodeJS.Timeout>();

  /**
   * How long a change may sit in memory before being persisted. This is a
   * fixed interval from the FIRST unsaved change, not a trailing debounce.
   * somebody typing continuously for ten minutes must not keep pushing the
   * save out ahead of themselves.
   */
  private static readonly FLUSH_INTERVAL_MS = 5000;

  /**
   * Access can change while a socket stays connected: an owner turns an
   * editor into a viewer, or removes someone. This often, every joined
   * socket's access is checked again.
   */
  private static readonly ACCESS_RECHECK_MS = 30_000;
  private accessTimer: NodeJS.Timeout | null = null;

  /** How often each socket may send each kind of message (see socket-guard.ts). */
  private readonly limiter = new RateLimiter();
  /** Sockets whose dropped messages have been logged lately, so a flood is one log line, not thousands. */
  private readonly floodLogged = new Map<string, number>();

  constructor(
    private readonly authService: AuthService,
    private readonly projectsService: ProjectsService,
    private readonly yjsPersistence: YjsPersistenceService,
    @Optional() private readonly history?: HistoryService,
  ) {}

  // ──────────── Yjs helpers ────────────

  /** Get or create the Y.Doc for a project */
  private getOrCreateYDoc(projectUid: string): Y.Doc {
    let doc = this.yjsDocs.get(projectUid);
    if (!doc) {
      doc = new Y.Doc();
      const created = doc;
      // Whose socket changed which file: counted for the next version of that file (see HistoryService).
      created.on('afterTransaction', (tr: Y.Transaction) =>
        this.noteAuthors(projectUid, created, tr),
      );
      this.yjsDocs.set(projectUid, doc);
      this.logger.log(`Created Y.Doc for project ${projectUid}`);
    }
    return doc;
  }

  /**
   * Credit a change to the person whose socket sent it, once per file it touched. Only updates a person sent carry their id as the transaction's origin (see handleYjsUpdate): loading saved state, seeding from the database, and the server's own writes (a rename, a pull, a restore) credit no one here.
   */
  private noteAuthors(projectUid: string, doc: Y.Doc, tr: Y.Transaction) {
    const origin = tr.origin as { userId?: unknown; name?: unknown } | null;
    if (!this.history || !origin || typeof origin.userId !== 'number') return;
    let names: Map<unknown, string> | null = null;
    for (const type of tr.changed.keys()) {
      if (!(type instanceof Y.Text) || type._item !== null) continue;
      names ??= new Map([...doc.share].map(([name, t]) => [t, name]));
      const path = names.get(type);
      if (!path || path === META_KEY || path.startsWith('tc:')) continue;
      this.history.noteEdit(
        projectUid,
        path,
        origin.userId,
        typeof origin.name === 'string' ? origin.name : '',
      );
    }
  }

  /**
   * Get the project's Y.Doc, guaranteed to have had any persisted CRDT state
   * applied to it. Every path that reads or mutates a doc goes through here.
   */
  private async hydrateYDoc(projectUid: string): Promise<Y.Doc> {
    // Never race a teardown that is still writing this project's state out.
    const teardown = this.teardowns.get(projectUid);
    if (teardown) await teardown;

    const doc = this.getOrCreateYDoc(projectUid);

    let hydration = this.hydrating.get(projectUid);
    if (!hydration) {
      hydration = this.yjsPersistence.load(projectUid, doc).then((restored) => {
        // A restored Y.Text is strictly newer than the project_files row it
        // was originally seeded from, so mark it seeded to stop handleYjsSync
        // overwriting it with stale database content.
        for (const file of restored) {
          this.seededFiles.add(`${projectUid}::${file}`);
        }
        return restored;
      });
      this.hydrating.set(projectUid, hydration);
    }
    await hydration;
    this.ensureEpoch(projectUid, doc);

    return doc;
  }

  /**
   * Every document carries an epoch: a random name given when it is first made, saved with it, and the same for as long as its history continues. A client that edited an earlier document (one the server could not restore, so it was seeded again from the files) is told by a different epoch that its history and the server's no longer share a past: merging the two would put every line in twice, so it starts again from the server's copy instead.
   */
  private ensureEpoch(projectUid: string, doc: Y.Doc): string {
    const meta = doc.getMap<string>(META_KEY);
    const current = meta.get('epoch');
    if (typeof current === 'string') return current;
    const epoch = randomBytes(9).toString('base64url');
    doc.transact(() => meta.set('epoch', epoch), 'server');
    this.markDirty(projectUid);
    return epoch;
  }

  /** Drops a message that is over its rate, and says so in the log once in a while. */
  private allowed(client: Socket, kind: RateKind): boolean {
    if (this.limiter.take(client.id, kind)) return true;
    const last = this.floodLogged.get(client.id) ?? 0;
    if (Date.now() - last > 10_000) {
      this.floodLogged.set(client.id, Date.now());
      this.logger.warn(
        `Socket ${client.id} is sending ${kind} messages faster than allowed; dropping them`,
      );
    }
    return false;
  }

  /** File paths this room has seeded or restored, i.e. what is safe to flush. */
  private getTrackedFiles(projectUid: string): string[] {
    const prefix = `${projectUid}::`;
    const files: string[] = [];
    for (const key of this.seededFiles) {
      if (key.startsWith(prefix)) files.push(key.slice(prefix.length));
    }
    return files;
  }

  /** Note that a project has unpersisted changes and schedule a flush. */
  private markDirty(projectUid: string): void {
    this.dirtyDocs.add(projectUid);
    if (this.flushTimers.has(projectUid)) return;

    const timer = setTimeout(() => {
      this.flushTimers.delete(projectUid);
      void this.flushDoc(projectUid);
    }, CollaborationGateway.FLUSH_INTERVAL_MS);
    // Don't hold the event loop open on this alone.
    timer.unref?.();
    this.flushTimers.set(projectUid, timer);
  }

  /**
   * Persist a live project's CRDT state, and optionally write its text back to
   * `project_files`. The file write is reserved for teardown and shutdown,
   * doing it on every interval would mean a database round trip per file every
   * five seconds for every open room.
   */
  private async flushDoc(
    projectUid: string,
    includeFiles = false,
  ): Promise<void> {
    const doc = this.yjsDocs.get(projectUid);
    if (!doc) return;
    if (!this.dirtyDocs.has(projectUid) && !includeFiles) return;

    this.dirtyDocs.delete(projectUid);

    if (includeFiles) {
      await this.yjsPersistence.flushToFiles(
        projectUid,
        doc,
        this.getTrackedFiles(projectUid),
      );
    }
    await this.yjsPersistence.save(projectUid, doc);
  }

  /**
   * Flush and release the Y.Doc for a project whose room has emptied.
   *
   * The doc is detached from `yjsDocs` synchronously and the teardown promise
   * published before the first `await`, so a client joining mid-flush queues
   * behind it in `hydrateYDoc` instead of reading half-written state.
   */
  private destroyYDoc(projectUid: string): Promise<void> {
    const existing = this.teardowns.get(projectUid);
    if (existing) return existing;

    const doc = this.yjsDocs.get(projectUid);
    this.yjsDocs.delete(projectUid);
    this.hydrating.delete(projectUid);

    const timer = this.flushTimers.get(projectUid);
    if (timer) {
      clearTimeout(timer);
      this.flushTimers.delete(projectUid);
    }

    const teardown = (async () => {
      if (doc) {
        try {
          // Content first: even if persisting the CRDT blob fails, the plain
          // text the compiler and REST API read is already correct.
          await this.yjsPersistence.flushToFiles(
            projectUid,
            doc,
            this.getTrackedFiles(projectUid),
          );
          // Changes made live since each file's last version become a version now, credited to whoever made them: closing the tab before an autosave must not leave them out of the history.
          await this.history?.flushPending(projectUid, (path) =>
            doc.share.has(path) ? doc.getText(path).toJSON() : null,
          );
          await this.yjsPersistence.save(projectUid, doc);
        } catch (err: unknown) {
          this.logger.error(
            `Teardown flush failed for project ${projectUid}: ${errorMessage(err)}`,
          );
        }
        doc.destroy();
        this.logger.log(
          `Flushed and destroyed Y.Doc for project ${projectUid}`,
        );
      }

      this.dirtyDocs.delete(projectUid);

      // Forget seeding state for this project so the next session re-seeds the
      // fresh Y.Doc from persisted state, or from the database if none exists.
      const prefix = `${projectUid}::`;
      for (const key of this.seededFiles) {
        if (key.startsWith(prefix)) this.seededFiles.delete(key);
      }
      for (const key of this.seedingInFlight.keys()) {
        if (key.startsWith(prefix)) this.seedingInFlight.delete(key);
      }
    })().finally(() => {
      this.teardowns.delete(projectUid);
    });

    this.teardowns.set(projectUid, teardown);
    return teardown;
  }

  /**
   * Flush every open room on shutdown. Without this a deploy drops the
   * in-memory state of every active editing session at once, the single
   * largest data-loss event the old design could produce.
   */
  afterInit(): void {
    registerCollabStats(() => ({
      sockets: this.socketToProject.size,
      rooms: this.rooms.size,
      documents: this.yjsDocs.size,
    }));
    this.accessTimer = setInterval(
      () => void this.recheckAccess(),
      CollaborationGateway.ACCESS_RECHECK_MS,
    );
    this.accessTimer.unref?.();
  }

  /**
   * Edit rights follow the current role, and a socket whose user lost access
   * leaves the room, so it stops receiving the document too. One lookup per
   * person and project per pass. A failed lookup changes nothing.
   */
  private async recheckAccess(): Promise<void> {
    await this.recheckSessions();
    const lookups = new Map<
      string,
      Promise<{ canView: boolean; canEdit: boolean } | null>
    >();
    for (const [socketId, projectUid] of Array.from(this.socketToProject)) {
      const socket = (this.server as any)?.sockets?.get?.(socketId) as
        Socket | undefined;
      const userId = (socket as any)?.user?.userId;
      if (!socket || typeof userId !== 'number') continue;

      const key = `${projectUid}:${userId}`;
      if (!lookups.has(key)) {
        lookups.set(
          key,
          this.projectsService
            .checkAccess(projectUid, userId, { files: false })
            .then((a: any) => ({ canView: !!a.canView, canEdit: !!a.canEdit }))
            .catch(() => null),
        );
      }
      const access = await lookups.get(key);
      if (!access || this.socketToProject.get(socketId) !== projectUid)
        continue;

      if (!access.canView) {
        this.logger.log(
          `User ${userId} lost access to ${projectUid}; removing socket ${socketId}`,
        );
        socket.emit('access-changed', { canView: false, canEdit: false });
        await this.handleLeaveProject(socket);
        continue;
      }
      if (access.canEdit !== !!this.socketCanEdit.get(socketId)) {
        this.socketCanEdit.set(socketId, access.canEdit);
        socket.emit('access-changed', {
          canView: true,
          canEdit: access.canEdit,
        });
      }
    }
  }

  /**
   * The REST API refuses a session the moment it is signed out, revoked from settings, expired, or its account disabled; a socket was checked only when it connected, so it went on reading and writing. Each pass checks every socket's session again (the session lookup is cached) and closes those that would no longer be let in.
   */
  private async recheckSessions(): Promise<void> {
    const sockets = (
      this.server as unknown as { sockets?: Map<string, Socket> } | undefined
    )?.sockets;
    const checks = new Map<string, Promise<boolean>>();
    for (const socket of Array.from(sockets?.values() ?? [])) {
      const user = (
        socket as Socket & { user?: { sid?: string; exp?: number } }
      ).user;
      if (!user) continue;
      let ok: Promise<boolean>;
      if (typeof user.exp === 'number' && user.exp * 1000 <= Date.now())
        ok = Promise.resolve(false);
      else if (!user.sid) ok = Promise.resolve(true);
      else {
        const sid = user.sid;
        if (!checks.has(sid)) {
          checks.set(
            sid,
            this.authService
              .validateSession(sid)
              .then(() => true)
              // Only a refusal ends the socket; the database being unreachable for a moment does not.
              .catch((err: unknown) => !(err instanceof UnauthorizedException)),
          );
        }
        ok = checks.get(sid)!;
      }
      if (await ok) continue;
      this.logger.log(`Socket ${socket.id}: its session has ended; closing it`);
      socket.emit('session-ended');
      await this.handleLeaveProject(socket);
      socket.disconnect(true);
    }
  }

  async onModuleDestroy(): Promise<void> {
    if (this.accessTimer) clearInterval(this.accessTimer);
    const open = Array.from(this.yjsDocs.keys());
    if (open.length === 0) return;

    this.logger.log(`Flushing ${open.length} open Y.Doc(s) before shutdown`);
    await Promise.all(open.map((uid) => this.destroyYDoc(uid)));
  }

  /** Assign a stable color to a user */
  private getColorForUser(userId: number): string {
    if (!this.userColorIndex.has(userId)) {
      this.userColorIndex.set(userId, this.nextColorIndex);
      this.nextColorIndex = (this.nextColorIndex + 1) % CURSOR_COLORS.length;
    }
    return CURSOR_COLORS[this.userColorIndex.get(userId)!];
  }

  /**
   * Close every open socket of one account. A session is only checked when a socket connects, so ending an account's sessions (an administrator disabling it, signing it out everywhere, or deleting it) also has to close the sockets it already has open. Returns how many were closed.
   */
  disconnectUser(userId: number): number {
    let closed = 0;
    const sockets = (this.server as any)?.sockets as
      Map<string, Socket> | undefined;
    for (const socket of Array.from(sockets?.values() ?? [])) {
      if ((socket as any).user?.userId === userId) {
        socket.disconnect(true);
        closed += 1;
      }
    }
    return closed;
  }

  /** Authenticate socket on connect via JWT in the handshake query/auth */
  /**
   * Authentication is asynchronous (it checks the session in the database),
   * and clients send join-project as soon as they connect. Each socket keeps
   * the promise of its own authentication, and join waits for it; checking
   * `client.user` directly dropped any client whose join beat the lookup.
   */
  async handleConnection(client: Socket) {
    const ready = this.authenticate(client);
    (client as any).authReady = ready;
    await ready;
  }

  private async authenticate(client: Socket): Promise<void> {
    try {
      // Programs pass a token in the handshake. The site's own pages rely on
      // the session cookie, which the browser sends with the handshake; a
      // handshake from another site's page would carry it too, so the cookie
      // only counts when the Origin is ours.
      let token =
        (client.handshake.auth?.token as string) ||
        (client.handshake.query?.token as string);
      if (!token && hasOwnOrigin(client.handshake.headers)) {
        token =
          readCookie(client.handshake.headers.cookie, SESSION_COOKIE) ?? '';
      }

      if (!token) {
        this.logger.warn(`Socket ${client.id} rejected: no token`);
        client.disconnect();
        return;
      }

      // Full validation, not just signature. `validateToken` also checks the
      // session the token was issued against is still active, so revoking a
      // session from settings closes its sockets too. Verifying the JWT alone
      // here left a revoked token able to open a collaboration socket, and
      // read live edits, for the remainder of its seven-day lifetime.
      const payload = await this.authService.validateToken(token);
      const userId = payload.sub ?? (payload as any).userId;
      // The token carries no picture, so read the account's: a generated picture (dither:…) or an uploaded photo's storage key, which browsers open through GET /users/:id/avatar.
      const account = await this.projectsService
        .getOwner(userId)
        .catch(() => null);
      // Attach user info to socket data to ensure correct identity for presence
      (client as any).user = {
        userId: userId,
        name: payload.name ?? payload.email ?? 'Anonymous',
        email: payload.email ?? '',
        avatarUrl: account?.avatarUrl ?? null,
        // Checked again every ACCESS_RECHECK_MS (see recheckSessions).
        sid: payload.sid,
        exp: (payload as { exp?: number }).exp,
      };

      this.logger.log(
        `Socket ${client.id} authenticated as userId=${(client as any).user.userId}`,
      );
    } catch (err: any) {
      this.logger.warn(
        `Socket ${client.id} rejected: invalid token. ${err.message}`,
      );
      client.disconnect();
    }
  }

  /** Clean up on disconnect */
  async handleDisconnect(client: Socket) {
    const projectUid = this.socketToProject.get(client.id);
    if (projectUid) {
      const room = this.rooms.get(projectUid);
      if (room) {
        room.delete(client.id);

        // Broadcast updated presence to the room
        this.broadcastPresence(projectUid);

        if (room.size === 0) {
          this.rooms.delete(projectUid);
          // Last user left, so flush the Y.Doc to storage, then free it
          await this.destroyYDoc(projectUid);
        }
      }
      this.socketToProject.delete(client.id);
      this.socketCanEdit.delete(client.id);
    }
    this.limiter.forget(client.id);
    this.floodLogged.delete(client.id);

    this.logger.log(`Socket ${client.id} disconnected`);
  }

  /**
   * Join a project room.
   *
   * Joining takes a moment (the sign-in is checked, then access to the project), and the browser does not wait for it: it asks for the open file's contents straight after asking to join. Those requests must not be dropped for arriving early, or the first file a person opens never becomes live and what they type into it is not shared or saved through the document. So the join is recorded as in flight, and the document handlers wait for it (see `joinedProject`).
   */
  @SubscribeMessage('join-project')
  async handleJoinProject(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { projectUid: string; activeFile?: string },
  ) {
    const uid = validProjectUid(data?.projectUid);
    if (!uid || !this.allowed(client, 'join')) return;
    const activeFile = filePath(data?.activeFile) ?? undefined;
    // One join at a time per socket, in the order asked: two running at once could each leave the other's room half-joined.
    const previous = this.joining.get(client.id) ?? Promise.resolve();
    const joining = previous
      .then(() => this.joinProject(client, { projectUid: uid, activeFile }))
      .catch((err: unknown) => {
        this.logger.error(
          `Join failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      });
    this.joining.set(client.id, joining);
    try {
      await joining;
    } finally {
      if (this.joining.get(client.id) === joining)
        this.joining.delete(client.id);
    }
  }

  /** The project this socket is in, once any join it has asked for has finished. */
  private async joinedProject(client: Socket): Promise<string | undefined> {
    const joining = this.joining.get(client.id);
    if (joining) await joining;
    return this.socketToProject.get(client.id);
  }

  private async joinProject(
    client: Socket,
    data: { projectUid: string; activeFile?: string },
  ) {
    await (client as any).authReady;
    const user = (client as any).user;
    if (!user) {
      client.disconnect();
      return;
    }

    const { projectUid, activeFile } = data;

    // Verify the user has access to this project
    let canEdit = false;
    let member = false;
    try {
      const access = await this.projectsService.checkAccess(
        projectUid,
        user.userId,
        { files: false },
      );
      canEdit = !!access.canEdit;
      // Someone with an invitation they have not accepted can look, but
      // does not get the chat or comment announcements.
      member = !access.pendingInvitation;
      if (!access.canView) {
        this.logger.warn(
          `User ${user.userId} denied access to project ${projectUid}`,
        );
        client.emit('error', { message: 'Access denied to this project' });
        return;
      }
    } catch (err: any) {
      this.logger.error(
        `Access check failed for user ${user.userId} on project ${projectUid}: ${err.message}`,
      );
      client.emit('error', { message: 'Access denied to this project' });
      return;
    }

    // Leave previous room if any.
    //
    // This MUST be awaited. `handleLeaveProject` deletes the socket's entry in
    // `socketToProject` as its last step, and when the previous room empties it
    // first awaits the Y.Doc teardown. Left unawaited, that delete lands after
    // the `socketToProject.set` below and wipes the mapping for the room we
    // just joined, which silently kills sync for that socket.
    const prevProject = this.socketToProject.get(client.id);
    if (prevProject && prevProject !== projectUid) {
      await this.handleLeaveProject(client);
    }

    // The socket may have gone while its access was being checked. Recorded now, it would stay in the room as a presence nobody can remove, and keep the room's document in memory for good.
    if (!client.connected) return;

    // Join Socket.IO room
    client.join(`project:${projectUid}`);
    if (member) client.join(`members:${projectUid}`);
    this.socketToProject.set(client.id, projectUid);
    this.socketCanEdit.set(client.id, canEdit);

    // Create room map if needed
    if (!this.rooms.has(projectUid)) {
      this.rooms.set(projectUid, new Map());
    }

    const room = this.rooms.get(projectUid)!;

    const presence: UserPresence = {
      userId: user.userId,
      socketId: client.id,
      name: user.name,
      email: user.email,
      avatarUrl: user.avatarUrl,
      color: this.getColorForUser(user.userId),
      activeFile: activeFile || null,
      cursor: null,
      selection: null,
      lastActivity: Date.now(),
    };

    room.set(client.id, presence);

    this.logger.log(
      `User ${user.userId} (${user.name}) joined project ${projectUid}, ${room.size} users now`,
    );

    // Send current room state to the joining user
    client.emit(
      'presence-sync',
      this.getRoomPresenceList(projectUid, client.id),
    );

    // Broadcast updated presence to everyone else
    this.broadcastPresence(projectUid);
  }

  /** Leave a project room */
  @SubscribeMessage('leave-project')
  async handleLeaveProject(@ConnectedSocket() client: Socket) {
    const projectUid = this.socketToProject.get(client.id);
    if (!projectUid) return;

    void client.leave(`project:${projectUid}`);
    void client.leave(`members:${projectUid}`);
    const room = this.rooms.get(projectUid);
    if (room) {
      room.delete(client.id);
      this.broadcastPresence(projectUid);
      if (room.size === 0) {
        this.rooms.delete(projectUid);
        // Last user left, so flush the Y.Doc to storage, then free it
        await this.destroyYDoc(projectUid);
      }
    }
    this.socketToProject.delete(client.id);
    this.socketCanEdit.delete(client.id);
  }

  /** Cursor position update */
  @SubscribeMessage('cursor-move')
  handleCursorMove(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: unknown,
  ) {
    const projectUid = this.socketToProject.get(client.id);
    if (!projectUid) return;
    const data = cursorMove(body);
    if (!data || !this.allowed(client, 'cursor')) return;

    const room = this.rooms.get(projectUid);
    if (!room) return;

    const presence = room.get(client.id);
    if (!presence) return;

    presence.cursor = { line: data.line, ch: data.ch };
    presence.selection = data.selection;
    presence.lastActivity = Date.now();

    // Broadcast to others in the room (not to self)
    client.to(`project:${projectUid}`).emit('cursor-update', {
      socketId: client.id,
      userId: presence.userId,
      name: presence.name,
      color: presence.color,
      cursor: presence.cursor,
      selection: presence.selection,
      activeFile: presence.activeFile,
    });
  }

  /** Active file change */
  @SubscribeMessage('file-select')
  async handleFileSelect(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { file: string },
  ) {
    const file = filePath(data?.file);
    if (!file || !this.allowed(client, 'select')) return;
    const projectUid = await this.joinedProject(client);
    if (!projectUid) return;

    const room = this.rooms.get(projectUid);
    if (!room) return;

    const presence = room.get(client.id);
    if (!presence) return;

    presence.activeFile = file;
    presence.cursor = null; // Reset cursor when switching files
    presence.selection = null;
    presence.lastActivity = Date.now();

    // Broadcast presence update
    this.broadcastPresence(projectUid);
  }

  // ──────────── Yjs CRDT event handlers ────────────

  /**
   * yjs-sync: the client sends its state vector, the server responds with the
   * diff so the client can catch up to the server state.
   *
   * This is also the ONE place a file's Y.Text is seeded from the database.
   * A synchronous check-and-set on `seededFiles` elects a single seeder, and
   * concurrent sync requests await that seeder's shared promise before
   * responding, so every client receives the seeded content in its own sync
   * response. This replaces the old racy client-side seeding that caused
   * content doubling/rotation.
   */
  @SubscribeMessage('yjs-sync')
  async handleYjsSync(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { file: string; sv: unknown },
  ) {
    const file = filePath(data?.file);
    const stateVector = bytesOf(data?.sv, SOCKET_LIMITS.maxStateVectorBytes);
    if (!file || !stateVector || !this.allowed(client, 'sync')) return;
    const projectUid = await this.joinedProject(client);
    if (!projectUid) return;

    const doc = await this.hydrateYDoc(projectUid);
    const seedKey = `${projectUid}::${file}`;

    // Seed from the DB exactly once per file. Concurrent sync requests all
    // await the SAME seeding promise, so every client receives the seeded
    // state in its own sync response. There is no "empty now, content later"
    // window that could desync or double a late joiner.
    // The file's text is only made in the document once the file is known to exist: a name that is not one of the project's files (a typo, or a client asking for anything it likes) gets the document as it is, and leaves nothing behind in it.
    let known: boolean;
    try {
      known = doc.share.has(file) && doc.getText(file).length > 0;
    } catch {
      // The name is taken by something that is not a text.
      return;
    }
    if (!known && !this.seededFiles.has(seedKey)) {
      this.seededFiles.add(seedKey);
      const seeding = (async () => {
        const content = await this.projectsService.getFileContentByPath(
          projectUid,
          file,
        );
        // No such file (yet): a client that renamed a file can ask for the new path a moment before the rename reaches the database. That is not "seeded and empty": left marked, the text would stay empty for the life of the room, and the next save or flush would blank the file. Unmarked, the next sync seeds it properly.
        if (content === null) {
          this.seededFiles.delete(seedKey);
          return;
        }
        const yText = doc.getText(file);
        if (content && yText.length === 0) {
          doc.transact(() => {
            yText.insert(0, content);
          });
          this.markDirty(projectUid);
          this.logger.log(
            `Seeded Y.Text for "${file}" in project ${projectUid} from DB (${content.length} chars)`,
          );
        }
      })()
        .catch((err: any) => {
          // Seeding failed. Allow a later sync to retry by clearing the flag.
          this.seededFiles.delete(seedKey);
          this.logger.error(
            `Failed to seed Y.Text for "${file}" in project ${projectUid}: ${err.message}`,
          );
        })
        .finally(() => {
          this.seedingInFlight.delete(seedKey);
        });
      this.seedingInFlight.set(seedKey, seeding);
    }

    // If a seed is currently in flight for this file (started by us or by a
    // concurrent request), wait for it before encoding the response.
    const inFlight = this.seedingInFlight.get(seedKey);
    if (inFlight) await inFlight;

    let update: Uint8Array;
    try {
      update = Y.encodeStateAsUpdate(doc, stateVector);
    } catch {
      // Not a state vector.
      return;
    }

    // `sv` is the server's own state vector, so the client can send what it has that the server lacks (what it typed while disconnected); `epoch` tells it whether the two still share a history (see ensureEpoch).
    client.emit('yjs-sync', {
      file,
      update: wire(update),
      sv: wire(Y.encodeStateVector(doc)),
      epoch: this.ensureEpoch(projectUid, doc),
    });
  }

  /**
   * yjs-update: the client sends a Yjs update (mutation). Server applies it
   * to the canonical Y.Doc and relays to all other clients in the room.
   */
  @SubscribeMessage('yjs-update')
  async handleYjsUpdate(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { file: string; update: unknown },
  ) {
    const file = filePath(data?.file);
    const updateBytes = bytesOf(data?.update, SOCKET_LIMITS.maxUpdateBytes);
    if (!file || !updateBytes) {
      client.emit('error', {
        message:
          'That change could not be read, or is too large to send at once.',
      });
      return;
    }
    if (!this.allowed(client, 'update')) return;
    const projectUid = await this.joinedProject(client);
    if (!projectUid) return;
    if (!this.socketCanEdit.get(client.id)) {
      client.emit('error', {
        message: 'You have view access to this project.',
      });
      return;
    }

    const doc = await this.hydrateYDoc(projectUid);

    try {
      // The origin names who sent it, so the change is credited to them (see noteAuthors).
      const sender = (
        client as Socket & { user?: { userId: number; name: string } }
      ).user;
      Y.applyUpdate(
        doc,
        updateBytes,
        sender ? { userId: sender.userId, name: sender.name } : null,
      );
    } catch (err: any) {
      this.logger.error(
        `Failed to apply Yjs update for project ${projectUid}, file ${file}: ${err.message}`,
      );
      return;
    }

    // Schedule a background persist so a crash loses at most FLUSH_INTERVAL_MS
    // of work rather than the whole session.
    this.markDirty(projectUid);

    // Relay the update to every other client in the room (not the sender)
    client.to(`project:${projectUid}`).emit('yjs-update', {
      file,
      update: wire(updateBytes),
    });
  }

  /**
   * yjs-awareness-update: relay awareness information (cursors, user
   * names, selection ranges managed by y-protocols/awareness) to peers.
   */
  @SubscribeMessage('yjs-awareness-update')
  async handleYjsAwarenessUpdate(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { data: unknown },
  ) {
    const bytes = bytesOf(data?.data, SOCKET_LIMITS.maxAwarenessBytes);
    if (!bytes || !this.allowed(client, 'awareness')) return;
    const projectUid = await this.joinedProject(client);
    if (!projectUid) return;

    // Relay to all other clients in the room (not the sender). Only the bytes go on: nothing else the client put in the message reaches the others.
    client.to(`project:${projectUid}`).emit('yjs-awareness-update', {
      data: wire(bytes),
    });
  }

  // ──────────── Helpers ────────────

  /**
   * Tell the project's members something happened that they should see now:
   * a new chat message, or a comment change to fetch.
   */
  announce(
    projectUid: string,
    event: 'chat-message' | 'comments-changed' | 'files-changed',
    payload: unknown,
  ) {
    this.server?.to(`members:${projectUid}`).emit(event, payload);
  }

  /**
   * Write what people are editing back to the project's files now, so a
   * push or an export reads the current text. Nothing to do when nobody has
   * the project open.
   */
  async flushFiles(projectUid: string): Promise<void> {
    if (!this.yjsDocs.has(projectUid)) return;
    this.dirtyDocs.add(projectUid);
    await this.flushDoc(projectUid, true);
  }

  /**
   * A file (or a folder of files) took a new path. The live document keys each file's text by its path, so the text moves with it: what people were editing under the old path is put under the new one, the old one is emptied, and everyone in the room is told. Without this the renamed file opened empty, and the next save blanked it. Nothing to do when nobody has the project open: the database holds the text, and the document is seeded from it by path when the file is opened.
   */
  movePaths(projectUid: string, from: string, to: string): void {
    if (from !== to) this.history?.movePending(projectUid, from, to);
    const doc = this.yjsDocs.get(projectUid);
    if (!doc || from === to) return;
    const prefix = `${projectUid}::`;
    const moves: [string, string][] = [];
    for (const key of [...this.seededFiles]) {
      if (!key.startsWith(prefix)) continue;
      const path = key.slice(prefix.length);
      if (path === from) moves.push([path, to]);
      else if (path.startsWith(`${from}/`))
        moves.push([path, to + path.slice(from.length)]);
    }
    if (!moves.length) return;
    const before = Y.encodeStateVector(doc);
    doc.transact(() => {
      for (const [oldPath, newPath] of moves) {
        const source = doc.getText(oldPath);
        const target = doc.getText(newPath);
        if (target.length === 0 && source.length > 0)
          target.insert(0, source.toString());
        if (source.length > 0) source.delete(0, source.length);
        // Suggested changes point at the old text's characters and cannot follow it; they are dropped with it.
        doc.getMap(`tc:${oldPath}`).clear();
      }
    }, 'server');
    for (const [oldPath, newPath] of moves) {
      this.seededFiles.delete(`${prefix}${oldPath}`);
      this.seededFiles.add(`${prefix}${newPath}`);
    }
    this.markDirty(projectUid);
    this.server?.to(`project:${projectUid}`).emit('yjs-update', {
      file: to,
      update: wire(Y.encodeStateAsUpdate(doc, before)),
    });
    this.logger.log(
      `Moved ${moves.length} live file(s) from "${from}" to "${to}" in project ${projectUid}`,
    );
  }

  /**
   * A file (or a folder) was deleted, or a new file was made at this path: whatever text the shared document holds under it is emptied, so a deleted file's text cannot come back under a new file of the same name. The next open seeds the path from the database.
   */
  async forgetPaths(projectUid: string, path: string): Promise<void> {
    const matches = (key: string) => key === path || key.startsWith(`${path}/`);
    this.history?.forgetPending(projectUid, path);
    const doc = this.yjsDocs.get(projectUid);
    if (!doc) {
      await this.yjsPersistence.dropPaths(projectUid, matches);
      return;
    }
    const before = Y.encodeStateVector(doc);
    const changed = clearPaths(doc, matches);
    const prefix = `${projectUid}::`;
    for (const key of [...this.seededFiles]) {
      if (key.startsWith(prefix) && matches(key.slice(prefix.length)))
        this.seededFiles.delete(key);
    }
    if (!changed) return;
    this.markDirty(projectUid);
    this.server?.to(`project:${projectUid}`).emit('yjs-update', {
      file: path,
      update: wire(Y.encodeStateAsUpdate(doc, before)),
    });
  }

  /** A file's text as people are editing it now, or null when it is not open live. */
  liveText(projectUid: string, path: string): string | null {
    const doc = this.yjsDocs.get(projectUid);
    if (!doc || !this.seededFiles.has(`${projectUid}::${path}`)) return null;
    return doc.getText(path).toString();
  }

  /**
   * Add text at the end of a file that is open live, as an ordinary insert
   * that merges with what people are typing. False when it is not open.
   */
  async appendLiveText(
    projectUid: string,
    path: string,
    addition: string,
  ): Promise<boolean> {
    const doc = this.yjsDocs.get(projectUid);
    if (!doc || !this.seededFiles.has(`${projectUid}::${path}`)) return false;
    const text = doc.getText(path);
    // A blank line between what is there and the addition.
    const current = text.toString();
    const sep =
      current && !current.endsWith('\n\n')
        ? current.endsWith('\n')
          ? '\n'
          : '\n\n'
        : '';
    const before = Y.encodeStateVector(doc);
    doc.transact(() => text.insert(text.length, sep + addition), 'server');
    this.markDirty(projectUid);
    this.server?.to(`project:${projectUid}`).emit('yjs-update', {
      file: path,
      update: wire(Y.encodeStateAsUpdate(doc, before)),
    });
    return true;
  }

  /**
   * Replace a file's text in the live document (after a pull, say) as one
   * minimal change, and send it to everyone editing. Returns false when the
   * file is not open live; the database then holds the new text and the
   * live document is seeded from it when someone opens the file.
   */
  async replaceLiveText(
    projectUid: string,
    path: string,
    content: string,
  ): Promise<boolean> {
    const doc = this.yjsDocs.get(projectUid);
    if (!doc || !this.seededFiles.has(`${projectUid}::${path}`)) return false;
    const text = doc.getText(path);
    const current = text.toString();
    if (current === content) return true;
    let start = 0;
    const max = Math.min(current.length, content.length);
    while (start < max && current[start] === content[start]) start++;
    let endOld = current.length;
    let endNew = content.length;
    while (
      endOld > start &&
      endNew > start &&
      current[endOld - 1] === content[endNew - 1]
    ) {
      endOld--;
      endNew--;
    }
    const before = Y.encodeStateVector(doc);
    doc.transact(() => {
      if (endOld > start) text.delete(start, endOld - start);
      if (endNew > start) text.insert(start, content.slice(start, endNew));
    }, 'server');
    this.markDirty(projectUid);
    this.server?.to(`project:${projectUid}`).emit('yjs-update', {
      file: path,
      update: wire(Y.encodeStateAsUpdate(doc, before)),
    });
    return true;
  }

  /** Get the presence list for a room, excluding a specific socket */
  private getRoomPresenceList(
    projectUid: string,
    excludeSocketId?: string,
  ): Omit<UserPresence, 'socketId' | 'lastActivity'>[] {
    const room = this.rooms.get(projectUid);
    if (!room) return [];

    const list: Omit<UserPresence, 'socketId' | 'lastActivity'>[] = [];
    for (const [socketId, presence] of room) {
      if (socketId === excludeSocketId) continue;
      list.push({
        userId: presence.userId,
        name: presence.name,
        email: presence.email,
        avatarUrl: presence.avatarUrl,
        color: presence.color,
        activeFile: presence.activeFile,
        cursor: presence.cursor,
        selection: presence.selection,
      });
    }
    return list;
  }

  /** Broadcast the current presence list to everyone in a room */
  private broadcastPresence(projectUid: string) {
    const room = this.rooms.get(projectUid);
    if (!room) return;

    for (const [socketId] of room) {
      this.server
        .to(socketId)
        .emit('presence-sync', this.getRoomPresenceList(projectUid, socketId));
    }
  }
}
