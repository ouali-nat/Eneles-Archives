"use client";

import { count, dateTime, title } from "@/components/admin/format";
import { AdminLink, Country, LoadState, Pager, Pill, outcomeTone, sortOf, useAdminData, useListParams, useSearchBox } from "@/components/admin/parts";
import { PageHeader } from "@/components/essential/layout/PageHeader";
import { Search } from "@/components/icons";
import { DataTable, type Column } from "@/components/ui/data-table";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { adminAPI, type AdminAuditEvent } from "@/lib/api/admin";

const OUTCOMES = ["all", "success", "failure", "blocked"];

const COLUMNS: Column<AdminAuditEvent>[] = [
  { id: "createdAt", header: "When", firstDirection: "desc", cell: (a) => <span className="text-muted-foreground">{dateTime(a.createdAt)}</span> },
  {
    id: "action",
    header: "Event",
    firstDirection: "asc",
    cell: (a) => (
      <span className="flex flex-col py-1.5 leading-tight">
        <span className="font-mono type-small">{a.action}</span>
        {a.target && (
          <AdminLink to={`/users/${a.target.id}`} className="type-small text-muted-foreground hover:text-foreground hover:underline">
            On {a.target.email ?? `account ${a.target.id}`}
          </AdminLink>
        )}
      </span>
    ),
  },
  { id: "outcome", header: "Outcome", firstDirection: "asc", cell: (a) => <Pill tone={outcomeTone(a.outcome)}>{title(a.outcome)}</Pill> },
  {
    id: "account",
    header: "By",
    firstDirection: "asc",
    cell: (a) =>
      a.userId ? (
        <AdminLink to={`/users/${a.userId}`} className="hover:underline">
          {a.email ?? `Account ${a.userId}`}
        </AdminLink>
      ) : (
        <span className="text-muted-foreground">Nobody signed in</span>
      ),
  },
  {
    id: "ip",
    header: "From",
    firstDirection: "asc",
    cell: (a) => (
      <span className="flex items-center gap-3">
        <Country code={a.country} short />
        <span className="font-mono type-small">{a.ipAddress ?? "Unknown"}</span>
      </span>
    ),
  },
  {
    id: "client",
    header: "Client",
    firstDirection: "asc",
    cell: (a) =>
      a.userAgent ? (
        <Tooltip>
          <TooltipTrigger asChild>
            <span tabIndex={0} className="block max-w-52 truncate text-muted-foreground outline-none focus-visible:ring-2 focus-visible:ring-focus">
              {a.userAgent}
            </span>
          </TooltipTrigger>
          <TooltipContent className="max-w-md break-all">{a.userAgent}</TooltipContent>
        </Tooltip>
      ) : (
        <span className="text-muted-foreground">Unknown</span>
      ),
  },
];

export default function AdminAuditPage() {
  const [params, set] = useListParams({ action: "all", outcome: "all", ip: "", sort: "createdAt", order: "desc", page: "1" });
  const [query, setQuery] = useSearchBox(params.ip, (text) => set({ ip: text, page: "1" }, { replace: true }));
  const page = Math.max(Number(params.page) || 1, 1);
  const { data, error, loading } = useAdminData(
    () =>
      adminAPI.audit({
        action: params.action === "all" ? undefined : params.action,
        outcome: params.outcome === "all" ? undefined : params.outcome,
        ip: params.ip.trim(),
        sort: params.sort,
        order: params.order === "asc" ? "asc" : "desc",
        page,
        limit: 50,
      }),
    JSON.stringify(params),
  );

  return (
    <>
      <PageHeader title="Audit log" description={data ? `${count(data.meta.total)} ${data.meta.total === 1 ? "event" : "events"}` : "Sign-ins, failed codes, and every time an operator opened or changed an account."} />
      <div className="flex flex-wrap items-center gap-2">
        <Select value={params.action} onValueChange={(v) => set({ action: v, page: "1" })}>
          <SelectTrigger aria-label="Event" className="w-56">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All events</SelectItem>
            {params.action !== "all" && !data?.actions.some((a) => a.action === params.action) && <SelectItem value={params.action}>{params.action}</SelectItem>}
            {data?.actions.map((a) => (
              <SelectItem key={a.action} value={a.action}>
                {a.action} ({count(a.count)})
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={params.outcome} onValueChange={(v) => set({ outcome: v, page: "1" })}>
          <SelectTrigger aria-label="Outcome" className="w-40">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {OUTCOMES.map((o) => (
              <SelectItem key={o} value={o}>
                {o === "all" ? "All outcomes" : title(o)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <div className="relative min-w-56 flex-1">
          <Search className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input type="search" aria-label="Filter by IP address" placeholder="Filter by IP address" value={query} onChange={(e) => setQuery(e.target.value)} className="ps-9" />
        </div>
      </div>
      <LoadState error={error} loading={false} has={!!data} />
      {(data || !error) && (
        <>
          {/* Before the first answer the table draws its real header over rows of placeholders. */}
          <DataTable loading={!data && 10} label="Audit log" columns={COLUMNS} rows={data?.data ?? []} rowKey={(a) => a.id} sort={sortOf(params)} onSortChange={(next) => set({ sort: next.column, order: next.direction, page: "1" })} busy={loading} empty="No event matches." />
          {data && <Pager meta={data.meta} onPage={(next) => set({ page: String(next) })} />}
        </>
      )}
    </>
  );
}
