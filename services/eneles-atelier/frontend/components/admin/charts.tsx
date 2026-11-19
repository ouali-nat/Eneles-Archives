"use client";

import { useId, useState, type KeyboardEvent, type ReactNode } from "react";
import { useElementWidth } from "@/hooks/useElementWidth";
import { cn } from "@/lib/utils";
import type { DayCount } from "@/lib/api/admin";
import { ArrowRight } from "@/components/icons";
import { count, day } from "./format";
import { AdminLink } from "./parts";

/**
 * The admin panel's figures and charts. Every chart here plots one series, so there is one chart hue (`chart`), no legend, and the card's title says what is drawn. Text is always ink, never the series color.
 */

/** A headline number: what it counts, the number, and one line of context. With `to`, the whole tile is a link to the page that explains the number. */
export function StatTile({ label, value, note, to, className }: { label: string; value: ReactNode; note?: ReactNode; /** A page in the panel ("/billing"). */ to?: string; className?: string }) {
  const body = (
    <>
      <p className="flex items-center justify-between gap-2 type-small text-muted-foreground">
        <span className="line-clamp-2">{label}</span>
        {to && <ArrowRight aria-hidden className="size-4 shrink-0 opacity-0 transition-opacity group-hover/tile:opacity-100 group-focus-visible/tile:opacity-100" />}
      </p>
      <p className="text-2xl font-semibold tracking-[-0.02em] tabular-nums">{value}</p>
      {note && <p className="line-clamp-2 type-small text-muted-foreground">{note}</p>}
    </>
  );
  const frame = "flex min-w-0 flex-col gap-1 rounded-[var(--radius-card)] border border-line bg-card p-4";
  if (!to) return <div className={cn(frame, className)}>{body}</div>;
  return (
    <AdminLink to={to} className={cn(frame, "group/tile transition-colors hover:bg-surface-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus", className)}>
      {body}
    </AdminLink>
  );
}

/** The card a chart or a breakdown sits in. */
export function ChartCard({ title, summary, children, className }: { title: string; summary?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cn("flex min-w-0 flex-col rounded-[var(--radius-card)] border border-line bg-card p-4", className)}>
      <header className="mb-3 flex items-baseline justify-between gap-3">
        <h3 className="type-base font-medium">{title}</h3>
        {summary && <p className="shrink-0 type-small text-muted-foreground tabular-nums">{summary}</p>}
      </header>
      {children}
    </section>
  );
}

/** A round number at or above `max` for the top of the axis, so the ticks are clean. Sizes in bytes round on powers of 1024, so the ticks read "4 MB" and "2 MB" rather than "3.8 MB". */
function axisTop(max: number, binary = false): number {
  if (max <= 4) return 4;
  if (binary) {
    const unit = 1024 ** Math.floor(Math.log(max) / Math.log(1024));
    for (const step of [1, 2, 4, 8, 16, 32, 64, 128, 256, 512, 1024]) if (step * unit >= max) return step * unit;
  }
  const magnitude = 10 ** Math.floor(Math.log10(max));
  // Only tops whose half is a round number too, so the middle tick is never "2.5".
  for (const step of [1, 2, 4, 6, 8, 10]) if (step * magnitude >= max) return step * magnitude;
  return 10 * magnitude;
}

const PLOT_HEIGHT = 132;
const AXIS_BOTTOM = 20;
const TOP_ROOM = 6;

/**
 * One number per day as columns. Hovering or arrowing along the plot reads out any day; the same numbers are in a table for screen readers.
 */
