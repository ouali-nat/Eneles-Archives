import { monitorEventLoopDelay } from 'perf_hooks';

/**
 * Live numbers about this process that more than one module wants to read (the metrics endpoint and the admin panel) without importing each other.
 */
export interface CollabStats {
  /** Browser tabs connected to a project right now. */
  sockets: number;
  /** Projects with at least one person in them. */
  rooms: number;
  /** Project documents held in memory. */
  documents: number;
}

let collab: () => CollabStats = () => ({ sockets: 0, rooms: 0, documents: 0 });

/** The collaboration gateway registers how to count its connections. */
export function registerCollabStats(read: () => CollabStats): void {
  collab = read;
}

export function collabStats(): CollabStats {
  try {
    return collab();
  } catch {
    return { sockets: 0, rooms: 0, documents: 0 };
  }
}

// How late timers fire: the clearest single sign that the process is overloaded.
const RESOLUTION_MS = 20;
const loop = monitorEventLoopDelay({ resolution: RESOLUTION_MS });
loop.enable();

/** Event loop delay in milliseconds since the last call: mean and 99th percentile. */
export function eventLoopDelay(): { meanMs: number; p99Ms: number } {
  // The histogram measures the gap between ticks of its own timer, so an idle loop reads as the resolution, not as zero.
  const late = (ns: number) => (Number.isFinite(ns) ? Math.max(Math.round((ns / 1e6 - RESOLUTION_MS) * 100) / 100, 0) : 0);
  const delay = { meanMs: late(loop.mean), p99Ms: late(loop.percentile(99)) };
  loop.reset();
  return delay;
}

export const startedAt = new Date();
