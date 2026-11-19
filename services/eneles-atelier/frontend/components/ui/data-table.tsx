"use client";

import { useMemo, useState, type ReactNode } from "react";
import { ArrowUp } from "@/components/icons";
import { SkeletonText } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

/*
 * The one table for records, across the app and the admin panel. Every column header is a button that sorts by that column: the first press sorts in the column's natural direction (text from A, numbers and times from the largest), a second press reverses it, and the header shows the direction with an arrow and in `aria-sort`.
 *
 * A table whose rows are all on the page sorts them itself, by each column's `sortValue`: numbers as numbers, times as times, text in alphabetical order with numbers inside it read as numbers, and empty values last whichever the direction. A table over a list the server pages passes `sort` and `onSortChange` instead, and asks the server for the rows in that order.
 */

export type SortDirection = "asc" | "desc";
export interface TableSort {
  column: string;
  direction: SortDirection;
}
export type SortValue = string | number | boolean | Date | null | undefined;

export interface Column<T> {
  id: string;
  header: string;
  cell: (row: T) => ReactNode;
  /** What the column sorts by when the table sorts its own rows. Return a Date (or use `asTime`) for a time, so it sorts as a time and not as text. */
  sortValue?: (row: T) => SortValue;
  /** Off for a column with nothing to order by, such as a column of buttons. On by default. */
  sortable?: boolean;
  /** The direction of the first press. Worked out from the values when the table sorts its own rows; ascending otherwise. */
  firstDirection?: SortDirection;
  align?: "start" | "end";
  /** Classes for this column's cells, header included. */
  className?: string;
  /** Hides the header's text but keeps it for screen readers (a column of row actions). */
  hideHeader?: boolean;
}

/** An ISO time from an API as a Date, for `sortValue`; empty stays empty, so it sorts last. */
export const asTime = (value: string | number | Date | null | undefined): Date | null => (value === null || value === undefined || value === "" ? null : new Date(value));

const collator = new Intl.Collator("en", { numeric: true, sensitivity: "base" });
const isEmpty = (value: SortValue) => value === null || value === undefined || value === "" || (value instanceof Date && Number.isNaN(value.getTime()));

function compare(a: SortValue, b: SortValue): number {
  if (typeof a === "number" && typeof b === "number") return a - b;
  if (a instanceof Date && b instanceof Date) return a.getTime() - b.getTime();
  if (typeof a === "boolean" && typeof b === "boolean") return Number(a) - Number(b);
  return collator.compare(String(a), String(b));
}

/** Rows ordered by one column; equal rows keep their order, and empty values go last in both directions. */
export function sortRows<T>(rows: T[], value: (row: T) => SortValue, direction: SortDirection): T[] {
  const sign = direction === "asc" ? 1 : -1;
  return rows
    .map((row, index) => ({ row, index, value: value(row) }))
    .sort((a, b) => {
      const emptyA = isEmpty(a.value);
      const emptyB = isEmpty(b.value);
      if (emptyA || emptyB) return emptyA === emptyB ? a.index - b.index : emptyA ? 1 : -1;
      return compare(a.value, b.value) * sign || a.index - b.index;
    })
    .map((entry) => entry.row);
}

/** Widths, as shares of their cell, the placeholder bars cycle through, so a column of them does not look ruled. Shares, not lengths, so the bars never widen the table past its frame: the columns keep the header's widths. */
const PLACEHOLDER_WIDTHS = [70, 50, 85, 60, 40, 75];