export function DayChart({
  data,
  unit,
  format = count,
  label = day,
  per = "day",
  binary = false,
}: {
  data: DayCount[];
  /** What one unit is, for the readout: "sign-ups", "requests". */
  unit: string;
  format?: (n: number) => string;
  /** How a column's key reads on the axis and in the readout; a day by default ("Nov 10"), or a month for monthly data. */
  label?: (key: string) => string;
  /** What one column is, for the screen-reader table: "day" or "month". */
  per?: string;
  /** The numbers are bytes: the axis rounds on powers of 1024. */
  binary?: boolean;
}) {
  const [ref, width] = useElementWidth<HTMLDivElement>();
  const [active, setActive] = useState<number | null>(null);
  const captionId = useId();

  const top = axisTop(Math.max(...data.map((d) => d.count), 0), binary);
  // A range with nothing in it draws only the baseline and says so, rather than an axis of made-up round numbers.
  const blank = !data.some((d) => d.count > 0);
  const ticks = blank ? [0] : [0, top / 2, top];
  const gutter = Math.max(...ticks.map((t) => format(t).length)) * 6.5 + 10;
  const plotWidth = Math.max(width - gutter, 0);
  const band = data.length ? plotWidth / data.length : 0;
  // Never fill the slot: a column is at most 24px wide and always leaves a 2px gap to its neighbor.
  const bar = Math.max(Math.min(band - 2, 24), 1);
  const y = (value: number) => TOP_ROOM + (PLOT_HEIGHT - TOP_ROOM) * (1 - value / top);
  const labelled = data.length > 2 ? [0, Math.floor((data.length - 1) / 2), data.length - 1] : data.map((_, i) => i);

  const onKeyDown = (event: KeyboardEvent) => {
    if (!data.length) return;
    const move = { ArrowLeft: -1, ArrowRight: 1 }[event.key];
    if (move) {
      event.preventDefault();
      setActive((i) => Math.min(Math.max((i ?? (move > 0 ? -1 : data.length)) + move, 0), data.length - 1));
    } else if (event.key === "Home") setActive(0);
    else if (event.key === "End") setActive(data.length - 1);
    else if (event.key === "Escape") setActive(null);
  };

  const shown = active !== null ? data[active] : null;
  const readoutLeft = active !== null ? gutter + band * (active + 0.5) : 0;

  return (
    <div ref={ref} className="relative">
      {width > 0 && (
        <svg
          width={width}
          height={PLOT_HEIGHT + AXIS_BOTTOM}
          role="img"
          aria-describedby={captionId}
          tabIndex={0}
          onKeyDown={onKeyDown}
          onBlur={() => setActive(null)}
          onPointerLeave={() => setActive(null)}
          className="block rounded-[var(--radius-inset)] outline-offset-4 outline-focus focus:outline-none focus-visible:outline-2"
        >
          {ticks.map((tick) => (
            <g key={tick}>
              <line x1={gutter} x2={width} y1={y(tick)} y2={y(tick)} className="stroke-line" strokeWidth={1} shapeRendering="crispEdges" />
              <text x={gutter - 8} y={y(tick)} dy="0.32em" textAnchor="end" className="fill-muted-foreground type-micro tabular-nums">
                {format(tick)}
              </text>
            </g>
          ))}
          {active !== null && <rect x={gutter + band * active} y={TOP_ROOM} width={band} height={PLOT_HEIGHT - TOP_ROOM} className="fill-surface" />}
          {data.map((d, i) => {
            const height = d.count > 0 ? Math.max(PLOT_HEIGHT - y(d.count), 2) : 0;
            const radius = Math.min(4, bar / 2, height);
            const x = gutter + band * i + (band - bar) / 2;
            const topY = PLOT_HEIGHT - height;
            // Rounded at the data end, square on the baseline.
            const path = `M${x},${PLOT_HEIGHT} V${topY + radius} Q${x},${topY} ${x + radius},${topY} H${x + bar - radius} Q${x + bar},${topY} ${x + bar},${topY + radius} V${PLOT_HEIGHT} Z`;
            return height > 0 ? <path key={d.day} d={path} className={cn("fill-chart transition-opacity", active !== null && active !== i && "opacity-45")} /> : null;
          })}
          {labelled.map((i) => (
            <text key={i} x={gutter + band * (i + 0.5)} y={PLOT_HEIGHT + 15} textAnchor={i === 0 ? "start" : i === data.length - 1 ? "end" : "middle"} dx={i === 0 ? -band / 2 : i === data.length - 1 ? band / 2 : 0} className="fill-muted-foreground type-micro">
              {label(data[i].day)}
            </text>
          ))}
          {/* The whole band is the hit target, so a day with a short column, or none, is as easy to read as a tall one. */}
          {data.map((d, i) => (
            <rect key={d.day} x={gutter + band * i} y={0} width={band} height={PLOT_HEIGHT} fill="transparent" onPointerMove={() => setActive(i)} />
          ))}
        </svg>
      )}
      {width === 0 && <div style={{ height: PLOT_HEIGHT + AXIS_BOTTOM }} />}
      {blank && width > 0 && (
        <p className="pointer-events-none absolute inset-x-0 top-0 flex items-center justify-center type-small text-muted-foreground" style={{ height: PLOT_HEIGHT, paddingInlineStart: gutter }}>
          None in this range
        </p>
      )}
      {shown && (
        <div
          role="status"
          className="pointer-events-none absolute top-0 z-10 -translate-x-1/2 rounded-[var(--radius-item)] border border-line bg-panel px-2.5 py-1.5 whitespace-nowrap shadow-popover"
          style={{ left: Math.min(Math.max(readoutLeft, 56), Math.max(width - 56, 56)) }}
        >
          <p className="type-small font-semibold tabular-nums">
            {format(shown.count)} <span className="font-normal text-muted-foreground">{unit}</span>
          </p>
          <p className="type-micro text-muted-foreground">{label(shown.day)}</p>
        </div>
      )}
      {/* The same numbers as a table, for screen readers. It sits in a clipped box: a table on its own ignores the clipping and its caption showed under the chart. */}
      <div id={captionId} className="sr-only">
        <table>
          <caption>
            {unit} per {per}
          </caption>
          <thead>
            <tr>
              <th scope="col">{per[0].toUpperCase() + per.slice(1)}</th>
              <th scope="col">{unit}</th>
            </tr>
          </thead>
          <tbody>
            {data.map((d) => (
              <tr key={d.day}>
                <td>{label(d.day)}</td>
                <td>{d.count}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export interface BarItem {
  key: string;
  label: ReactNode;
  value: number;
}

/**
 * A ranked breakdown: one row per category, a bar from a shared baseline, and the number and its share written beside it. Rows past `limit` fold into "Other" instead of running on.
 */
export function BarList({ items, limit = 6, format = count, empty = "Nothing yet." }: { items: BarItem[]; limit?: number; format?: (n: number) => string; empty?: string }) {
  const sorted = [...items].sort((a, b) => b.value - a.value);
  const total = sorted.reduce((sum, item) => sum + item.value, 0);
  const head = sorted.length > limit ? sorted.slice(0, limit - 1) : sorted;
  const rest = sorted.slice(head.length);
  const rows = rest.length ? [...head, { key: "__other", label: `Other (${rest.length})`, value: rest.reduce((sum, item) => sum + item.value, 0) }] : head;
  const max = Math.max(...rows.map((r) => r.value), 1);
  if (!total) return <p className="flex flex-1 items-center justify-center py-6 text-center type-small text-muted-foreground">{empty}</p>;
  return (
    <ul className="flex flex-col gap-2.5">
      {rows.map((row) => (
        <li key={row.key} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1">
          <span className="flex min-w-0 items-center gap-2 truncate type-small">{row.label}</span>
          <span className="type-small tabular-nums">
            {format(row.value)}
            <span className="ms-2 inline-block min-w-[4ch] text-end text-muted-foreground">{Math.round((row.value / total) * 100)}%</span>
          </span>
          <span className="col-span-2 block h-1.5">
            {row.value > 0 && <span className="block h-full min-w-[3px] rounded-e-[4px] bg-chart" style={{ width: `${(row.value / max) * 100}%` }} />}
          </span>
        </li>
      ))}
    </ul>
  );
}

/** How full something is, with the number beside it. The fill turns to warning and then danger as it nears the limit, and the empty part of the track is a lighter step of the same color, so the state reads across the whole bar. */
export function Meter({ value, max, label }: { value: number; max: number; label: string }) {
  const share = max > 0 ? Math.min(value / max, 1) : 0;
  return (
    <div role="meter" aria-label={label} aria-valuemin={0} aria-valuemax={max} aria-valuenow={value} className={cn("h-1.5 w-full overflow-hidden rounded-full", share > 0.9 ? "bg-danger/15" : share > 0.75 ? "bg-warning/15" : "bg-chart/15")}>
      <div className={cn("h-full rounded-full", share > 0.9 ? "bg-danger" : share > 0.75 ? "bg-warning" : "bg-chart")} style={{ width: `${Math.max(share * 100, value > 0 ? 2 : 0)}%` }} />
    </div>
  );
}
