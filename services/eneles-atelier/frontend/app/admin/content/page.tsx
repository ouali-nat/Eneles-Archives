"use client";

import { BarList, ChartCard, DayChart, StatTile } from "@/components/admin/charts";
import { count, title } from "@/components/admin/format";
import { LoadState, useAdminData, useListParams } from "@/components/admin/parts";
import { PageHeader } from "@/components/essential/layout/PageHeader";
import { Segmented } from "@/components/ui/segmented";
import { adminAPI, type DayCount, type Tally } from "@/lib/api/admin";
import { cn } from "@/lib/utils";

const RANGES = [
  { value: "7", label: "7 days" },
  { value: "30", label: "30 days" },
  { value: "90", label: "90 days" },
];

const ACCESS: Record<string, string> = { private: "Private", view: "Anyone with the link can view", edit: "Anyone with the link can edit" };
const STATUS: Record<string, string> = { pending: "Waiting", processing: "Converting", completed: "Converted", error: "Failed" };

const sum = (series: DayCount[]) => series.reduce((total, d) => total + d.count, 0);
const bars = (rows: Tally[], names: Record<string, string>) => rows.map((r) => ({ key: r.name, label: names[r.name] ?? title(r.name), value: r.count }));

export default function AdminContentPage() {
  const [params, set] = useListParams({ days: "30" });
  const range = RANGES.some((r) => r.value === params.days) ? params.days : "30";
  const { data, error, loading } = useAdminData(() => adminAPI.content(Number(range)), range);

  return (
    <>
      <PageHeader
        title="Content"
        description="How much is being made. Counts only: no title, file, snip, or PDF is read here."
        actions={<Segmented value={range} onValueChange={(days) => set({ days })} options={RANGES} label="Time range" />}
      />
      <LoadState error={error} loading={loading} has={!!data} />
      {data && (
        <div className={cn("flex flex-col gap-6 transition-opacity", loading && "opacity-60")}>
          <div className="grid grid-cols-2 gap-3 @min-[48rem]:grid-cols-4">
            <StatTile label="Projects" value={count(data.totals.projects)} note={`${count(data.totals.archived)} archived, ${count(data.totals.references)} reference papers`} />
            <StatTile label="Files in projects" value={count(data.totals.files)} note={`In ${count(data.totals.folders)} folders`} />
            <StatTile label="Snips" value={count(data.totals.snips)} />
            <StatTile label="PDFs" value={count(data.totals.pdfs)} note={`${count(data.totals.pdfPages)} pages`} />
            <StatTile label="Shared projects" value={count(data.totals.shared)} note={`${count(data.totals.collaborators)} collaborators, ${count(data.totals.pendingInvitations)} invitations waiting`} />
            <StatTile label="Linked to GitHub" value={count(data.totals.githubLinked)} note={data.totals.projects ? `${Math.round((data.totals.githubLinked / data.totals.projects) * 100)}% of projects` : undefined} />
            <StatTile label="Templates" value={count(data.totals.templates)} note={`${count(data.totals.publicTemplates)} shared with everyone`} />
            <StatTile label="Made in this range" value={count(sum(data.series.projects) + sum(data.series.snips) + sum(data.series.pdfs))} note={`Projects, snips, and PDFs in ${data.days} days`} />
          </div>

          <div className="grid gap-3 @min-[56rem]:grid-cols-2">
            <ChartCard title="Projects created per day" summary={`${count(sum(data.series.projects))} in ${data.days} days`}>
              <DayChart data={data.series.projects} unit="projects" />
            </ChartCard>
            <ChartCard title="Project files created per day" summary={`${count(sum(data.series.files))} in ${data.days} days`}>
              <DayChart data={data.series.files} unit="files" />
            </ChartCard>
            <ChartCard title="Snips created per day" summary={`${count(sum(data.series.snips))} in ${data.days} days`}>
              <DayChart data={data.series.snips} unit="snips" />
            </ChartCard>
            <ChartCard title="PDFs uploaded per day" summary={`${count(sum(data.series.pdfs))} in ${data.days} days`}>
              <DayChart data={data.series.pdfs} unit="PDFs" />
            </ChartCard>
          </div>

          <div className="grid gap-3 @min-[48rem]:grid-cols-3">
            <ChartCard title="Projects by link sharing" summary={`${count(data.totals.projects)} projects`}>
              <BarList items={bars(data.projectAccess, ACCESS)} empty="No projects yet." />
            </ChartCard>
            <ChartCard title="Snips by state" summary={`${count(data.totals.snips)} snips`}>
              <BarList items={bars(data.snipStatus, STATUS)} empty="No snips yet." />
            </ChartCard>
            <ChartCard title="PDFs by state" summary={`${count(data.totals.pdfs)} PDFs`}>
              <BarList items={bars(data.pdfStatus, STATUS)} empty="No PDFs yet." />
            </ChartCard>
          </div>
        </div>
      )}
    </>
  );
}
