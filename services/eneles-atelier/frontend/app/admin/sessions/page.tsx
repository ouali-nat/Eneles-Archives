"use client";

import { count, dateTime } from "@/components/admin/format";
import { AdminLink, Country, LoadState, Pager, Pill, deviceLine, sortOf, useAdminData, useListParams, useSearchBox } from "@/components/admin/parts";
import { PageHeader } from "@/components/essential/layout/PageHeader";
import { Search } from "@/components/icons";
import { DataTable, type Column } from "@/components/ui/data-table";
import { Input } from "@/components/ui/input";
import { Segmented } from "@/components/ui/segmented";
import { RelativeTime } from "@/components/ui/time";
import { adminAPI, type AdminSession } from "@/lib/api/admin";

const COLUMNS: Column<AdminSession>[] = [
  { id: "state", header: "State", cell: (s) => (s.live ? <Pill tone="good">Live</Pill> : <Pill tone="muted">{s.isActive ? "Expired" : "Signed out"}</Pill>) },
  {
    id: "account",
    header: "Account",
    firstDirection: "asc",
    cell: (s) => (
      <AdminLink to={`/users/${s.userId}`} className="hover:underline">
        {s.user?.email ?? `Account ${s.userId}`}
      </AdminLink>
    ),
  },
  { id: "device", header: "Device", firstDirection: "asc", cell: (s) => deviceLine(s) },
  { id: "country", header: "Country", firstDirection: "asc", cell: (s) => <Country code={s.country} /> },
  { id: "ip", header: "IP address", firstDirection: "asc", cell: (s) => <span className="font-mono type-small">{s.ipAddress ?? "Unknown"}</span> },
  { id: "lastActive", header: "Last active", firstDirection: "desc", cell: (s) => <RelativeTime value={s.lastActive} className="text-muted-foreground" /> },
  { id: "createdAt", header: "Signed in", firstDirection: "desc", cell: (s) => <span className="text-muted-foreground">{dateTime(s.createdAt)}</span> },
];

export default function AdminSessionsPage() {
  const [params, set] = useListParams({ scope: "live", q: "", sort: "lastActive", order: "desc", page: "1" });
  const [query, setQuery] = useSearchBox(params.q, (text) => set({ q: text, page: "1" }, { replace: true }));
  const live = params.scope !== "all";
  const page = Math.max(Number(params.page) || 1, 1);
  const { data, error, loading } = useAdminData(
    () => adminAPI.sessions({ live, search: params.q.trim(), sort: params.sort, order: params.order === "asc" ? "asc" : "desc", page, limit: 50 }),
    JSON.stringify(params),
    30_000,
  );

  return (
    <>
      <PageHeader title="Sessions" description={data ? `${count(data.meta.total)} ${live ? "live" : "in all"}` : "Who is signed in, from where, and on what."} />
      <div className="flex flex-wrap items-center gap-2">
        <Segmented
          value={live ? "live" : "all"}
          onValueChange={(v) => set({ scope: v, page: "1" })}
          options={[
            { value: "live", label: "Live" },
            { value: "all", label: "All" },
          ]}
          label="Which sessions"
        />
        <div className="relative min-w-56 flex-1">
          <Search className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input type="search" aria-label="Search sessions" placeholder="Search by email, IP address, browser, or system" value={query} onChange={(e) => setQuery(e.target.value)} className="ps-9" />
        </div>
      </div>
      <LoadState error={error} loading={false} has={!!data} />
      {(data || !error) && (
        <>
          {/* Before the first answer the table draws its real header over rows of placeholders. */}
          <DataTable loading={!data && 10} label="Sessions" columns={COLUMNS} rows={data?.data ?? []} rowKey={(s) => s.id} sort={sortOf(params)} onSortChange={(next) => set({ sort: next.column, order: next.direction, page: "1" })} busy={loading} empty="No session matches." />
          {data && <Pager meta={data.meta} onPage={(next) => set({ page: String(next) })} />}
        </>
      )}
    </>
  );
}
