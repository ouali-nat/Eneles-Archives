import {
  RateLimiter,
  bytesOf,
  cursorMove,
  filePath,
  projectUid,
  wire,
} from './socket-guard';

describe('socket-guard', () => {
  it('reads bytes sent as binary or as an array of numbers, within a limit', () => {
    expect(bytesOf(new Uint8Array([1, 2, 3]), 10)).toEqual(
      new Uint8Array([1, 2, 3]),
    );
    expect(bytesOf(Buffer.from([4, 5]), 10)).toEqual(new Uint8Array([4, 5]));
    expect(bytesOf(new Uint8Array([7, 8]).buffer, 10)).toEqual(
      new Uint8Array([7, 8]),
    );
    expect(bytesOf([1, 2, 255], 10)).toEqual(new Uint8Array([1, 2, 255]));
    expect(bytesOf(new Uint8Array(11), 10)).toBeNull();
    expect(bytesOf(new Array(11).fill(0), 10)).toBeNull();
    expect(bytesOf([1, 256], 10)).toBeNull();
    expect(bytesOf([1, -1], 10)).toBeNull();
    expect(bytesOf([1, 1.5], 10)).toBeNull();
    expect(bytesOf(['1'], 10)).toBeNull();
    expect(bytesOf('abc', 10)).toBeNull();
    expect(bytesOf({ length: 2 }, 10)).toBeNull();
    expect(bytesOf(null, 10)).toBeNull();
  });

  it('sends a view of the same bytes, not a copy of the whole underlying buffer', () => {
    const backing = new Uint8Array([9, 9, 1, 2, 3, 9]);
    const view = backing.subarray(2, 5);
    expect([...wire(view)]).toEqual([1, 2, 3]);
  });

  it('accepts file paths and refuses the document’s own keys and malformed names', () => {
    expect(filePath('main.tex')).toBe('main.tex');
    expect(filePath('chapters/intro.tex')).toBe('chapters/intro.tex');
    expect(filePath('')).toBeNull();
    expect(filePath('a\0b')).toBeNull();
    expect(filePath('tc:main.tex')).toBeNull();
    expect(filePath('texer:meta')).toBeNull();
    expect(filePath('x'.repeat(1025))).toBeNull();
    expect(filePath(42)).toBeNull();
    expect(filePath({ toString: () => 'main.tex' })).toBeNull();
  });

  it('accepts project uids and nothing else', () => {
    expect(projectUid('f5Sb5C98Ul4B3KSF')).toBe('f5Sb5C98Ul4B3KSF');
    expect(projectUid('a_b-c')).toBe('a_b-c');
    expect(projectUid('../x')).toBeNull();
    expect(projectUid('')).toBeNull();
    expect(projectUid('x'.repeat(65))).toBeNull();
    expect(projectUid(['x'])).toBeNull();
  });

  it('keeps only numbers in range from a cursor message', () => {
    expect(cursorMove({ line: 3, ch: 4, extra: 'x'.repeat(1000) })).toEqual({
      line: 3,
      ch: 4,
      selection: null,
    });
    expect(
      cursorMove({
        line: 1,
        ch: 0,
        selection: { fromLine: 1, fromCh: 0, toLine: 2, toCh: 5, junk: 1 },
      }),
    ).toEqual({
      line: 1,
      ch: 0,
      selection: { fromLine: 1, fromCh: 0, toLine: 2, toCh: 5 },
    });
    expect(cursorMove({ line: '3', ch: 4 })).toBeNull();
    expect(cursorMove({ line: -1, ch: 4 })).toBeNull();
    expect(cursorMove({ line: 1e12, ch: 4 })).toBeNull();
    expect(
      cursorMove({ line: 1, ch: 2, selection: { fromLine: 'a' } }),
    ).toBeNull();
    expect(cursorMove(null)).toBeNull();
    expect(cursorMove('x')).toBeNull();
  });

  it('lets a burst through, then the steady rate, per socket and kind', () => {
    let now = 0;
    const limiter = new RateLimiter(
      {
        join: { perSecond: 1, burst: 1 },
        sync: { perSecond: 1, burst: 1 },
        update: { perSecond: 10, burst: 5 },
        awareness: { perSecond: 1, burst: 1 },
        cursor: { perSecond: 1, burst: 1 },
        select: { perSecond: 1, burst: 1 },
      },
      () => now,
    );
    const passed = Array.from({ length: 8 }, () =>
      limiter.take('a', 'update'),
    ).filter(Boolean).length;
    expect(passed).toBe(5);
    // Another socket, and another kind, have their own buckets.
    expect(limiter.take('b', 'update')).toBe(true);
    expect(limiter.take('a', 'cursor')).toBe(true);
    // A tenth of a second later, one more update has been earned.
    now += 100;
    expect(limiter.take('a', 'update')).toBe(true);
    expect(limiter.take('a', 'update')).toBe(false);
    limiter.forget('a');
    limiter.forget('b');
    expect(limiter.size).toBe(0);
  });
});
