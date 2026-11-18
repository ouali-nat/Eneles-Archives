/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-return, @typescript-eslint/require-await, @typescript-eslint/no-base-to-string -- test doubles of sockets and services are deliberately loose */
import * as Y from 'yjs';
import { UnauthorizedException } from '@nestjs/common';
import { CollaborationGateway } from './collaboration.gateway';
import { YjsPersistenceService } from './yjs-persistence.service';
import { HistoryService } from '../projects/history.service';
import { mockPrisma } from '../test-utils';

const UID = 'proj1';

type Sent = { event: string; payload: any };

/** A stand-in for a Socket.IO socket: records what it is sent and which rooms it is in. */
function fakeSocket(id: string, userId = 1) {
  const sent: Sent[] = [];
  const relayed: Array<Sent & { room: string }> = [];
  const rooms = new Set<string>();
  const socket: any = {
    id,
    connected: true,
    user: {
      userId,
      name: `User ${userId}`,
      email: `u${userId}@example.com`,
      sid: `sid-${userId}`,
    },
    authReady: Promise.resolve(),
    sent,
    relayed,
    rooms,
    emit: (event: string, payload: unknown) => sent.push({ event, payload }),
    join: (room: string) => rooms.add(room),
    leave: (room: string) => rooms.delete(room),
    to: (room: string) => ({
      emit: (event: string, payload: unknown) =>
        relayed.push({ room, event, payload }),
    }),
    disconnect: jest.fn(() => {
      socket.connected = false;
    }),
  };
  return socket;
}

function setup(
  access: { canView: boolean; canEdit: boolean } = {
    canView: true,
    canEdit: true,
  },
) {
  const files: Record<string, string> = { 'main.tex': 'Hello' };
  const projects: any = {
    checkAccess: jest.fn(async () => ({ ...access, pendingInvitation: null })),
    getFileContentByPath: jest.fn(
      async (_uid: string, path: string) => files[path] ?? null,
    ),
    getOwner: jest.fn(async () => null),
  };
  const auth: any = {
    validateToken: jest.fn(),
    validateSession: jest.fn(async () => ({ userId: 1 })),
  };
  const persistence: any = {
    load: jest.fn(async () => new Set<string>()),
    save: jest.fn(async () => undefined),
    flushToFiles: jest.fn(async () => 0),
    dropPaths: jest.fn(async () => undefined),
  };
  const history = new HistoryService(mockPrisma() as any);
  const gateway = new CollaborationGateway(
    auth,
    projects,
    persistence as YjsPersistenceService,
    history,
  );
  const sockets = new Map<string, any>();
  const broadcast: Array<Sent & { room: string }> = [];
  gateway.server = {
    sockets,
    to: (room: string) => ({
      emit: (event: string, payload: unknown) =>
        broadcast.push({ room, event, payload }),
    }),
  } as any;
  return {
    gateway,
    projects,
    auth,
    persistence,
    sockets,
    broadcast,
    files,
    history,
  };
}

async function joined(gateway: CollaborationGateway, socket: any) {
  await gateway.handleJoinProject(socket, {
    projectUid: UID,
    activeFile: 'main.tex',
  });
}

async function sync(
  gateway: CollaborationGateway,
  socket: any,
  file = 'main.tex',
  doc = new Y.Doc(),
) {
  socket.sent.length = 0;
  await gateway.handleYjsSync(socket, { file, sv: Y.encodeStateVector(doc) });
  const reply = socket.sent.find((s: Sent) => s.event === 'yjs-sync')?.payload;
  if (reply) Y.applyUpdate(doc, new Uint8Array(reply.update));
  return { reply, doc };
}

