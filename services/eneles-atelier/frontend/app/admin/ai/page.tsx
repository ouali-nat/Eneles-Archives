"use client";

import { BarList, ChartCard, DayChart, StatTile } from "@/components/admin/charts";
import { bytes, count, title } from "@/components/admin/format";
import { AdminLink, LoadState, Pill, planTone, useAdminData, useListParams } from "@/components/admin/parts";
import { DataTable, type Column } from "@/components/ui/data-table";
import { PageHeader, SectionHeading } from "@/components/essential/layout/PageHeader";
import { Segmented } from "@/components/ui/segmented";
import { adminAPI, type AdminAi, type AdminPlatformAi } from "@/lib/api/admin";
import { cn } from "@/lib/utils";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Switch } from "@/components/ui/switch";
import { RelativeTime } from "@/components/ui/time";
import { useAdminMe } from "@/components/admin/AdminShell";
import { modelName } from "@/lib/ai/model-name";

const RANGES = [
  { value: "7", label: "7 days" },
  { value: "30", label: "30 days" },
  { value: "90", label: "90 days" },
];

type TopUser = AdminAi["topUsers"][number];
const TOP_COLUMNS: Column<TopUser>[] = [
  {
    id: "account",
    header: "Account",
    sortValue: (t) => t.email ?? "",
    cell: (t) => (
      <AdminLink to={`/users/${t.userId}`} className="hover:underline">
        {t.email ?? `Account ${t.userId}`}
      </AdminLink>
    ),
  },
  { id: "plan", header: "Plan", sortValue: (t) => ["free", "pro", "team", "enterprise"].indexOf(t.plan ?? ""), cell: (t) => t.plan && <Pill tone={planTone(t.plan)}>{title(t.plan)}</Pill> },
  { id: "calls", header: "Calls", align: "end", sortValue: (t) => t.calls, cell: (t) => count(t.calls) },
  { id: "requests", header: "Requests", align: "end", sortValue: (t) => t.requests, cell: (t) => count(t.requests) },
  { id: "inputTokens", header: "Tokens in", align: "end", sortValue: (t) => t.inputTokens, cell: (t) => count(t.inputTokens) },
  { id: "outputTokens", header: "Tokens out", align: "end", sortValue: (t) => t.outputTokens, cell: (t) => count(t.outputTokens) },
];

type ModelUse = AdminAi["byModel"][number];
const modelLabel = (m: ModelUse) => (m.model ? modelName(m.model) : m.provider?.startsWith("speech") ? "Speech to text" : (m.provider ?? "Unknown"));
const MODEL_COLUMNS: Column<ModelUse>[] = [
  { id: "model", header: "Model", sortValue: modelLabel, cell: (m) => modelLabel(m) },
  { id: "provider", header: "Provider", sortValue: (m) => m.provider ?? "", cell: (m) => <span className="text-muted-foreground">{m.provider ?? "Unknown"}</span> },
  { id: "calls", header: "Calls", align: "end", sortValue: (m) => m.calls, cell: (m) => count(m.calls) },
  { id: "requests", header: "Requests", align: "end", sortValue: (m) => m.requests, cell: (m) => count(m.requests) },
  { id: "inputTokens", header: "Tokens in", align: "end", sortValue: (m) => m.inputTokens, cell: (m) => count(m.inputTokens) },
  { id: "outputTokens", header: "Tokens out", align: "end", sortValue: (m) => m.outputTokens, cell: (m) => count(m.outputTokens) },
];

/**
 * The Platform AI switch: whether Eneles members may use the platform's own model keys. Off by default; with it off the assistant answers only with people's own keys, for all Eneles members. Only the root administrator can change it; other administrators see where it stands.
 */
function PlatformAiSwitch() {
  const me = useAdminMe();
  const [state, setState] = useState<AdminPlatformAi | null>(null);
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    adminAPI
      .platformAi()
      .then(setState)
      .catch(() => undefined);
  }, []);
  const change = async (enabled: boolean) => {
    setSaving(true);
    try {
      setState(await adminAPI.setPlatformAi(enabled));
      toast.success(enabled ? "Platform AI is on" : "Platform AI is off");
    } catch (e) {
      toast.error(e instanceof Error && e.message ? e.message : "Platform AI could not be changed.");
    } finally {
      setSaving(false);
    }
  };
  const root = !!me?.root;
  return (
    <section aria-label="Platform AI" className="flex flex-col gap-4 rounded-[var(--radius-surface)] border border-line bg-card p-5">
      <div className="flex items-start gap-4">
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <h2 id="platform-ai-label" className="type-base font-semibold text-foreground">
            Platform AI
          </h2>
          <p className="type-base text-muted-foreground">
            When this is off, Axya answers only with each person&rsquo;s own API key, for all Eneles members, and the platform&rsquo;s keys are never used. When it is on, all Eneles members can also use the platform&rsquo;s keys without bringing their own; a person&rsquo;s own key, when they have one, is still used first.
          </p>
        </div>
        <Switch checked={!!state?.enabled} onCheckedChange={(v) => void change(v)} disabled={!state || !root || saving} aria-labelledby="platform-ai-label" />
      </div>
      {state && (
        <dl className="grid gap-x-6 gap-y-1 type-small @min-[40rem]:grid-cols-[auto_1fr]">
          <dt className="text-muted-foreground">Now</dt>
          <dd className="text-foreground">{state.enabled ? "On" : "Off"}{state.updatedAt && <> since <RelativeTime value={state.updatedAt} lowercase /></>}</dd>
          <dt className="text-muted-foreground">Platform keys</dt>
          <dd className="text-foreground">{state.configured ? `Set: ${title(state.provider ?? "")}, ${modelName(state.model)}` : "Not set. Set ANTHROPIC_API_KEY or OPENAI_API_KEY on the server; until then, turning this on changes nothing."}</dd>
          {!root && (
            <>
              <dt className="text-muted-foreground">Who can change it</dt>
              <dd className="text-foreground">Only the root administrator.</dd>
            </>
          )}
        </dl>
      )}
    </section>
  );
}

