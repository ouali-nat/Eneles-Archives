/**
 * What the collaboration socket accepts from a client: how large a message may be, how often each kind may arrive, and what shape each field must have. A browser running our own code never comes near these limits; they are there for a client that is broken or hostile, so that it cannot make the server hold unbounded memory or relay a flood to everyone in a room.
 */
export const SOCKET_LIMITS = {
  /** Socket.IO refuses (and disconnects) any single message larger than this. A Yjs update is sent as binary, so this is the largest paste the editor can carry in one change. */
  maxMessageBytes: 4 * 1024 * 1024,
  /** One document update. */
  maxUpdateBytes: 3 * 1024 * 1024,
  /** One awareness update: a person's name, color, cursor, and selection. Ours are a few hundred bytes. */
  maxAwarenessBytes: 16 * 1024,
  /** A state vector: a few bytes per client that ever edited the document. */
  maxStateVectorBytes: 64 * 1024,
  /** A file path, as the REST API allows it. */
  maxPathLength: 1024,
  maxProjectUidLength: 64,
} as const;

/** Bytes from what a client sent: binary (what current clients send), or an array of byte values (what clients from before the switch to binary send). Null when it is neither, or larger than `max`. */
export function bytesOf(value: unknown, max: number): Uint8Array | null {
  if (value instanceof Uint8Array)
    return value.byteLength <= max ? value : null;
  if (value instanceof ArrayBuffer)
    return value.byteLength <= max ? new Uint8Array(value) : null;
  if (Array.isArray(value)) {
    if (value.length > max) return null;
    const bytes = new Uint8Array(value.length);
    for (let i = 0; i < value.length; i++) {
      const byte: unknown = value[i];
      if (
        typeof byte !== 'number' ||
        !Number.isInteger(byte) ||
        byte < 0 ||
        byte > 255
      )
        return null;
      bytes[i] = byte;
    }
    return bytes;
  }
  return null;
}

/** Bytes to send: a Buffer is carried by Socket.IO as a binary attachment, a third the size of the same bytes written out as JSON numbers. Older clients read it with `new Uint8Array(…)` just as they read the arrays they were sent before. */
export function wire(bytes: Uint8Array): Buffer {
  return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

/** Keys of the shared document that are not files: suggested changes are kept under `tc:<path>`, and the document's own bookkeeping under `texer:`. */
export const RESERVED_KEY = /^(tc|texer):/;

/** A file path a client may name: a non-empty string of bounded length, with no NUL and not one of the document's own keys. */
export function filePath(value: unknown): string | null {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.length > SOCKET_LIMITS.maxPathLength
  )
    return null;
  if (value.includes('\0') || RESERVED_KEY.test(value)) return null;
  return value;
}

export function projectUid(value: unknown): string | null {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.length > SOCKET_LIMITS.maxProjectUidLength
  )
    return null;
  return /^[A-Za-z0-9_-]+$/.test(value) ? value : null;
}

const MAX_POSITION = 10_000_000;
const position = (value: unknown): number | null =>
  typeof value === 'number' &&
  Number.isInteger(value) &&
  value >= 0 &&
  value <= MAX_POSITION
    ? value
    : null;

export interface CursorMove {
  line: number;
  ch: number;
  selection: {
    fromLine: number;
    fromCh: number;
    toLine: number;
    toCh: number;
  } | null;
}

/** A cursor position as numbers in range, or null. Anything else in the message is dropped, so what is relayed to the room is only these numbers. */
export function cursorMove(value: unknown): CursorMove | null {
  if (!value || typeof value !== 'object') return null;
  const data = value as Record<string, unknown>;
  const line = position(data.line);
  const ch = position(data.ch);
  if (line === null || ch === null) return null;
  let selection: CursorMove['selection'] = null;
  if (data.selection && typeof data.selection === 'object') {
    const s = data.selection as Record<string, unknown>;
    const fromLine = position(s.fromLine);
    const fromCh = position(s.fromCh);
    const toLine = position(s.toLine);
    const toCh = position(s.toCh);
    if (
      fromLine === null ||
      fromCh === null ||
      toLine === null ||
      toCh === null
    )
      return null;
    selection = { fromLine, fromCh, toLine, toCh };
  }
  return { line, ch, selection };
}

export type RateKind =
  'join' | 'sync' | 'update' | 'awareness' | 'cursor' | 'select';

/** Messages per second each socket may send of each kind, and how many it may send at once after a pause. Typing fast is about 15 updates a second; a paste or an undo is one. */
export const RATES: Record<RateKind, { perSecond: number; burst: number }> = {
  join: { perSecond: 1, burst: 5 },
  sync: { perSecond: 10, burst: 40 },
  update: { perSecond: 60, burst: 240 },
  awareness: { perSecond: 30, burst: 60 },
  cursor: { perSecond: 20, burst: 40 },
  select: { perSecond: 5, burst: 20 },
};

/**
 * A token bucket per socket and kind of message. A message over the rate is dropped, not queued: a client sending faster than any person types is broken or hostile, and queueing for it would only move the memory problem.
 */
export class RateLimiter {
  private readonly buckets = new Map<string, { tokens: number; at: number }>();

  constructor(
    private readonly rates: Record<
      RateKind,
      { perSecond: number; burst: number }
    > = RATES,
    private readonly now: () => number = Date.now,
  ) {}

  /** True when the message may go ahead. */
  take(socketId: string, kind: RateKind): boolean {
    const { perSecond, burst } = this.rates[kind];
    const key = `${socketId}:${kind}`;
    const time = this.now();
    const bucket = this.buckets.get(key) ?? { tokens: burst, at: time };
    bucket.tokens = Math.min(
      burst,
      bucket.tokens + ((time - bucket.at) / 1000) * perSecond,
    );
    bucket.at = time;
    const allowed = bucket.tokens >= 1;
    if (allowed) bucket.tokens -= 1;
    this.buckets.set(key, bucket);
    return allowed;
  }

  /** Forgets a socket that has gone. */
  forget(socketId: string): void {
    for (const kind of Object.keys(this.rates))
      this.buckets.delete(`${socketId}:${kind}`);
  }

  get size(): number {
    return this.buckets.size;
  }
}
