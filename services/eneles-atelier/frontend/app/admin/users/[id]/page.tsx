"use client";

import { use } from "react";
import { useRouter } from "next/navigation";
import { AccountActions } from "@/components/admin/AccountActions";
import { useAdminMe } from "@/components/admin/AdminShell";
import { ChartCard, DayChart, StatTile } from "@/components/admin/charts";
import { bytes, count, date, dateTime, money, title } from "@/components/admin/format";
import { AdminLink, Country, Facts, LoadState, Pill, StatusPill, deviceLine, outcomeTone, planTone, useAdminBase, useAdminData } from "@/components/admin/parts";
import { PageHeader, SectionHeading } from "@/components/essential/layout/PageHeader";
import { ArrowLeft } from "@/components/icons";
import { DataTable, asTime, type Column } from "@/components/ui/data-table";
import { RelativeTime } from "@/components/ui/time";
import { adminAPI, type AdminAuditEvent, type AdminSession, type AdminUserDetail } from "@/lib/api/admin";

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

const SESSION_COLUMNS: Column<AdminSession>[] = [
  { id: "state", header: "State", sortValue: (s) => (s.live ? 2 : s.isActive ? 1 : 0), cell: (s) => (s.live ? <Pill tone="good">Live</Pill> : <Pill tone="muted">{s.isActive ? "Expired" : "Signed out"}</Pill>) },
  { id: "device", header: "Device", sortValue: deviceLine, cell: deviceLine },
  { id: "country", header: "Country", sortValue: (s) => s.country ?? "", cell: (s) => <Country code={s.country} /> },
  { id: "ip", header: "IP address", sortValue: (s) => s.ipAddress ?? "", cell: (s) => <span className="font-mono type-small">{s.ipAddress ?? "Unknown"}</span> },
  { id: "lastActive", header: "Last active", sortValue: (s) => asTime(s.lastActive), cell: (s) => <RelativeTime value={s.lastActive} className="text-muted-foreground" /> },
  { id: "createdAt", header: "Signed in", sortValue: (s) => asTime(s.createdAt), cell: (s) => <span className="text-muted-foreground">{dateTime(s.createdAt)}</span> },
  { id: "expiresAt", header: "Expires", sortValue: (s) => asTime(s.expiresAt), cell: (s) => <span className="text-muted-foreground">{date(s.expiresAt)}</span> },
];

type Usage = AdminUserDetail["usage"][number];
const USAGE_COLUMNS: Column<Usage>[] = [
  { id: "month", header: "Month", sortValue: (m) => m.year * 100 + m.month, firstDirection: "desc", cell: (m) => `${MONTHS[m.month - 1]} ${m.year}` },
  { id: "snips", header: "Snips", align: "end", sortValue: (m) => m.snipsUsed, cell: (m) => count(m.snipsUsed) },
  { id: "pages", header: "PDF pages", align: "end", sortValue: (m) => m.pdfPagesUsed, cell: (m) => count(m.pdfPagesUsed) },
];

type Payment = AdminUserDetail["payments"][number];
const PAYMENT_COLUMNS: Column<Payment>[] = [
  { id: "date", header: "Date", sortValue: (p) => asTime(p.createdAt), cell: (p) => date(p.createdAt) },
  { id: "status", header: "Status", sortValue: (p) => p.status, cell: (p) => <Pill tone={p.status === "succeeded" ? "good" : "warn"}>{title(p.status)}</Pill> },
  { id: "amount", header: "Amount", align: "end", sortValue: (p) => p.amount, cell: (p) => money(p.amount, p.currency) },
];

type Key = AdminUserDetail["apiKeys"][number];
const KEY_COLUMNS: Column<Key>[] = [
  { id: "key", header: "Key", sortValue: (k) => k.keyPrefix, cell: (k) => <span className="font-mono type-small">{k.keyPrefix}…</span> },
  { id: "created", header: "Created", sortValue: (k) => asTime(k.createdAt), cell: (k) => <span className="text-muted-foreground">{date(k.createdAt)}</span> },
  { id: "used", header: "Last used", sortValue: (k) => asTime(k.lastUsedAt), cell: (k) => <RelativeTime value={k.lastUsedAt} fallback="Never" className="text-muted-foreground" /> },
];

const EVENT_COLUMNS: Column<AdminAuditEvent>[] = [
  { id: "when", header: "When", sortValue: (a) => asTime(a.createdAt), cell: (a) => <span className="text-muted-foreground">{dateTime(a.createdAt)}</span> },
  { id: "event", header: "Event", sortValue: (a) => a.action, cell: (a) => <span className="font-mono type-small">{a.action}</span> },
  { id: "by", header: "By", sortValue: (a) => a.actor ?? "", cell: (a) => (a.actor ? <span>{a.actor}</span> : <span className="text-muted-foreground">The account</span>) },
  { id: "outcome", header: "Outcome", sortValue: (a) => a.outcome, cell: (a) => <Pill tone={outcomeTone(a.outcome)}>{title(a.outcome)}</Pill> },
  { id: "country", header: "Country", sortValue: (a) => a.country ?? "", cell: (a) => <Country code={a.country} /> },
  { id: "ip", header: "IP address", sortValue: (a) => a.ipAddress ?? "", cell: (a) => <span className="font-mono type-small">{a.ipAddress ?? "Unknown"}</span> },
];

