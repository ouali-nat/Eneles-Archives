"use client"

import { useCallback, useEffect, useState, type ReactNode } from "react"
import Link from "next/link"
import { ArrowRight } from "@/components/icons"
import { Button } from "@/components/ui/button"
import { Container } from "@/components/ui/container"
import { StatisticsSkeleton } from "@/components/essential/statistics/StatisticsSkeleton"
import { PageHeader, SectionHeading } from "@/components/essential/layout/PageHeader"
import { BarList, ChartCard, DayChart, Meter, StatTile } from "@/components/admin/charts"
import { bytes, count } from "@/components/admin/format"
import { usageAPI } from "@/lib/api"
import { cn } from "@/lib/utils"
import { RelativeTime } from "@/components/ui/time"

/** What `GET /usage/statistics` answers (backend/src/usage/usage.service.ts). Limits of -1 are unlimited. */
type Statistics = {
  account: { createdAt: string; plan: string; aiAssistant: boolean }
  totals: { projects: number; sharedWithYou: number; files: number; snips: number; pdfs: number; pdfPages: number; snipsConverted: number; pdfPagesConverted: number }
  currentMonth: { snipsUsed: number; snipsLimit: number; pdfPagesUsed: number; pdfPagesLimit: number; resetsOn: string }
  storage: { usedBytes: number; limitBytes: number; byKind: { pdfs: number; snips: number; projectFiles: number } }
  monthly: { month: string; snips: number; pdfPages: number; projects: number }[]
  ai: { daily: { day: string; count: number }[]; requests: number; tokens: number }
  filesByKind: Record<string, number>
  collaboration: { people: number; sharedProjects: number; sharedWithYou: number; comments: number }
}

const monthShort = new Intl.DateTimeFormat("en-US", { month: "short", year: "numeric", timeZone: "UTC" })
const monthLabel = (key: string) => monthShort.format(new Date(`${key}-01T00:00:00Z`))
const dayLong = new Intl.DateTimeFormat("en-US", { month: "long", day: "numeric" })
const sinceFormat = new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric" })
const plural = (n: number, one: string, many = `${one}s`) => `${count(n)} ${n === 1 ? one : many}`

const FILE_KINDS: Record<string, string> = {
  tex: "LaTeX sources (.tex)",
  bib: "Bibliographies (.bib)",
  figure: "Figures and images",
  style: "Classes and styles",
  other: "Other files",
}

/** The sentence a chart shows instead of an empty plot. */
function Empty({ children }: { children: ReactNode }) {
  return <p className="flex min-h-[152px] flex-1 items-center justify-center px-6 text-center type-base text-balance text-muted-foreground">{children}</p>
}

/** One allowance of the plan: what it is, the figures, and the meter (or the word Unlimited). */
function Allowance({ label, used, limit, format = count }: { label: string; used: number; limit: number; format?: (n: number) => string }) {
  const unlimited = limit < 0
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <div className="flex items-baseline justify-between gap-3">
        <span className="type-base font-medium">{label}</span>
        <span className="type-base tabular-nums">
          {format(used)}
          {!unlimited && <span className="text-muted-foreground"> of {format(limit)}</span>}
        </span>
      </div>
      {unlimited ? <p className="type-small text-muted-foreground">Unlimited on your plan</p> : <Meter value={used} max={limit} label={label} />}
      {!unlimited && limit > 0 && (
        <p className="type-small text-muted-foreground tabular-nums">{used >= limit ? "None left this month" : `${format(Math.max(limit - used, 0))} left`}</p>
      )}
    </div>
  )
}

export default function StatisticsPage() {
  const [stats, setStats] = useState<Statistics | null>(null)
  const [failed, setFailed] = useState(false)

  const fetchStats = useCallback(
    () =>
      usageAPI
        .getStatistics()
        .then((data: Statistics) => setStats(data))
        .catch(() => setFailed(true)),
    [],
  )
  useEffect(() => {
    void fetchStats()
  }, [fetchStats])
  const load = () => {
    setFailed(false)
    void fetchStats()
  }

  const description = stats ? (
    <>
      Your account since <RelativeTime value={stats.account.createdAt}>{sinceFormat.format(new Date(stats.account.createdAt))}</RelativeTime>.
    </>
  ) : (
    "Your projects, conversions, AI use, and storage."
  )

  return (
    <Container>
      <div className="flex flex-col gap-8">
        <PageHeader title="Statistics" description={description} />
        {failed ? (
          <div className="flex flex-col items-start gap-3 rounded-[var(--radius-surface)] border border-line bg-card p-5">
            <p className="type-base">Your statistics could not be loaded.</p>
            <Button variant="outline" onClick={load}>
              Try again
            </Button>
          </div>
        ) : !stats ? (
          <StatisticsSkeleton />
        ) : (
          <Report stats={stats} />
        )}
      </div>
    </Container>
  )
}