export function DataTable<T>({
  columns,
  rows,
  rowKey,
  label,
  sort: controlledSort,
  onSortChange,
  defaultSort = null,
  empty = "Nothing to show.",
  busy = false,
  loading = false,
  framed = true,
  rowClassName,
  className,
}: {
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T) => string | number;
  /** What the table lists, for screen readers: "Sessions", "Payments". */
  label: string;
  /** The order the server returned the rows in. With `onSortChange`, the table does not sort them itself. */
  sort?: TableSort | null;
  onSortChange?: (sort: TableSort) => void;
  defaultSort?: TableSort | null;
  empty?: ReactNode;
  /** A newer answer is on its way: the rows dim and stay in place. */
  busy?: boolean;
  /** The first answer is on its way and there are no rows yet: the real header over this many rows of placeholders at the rows' own height (true is five). */
  loading?: boolean | number;
  /** Draws the bordered card around the table. Off when the table already sits in a card. */
  framed?: boolean;
  rowClassName?: (row: T) => string | undefined;
  className?: string;
}) {
  const [ownSort, setOwnSort] = useState<TableSort | null>(defaultSort);
  const server = !!onSortChange;
  const sort = server ? (controlledSort ?? null) : ownSort;

  const firstDirection = (column: Column<T>): SortDirection => {
    if (column.firstDirection) return column.firstDirection;
    if (server || !column.sortValue) return "asc";
    const sample = rows.map(column.sortValue).find((v) => !isEmpty(v));
    return typeof sample === "string" ? "asc" : sample === undefined ? "asc" : "desc";
  };

  const press = (column: Column<T>) => {
    const next: TableSort = sort?.column === column.id ? { column: column.id, direction: sort.direction === "asc" ? "desc" : "asc" } : { column: column.id, direction: firstDirection(column) };
    if (server) onSortChange(next);
    else setOwnSort(next);
  };

  const placeholders = rows.length === 0 && loading ? (loading === true ? 5 : loading) : 0;

  const shown = useMemo(() => {
    if (server || !sort) return rows;
    const column = columns.find((c) => c.id === sort.column);
    return column?.sortValue ? sortRows(rows, column.sortValue, sort.direction) : rows;
  }, [server, sort, rows, columns]);

  return (
    <div className={cn("data-table min-w-0 overflow-x-auto", framed && "rounded-[var(--radius-card)] border border-line bg-card", className)}>
      <table className={cn("w-full border-collapse type-base transition-opacity", busy && placeholders === 0 && "opacity-60")} aria-busy={busy || placeholders > 0 || undefined}>
        <caption className="sr-only">{label}</caption>
        <thead>
          <tr className="border-b border-line">
            {columns.map((column, index) => {
              const sortable = column.sortable !== false && (server || !!column.sortValue);
              const direction = sort?.column === column.id ? sort.direction : null;
              const end = column.align === "end";
              // The arrow of an unsorted header previews the direction a press would sort.
              const arrow = direction ?? firstDirection(column);
              return (
                <th key={column.id} scope="col" aria-sort={direction ? (direction === "asc" ? "ascending" : "descending") : sortable ? "none" : undefined} className={cn("data-table-head h-10 p-0 font-medium whitespace-nowrap", end ? "text-end" : "text-start", column.className)}>
                  {sortable ? (
                    <button
                      type="button"
                      onClick={() => press(column)}
                      data-sorted={direction ?? undefined}
                      className={cn(
                        "group/sort flex h-10 w-full items-center px-3 font-medium text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:text-foreground focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-inset data-[sorted]:text-foreground",
                        end ? "justify-end text-end" : "text-start",
                        // At the table's edge there is no neighbour's padding to hang the arrow in.
                        !end && index === columns.length - 1 && "pe-8",
                        end && index === 0 && "ps-8",
                      )}
                    >
                      {/* The arrow hangs in the padding beside the label (after it, or before it in a column of numbers), so it takes no width and the columns stay as narrow as their contents. */}
                      <span className="relative">
                        <span className={cn(column.hideHeader && "sr-only")}>{column.header}</span>
                        <ArrowUp
                          aria-hidden
                          className={cn(
                            "absolute top-1/2 size-4 -translate-y-1/2 transition-[opacity,rotate]",
                            end ? "end-full me-1" : "start-full ms-1",
                            arrow === "desc" && "rotate-180",
                            direction ? "opacity-100" : "opacity-0 group-hover/sort:opacity-50 group-focus-visible/sort:opacity-50 [@media(pointer:coarse)]:opacity-40",
                          )}
                        />
                      </span>
                    </button>
                  ) : (
                    <span className={cn("flex h-10 items-center px-3 text-muted-foreground", end && "justify-end", column.hideHeader && "[&>span]:sr-only")}>
                      <span>{column.header}</span>
                    </span>
                  )}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {shown.map((row) => (
            <tr key={rowKey(row)} className={cn("border-b border-line transition-colors last:border-0 hover:bg-surface/50", rowClassName?.(row))}>
              {columns.map((column) => (
                <td key={column.id} className={cn("h-11 px-3 whitespace-nowrap", column.align === "end" && "text-end tabular-nums", column.className)}>
                  {column.cell(row)}
                </td>
              ))}
            </tr>
          ))}
          {placeholders > 0 &&
            Array.from({ length: placeholders }, (_, i) => (
              <tr key={`placeholder-${i}`} aria-hidden className="border-b border-line last:border-0">
                {columns.map((column, c) => (
                  <td key={column.id} className={cn("h-11 px-3", column.className)}>
                    <SkeletonText className={cn("type-base", column.align === "end" && "justify-end")} width={column.hideHeader ? "2rem" : `${PLACEHOLDER_WIDTHS[(i + c) % PLACEHOLDER_WIDTHS.length]}%`} />
                  </td>
                ))}
              </tr>
            ))}
        </tbody>
      </table>
      {placeholders > 0 && <span role="status" className="sr-only">Loading {label.toLowerCase()}</span>}
      {/* The empty sentence sits in the middle of the table's body, both ways. */}
      {rows.length === 0 && placeholders === 0 && <div className="flex min-h-36 flex-col items-center justify-center gap-3 px-6 py-8 text-center type-base text-muted-foreground">{empty}</div>}
    </div>
  );
}