export default function AdminAiPage() {
  const [params, set] = useListParams({ days: "30" });
  const range = RANGES.some((r) => r.value === params.days) ? params.days : "30";
  const setRange = (days: string) => set({ days });
  const { data, error, loading } = useAdminData(() => adminAPI.ai(Number(range)), range);
  const kind = (name: string) => data?.byKind.find((k) => k.kind === name);

  return (
    <>
      <PageHeader title="AI usage" description="The assistant and dictation: calls made with people's own keys and, when Platform AI is on, with ours. Amounts only: no message, file, or transcript is stored." actions={<Segmented value={range} onValueChange={setRange} options={RANGES} label="Time range" />} />
      <PlatformAiSwitch />
      <LoadState error={error} loading={loading} has={!!data} />
      {data && (
        <div className={cn("flex flex-col gap-6 transition-opacity", loading && "opacity-60")}>
          <div className="grid grid-cols-2 gap-3 @min-[48rem]:grid-cols-4">
            <StatTile label="Assistant messages" value={count(kind("chat")?.calls ?? 0)} note={`${count(kind("chat")?.requests ?? 0)} model requests`} />
            <StatTile label="Tokens in" value={count(data.totals.inputTokens)} note={`${count(data.totals.outputTokens)} out`} />
            <StatTile label="Dictated clips" value={count(kind("dictation")?.calls ?? 0)} note={`${bytes(data.totals.audioBytes)} of audio`} />
            <StatTile label="Failed calls" value={count(data.totals.failures)} note={`${data.totals.calls ? ((data.totals.failures / data.totals.calls) * 100).toFixed(1) : "0"}% of ${count(data.totals.calls)}, ${(data.totals.averageMs / 1000).toFixed(1)} s on average`} />
          </div>

          <div className="grid gap-3 @min-[56rem]:grid-cols-2 @min-[80rem]:grid-cols-3">
            <ChartCard title="Model requests per day">
              <DayChart data={data.series.requests} unit="requests" />
            </ChartCard>
            <ChartCard title="Tokens per day" summary="In and out together">
              <DayChart data={data.series.tokens} unit="tokens" />
            </ChartCard>
            <ChartCard title="People using AI per day">
              <DayChart data={data.series.users} unit="people" />
            </ChartCard>
          </div>

          <div className="grid gap-3 @min-[56rem]:grid-cols-2">
            <ChartCard title="By model" summary="Calls">
              {/* One bar per name: two providers of speech to text read as one model here; the table below keeps them apart. */}
              <BarList items={Object.entries(data.byModel.reduce<Record<string, number>>((by, m) => ((by[modelLabel(m)] = (by[modelLabel(m)] ?? 0) + m.calls), by), {})).map(([name, value]) => ({ key: name, label: name, value }))} empty="No AI use in this range." />
            </ChartCard>
            <ChartCard title="By feature" summary="Calls">
              <BarList items={data.byKind.map((k) => ({ key: k.kind, label: k.kind === "chat" ? "Assistant" : title(k.kind), value: k.calls }))} empty="No AI use in this range." />
            </ChartCard>
          </div>

          <SectionHeading title="Heaviest users" description="By tokens sent, in this range." />
          <DataTable label="Heaviest users" columns={TOP_COLUMNS} rows={data.topUsers} rowKey={(t) => t.userId} defaultSort={{ column: "inputTokens", direction: "desc" }} empty="Nobody has used AI in this range." />

          <SectionHeading title="Models" description="Every model called in this range." />
          <DataTable label="Models" columns={MODEL_COLUMNS} rows={data.byModel} rowKey={(m) => `${m.provider}/${m.model}`} defaultSort={{ column: "calls", direction: "desc" }} empty="No AI use in this range." />
        </div>
      )}
    </>
  );
}
