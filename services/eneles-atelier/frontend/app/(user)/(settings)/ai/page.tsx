"use client";

import { useEffect, useState } from "react";
import { Container } from "@/components/ui/container";
import { PageHeader, SectionHeading } from "@/components/essential/layout/PageHeader";
import { Segmented } from "@/components/ui/segmented";
import { DataTable, type Column } from "@/components/ui/data-table";
import { RelativeTime } from "@/components/ui/time";
import { Skeleton } from "@/components/ui/skeleton";
import { AiProviderSettings } from "@/components/editor/settings/AiProviderSettings";
import { aiAPI, type AiUsageSummary } from "@/lib/api";
import { modelName } from "@/lib/ai/model-name";

type Row = AiUsageSummary["byModel"][number];

const count = (n: number) => n.toLocaleString("en-US");
const PROVIDER_NAMES: Record<string, string> = { anthropic: "Anthropic", openai: "OpenAI", gemini: "Google Gemini", openrouter: "OpenRouter", mistral: "Mistral", groq: "Groq", xai: "xAI", deepseek: "DeepSeek", compatible: "OpenAI-compatible", local: "Local test model", speech: "Eneles speech" };
const SOURCES: Record<string, string> = { own: "Your key", platform: "Eneles", local: "No model" };

const COLUMNS: Column<Row>[] = [
  { id: "model", header: "Model", sortValue: (r) => r.model ?? "", cell: (r) => <span className="text-foreground">{r.kind === "dictation" ? `Dictation${r.model ? `, ${modelName(r.model)}` : ""}` : r.model ? modelName(r.model) : "Unknown"}</span> },
  { id: "provider", header: "Provider", sortValue: (r) => r.provider ?? "", cell: (r) => <span className="text-muted-foreground">{PROVIDER_NAMES[r.provider ?? ""] ?? r.provider ?? "Unknown"}</span> },
  { id: "source", header: "Paid by", sortValue: (r) => r.keySource ?? "", cell: (r) => <span className="text-muted-foreground">{SOURCES[r.keySource ?? ""] ?? "Earlier"}</span> },
  { id: "calls", header: "Calls", align: "end", sortValue: (r) => r.calls, cell: (r) => count(r.calls) },
  { id: "in", header: "Tokens in", align: "end", sortValue: (r) => r.inputTokens, cell: (r) => count(r.inputTokens) },
  { id: "out", header: "Tokens out", align: "end", sortValue: (r) => r.outputTokens, cell: (r) => count(r.outputTokens) },
  { id: "last", header: "Last used", align: "end", sortValue: (r) => (r.lastUsedAt ? new Date(r.lastUsedAt) : null), cell: (r) => <RelativeTime value={r.lastUsedAt} fallback="Never" /> },
];

const RANGES = [
  { value: "7", label: "7 days" },
  { value: "30", label: "30 days" },
  { value: "90", label: "90 days" },
];

/** The person's own AI use: tokens by model, and whose key paid, over a range. Counts only: no message is stored. */
function Usage() {
  const [days, setDays] = useState("30");
  const [data, setData] = useState<AiUsageSummary | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let live = true;
    aiAPI
      .usage(Number(days))
      .then((d) => live && (setData(d), setFailed(false)))
      .catch(() => live && setFailed(true));
    return () => {
      live = false;
    };
  }, [days]);
  return (
    <section className="flex flex-col gap-4" aria-label="Usage">
      <SectionHeading title="Usage" description="Tokens Axya used for you, by model. Only the counts are kept: never a message or a file." actions={<Segmented value={days} onValueChange={setDays} options={RANGES} label="Time range" />} />
      {failed ? (
        <p className="type-base text-muted-foreground">Usage could not be loaded.</p>
      ) : !data ? (
        <Skeleton className="h-32 w-full" />
      ) : (
        <>
          <p className="type-base text-muted-foreground">
            {count(data.totals.calls)} {data.totals.calls === 1 ? "request" : "requests"}, {count(data.totals.inputTokens)} tokens in and {count(data.totals.outputTokens)} out in the last {data.days} days.
          </p>
          <DataTable label="Usage by model" columns={COLUMNS} rows={data.byModel} rowKey={(r) => `${r.kind}/${r.provider}/${r.model}/${r.keySource}`} defaultSort={{ column: "in", direction: "desc" }} empty="Axya has not been used in this range." />
        </>
      )}
    </section>
  );
}

export default function AiSettingsPage() {
  return (
    <Container>
      <div className="flex flex-col gap-8">
        <PageHeader title="AI" description="Your API keys, the model Axya uses, and what it has used." />
        <AiProviderSettings />
        <Usage />
      </div>
    </Container>
  );
}
