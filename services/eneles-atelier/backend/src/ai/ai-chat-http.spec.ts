import { EventEmitter } from 'events';
import { HttpException, HttpStatus } from '@nestjs/common';
import type {
  Request as ExpressRequest,
  Response as ExpressResponse,
} from 'express';
import { AI_LIMITS, type AiChatDto } from '../projects/dto/ai-chat.dto';
import { AiController } from './ai.controller';
import { ProjectsController } from '../projects/projects.controller';
import type { AiChatService, ChatRoute, Emit } from './ai-chat.service';
import { chatInput, streamChat } from './ai-chat-http';
import type { ChatInput } from './ai-chat.tools';

/** A response that records what was written, enough of Express's for the stream. */
function fakeResponse() {
  const res = new EventEmitter() as EventEmitter & {
    statusCode: number;
    headers: Record<string, string>;
    chunks: string[];
    writableEnded: boolean;
    writableFinished: boolean;
    status: (code: number) => unknown;
    setHeader: (name: string, value: string) => void;
    flushHeaders: () => void;
    write: (chunk: string) => boolean;
    end: () => void;
  };
  res.statusCode = 0;
  res.headers = {};
  res.chunks = [];
  res.writableEnded = false;
  res.writableFinished = false;
  res.status = (code) => ((res.statusCode = code), res);
  res.setHeader = (name, value) => void (res.headers[name] = value);
  res.flushHeaders = () => undefined;
  res.write = (chunk) => (res.chunks.push(chunk), true);
  res.end = () => {
    res.writableEnded = true;
    res.writableFinished = true;
  };
  return res;
}

const route = {
  source: 'local',
  provider: 'local',
  model: 'fake',
} as unknown as ChatRoute;

/** An AiChatService double: `route` as given, and a stream that sends `events` (or waits for the abort when `hold` is set). */
function fakeChat(
  events: Parameters<Emit>[0][],
  options: { refuse?: HttpException; hold?: boolean } = {},
) {
  const seen: { route?: unknown; input?: ChatInput; signal?: AbortSignal } = {};
  const chat = {
    route: jest.fn((_userId: number, requested: unknown) => {
      if (options.refuse) return Promise.reject(options.refuse);
      seen.route = requested;
      return Promise.resolve(route);
    }),
    stream: jest.fn(
      async (
        _route: ChatRoute,
        input: ChatInput,
        emit: Emit,
        signal: AbortSignal,
      ) => {
        seen.input = input;
        seen.signal = signal;
        for (const e of events) emit(e);
        if (options.hold)
          await new Promise<void>((resolve) =>
            signal.addEventListener('abort', () => resolve()),
          );
      },
    ),
  };
  return { chat: chat as unknown as AiChatService, mock: chat, seen };
}

const body = (over: Partial<AiChatDto> = {}): AiChatDto => ({
  message: '  Fix the table  ',
  files: [{ path: 'main.tex', content: '\\documentclass{article}' }],
  activeFilePath: 'main.tex',
  history: [{ role: 'user', content: 'Hi' }],
  context: { selection: 'x' },
  ...over,
});

describe('checking a question for the assistant', () => {
  it('trims the message and keeps the files, history, and context, with no reference papers', () => {
    expect(chatInput(7, body())).toEqual({
      userId: 7,
      message: 'Fix the table',
      files: [{ path: 'main.tex', content: '\\documentclass{article}' }],
      references: [],
      activeFilePath: 'main.tex',
      history: [{ role: 'user', content: 'Hi' }],
      context: { selection: 'x' },
    });
  });

  it('needs a message and at least one file', () => {
    const status = (b: AiChatDto) => {
      try {
        chatInput(7, b);
      } catch (e) {
        return (e as HttpException).getStatus();
      }
      return null;
    };
    expect(status(body({ message: '   ' }))).toBe(HttpStatus.BAD_REQUEST);
    expect(status(body({ files: [] }))).toBe(HttpStatus.BAD_REQUEST);
  });

  it('refuses a project too large to send at once', () => {
    const half = 'x'.repeat(Math.ceil(AI_LIMITS.totalContent / 2) + 1);
    const files = [
      { path: 'a.tex', content: half },
      { path: 'b.tex', content: half },
    ];
    expect(() => chatInput(7, body({ files }))).toThrow(HttpException);
    try {
      chatInput(7, body({ files }));
    } catch (e) {
      expect((e as HttpException).getStatus()).toBe(
        HttpStatus.PAYLOAD_TOO_LARGE,
      );
    }
  });
});

