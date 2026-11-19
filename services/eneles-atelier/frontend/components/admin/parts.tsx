"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import type { TableSort } from "@/components/ui/data-table";
import { Button } from "@/components/ui/button";
import { ChevronLeft, ChevronRight } from "@/components/icons";
import { ApiError } from "@/lib/api";
import type { PageMeta } from "@/lib/api/admin";
import { Skeleton, SkeletonText } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { count, countryName } from "./format";

/**
 * Where the panel's pages live. On the admin host (admin.eneles.example) they sit at the root; everywhere else, under /admin. The proxy does the mapping on the way in; this is the same rule for links on the way out.
 */
const noop = () => () => {};
export function useAdminBase(): string {
  return useSyncExternalStore(
    noop,
    () => (window.location.hostname.startsWith("admin.") ? "" : "/admin"),
    () => "/admin",
  );
}

/** A link inside the panel: `to` is the page's path without the prefix ("/users/4"). */
export function AdminLink({ to, className, children, ...props }: { to: string; className?: string; children: ReactNode } & Omit<React.ComponentProps<typeof Link>, "href">) {
  const base = useAdminBase();
  return (
    <Link href={`${base}${to}` || "/"} className={className} {...props}>
      {children}
    </Link>
  );
}

/** A country as its flag and name. The flag is a picture, so it draws on systems whose fonts have no flag emoji. */
export function Country({ code, short = false }: { code: string | null | undefined; /** The flag and the two-letter code only, for narrow columns. */ short?: boolean }) {
  if (!code || !/^[A-Z]{2}$/.test(code)) return <span className="text-muted-foreground">Unknown</span>;
  const name = countryName(code);
  return (
    <span className="inline-flex min-w-0 items-center gap-2" title={short ? name : undefined}>
      {/* eslint-disable-next-line @next/next/no-img-element -- a static 1 KB SVG; the image optimizer adds nothing */}
      <img src={`/flags/${code.toLowerCase()}.svg`} alt="" width={20} height={15} loading="lazy" className="h-[15px] w-5 shrink-0 rounded-[2px] border border-line object-cover" />
      <span className="truncate">{short ? code : name}</span>
    </span>
  );
}

const TONES = {
  neutral: "bg-surface text-foreground",
  good: "bg-success/15 text-success",
  warn: "bg-warning/15 text-warning",
  bad: "bg-danger/15 text-danger",
  muted: "bg-surface text-muted-foreground",
} as const;

/** A short state word: Live, Pro, Failure. */
export function Pill({ tone = "neutral", children }: { tone?: keyof typeof TONES; children: ReactNode }) {
  return <span className={cn("inline-flex h-5 items-center rounded-[var(--radius-inset)] px-1.5 type-micro font-medium whitespace-nowrap", TONES[tone])}>{children}</span>;
}

/** The account's state as a pill, or nothing when it is active. */
export function StatusPill({ status }: { status: string }) {
  if (status === "suspended") return <Pill tone="warn">Disabled</Pill>;
  if (status === "deleted") return <Pill tone="bad">Deleted</Pill>;
  return null;
}

export const planTone = (plan: string): keyof typeof TONES => (plan === "free" ? "muted" : "neutral");
export const outcomeTone = (outcome: string): keyof typeof TONES => (outcome === "success" ? "good" : outcome === "blocked" ? "warn" : "bad");

/** "1 to 25 of 312" and the two buttons that move through it. */
export function Pager({ meta, onPage }: { meta: PageMeta | undefined; onPage: (page: number) => void }) {
  if (!meta || meta.total === 0) return null;
  const from = (meta.page - 1) * meta.limit + 1;
  const to = Math.min(meta.page * meta.limit, meta.total);
  return (
    <div className="flex items-center justify-between gap-3">
      <p className="type-small text-muted-foreground tabular-nums">
        {count(from)} to {count(to)} of {count(meta.total)}
      </p>
      <div className="flex items-center gap-1.5">
        <Button variant="outline" size="icon" aria-label="Previous page" disabled={!meta.hasPrev} onClick={() => onPage(meta.page - 1)}>
          <ChevronLeft />
        </Button>
        <Button variant="outline" size="icon" aria-label="Next page" disabled={!meta.hasNext} onClick={() => onPage(meta.page + 1)}>
          <ChevronRight />
        </Button>
      </div>
    </div>
  );
}

/**
 * Loads one thing from the admin API and reloads it when `key` changes or `reload` is called. While a reload is in flight the previous answer stays on screen (dimmed by the page), so nothing jumps.
 */
export function useAdminData<T>(load: () => Promise<T>, key: string, refreshMs?: number) {
  const [data, setData] = useState<T | undefined>();
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const latest = useRef(load);
  useEffect(() => {
    latest.current = load;
  });
  const run = useCallback(async (quiet: boolean) => {
    if (!quiet) setLoading(true);
    try {
      const result = await latest.current();
      setData(result);
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError && err.status === 403 ? "This account is not an administrator." : err instanceof Error ? err.message : "Could not load this.");
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    let cancelled = false;
    // Deferred a tick so the fetch starts after the effect, not inside it.
    const start = window.setTimeout(() => !cancelled && void run(false), 0);
    const timer = refreshMs ? window.setInterval(() => document.visibilityState === "visible" && void run(true), refreshMs) : 0;
    return () => {
      cancelled = true;
      window.clearTimeout(start);
      window.clearInterval(timer);
    };
  }, [key, refreshMs, run]);
  return { data, error, loading, reload: () => run(false) };
}

