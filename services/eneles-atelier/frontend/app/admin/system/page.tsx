"use client";

import type { ReactNode } from "react";
import { Meter } from "@/components/admin/charts";
import { bytes, count, duration } from "@/components/admin/format";
import { RelativeTime } from "@/components/ui/time";
import { Facts, LoadState, Pill, useAdminData } from "@/components/admin/parts";
import { PageHeader } from "@/components/essential/layout/PageHeader";
import { adminAPI } from "@/lib/api/admin";

/** One service: its name, whether it answers, how fast, and the facts that say whether it has room left. */
function Service({ name, ok, ms, error, children }: { name: string; ok: boolean; ms?: number; error?: string; children?: ReactNode }) {
  return (
    <section className="flex flex-col gap-4 rounded-[var(--radius-card)] border border-line bg-card p-4">
      <header className="flex items-center justify-between gap-3">
        <h2 className="type-base font-medium">{name}</h2>
        <span className="flex items-center gap-2">
          {ms !== undefined && <span className="type-small text-muted-foreground tabular-nums">{ms} ms</span>}
          <Pill tone={ok ? "good" : "bad"}>{ok ? "Up" : "Down"}</Pill>
        </span>
      </header>
      {error && <p className="type-small text-danger">{error}</p>}
      {children}
    </section>
  );
}

export default function AdminSystemPage() {
  const { data, error, loading } = useAdminData(() => adminAPI.system(), "system", 15_000);

  return (
    <>
      <PageHeader title="System" description={data ? <>Checked <RelativeTime value={data.generatedAt} lowercase />. Refreshes every 15 seconds.</> : "Whether each service answers, and how much room it has left."} />
      <LoadState error={error} loading={loading} has={!!data} />
      {data && (
        <div className="grid gap-3 @min-[48rem]:grid-cols-2 @min-[80rem]:grid-cols-3">
          <Service name="API" ok>
            <Facts
              items={[
                { label: "Version", value: data.api.version },
                { label: "Environment", value: data.api.environment },
                { label: "Up for", value: duration(data.api.uptimeSeconds) },
                { label: "Memory", value: bytes(data.api.memory.rssBytes) },
                { label: "Of which heap", value: bytes(data.api.memory.heapUsedBytes) },
                { label: "Event loop delay, mean", value: `${data.api.eventLoop.meanMs} ms` },
                { label: "Event loop delay, slowest 1%", value: `${data.api.eventLoop.p99Ms} ms` },
                { label: "Node", value: data.api.node },
              ]}
            />
          </Service>

          <Service name="Database" ok={data.database.ok} ms={data.database.ms} error={data.database.error}>
            <div className="flex flex-col gap-1.5">
              <div className="flex justify-between type-small">
                <span className="text-muted-foreground">Connections in use</span>
                <span className="tabular-nums">
                  {data.database.pool.totalCount - data.database.pool.idleCount} of {data.database.pool.totalCount}
                </span>
              </div>
              <Meter label="Database connections in use" value={data.database.pool.totalCount - data.database.pool.idleCount} max={Math.max(data.database.pool.totalCount, 1)} />
            </div>
            <Facts
              items={[
                { label: "Queries waiting for a connection", value: count(data.database.pool.waitingCount) },
                { label: "Size on disk", value: data.database.sizeBytes === null ? "Unknown" : bytes(data.database.sizeBytes) },
              ]}
            />
          </Service>

          <Service name="Redis" ok={data.redis.ok} ms={data.redis.ok ? data.redis.ms : undefined} error={data.redis.error}>
            {data.redis.ok && (
              <>
                {!!data.redis.maxBytes && (
                  <div className="flex flex-col gap-1.5">
                    <div className="flex justify-between type-small">
                      <span className="text-muted-foreground">Memory</span>
                      <span className="tabular-nums">
                        {bytes(data.redis.usedBytes)} of {bytes(data.redis.maxBytes)}
                      </span>
                    </div>
                    <Meter label="Redis memory in use" value={data.redis.usedBytes ?? 0} max={data.redis.maxBytes} />
                  </div>
                )}
                <Facts
                  items={[
                    ...(data.redis.maxBytes ? [] : [{ label: "Memory", value: `${bytes(data.redis.usedBytes)} (no limit set)` }]),
                    { label: "Peak memory", value: bytes(data.redis.peakBytes) },
                    { label: "Keys", value: count(data.redis.keys ?? 0) },
                  ]}
                />
              </>
            )}
          </Service>

          <Service name="Compiler" ok={data.compiler.ok} ms={data.compiler.ok ? data.compiler.ms : undefined} error={data.compiler.error}>
            {data.compiler.ok && (
              <>
                {typeof data.compiler.active === "number" && typeof data.compiler.capacity === "number" && (
                  <div className="flex flex-col gap-1.5">
                    <div className="flex justify-between type-small">
                      <span className="text-muted-foreground">Compiles running</span>
                      <span className="tabular-nums">
                        {data.compiler.active} of {data.compiler.capacity}
                      </span>
                    </div>
                    <Meter label="Compiles running" value={data.compiler.active} max={data.compiler.capacity} />
                  </div>
                )}
                <Facts
                  items={[
                    ...(typeof data.compiler.queued === "number" ? [{ label: "Waiting in the queue", value: count(data.compiler.queued) }] : []),
                    { label: "Engines", value: data.compiler.engines?.join(", ") || "Unknown" },
                  ]}
                />
              </>
            )}
          </Service>

          <Service name="Live collaboration" ok>
            <Facts
              items={[
                { label: "Connected editors", value: count(data.collaboration.sockets) },
                { label: "Projects open", value: count(data.collaboration.rooms) },
                { label: "Documents in memory", value: count(data.collaboration.documents) },
              ]}
            />
          </Service>
        </div>
      )}
    </>
  );
}
