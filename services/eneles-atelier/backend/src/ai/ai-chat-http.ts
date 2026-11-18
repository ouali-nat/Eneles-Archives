import { HttpException, HttpStatus } from '@nestjs/common';
import type {
  Request as ExpressRequest,
  Response as ExpressResponse,
} from 'express';
import { AI_LIMITS, type AiChatDto } from '../projects/dto/ai-chat.dto';
import type { AiChatService } from './ai-chat.service';
import type { ChatInput } from './ai-chat.tools';

/*
 * The HTTP side of the assistant's chat, shared by its two routes: a Eneles project's (`POST /projects/:uid/ai/chat/stream`, which also checks access and adds the project's reference papers) and a project that is not on Eneles (`POST /ai/chat/stream`, the desktop app's local folders, which send every file with the question). Both check a question the same way and stream the answer the same way.
 */

/** Checks one question before anything is sent to a model: a message, files, and a total size the model can take. Returns what the assistant is asked, without reference papers (a Eneles project adds its own). */
export function chatInput(userId: number, body: AiChatDto): ChatInput {
  if (!body.message?.trim())
    throw new HttpException('Message is required', HttpStatus.BAD_REQUEST);
  if (!body.files?.length)
    throw new HttpException(
      'At least one file is required',
      HttpStatus.BAD_REQUEST,
    );
  const total = body.files.reduce((n, f) => n + f.content.length, 0);
  if (total > AI_LIMITS.totalContent)
    throw new HttpException(
      'This project is too large to send to the assistant at once.',
      HttpStatus.PAYLOAD_TOO_LARGE,
    );
  return {
    userId,
    message: body.message.trim(),
    files: body.files,
    references: [],
    activeFilePath: body.activeFilePath,
    tabSize: body.tabSize,
    history: body.history,
    context: body.context,
  };
}

/**
 * Answers `input` as server-sent events: `meta` (who answers), `text` deltas, `activity` (each file read or changed), `notice`, `result` (the proposed edits), then `done`, or `error` with a sentence the person can act on. Who may ask, and with which key, is settled before the stream starts (`route` counts the person's rate limits too), so a refusal is an ordinary HTTP error (402 with `code: "no_key"` when there is no key to answer with). Closing the request aborts the call at the provider: Stop in the editor stops the model, not only the display.
 */
export async function streamChat(
  chat: AiChatService,
  body: AiChatDto,
  input: ChatInput,
  req: ExpressRequest,
  res: ExpressResponse,
): Promise<void> {
  // The person asking pays for the model call, whoever owns the project.
  const route = await chat.route(input.userId!, {
    provider: body.provider,
    model: body.model,
  });

  const abort = new AbortController();
  const stop = () => abort.abort();
  // The response closing before the answer ends means the reader stopped it or went away.
  res.on('close', () => {
    if (!res.writableFinished) stop();
  });
  req.on('aborted', stop);

  res.status(200);
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();
  res.write(': open\n\n');
  const heartbeat = setInterval(() => res.write(': keep-alive\n\n'), 15_000);
  try {
    await chat.stream(
      route,
      input,
      (event) => {
        if (abort.signal.aborted || res.writableEnded) return;
        res.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
      },
      abort.signal,
    );
  } finally {
    clearInterval(heartbeat);
    if (!res.writableEnded) res.end();
  }
}