/** What a page shows before its first answer, or when the answer was an error. A page whose answer is a table draws the table's own placeholders instead (DataTable's `loading`) and passes `loading={false}` here. */
export function LoadState({ error, loading, has }: { error: string | null; loading: boolean; has: boolean }) {
  if (error && !has) return <p className="flex min-h-36 items-center justify-center rounded-[var(--radius-card)] border border-line bg-card px-6 py-8 text-center type-base text-danger">{error}</p>;
  if (loading && !has) return <AdminPageSkeleton />;
  return null;
}

/** The common shape of the panel's report pages while their first answer is on its way: a row of figure tiles in StatTile's frame, then four cards in ChartCard's with a plot's height. Each report differs after that, so this is the shape of their tops, not of every page. */
function AdminPageSkeleton() {
  return (
    <div role="status" aria-label="Loading" className="flex flex-col gap-6">
      <div className="grid grid-cols-2 gap-3 @min-[56rem]:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="flex min-w-0 flex-col gap-1 rounded-[var(--radius-card)] border border-line bg-card p-4">
            <SkeletonText className="type-small" width="55%" />
            <SkeletonText className="text-2xl" width="40%" />
            <SkeletonText className="type-small" width="65%" />
          </div>
        ))}
      </div>
      <div className="grid gap-3 @min-[56rem]:grid-cols-2">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="flex min-w-0 flex-col rounded-[var(--radius-card)] border border-line bg-card p-4">
            <SkeletonText className="mb-3 type-base" width="40%" />
            <Skeleton className="h-[152px] w-full" />
          </div>
        ))}
      </div>
    </div>
  );
}

/** A row of label and value pairs: the facts about one account or one service. */
export function Facts({ items, className }: { items: { label: string; value: ReactNode }[]; className?: string }) {
  return (
    <dl className={cn("grid grid-cols-[auto_minmax(0,1fr)] gap-x-6 gap-y-2 type-small", className)}>
      {items.map((item) => (
        <div key={item.label} className="contents">
          <dt className="text-muted-foreground">{item.label}</dt>
          <dd className="min-w-0 text-end tabular-nums [overflow-wrap:anywhere]">{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}

/**
 * A list's view state kept in the address: search, filters, sort, and page are query parameters, so a filtered list can be reloaded, shared, and stepped through with Back and Forward. A value equal to its default is left out of the address. `set` adds a history entry; pass `{ replace: true }` for typing, which should not leave one entry per key.
 */
export function useListParams<K extends string>(defaults: Record<K, string>) {
  const params = useSearchParams();
  const router = useRouter();
  const fallback = useRef(defaults);
  const values = Object.fromEntries((Object.keys(defaults) as K[]).map((key) => [key, params.get(key) ?? defaults[key]])) as Record<K, string>;
  const set = useCallback(
    (patch: Partial<Record<K, string>>, { replace = false }: { replace?: boolean } = {}) => {
      const next = new URLSearchParams(window.location.search);
      for (const [key, value] of Object.entries(patch) as [K, string | undefined][]) {
        if (value === undefined || value === "" || value === fallback.current[key]) next.delete(key);
        else next.set(key, value);
      }
      const query = next.toString();
      const url = `${window.location.pathname}${query ? `?${query}` : ""}`;
      if (replace) router.replace(url, { scroll: false });
      else router.push(url, { scroll: false });
    },
    [router],
  );
  return [values, set] as const;
}

/** The `sort` and `order` parameters as a table's sort, and back. */
export const sortOf = (values: { sort: string; order: string }): TableSort => ({ column: values.sort, direction: values.order === "asc" ? "asc" : "desc" });

/**
 * A search box over an address parameter. What is typed shows at once; the address (and so the server) follows a moment after typing stops. When the address changes on its own (Back, Forward, a link), the box follows it.
 */
export function useSearchBox(value: string, commit: (text: string) => void, ms = 300) {
  const [text, setText] = useState(value);
  const [seen, setSeen] = useState(value);
  if (value !== seen) {
    setSeen(value);
    setText(value);
  }
  const latest = useRef(commit);
  useEffect(() => {
    latest.current = commit;
  });
  useEffect(() => {
    if (text === value) return;
    const timer = window.setTimeout(() => latest.current(text), ms);
    return () => window.clearTimeout(timer);
  }, [text, value, ms]);
  return [text, setText] as const;
}

/** The site itself, from the panel: on the admin host the site is the same domain without "admin."; in development it is this server. */
export function useSiteHome(): string {
  return useSyncExternalStore(
    noop,
    () => (window.location.hostname.startsWith("admin.") ? `${window.location.protocol}//${window.location.host.slice("admin.".length)}/dashboard` : "/dashboard"),
    () => "/dashboard",
  );
}

/** Device, browser, and system on one line: "Desktop · Firefox · Linux". */
export function deviceLine(s: { deviceType: string; browser: string; os: string }): string {
  const cap = (word: string) => (word ? word[0].toUpperCase() + word.slice(1) : word);
  return [cap(s.deviceType), s.browser, s.os].filter((part) => part && part !== "Unknown").join(" · ") || "Unknown device";
}
