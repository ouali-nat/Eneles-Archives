"use client";

import { bytes, count, date, title } from "@/components/admin/format";
import { AdminLink, Country, LoadState, Pager, Pill, StatusPill, planTone, sortOf, useAdminData, useListParams, useSearchBox } from "@/components/admin/parts";
import { PageHeader } from "@/components/essential/layout/PageHeader";
import { Search } from "@/components/icons";
import { DataTable, type Column } from "@/components/ui/data-table";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { RelativeTime } from "@/components/ui/time";
import { adminAPI, type AdminUserRow } from "@/lib/api/admin";

const PLANS = ["all", "free", "pro", "team", "enterprise"];
const STATUSES = [
  { value: "all", label: "Any state" },
  { value: "active", label: "Active" },
  { value: "suspended", label: "Disabled" },
  { value: "deleted", label: "Deleted" },
];

const number = (id: string, header: string, value: (u: AdminUserRow) => number, show: (n: number) => string = count): Column<AdminUserRow> => ({
  id,
  header,
  align: "end",
  firstDirection: "desc",
  cell: (u) => show(value(u)),
});

const COLUMNS: Column<AdminUserRow>[] = [
  {
    id: "name",
    header: "Account",
    firstDirection: "asc",
    cell: (u) => (
      <AdminLink to={`/users/${u.id}`} className="flex flex-col py-1.5 leading-tight">
        <span className="flex items-center gap-2 font-medium">
          {u.name}
          {u.isAdmin && <Pill>Admin</Pill>}
          <StatusPill status={u.status} />
          {!u.verified && <Pill tone="warn">Unverified</Pill>}
        </span>
        <span className="type-small text-muted-foreground">{u.email}</span>
      </AdminLink>
    ),
  },
  { id: "plan", header: "Plan", firstDirection: "desc", cell: (u) => <Pill tone={planTone(u.plan)}>{title(u.plan)}</Pill> },
  { id: "country", header: "Country", firstDirection: "asc", cell: (u) => <Country code={u.country} short /> },
  number("projects", "Projects", (u) => u.projects),
  number("snips", "Snips", (u) => u.snips),
  number("pdfs", "PDFs", (u) => u.pdfs),
  number("storage", "Storage", (u) => u.storageBytes, bytes),
  number("ai", "AI, 30 days", (u) => u.aiRequests30d),
  number("sessions", "Sessions", (u) => u.liveSessions),
  { id: "lastActive", header: "Last active", firstDirection: "desc", cell: (u) => <RelativeTime value={u.lastActive} fallback="Never" className="text-muted-foreground" /> },
  { id: "createdAt", header: "Joined", firstDirection: "desc", cell: (u) => <span className="text-muted-foreground">{date(u.createdAt)}</span> },
];

export default function AdminUsersPage() {
  const [params, set] = useListParams({ q: "", plan: "all", status: "all", sort: "createdAt", order: "desc", page: "1" });
  const [query, setQuery] = useSearchBox(params.q, (text) => set({ q: text, page: "1" }, { replace: true }));
  const page = Math.max(Number(params.page) || 1, 1);
  const { data, error, loading } = useAdminData(
    () =>
      adminAPI.users({
        search: params.q.trim(),
        plan: params.plan === "all" ? undefined : params.plan,
        status: params.status === "all" ? undefined : params.status,
        sort: params.sort,
        order: params.order === "asc" ? "asc" : "desc",
        page,
        limit: 25,
      }),
    JSON.stringify(params),
  );

  return (
    <>
      <PageHeader title="Users" description={data ? `${count(data.meta.total)} ${data.meta.total === 1 ? "account" : "accounts"}` : "Every account, with what it holds and when it was last here."} />
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-56 flex-1">
          <Search className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input type="search" aria-label="Search accounts" placeholder="Search by name, email, or id" value={query} onChange={(e) => setQuery(e.target.value)} className="ps-9" />
        </div>
        <Select value={params.plan} onValueChange={(v) => set({ plan: v, page: "1" })}>
          <SelectTrigger aria-label="Plan" className="w-36">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {PLANS.map((p) => (
              <SelectItem key={p} value={p}>
                {p === "all" ? "All plans" : title(p)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={params.status} onValueChange={(v) => set({ status: v, page: "1" })}>
          <SelectTrigger aria-label="State" className="w-36">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {STATUSES.map((s) => (
              <SelectItem key={s.value} value={s.value}>
                {s.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <LoadState error={error} loading={false} has={!!data} />
      {(data || !error) && (
        <>
          {/* Before the first answer the table draws its real header over rows of placeholders. */}
          <DataTable loading={!data && 10} label="Accounts" columns={COLUMNS} rows={data?.data ?? []} rowKey={(u) => u.id} sort={sortOf(params)} onSortChange={(next) => set({ sort: next.column, order: next.direction, page: "1" })} busy={loading} empty="No account matches." />
          {data && <Pager meta={data.meta} onPage={(next) => set({ page: String(next) })} />}
        </>
      )}
    </>
  );
}