describe('CollaborationGateway', () => {
  let ctx: ReturnType<typeof setup>;
  afterEach(async () => {
    await ctx?.gateway.onModuleDestroy();
  });

  it('leaves no presence behind when the socket goes while its join is being checked', async () => {
    ctx = setup();
    let release!: () => void;
    ctx.projects.checkAccess.mockImplementationOnce(
      () =>
        new Promise(
          (resolve) =>
            (release = () =>
              resolve({
                canView: true,
                canEdit: true,
                pendingInvitation: null,
              })),
        ),
    );
    const socket = fakeSocket('s1');
    const join = ctx.gateway.handleJoinProject(socket, {
      projectUid: UID,
      activeFile: 'main.tex',
    });
    await new Promise((r) => setImmediate(r));
    socket.connected = false;
    await ctx.gateway.handleDisconnect(socket);
    release();
    await join;
    expect((ctx.gateway as any).rooms.get(UID)?.size ?? 0).toBe(0);
    expect((ctx.gateway as any).socketToProject.has('s1')).toBe(false);
  });

  it('runs one join at a time per socket, so a switch of project leaves the first room', async () => {
    ctx = setup();
    const socket = fakeSocket('s1');
    await Promise.all([
      ctx.gateway.handleJoinProject(socket, {
        projectUid: 'first',
        activeFile: 'main.tex',
      }),
      ctx.gateway.handleJoinProject(socket, {
        projectUid: 'second',
        activeFile: 'main.tex',
      }),
    ]);
    expect([...socket.rooms]).toEqual(['project:second', 'members:second']);
    expect((ctx.gateway as any).rooms.get('first')).toBeUndefined();
  });

  it('answers a sync in binary, with the server’s state vector and a stable epoch', async () => {
    ctx = setup();
    const socket = fakeSocket('s1');
    await joined(ctx.gateway, socket);
    const first = await sync(ctx.gateway, socket);
    expect(Buffer.isBuffer(first.reply.update)).toBe(true);
    expect(Buffer.isBuffer(first.reply.sv)).toBe(true);
    expect(first.doc.getText('main.tex').toString()).toBe('Hello');
    const second = await sync(ctx.gateway, socket);
    expect(typeof first.reply.epoch).toBe('string');
    expect(second.reply.epoch).toBe(first.reply.epoch);
  });

  it('makes no text for a name that is not one of the project’s files', async () => {
    ctx = setup();
    const socket = fakeSocket('s1');
    await joined(ctx.gateway, socket);
    await sync(ctx.gateway, socket, '../../etc/passwd');
    const doc: Y.Doc = (ctx.gateway as any).yjsDocs.get(UID);
    expect(doc.share.has('../../etc/passwd')).toBe(false);
    // The document's own keys cannot be asked for as files.
    socket.sent.length = 0;
    await ctx.gateway.handleYjsSync(socket, {
      file: 'texer:meta',
      sv: new Uint8Array([0]),
    });
    expect(socket.sent).toHaveLength(0);
  });

  it('refuses a viewer’s change and leaves the document as it was', async () => {
    ctx = setup({ canView: true, canEdit: false });
    const socket = fakeSocket('s1');
    await joined(ctx.gateway, socket);
    const { doc } = await sync(ctx.gateway, socket);
    const before = Y.encodeStateVector(doc);
    doc.getText('main.tex').insert(0, 'X');
    socket.sent.length = 0;
    await ctx.gateway.handleYjsUpdate(socket, {
      file: 'main.tex',
      update: Y.encodeStateAsUpdate(doc, before),
    });
    expect(socket.sent.map((s: Sent) => s.event)).toEqual(['error']);
    expect(
      ((ctx.gateway as any).yjsDocs.get(UID) as Y.Doc)
        .getText('main.tex')
        .toString(),
    ).toBe('Hello');
    expect(socket.relayed).toHaveLength(0);
  });

  it('applies an editor’s change sent as binary or as numbers, and relays it as binary', async () => {
    ctx = setup();
    const a = fakeSocket('a');
    await joined(ctx.gateway, a);
    const { doc } = await sync(ctx.gateway, a);
    let sv = Y.encodeStateVector(doc);
    doc.getText('main.tex').insert(5, ', world');
    await ctx.gateway.handleYjsUpdate(a, {
      file: 'main.tex',
      update: Y.encodeStateAsUpdate(doc, sv),
    });
    sv = Y.encodeStateVector(doc);
    doc.getText('main.tex').insert(12, '!');
    await ctx.gateway.handleYjsUpdate(a, {
      file: 'main.tex',
      update: Array.from(Y.encodeStateAsUpdate(doc, sv)),
    });
    expect(
      ((ctx.gateway as any).yjsDocs.get(UID) as Y.Doc)
        .getText('main.tex')
        .toString(),
    ).toBe('Hello, world!');
    expect(
      a.relayed
        .filter((r: any) => r.event === 'yjs-update')
        .every((r: any) => Buffer.isBuffer(r.payload.update)),
    ).toBe(true);
  });

  it('drops malformed and oversized messages without relaying them', async () => {
    ctx = setup();
    const socket = fakeSocket('s1');
    await joined(ctx.gateway, socket);
    ctx.gateway.handleCursorMove(socket, { line: 'x', ch: 0 });
    ctx.gateway.handleCursorMove(socket, { line: 1, ch: 2, name: 'spoofed' });
    await ctx.gateway.handleYjsAwarenessUpdate(socket, {
      data: new Uint8Array(64 * 1024),
    });
    await ctx.gateway.handleYjsAwarenessUpdate(socket, { data: 'not bytes' });
    await ctx.gateway.handleYjsUpdate(socket, {
      file: 'main.tex',
      update: { evil: true },
    });
    const relayed = socket.relayed.map((r: any) => r.event);
    expect(relayed).toEqual(['cursor-update']);
    expect(socket.relayed[0].payload.cursor).toEqual({ line: 1, ch: 2 });
    expect(socket.relayed[0].payload.name).toBe('User 1');
    expect(socket.sent.some((s: Sent) => s.event === 'error')).toBe(true);
  });

  it('relays no more than the allowed burst of cursor messages', async () => {
    ctx = setup();
    const socket = fakeSocket('s1');
    await joined(ctx.gateway, socket);
    for (let i = 0; i < 500; i++)
      ctx.gateway.handleCursorMove(socket, { line: i, ch: 0 });
    const relayed = socket.relayed.filter(
      (r: any) => r.event === 'cursor-update',
    ).length;
    expect(relayed).toBeGreaterThan(0);
    expect(relayed).toBeLessThanOrEqual(45);
  });

  it('closes a socket whose session has ended, and keeps one whose check merely failed', async () => {
    ctx = setup();
    const ended = fakeSocket('ended', 1);
    const fine = fakeSocket('fine', 2);
    const flaky = fakeSocket('flaky', 3);
    for (const s of [ended, fine, flaky]) {
      ctx.sockets.set(s.id, s);
      await joined(ctx.gateway, s);
    }
    ctx.auth.validateSession.mockImplementation(async (sid: string) => {
      if (sid === 'sid-1')
        throw new UnauthorizedException('Session has been deactivated');
      if (sid === 'sid-3') throw new Error('database unreachable');
      return { userId: 2 };
    });
    await (ctx.gateway as any).recheckSessions();
    expect(ended.disconnect).toHaveBeenCalled();
    expect(ended.sent.some((s: Sent) => s.event === 'session-ended')).toBe(
      true,
    );
    expect((ctx.gateway as any).rooms.get(UID).has('ended')).toBe(false);
    expect(fine.disconnect).not.toHaveBeenCalled();
    expect(flaky.disconnect).not.toHaveBeenCalled();
  });
});