export default function AdminUserPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { data, error, loading, reload } = useAdminData(() => adminAPI.user(Number(id)), id);
  const me = useAdminMe();
  const router = useRouter();
  const base = useAdminBase();
  const u = data?.user;

  return (
    <>
      <AdminLink to="/users" className="inline-flex h-[var(--control-height)] w-fit items-center gap-1.5 type-base text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" />
        Users
      </AdminLink>
      <LoadState error={error} loading={loading} has={!!data} />
      {data && u && (
        <>
          <PageHeader
            title={
              <span className="flex flex-wrap items-center gap-2.5">
                {u.name}
                <Pill tone={planTone(u.subscriptionType)}>{title(u.subscriptionType)}</Pill>
                {u.root ? <Pill>Root administrator</Pill> : u.isAdmin && <Pill>Admin</Pill>}
                <StatusPill status={u.accountStatus} />
              </span>
            }
            description={u.email}
          />

          <div className="grid grid-cols-2 gap-3 @min-[48rem]:grid-cols-4">
            <StatTile label="Projects" value={count(data.counts.projects)} note={`${count(data.counts.files)} files, ${count(data.counts.sharedWithOthers)} shared with others`} />
            <StatTile label="Snips" value={count(data.counts.snips)} note={bytes(data.storage.snipBytes)} />
            <StatTile label="PDFs" value={count(data.counts.pdfs)} note={`${count(data.counts.pdfPages)} pages, ${bytes(data.storage.pdfBytes)}`} />
            <StatTile label="Upload storage" value={bytes(data.storage.totalBytes)} note={`${bytes(data.storage.projectAssetBytes)} in projects`} />
          </div>

          <div className="grid gap-3 @min-[56rem]:grid-cols-2">
            <ChartCard title="Account">
              <Facts
                items={[
                  { label: "Id", value: u.id },
                  { label: "State", value: u.accountStatus === "suspended" ? "Disabled" : title(u.accountStatus) },
                  { label: "Joined", value: date(u.createdAt) },
                  { label: "Email verified", value: u.verified ? "Yes" : "No" },
                  { label: "Two-factor sign-in", value: u.twoFactorEnabled ? "On" : "Off" },
                  { label: "Affiliation", value: u.affiliation || "Not given" },
                  { label: "Subscription", value: u.subscription ? `${title(u.subscription.status)}${u.subscription.cancelAtPeriodEnd ? ", ends" : ", renews"} ${u.subscription.stripeCurrentPeriodEnd ? date(u.subscription.stripeCurrentPeriodEnd) : ""}` : "None" },
                  { label: "Last project activity", value: <RelativeTime value={data.lastProjectActivity} fallback="Never" /> },
                  { label: "Shared with them", value: `${count(data.counts.collaborations)} projects` },
                  { label: "Reference papers", value: count(data.counts.references) },
                  { label: "Templates", value: count(data.counts.templates) },
                ]}
              />
            </ChartCard>
            <ChartCard title="AI requests per day" summary="Last 30 days">
              <DayChart data={data.ai.perDay} unit="requests" />
              <Facts
                className="mt-4 border-t border-line pt-3"
                items={
                  data.ai.byKind.length
                    ? data.ai.byKind.map((k) => ({
                        label: k.kind === "chat" ? "Assistant" : title(k.kind),
                        value: k.kind === "dictation" ? `${count(k.calls)} clips, ${bytes(k.audioBytes)} of audio` : `${count(k.calls)} messages, ${count(k.inputTokens)} tokens in, ${count(k.outputTokens)} out`,
                      }))
                    : [{ label: "Use", value: "None in the last 30 days" }]
                }
              />
            </ChartCard>
          </div>

          <SectionHeading title="Sessions" description={`${count(data.counts.sessions)} in all, ${count(data.liveSessions)} live. The newest 50 are listed.`} />
          <DataTable label="Sessions" columns={SESSION_COLUMNS} rows={data.sessions} rowKey={(s) => s.id} defaultSort={{ column: "lastActive", direction: "desc" }} empty="This account has never signed in." />

          <div className="grid gap-6 @min-[56rem]:grid-cols-2">
            <div className="flex flex-col gap-3">
              <SectionHeading title="Conversions by month" />
              <DataTable label="Conversions by month" columns={USAGE_COLUMNS} rows={data.usage} rowKey={(m) => `${m.year}-${m.month}`} defaultSort={{ column: "month", direction: "desc" }} empty="Nothing converted yet." />
            </div>
            <div className="flex flex-col gap-3">
              <SectionHeading title="Payments" />
              <DataTable label="Payments" columns={PAYMENT_COLUMNS} rows={data.payments} rowKey={(p) => p.id} defaultSort={{ column: "date", direction: "desc" }} empty="No payments." />
              <SectionHeading title="API keys" />
              <DataTable label="API keys" columns={KEY_COLUMNS} rows={data.apiKeys} rowKey={(k) => k.id} defaultSort={{ column: "created", direction: "desc" }} empty="No API keys." />
            </div>
          </div>

          <SectionHeading title="Recent security events" description="Sign-ins and failed codes, and what operators did to this account. The newest 50." />
          <DataTable label="Recent security events" columns={EVENT_COLUMNS} rows={data.audit} rowKey={(a) => a.id} defaultSort={{ column: "when", direction: "desc" }} empty="No events." />

          {me && <AccountActions detail={data} me={me} onChanged={reload} onDeleted={() => (void reload(), router.push(`${base}/users`))} />}
        </>
      )}
    </>
  );
}
