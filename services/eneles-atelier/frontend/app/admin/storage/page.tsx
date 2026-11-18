"use client";

import { BarList, ChartCard, DayChart, StatTile } from "@/components/admin/charts";
import { bytes, count, title } from "@/components/admin/format";
import { AdminLink, LoadState, Pill, StatusPill, planTone, useAdminData, useListParams } from "@/components/admin/parts";
import { PageHeader, SectionHeading } from "@/components/essential/layout/PageHeader";
import { DataTable, type Column } from "@/components/ui/data-table";
import { Segmented } from "@/components/ui/segmented";
import { adminAPI, type AdminStorage } from "@/lib/api/admin";
import { cn } from "@/lib/utils";

const RANGES = [
  { value: "7", label: "7 days" },
  { value: "30", label: "30 days" },
  { value: "90", label: "90 days" },
];

type Holder = AdminStorage["largest"][number];
const size = (id: string, header: string, value: (h: Holder) => number): Column<Holder> => ({ id, header, align: "end", sortValue: value, cell: (h) => bytes(value(h)) });

const COLUMNS: Column<Holder>[] = [
  {
    id: "account",
    header: "Account",
    sortValue: (h) => h.email,
    cell: (h) => (
      <AdminLink to={`/users/${h.userId}`} className="flex flex-col py-1.5 leading-tight">
        <span className="flex items-center gap-2 font-medium">
          {h.name}
          <StatusPill status={h.status} />
        </span>
        <span className="type-small text-muted-foreground">{h.email}</span>
      </AdminLink>
    ),
  },
  { id: "plan", header: "Plan", sortValue: (h) => ["free", "pro", "team", "enterprise"].indexOf(h.plan), cell: (h) => <Pill tone={planTone(h.plan)}>{title(h.plan)}</Pill> },
  { id: "files", header: "Files", align: "end", sortValue: (h) => h.files, cell: (h) => count(h.files) },
  size("pdf", "PDFs", (h) => h.pdfBytes),
  size("snip", "Snips", (h) => h.snipBytes),
  size("project", "Project files", (h) => h.projectBytes),
  size("total", "Total", (h) => h.totalBytes),
];

export default function AdminStoragePage() {
  const [params, set] = useListParams({ days: "30" });
  const range = RANGES.some((r) => r.value === params.days) ? params.days : "30";
  const { data, error, loading } = useAdminData(() => adminAPI.storage(Number(range)), range);
  const sum = (series: { count: number }[]) => series.reduce((total, d) => total + d.count, 0);

  return (
    <>
      <PageHeader
        title="Storage"
        description="Uploaded files: PDFs, snip images, and the images and other files inside projects. Sizes only; no file is opened here."
        actions={<Segmented value={range} onValueChange={(days) => set({ days })} options={RANGES} label="Time range" />}
      />
      <LoadState error={error} loading={loading} has={!!data} />
      {data && (
        <div className={cn("flex flex-col gap-6 transition-opacity", loading && "opacity-60")}>
          <div className="grid grid-cols-2 gap-3 @min-[48rem]:grid-cols-4">
            <StatTile label="Stored in all" value={bytes(data.totals.bytes)} note={`${bytes(data.totals.addedInRange)} uploaded in ${data.days} days`} />
            <StatTile label="PDFs" value={bytes(data.totals.pdf.bytes)} note={`${count(data.totals.pdf.files)} ${data.totals.pdf.files === 1 ? "file" : "files"}`} />
            <StatTile label="Snips" value={bytes(data.totals.snip.bytes)} note={`${count(data.totals.snip.files)} ${data.totals.snip.files === 1 ? "image" : "images"}`} />
            <StatTile label="Project files" value={bytes(data.totals.project.bytes)} note={`${count(data.totals.project.files)} uploaded ${data.totals.project.files === 1 ? "file" : "files"}`} />
          </div>

          <div className="grid gap-3 @min-[56rem]:grid-cols-2">
            <ChartCard title="PDF bytes uploaded per day" summary={`${bytes(sum(data.series.pdf))} in ${data.days} days`}>
              <DayChart data={data.series.pdf} unit="uploaded" format={bytes} binary />
            </ChartCard>
            <ChartCard title="Snip bytes uploaded per day" summary={`${bytes(sum(data.series.snip))} in ${data.days} days`}>
              <DayChart data={data.series.snip} unit="uploaded" format={bytes} binary />
            </ChartCard>
            <ChartCard title="Project file bytes uploaded per day" summary={`${bytes(sum(data.series.project))} in ${data.days} days`}>
              <DayChart data={data.series.project} unit="uploaded" format={bytes} binary />
            </ChartCard>
            <ChartCard title="Stored by kind" summary={bytes(data.totals.bytes)}>
              <BarList
                format={bytes}
                items={[
                  { key: "pdf", label: "PDFs", value: data.totals.pdf.bytes },
                  { key: "snip", label: "Snips", value: data.totals.snip.bytes },
                  { key: "project", label: "Project files", value: data.totals.project.bytes },
                ]}
                empty="Nothing uploaded yet."
              />
              <p className="mt-4 border-t border-line pt-3 type-small text-muted-foreground">The daily charts count files that are still stored, on the day they were uploaded. Files deleted since are not in them.</p>
            </ChartCard>
          </div>

          <SectionHeading title="Largest accounts" description="The 25 accounts that store the most." />
          <DataTable label="Largest accounts" columns={COLUMNS} rows={data.largest} rowKey={(h) => h.userId} defaultSort={{ column: "total", direction: "desc" }} empty="Nobody has uploaded anything yet." />
        </div>
      )}
    </>
  );
}
