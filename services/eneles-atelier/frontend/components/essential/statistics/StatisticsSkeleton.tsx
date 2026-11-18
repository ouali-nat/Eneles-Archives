import { Skeleton, SkeletonText } from "@/components/ui/skeleton";
import { SectionHeading } from "@/components/essential/layout/PageHeader";

/* The Statistics report (app/(user)/statistics/page.tsx) before its numbers arrive: every section, card, and line in its own box, with the words that do not depend on the numbers (section and card titles, row labels) drawn for real. */

function TileSkeleton() {
  return (
    <div className="flex min-w-0 flex-col gap-1 rounded-[var(--radius-card)] border border-line bg-card p-4">
      <SkeletonText className="type-small" width="55%" />
      <SkeletonText className="text-2xl" width="35%" />
      <SkeletonText className="type-small" width="70%" />
    </div>
  );
}

function AllowanceSkeleton() {
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <div className="flex items-baseline justify-between gap-3">
        <SkeletonText className="flex-1 type-base" width="45%" />
        <SkeletonText className="w-20 type-base" width="100%" />
      </div>
      <Skeleton className="h-1.5 w-full rounded-full" />
      <SkeletonText className="type-small" width="30%" />
    </div>
  );
}

function CardSkeleton({ title, children, summary = true }: { title: string; children: React.ReactNode; summary?: boolean }) {
  return (
    <section className="flex min-w-0 flex-col rounded-[var(--radius-card)] border border-line bg-card p-4">
      <header className="mb-3 flex items-baseline justify-between gap-3">
        <h3 className="type-base font-medium">{title}</h3>
        {summary && <SkeletonText className="w-20 shrink-0 type-small" width="100%" />}
      </header>
      {children}
    </section>
  );
}

/** The plot of a DayChart: 132px of columns and 20px of axis. */
const plot = <Skeleton className="h-[152px] w-full rounded-[var(--radius-inset)]" />;

function BarsSkeleton() {
  return (
    <div className="flex flex-col gap-2.5">
      {["60%", "45%", "30%"].map((width) => (
        <div key={width} className="flex flex-col gap-1">
          <div className="flex items-center justify-between gap-3">
            <SkeletonText className="flex-1 type-small" width={width} />
            <SkeletonText className="w-16 type-small" width="100%" />
          </div>
          <Skeleton className="h-1.5 rounded-full" style={{ width }} />
        </div>
      ))}
    </div>
  );
}

const together = ["People you share projects with", "Your projects shared with others", "Projects others share with you", "Comments you have written"];

export function StatisticsSkeleton() {
  return (
    <div role="status" aria-label="Loading statistics" className="flex flex-col gap-8">
      <section className="grid grid-cols-2 gap-3 @min-[56rem]:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <TileSkeleton key={i} />
        ))}
      </section>

      <section className="flex flex-col gap-4">
        <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
          <div className="min-w-0 flex-1">
            <SkeletonText className="text-lg" width="14rem" />
            <SkeletonText className="mt-0.5 type-base" width="min(36rem, 90%)" />
          </div>
          <Skeleton className="h-[var(--control-height)] w-36 rounded-[var(--radius)]" />
        </div>
        <div className="grid gap-6 rounded-[var(--radius-surface)] border border-line bg-card p-5 @min-[48rem]:grid-cols-3">
          <AllowanceSkeleton />
          <AllowanceSkeleton />
          <AllowanceSkeleton />
        </div>
      </section>

      <section className="flex flex-col gap-4">
        <SectionHeading title="Activity" description="The last twelve months, and the last 30 days for AI." />
        <div className="grid gap-3 @min-[56rem]:grid-cols-2">
          <CardSkeleton title="Image snips converted per month">{plot}</CardSkeleton>
          <CardSkeleton title="PDF pages converted per month">{plot}</CardSkeleton>
          <CardSkeleton title="Projects created per month">{plot}</CardSkeleton>
          <CardSkeleton title="AI requests per day">{plot}</CardSkeleton>
        </div>
      </section>

      <section className="flex flex-col gap-4">
        <SectionHeading title="Breakdown" />
        <div className="grid gap-3 @min-[56rem]:grid-cols-3">
          <CardSkeleton title="Storage by kind">
            <BarsSkeleton />
          </CardSkeleton>
          <CardSkeleton title="Files in your projects by type">
            <BarsSkeleton />
          </CardSkeleton>
          <CardSkeleton title="Working with others" summary={false}>
            <dl className="flex flex-col divide-y divide-line">
              {together.map((label) => (
                <div key={label} className="flex items-baseline justify-between gap-3 py-2.5 first:pt-0 last:pb-0">
                  <dt className="type-base text-muted-foreground">{label}</dt>
                  <SkeletonText className="w-8 type-base" width="100%" />
                </div>
              ))}
            </dl>
          </CardSkeleton>
        </div>
      </section>
    </div>
  );
}