describe('streaming the answer', () => {
  it('routes with the chosen provider and model, then writes each event as a server-sent event and ends', async () => {
    const { chat, seen } = fakeChat([
      { type: 'text', delta: 'Hello' },
      { type: 'done' },
    ] as Parameters<Emit>[0][]);
    const res = fakeResponse();
    const req = new EventEmitter();
    const b = body({ provider: 'openai', model: 'gpt-x' });
    await streamChat(
      chat,
      b,
      chatInput(7, b),
      req as unknown as ExpressRequest,
      res as unknown as ExpressResponse,
    );
    expect(seen.route).toEqual({ provider: 'openai', model: 'gpt-x' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['Content-Type']).toBe(
      'text/event-stream; charset=utf-8',
    );
    expect(res.chunks[0]).toBe(': open\n\n');
    expect(res.chunks.slice(1)).toEqual([
      'event: text\ndata: {"type":"text","delta":"Hello"}\n\n',
      'event: done\ndata: {"type":"done"}\n\n',
    ]);
    expect(res.writableEnded).toBe(true);
  });

  it('refuses before the stream starts, as an ordinary HTTP error', async () => {
    const refusal = new HttpException(
      { message: 'Add your own API key to use Axya.', code: 'no_key' },
      HttpStatus.PAYMENT_REQUIRED,
    );
    const { chat, mock } = fakeChat([], { refuse: refusal });
    const res = fakeResponse();
    await expect(
      streamChat(
        chat,
        body(),
        chatInput(7, body()),
        new EventEmitter() as unknown as ExpressRequest,
        res as unknown as ExpressResponse,
      ),
    ).rejects.toBe(refusal);
    expect(mock.stream).not.toHaveBeenCalled();
    expect(res.chunks).toEqual([]);
  });

  it('stops the model when the reader closes the connection', async () => {
    const { chat, seen } = fakeChat([], { hold: true });
    const res = fakeResponse();
    const done = streamChat(
      chat,
      body(),
      chatInput(7, body()),
      new EventEmitter() as unknown as ExpressRequest,
      res as unknown as ExpressResponse,
    );
    await new Promise((r) => setImmediate(r));
    expect(seen.signal?.aborted).toBe(false);
    res.emit('close');
    await done;
    expect(seen.signal?.aborted).toBe(true);
    expect(res.writableEnded).toBe(true);
  });
});

describe('the assistant for a project that is not on Eneles (POST /ai/chat/stream)', () => {
  const controller = (chat: AiChatService) =>
    new AiController({} as never, chat, {} as never, {} as never, {} as never);

  it('answers the signed-in person from the files sent, with no project and no reference papers', async () => {
    const { chat, mock, seen } = fakeChat([
      { type: 'done' },
    ] as Parameters<Emit>[0][]);
    const res = fakeResponse();
    await controller(chat).chatStream(
      42,
      body(),
      new EventEmitter() as unknown as ExpressRequest,
      res as unknown as ExpressResponse,
    );
    expect(mock.route).toHaveBeenCalledWith(42, {
      provider: undefined,
      model: undefined,
    });
    expect(seen.input).toMatchObject({
      userId: 42,
      message: 'Fix the table',
      references: [],
    });
    expect(res.chunks.at(-1)).toBe('event: done\ndata: {"type":"done"}\n\n');
  });

  it('has the same per-address throttle as the cloud project route', () => {
    const limits = (proto: object, name: string) => {
      const fn = Object.getOwnPropertyDescriptor(proto, name)?.value as object;
      return [
        Reflect.getMetadata('THROTTLER:LIMITdefault', fn) as number,
        Reflect.getMetadata('THROTTLER:TTLdefault', fn) as number,
      ];
    };
    expect(limits(AiController.prototype, 'chatStream')).toEqual([30, 60000]);
    expect(limits(AiController.prototype, 'chatStream')).toEqual(
      limits(ProjectsController.prototype, 'aiChatStream'),
    );
  });

  it('checks the question before anything counts against the person', async () => {
    const { chat, mock } = fakeChat([]);
    await expect(
      controller(chat).chatStream(
        42,
        body({ files: [] }),
        new EventEmitter() as unknown as ExpressRequest,
        fakeResponse() as unknown as ExpressResponse,
      ),
    ).rejects.toThrow('At least one file is required');
    expect(mock.route).not.toHaveBeenCalled();
  });
});
