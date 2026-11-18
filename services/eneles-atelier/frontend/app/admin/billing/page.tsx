"use client";

import { BarList, ChartCard, DayChart, StatTile } from "@/components/admin/charts";
import { count, date, money, moneyShort, month, title } from "@/components/admin/format";
import { AdminLink, LoadState, Pager, Pill, planTone, sortOf, useAdminData, useListParams, useSearchBox } from "@/components/admin/parts";
import { PageHeader, SectionHeading } from "@/components/essential/layout/PageHeader";
import { Search } from "@/components/icons";
import { DataTable, type Column } from "@/components/ui/data-table";
import { Input } from "@/components/ui/input";
import { Segmented } from "@/components/ui/segmented";
import { adminAPI, type AdminPayment } from "@/lib/api/admin";
import { cn } from "@/lib/utils";

const STATUS_LABEL: Record<string, string> = { active: "Active", trialing: "Trialing", past_due: "Past due", incomplete: "Incomplete", canceled: "Canceled" };

const COLUMNS: Column<AdminPayment>[] = [
  { id: "createdAt", header: "Date", firstDirection: "desc", cell: (p) => date(p.createdAt) },
  {
    id: "account",
    header: "Account",
    firstDirection: "asc",
    cell: (p) => (
      <AdminLink to={`/users/${p.userId}`} className="flex flex-col py-1.5 leading-tight">
        <span className="font-medium">{p.name}</span>
        <span className="type-small text-muted-foreground">{p.email}</span>
      </AdminLink>
    ),
  },
  { id: "plan", header: "Plan now", firstDirection: "desc", cell: (p) => <Pill tone={planTone(p.plan)}>{title(p.plan)}</Pill> },
  { id: "status", header: "Status", firstDirection: "asc", cell: (p) => <Pill tone={p.status === "succeeded" ? "good" : "warn"}>{title(p.status)}</Pill> },
  { id: "amount", header: "Amount", align: "end", firstDirection: "desc", cell: (p) => money(p.amount, p.currency) },
];

export default function AdminBillingPage() {
  const overview = useAdminData(() => adminAPI.billing(12), "billing");
  const [params, set] = useListParams({ q: "", status: "all", sort: "createdAt", order: "desc", page: "1" });
  const [query, setQuery] = useSearchBox(params.q, (text) => set({ q: text, page: "1" }, { replace: true }));
  const page = Math.max(Number(params.page) || 1, 1);
  const list = useAdminData(
    () => adminAPI.payments({ search: params.q.trim(), status: params.status === "all" ? undefined : params.status, sort: params.sort, order: params.order === "asc" ? "asc" : "desc", page, limit: 25 }),
    JSON.stringify(params),
  );
  const data = overview.data;
  const active = data ? (data.subscriptions.active ?? 0) + (data.subscriptions.trialing ?? 0) : 0;
  const paid = data ? Object.entries(data.plans).reduce((sum, [plan, n]) => sum + (plan === "free" ? 0 : n), 0) : 0;
  const total12 = data ? data.perMonth.reduce((sum, m) => sum + m.count, 0) : 0;

  return (
    <>
      <PageHeader title="Billing" description="Subscriptions and payments as Stripe reported them. Amounts are what was charged, before Stripe's fees." />
      <LoadState error={overview.error} loading={overview.loading} has={!!data} />
      {data && (
        <div className={cn("flex flex-col gap-6 transition-opacity", overview.loading && "opacity-60")}>
          <div className="grid grid-cols-2 gap-3 @min-[48rem]:grid-cols-4">
            <StatTile label="Revenue, 30 days" value={money(data.revenue.last30.amount, data.currency)} note={`${count(data.revenue.last30.payments)} ${data.revenue.last30.payments === 1 ? "payment" : "payments"}`} />
            <StatTile label="Revenue, all time" value={money(data.revenue.allTime.amount, data.currency)} note={`${count(data.revenue.allTime.payments)} ${data.revenue.allTime.payments === 1 ? "payment" : "payments"}`} />
            <StatTile label="Active subscriptions" value={count(active)} note={data.endingAtPeriodEnd ? `${count(data.endingAtPeriodEnd)} end at the period's end` : `${count(paid)} ${paid === 1 ? "account" : "accounts"} on a paid plan`} />
            <StatTile label="Failed payments, 30 days" value={count(data.revenue.failed30)} note={`${count(data.subscriptions.past_due ?? 0)} subscriptions past due`} />
          </div>

          <div className="grid gap-3 @min-[56rem]:grid-cols-2">
            <ChartCard className="@min-[56rem]:col-span-2" title={`Revenue per month, ${data.currency.toUpperCase()}`} summary={`${money(total12, data.currency)} in 12 months`}>
              <DayChart data={data.perMonth} unit="received" label={month} per="month" format={(n) => moneyShort(n, data.currency)} />
              {data.otherCurrencies.length > 0 && <p className="mt-3 type-small text-muted-foreground">Also received: {data.otherCurrencies.map((c) => money(c.amount, c.currency)).join(", ")}. These are not in the chart.</p>}
            </ChartCard>
            <ChartCard title="Subscriptions by status" summary={`${count(Object.values(data.subscriptions).reduce((a, b) => a + b, 0))} in all`}>
                <BarList items={Object.entries(data.subscriptions).map(([status, value]) => ({ key: status, label: STATUS_LABEL[status] ?? title(status), value }))} empty="No subscriptions yet." />
            </ChartCard>
            <ChartCard title="Accounts by plan" summary="Active accounts">
              <BarList items={Object.entries(data.plans).map(([plan, value]) => ({ key: plan, label: title(plan), value }))} />
            </ChartCard>
          </div>
        </div>
      )}

      <SectionHeading title="Payments" description={list.data ? `${count(list.data.meta.total)} ${list.data.meta.total === 1 ? "payment" : "payments"}` : undefined} />
      <div className="flex flex-wrap items-center gap-2">
        <Segmented
          value={params.status === "succeeded" || params.status === "other" ? params.status : "all"}
          onValueChange={(v) => set({ status: v, page: "1" })}
          options={[
            { value: "all", label: "All" },
            { value: "succeeded", label: "Succeeded" },
            { value: "other", label: "Not succeeded" },
          ]}
          label="Which payments"
        />
        <div className="relative min-w-56 flex-1">
          <Search className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input type="search" aria-label="Search payments by account" placeholder="Search by email or account id" value={query} onChange={(e) => setQuery(e.target.value)} className="ps-9" />
        </div>
      </div>
      <LoadState error={list.error} loading={false} has={!!list.data} />
      {(list.data || !list.error) && (
        <>
          {/* Before the first answer the table draws its real header over rows of placeholders. */}
          <DataTable loading={!list.data && 10} label="Payments" columns={COLUMNS} rows={list.data?.data ?? []} rowKey={(p) => p.id} sort={sortOf(params)} onSortChange={(next) => set({ sort: next.column, order: next.direction, page: "1" })} busy={list.loading} empty="No payment matches." />
          {list.data && <Pager meta={list.data.meta} onPage={(next) => set({ page: String(next) })} />}
        </>
      )}
    </>
  );
}