describe('CollaborationGateway history attribution', () => {
  let ctx: ReturnType<typeof setup>;
  afterEach(async () => {
    await ctx?.gateway.onModuleDestroy();
  });

  /** A change typed in `doc` by this socket, sent to the server. */
  async function type(socket: any, doc: Y.Doc, file: string, at: number, text: string) {
    const sv = Y.encodeStateVector(doc);
    doc.getText(file).insert(at, text);
    await ctx.gateway.handleYjsUpdate(socket, {
      file,
      update: Y.encodeStateAsUpdate(doc, sv),
    });
  }

  it('credits each change to the person whose socket sent it, per file', async () => {
    ctx = setup();
    ctx.files['refs.tex'] = 'Refs';
    const a = fakeSocket('a', 1);
    const b = fakeSocket('b', 2);
    await joined(ctx.gateway, a);
    await joined(ctx.gateway, b);
    const { doc: docA } = await sync(ctx.gateway, a);
    const { doc: docB } = await sync(ctx.gateway, b);
    await sync(ctx.gateway, b, 'refs.tex', docB);

    await type(a, docA, 'main.tex', 5, '!');
    await type(a, docA, 'main.tex', 6, '!');
    await type(b, docB, 'refs.tex', 4, '.');

    expect(ctx.history.pendingFor(UID, 'main.tex')).toEqual([
      { userId: 1, edits: 2, name: 'User 1' },
    ]);
    expect(ctx.history.pendingFor(UID, 'refs.tex')).toEqual([
      { userId: 2, edits: 1, name: 'User 2' },
    ]);
  });

  it('credits no one for the server’s own writes or for a refused viewer change', async () => {
    ctx = setup({ canView: true, canEdit: false });
    const viewer = fakeSocket('v', 3);
    await joined(ctx.gateway, viewer);
    const { doc } = await sync(ctx.gateway, viewer);
    await type(viewer, doc, 'main.tex', 0, 'x');
    await ctx.gateway.replaceLiveText(UID, 'main.tex', 'Restored');
    expect(ctx.history.pendingPaths(UID)).toEqual([]);
  });

  it('moves waiting credit with a renamed file and drops it with a deleted one', async () => {
    ctx = setup();
    const a = fakeSocket('a', 1);
    await joined(ctx.gateway, a);
    const { doc } = await sync(ctx.gateway, a);
    await type(a, doc, 'main.tex', 0, '%');
    ctx.gateway.movePaths(UID, 'main.tex', 'paper.tex');
    expect(ctx.history.pendingFor(UID, 'paper.tex')).toHaveLength(1);
    expect(ctx.history.pendingFor(UID, 'main.tex')).toHaveLength(0);
    await ctx.gateway.forgetPaths(UID, 'paper.tex');
    expect(ctx.history.pendingPaths(UID)).toEqual([]);
  });
});

describe('YjsPersistenceService.load', () => {
  it('restores suggestion maps and the epoch as maps, not as text', async () => {
    const source = new Y.Doc();
    source.getText('main.tex').insert(0, 'Hello');
    source.getMap('tc:main.tex').set('s1', { kind: 'insert' });
    source.getMap('texer:meta').set('epoch', 'abc');
    const prisma: any = {
      client: {
        yjsDocument: {
          findUnique: jest.fn(async () => ({
            state: Buffer.from(Y.encodeStateAsUpdate(source)),
          })),
        },
      },
    };
    const service = new YjsPersistenceService(prisma, {} as any);
    const doc = new Y.Doc();
    const restored = await service.load('p', doc);
    expect([...restored]).toEqual(['main.tex']);
    expect(doc.getMap('tc:main.tex').get('s1')).toEqual({ kind: 'insert' });
    expect(doc.getMap('texer:meta').get('epoch')).toBe('abc');
  });
});