function Report({ stats }: { stats: Statistics }) {
  const { totals, currentMonth, storage, monthly, ai, collaboration } = stats
  const thisMonth = monthly[monthly.length - 1]
  const sum = (key: "snips" | "pdfPages" | "projects") => monthly.reduce((total, m) => total + m[key], 0)
  const fileKinds = Object.entries(stats.filesByKind).map(([key, value]) => ({ key, label: FILE_KINDS[key] ?? key, value }))
  const storageKinds = [
    { key: "projectFiles", label: "Project images and files", value: storage.byKind.projectFiles },
    { key: "pdfs", label: "Uploaded PDFs", value: storage.byKind.pdfs },
    { key: "snips", label: "Snip images", value: storage.byKind.snips },
  ]
  const series = (key: "snips" | "pdfPages" | "projects") => monthly.map((m) => ({ day: m.month, count: m[key] }))

  return (
    <div className="flex flex-col gap-8">
      <section aria-label="Totals" className="grid grid-cols-2 gap-3 @min-[56rem]:grid-cols-4">
        <StatTile label="Projects" value={count(totals.projects)} note={totals.sharedWithYou ? `And ${plural(totals.sharedWithYou, "project")} shared with you` : "None shared with you yet"} />
        <StatTile label="Project files" value={count(totals.files)} note={`${plural(stats.filesByKind.tex ?? 0, "LaTeX source")}`} />
        <StatTile label="Snips converted" value={count(totals.snipsConverted)} note={`${count(thisMonth?.snips ?? 0)} this month`} />
        <StatTile label="PDF pages converted" value={count(totals.pdfPagesConverted)} note={`${count(thisMonth?.pdfPages ?? 0)} this month`} />
      </section>

      <section aria-labelledby="stats-plan" className="flex flex-col gap-4">
        <SectionHeading
          title={<span id="stats-plan">Eneles usage this month</span>}
          description={
            <>
              Conversions start again on <RelativeTime value={currentMonth.resetsOn}>{dayLong.format(new Date(currentMonth.resetsOn))}</RelativeTime>. Storage counts what you keep, not what you upload in a month.
            </>
          }
          actions={
            <Button asChild variant="outline">
              <Link href="/billing">
                Accès Eneles
                <ArrowRight className="rtl:-scale-x-100" />
              </Link>
            </Button>
          }
        />
        <div className="grid gap-6 rounded-[var(--radius-surface)] border border-line bg-card p-5 @min-[48rem]:grid-cols-3">
          <Allowance label="Image snips" used={currentMonth.snipsUsed} limit={currentMonth.snipsLimit} />
          <Allowance label="PDF pages" used={currentMonth.pdfPagesUsed} limit={currentMonth.pdfPagesLimit} />
          <Allowance label="Upload storage" used={storage.usedBytes} limit={storage.limitBytes} format={bytes} />
        </div>
      </section>

      <section aria-labelledby="stats-activity" className="flex flex-col gap-4">
        <SectionHeading title={<span id="stats-activity">Activity</span>} description="The last twelve months, and the last 30 days for AI." />
        <div className="grid gap-3 @min-[56rem]:grid-cols-2">
          <ChartCard title="Image snips converted per month" summary={`${count(sum("snips"))} in 12 months`}>
            {sum("snips") ? <DayChart data={series("snips")} unit="snips" label={monthLabel} per="month" /> : <Empty>Images you convert to LaTeX are counted here, month by month.</Empty>}
          </ChartCard>
          <ChartCard title="PDF pages converted per month" summary={`${count(sum("pdfPages"))} in 12 months`}>
            {sum("pdfPages") ? <DayChart data={series("pdfPages")} unit="pages" label={monthLabel} per="month" /> : <Empty>Pages of PDFs you convert to LaTeX are counted here, month by month.</Empty>}
          </ChartCard>
          <ChartCard title="Projects created per month" summary={`${count(sum("projects"))} in 12 months`}>
            {sum("projects") ? <DayChart data={series("projects")} unit="projects" label={monthLabel} per="month" /> : <Empty>Projects you start appear here, month by month.</Empty>}
          </ChartCard>
          <ChartCard title="AI requests per day" summary={ai.requests ? `${count(ai.requests)} in 30 days` : undefined}>
            {ai.requests ? (
              <DayChart data={ai.daily} unit="requests" />
            ) : (
              <Empty>Requests to the editor&rsquo;s AI assistant and dictation appear here, day by day. Axya works with your own API key, set on the AI page.</Empty>
            )}
          </ChartCard>
        </div>
      </section>

      <section aria-labelledby="stats-breakdown" className="flex flex-col gap-4">
        <SectionHeading title={<span id="stats-breakdown">Breakdown</span>} />
        <div className="grid gap-3 @min-[56rem]:grid-cols-3">
          <ChartCard title="Storage by kind" summary={bytes(storage.usedBytes)}>
            <BarList items={storageKinds.filter((k) => k.value > 0)} format={bytes} empty="Uploaded PDFs, snip images, and images in your projects are counted here." />
          </ChartCard>
          <ChartCard title="Files in your projects by type" summary={count(totals.files)}>
            <BarList items={fileKinds.filter((k) => k.value > 0)} empty="The files of projects you own are counted here." />
          </ChartCard>
          <ChartCard title="Working with others">
            <dl className="flex flex-col divide-y divide-line">
              {[
                ["People you share projects with", collaboration.people],
                ["Your projects shared with others", collaboration.sharedProjects],
                ["Projects others share with you", collaboration.sharedWithYou],
                ["Comments you have written", collaboration.comments],
              ].map(([label, value]) => (
                <div key={label} className="flex items-baseline justify-between gap-3 py-2.5 first:pt-0 last:pb-0">
                  <dt className="type-base text-muted-foreground">{label}</dt>
                  <dd className={cn("type-base font-medium tabular-nums")}>{count(value as number)}</dd>
                </div>
              ))}
            </dl>
          </ChartCard>
        </div>
      </section>
    </div>
  )
}
