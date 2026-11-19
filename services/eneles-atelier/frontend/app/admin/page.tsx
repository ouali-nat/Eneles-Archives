"use client";

import { BarList, ChartCard, DayChart, StatTile } from "@/components/admin/charts";
import { bytes, count, money, title } from "@/components/admin/format";
import { Country, LoadState, useAdminData, useListParams } from "@/components/admin/parts";
import { PageHeader } from "@/components/essential/layout/PageHeader";
import { Segmented } from "@/components/ui/segmented";
import { adminAPI, type DayCount, type Tally } from "@/lib/api/admin";
import { cn } from "@/lib/utils";

const RANGES = [
  { value: "7", label: "7 days" },
  { value: "30", label: "30 days" },
  { value: "90", label: "90 days" },
];

const sum = (series: DayCount[]) => series.reduce((total, d) => total + d.count, 0);
const tally = (rows: Tally[]) => rows.map((r) => ({ key: r.name, label: r.name, value: r.count }));

export default function AdminOverviewPage() {
  const [params, set] = useListParams({ days: "30" });
  const range = RANGES.some((r) => r.value === params.days) ? params.days : "30";
  const setRange = (days: string) => set({ days });
  const { data, error, loading } = useAdminData(() => adminAPI.overview(Number(range)), range, 60_000);

  return (
    <>
      <PageHeader title="Overview" description="Accounts, activity, and what is being used. Counts only: nobody's projects or snips are read here." actions={<Segmented value={range} onValueChange={setRange} options={RANGES} label="Time range" />} />
      <LoadState error={error} loading={loading} has={!!data} />
      {data && (
        <div className={cn("flex flex-col gap-6 transition-opacity", loading && "opacity-60")}>
          {/* The few numbers that matter, each a way into the page that explains it. */}
          <div className="grid grid-cols-2 gap-3 @min-[48rem]:grid-cols-3 @min-[80rem]:grid-cols-6">
            <StatTile to="/users" label="Accounts" value={count(data.users.total)} note={`${count(data.users.new.week)} new this week`} />
            <StatTile to="/sessions" label="Active today" value={count(data.users.active.day)} note={`${count(data.users.active.week)} this week`} />
            <StatTile to="/billing" label="Revenue, 30 days" value={money(data.billing.revenue30d.amount)} note={`${count(data.users.total - (data.users.byPlan.free ?? 0))} paid ${data.users.total - (data.users.byPlan.free ?? 0) === 1 ? "account" : "accounts"}`} />
            <StatTile to="/content" label="Projects" value={count(data.content.projects)} note={`${count(data.content.files)} files, ${count(data.content.sharedProjects)} shared`} />
            <StatTile to="/storage" label="Upload storage" value={bytes(data.storage.totalBytes)} note={`${count(data.content.snips)} snips, ${count(data.content.pdfs)} PDFs`} />
            <StatTile to="/ai" label="AI requests" value={count(data.thisMonth.aiRequests)} note="This month" />
          </div>

          <div className="grid gap-3 @min-[56rem]:grid-cols-2">
            <ChartCard title="Sign-ups per day" summary={`${count(sum(data.series.signups))} in ${data.series.days} days`}>
              <DayChart data={data.series.signups} unit="sign-ups" />
            </ChartCard>
            <ChartCard title="Sign-ins per day" summary={`${count(sum(data.series.logins))} in ${data.series.days} days`}>
              <DayChart data={data.series.logins} unit="sign-ins" />
            </ChartCard>
            <ChartCard title="Projects created per day" summary={`${count(sum(data.series.projects))} in ${data.series.days} days`}>
              <DayChart data={data.series.projects} unit="projects" />
            </ChartCard>
            <ChartCard title="AI requests per day" summary={`${count(sum(data.series.aiRequests))} in ${data.series.days} days`}>
              <DayChart data={data.series.aiRequests} unit="requests" />
            </ChartCard>
          </div>

          <div className="grid gap-3 @min-[40rem]:grid-cols-2 @min-[72rem]:grid-cols-4">
            <ChartCard title="Plans" summary={`${count(data.users.total)} accounts`}>
              <BarList items={Object.entries(data.users.byPlan).map(([plan, value]) => ({ key: plan, label: title(plan), value }))} />
            </ChartCard>
            <ChartCard title="Countries" summary="Live sessions">
              <BarList items={data.sessions.countries.map((c) => ({ key: c.name, label: <Country code={c.name === "Unknown" ? null : c.name} />, value: c.count }))} />
            </ChartCard>
            <ChartCard title="Browsers" summary="Live sessions">
              <BarList items={tally(data.sessions.browsers)} />
            </ChartCard>
            <ChartCard title="Systems" summary="Live sessions">
              <BarList items={tally(data.sessions.systems)} />
            </ChartCard>
          </div>

          <div className="grid gap-3 @min-[40rem]:grid-cols-2 @min-[72rem]:grid-cols-4">
            <StatTile label="Verified accounts" value={count(data.users.verified)} note={`${count(data.users.twoFactor)} with two-factor sign-in`} />
            <StatTile to="/users?status=suspended" label="Disabled accounts" value={count(data.users.suspended)} note={`${count(data.users.deleted)} deleted`} />
            <StatTile to="/sessions" label="Live sessions" value={count(data.sessions.live)} note="Signed in and not expired" />
            <StatTile label="Snips converted this month" value={count(data.thisMonth.snipConversions)} note={`And ${count(data.thisMonth.pdfPages)} PDF pages`} />
          </div>
        </div>
      )}
    </>
  );
}
