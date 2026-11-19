/**
 * A text cut into lines the way the editor's diff view (the `diff` package's line diff) cuts it: each line keeps its newline, so a newline added or removed at the very end counts as a change to the last line. Counting the same way here keeps the "+n −m" a timeline row shows equal to what the change shows when opened.
 */
export function lineTokens(text: string): string[] {
  if (!text) return [];
  return text.match(/[^\n]*\n|[^\n]+$/g) ?? [];
}

/** How much work the exact count may do before it settles for the quick estimate (see lineChangeCounts). */
const DEFAULT_BUDGET = 4_000_000;

/**
 * Lines added and removed from `before` to `after`, as a minimal line diff counts them. The common start and end are set aside first, so a small change in a long file costs almost nothing; the middle is measured with Myers' algorithm. A middle so different that the exact count would take too long (a whole file replaced) is estimated instead from which lines the two sides share, which can count a moved line as unchanged: the estimate is never higher than the truth.
 */
export function lineChangeCounts(
  before: string,
  after: string,
  budget = DEFAULT_BUDGET,
): { added: number; removed: number } {
  const a = lineTokens(before);
  const b = lineTokens(after);
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA--;
    endB--;
  }
  const n = endA - start;
  const m = endB - start;
  if (n === 0 || m === 0) return { added: m, removed: n };

  const d = editDistance(a.slice(start, endA), b.slice(start, endB), budget);
  if (d !== null) return { added: (d + m - n) / 2, removed: (d - m + n) / 2 };

  // Over budget: every line of the old middle that has no partner in the new one was removed, and the rest of the new middle was added.
  const left = new Map<string, number>();
  for (const line of a.slice(start, endA))
    left.set(line, (left.get(line) ?? 0) + 1);
  let shared = 0;
  for (const line of b.slice(start, endB)) {
    const count = left.get(line) ?? 0;
    if (count > 0) {
      shared++;
      left.set(line, count - 1);
    }
  }
  return { added: m - shared, removed: n - shared };
}

/** The fewest lines inserted plus deleted to turn `a` into `b` (Myers, 1986), or null when that takes more than `budget` steps. */
function editDistance(a: string[], b: string[], budget: number): number | null {
  const n = a.length;
  const m = b.length;
  const max = n + m;
  const offset = max + 1;
  const v = new Int32Array(2 * max + 3);
  let work = 0;
  for (let d = 0; d <= max; d++) {
    for (let k = -d; k <= d; k += 2) {
      let x =
        k === -d || (k !== d && v[offset + k - 1] < v[offset + k + 1])
          ? v[offset + k + 1]
          : v[offset + k - 1] + 1;
      let y = x - k;
      while (x < n && y < m && a[x] === b[y]) {
        x++;
        y++;
        work++;
      }
      v[offset + k] = x;
      if (x >= n && y >= m) return d;
    }
    work += d + 1;
    if (work > budget) return null;
  }
  return max;
}
