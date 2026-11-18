"use client";

import { BarList, ChartCard, DayChart, StatTile } from "@/components/admin/charts";
import { count } from "@/components/admin/format";
import { AdminLink, LoadState, Pager, useAdminData, useListParams, useSearchBox } from "@/components/admin/parts";
import { PageHeader } from "@/components/essential/layout/PageHeader";
import { Search } from "@/components/icons";
import { DataTable, type Column } from "@/components/ui/data-table";
import { Input } from "@/components/ui/input";
import { Segmented } from "@/components/ui/segmented";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { RelativeTime } from "@/components/ui/time";
import { adminAPI, type AdminEmailRow, type EmailStatus } from "@/lib/api/admin";
import { cn } from "@/lib/utils";
import { EmailStatusPill, STATUS_WORDS, kindWords } from "./email-status";

const RANGES = [
  { value: "7", label: "7 days" },
  { value: "30", label: "30 days" },
  { value: "90", label: "90 days" },
];

const percent = (part: number, whole: number) => (whole ? `${((part / whole) * 100).toFixed(1)}%` : "0%");

const COLUMNS: Column<AdminEmailRow>[] = [
  { id: "status", header: "Status", cell: (e) => <EmailStatusPill status={e.status} /> },
  {
    id: "to",
    header: "To",
    cell: (e) => (
      <AdminLink to={`/emails/${e.id}`} className="hover:underline">
        {e.recipients.join(", ") || "Unknown"}
      </AdminLink>
    ),
  },
  { id: "kind", header: "Kind", cell: (e) => kindWords(e.kind) },
  { id: "subject", header: "Subject", cell: (e) => <span className="block max-w-80 truncate text-muted-foreground">{e.subject ?? "Not kept"}</span> },
  { id: "createdAt", header: "Sent", cell: (e) => <RelativeTime value={e.createdAt} className="text-muted-foreground" /> },
  { id: "lastEventAt", header: "Last event", cell: (e) => (e.lastEventAt ? <RelativeTime value={e.lastEventAt} className="text-muted-foreground" /> : <span className="text-muted-foreground">None yet</span>) },
];

/**
 * Email: what the API sent through Resend, and what happened to it, as Resend's webhook reported it (POST /email/webhook). Sign-in emails never show a subject here, because it held the code.
 */
export default function AdminEmailsPage() {
  const [params, set] = useListParams({ days: "30", status: "", kind: "", q: "", page: "1" });
  const [query, setQuery] = useSearchBox(params.q, (text) => set({ q: text, page: "1" }, { replace: true }));
  const range = RANGES.some((r) => r.value === params.days) ? params.days : "30";
  const page = Math.max(Number(params.page) || 1, 1);
  const { data, error, loading } = useAdminData(
    () => adminAPI.emails({ days: Number(range), status: params.status || undefined, kind: params.kind || undefined, search: params.q.trim() || undefined, page, limit: 50 }),
    JSON.stringify(params),
    60_000,
  );
  const t = data?.totals;
  const of = (status: EmailStatus) => t?.[status] ?? 0;
  const reached = of("delivered") + of("opened") + of("clicked");
  const lost = of("bounced") + of("complained") + of("failed");

  return (
    <>
      <PageHeader title="Email" description="What was sent through Resend, and what happened to it. Sign-in emails never show their subject here, because it held the code." actions={<Segmented value={range} onValueChange={(days) => set({ days, page: "1" })} options={RANGES} label="Time range" />} />
      <LoadState error={error} loading={loading} has={!!data} />
      {data && (
        <div className={cn("flex flex-col gap-6 transition-opacity", loading && "opacity-60")}>
          <div className="grid grid-cols-2 gap-3 @min-[48rem]:grid-cols-4">
            <StatTile label="Sent" value={count(t?.all ?? 0)} note={`${count(of("delivery_delayed"))} delayed for now`} />
            <StatTile label="Delivered" value={percent(reached, t?.all ?? 0)} note={`${count(reached)} reached an inbox`} />
            <StatTile label="Opened" value={percent(of("opened") + of("clicked"), reached)} note={`${count(of("clicked"))} with a link clicked`} />
            <StatTile label="Bounced or spam" value={percent(lost, t?.all ?? 0)} note={`${count(of("bounced"))} bounced, ${count(of("complained"))} marked as spam, ${count(of("failed"))} failed`} />
          </div>

          <div className="grid gap-3 @min-[56rem]:grid-cols-2 @min-[80rem]:grid-cols-3">
            <ChartCard title="Sent per day">
              <DayChart data={data.series.sent} unit="emails" />
            </ChartCard>
            <ChartCard title="Delivered per day">
              <DayChart data={data.series.delivered} unit="emails" />
            </ChartCard>
            <ChartCard title="Bounced or failed per day">
              <DayChart data={data.series.bounced} unit="emails" />
            </ChartCard>
          </div>

          <ChartCard title="By kind" summary="Emails sent">
            <BarList items={data.byKind.map((k) => ({ key: k.kind, label: kindWords(k.kind), value: k.count }))} empty="No email in this range." />
          </ChartCard>

          <div className="flex flex-wrap items-center gap-2">
            <Select value={params.status || "all"} onValueChange={(v) => set({ status: v === "all" ? "" : v, page: "1" })}>
              <SelectTrigger className="w-44" aria-label="Status">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Every status</SelectItem>
                {(Object.keys(STATUS_WORDS) as EmailStatus[]).map((s) => (
                  <SelectItem key={s} value={s}>
                    {STATUS_WORDS[s]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={params.kind || "all"} onValueChange={(v) => set({ kind: v === "all" ? "" : v, page: "1" })}>
              <SelectTrigger className="w-48" aria-label="Kind">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Every kind</SelectItem>
                {data.byKind.map((k) => (
                  <SelectItem key={k.kind} value={k.kind}>
                    {kindWords(k.kind)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <div className="relative min-w-56 flex-1">
              <Search className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input type="search" aria-label="Search email" placeholder="Search by exact address, subject, or Resend id" value={query} onChange={(e) => setQuery(e.target.value)} className="ps-9" />
            </div>
          </div>
          <DataTable label="Email" columns={COLUMNS} rows={data.data} rowKey={(e) => e.id} busy={loading} empty="No email matches." />
          <Pager meta={data.meta} onPage={(next) => set({ page: String(next) })} />
        </div>
      )}
    </>
  );
}
