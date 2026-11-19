/** Numbers, sizes, money, and times as the admin panel writes them. One place, so every table agrees. */

const whole = new Intl.NumberFormat("en-US");
const short = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 });

/** 1,284 in full below ten thousand, then 12.9K and 4.2M. */
export function count(n: number): string {
  return Math.abs(n) < 10_000 ? whole.format(n) : short.format(n);
}

export function bytes(n: number | null | undefined): string {
  if (!n) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.min(Math.floor(Math.log(n) / Math.log(1024)), units.length - 1);
  const value = n / 1024 ** i;
  // "4 MB" rather than "4.0 MB", so round axis ticks read as round.
  return `${value >= 100 || i === 0 ? Math.round(value) : Number(value.toFixed(1))} ${units[i]}`;
}

/** Whole units without cents, for an axis: "$40", "$1.2K". */
export function moneyShort(cents: number, currency = "usd"): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: currency.toUpperCase(), notation: cents >= 1_000_000 ? "compact" : "standard", maximumFractionDigits: cents >= 1_000_000 ? 1 : 0 }).format(cents / 100);
}

export function money(cents: number, currency = "usd"): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: currency.toUpperCase() }).format(cents / 100);
}

export function duration(seconds: number): string {
  if (seconds < 60) return `${Math.round(seconds)} s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)} min`;
  if (seconds < 86_400) return `${Math.floor(seconds / 3600)} h ${Math.floor((seconds % 3600) / 60)} min`;
  return `${Math.floor(seconds / 86_400)} d ${Math.floor((seconds % 86_400) / 3600)} h`;
}

const dateOnly = new Intl.DateTimeFormat("en-US", { year: "numeric", month: "short", day: "numeric" });
const dateAndTime = new Intl.DateTimeFormat("en-US", { year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
const dayOnly = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

export const date = (value: string | Date) => dateOnly.format(new Date(value));
export const dateTime = (value: string | Date) => dateAndTime.format(new Date(value));
/** A day key from the API ("2026-11-10", UTC) as "Nov 10". */
export const day = (key: string) => dayOnly.format(new Date(`${key}T00:00:00Z`));
const monthOnly = new Intl.DateTimeFormat("en-US", { month: "short", year: "numeric", timeZone: "UTC" });
/** A month key from the API ("2026-11") as "Nov 2026". */
export const month = (key: string) => monthOnly.format(new Date(`${key}-01T00:00:00Z`));

let regions: Intl.DisplayNames | null = null;

/** "CH" as "Switzerland". */
export function countryName(code: string | null | undefined): string {
  if (!code || !/^[A-Z]{2}$/.test(code)) return "Unknown";
  try {
    regions ??= new Intl.DisplayNames(["en"], { type: "region" });
    return regions.of(code) ?? code;
  } catch {
    return code;
  }
}

/** "pro" as "Pro". */
export const title = (word: string) => (word ? word[0].toUpperCase() + word.slice(1).replace(/_/g, " ") : word);
