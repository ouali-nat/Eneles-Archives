import { Pill } from "@/components/admin/parts";
import type { EmailStatus } from "@/lib/api/admin";

/** Each status in words, with its tone: delivery is good, a delay is a warning, anything that did not arrive is bad. */
export const STATUS_WORDS: Record<EmailStatus, string> = {
  sent: "Sent",
  delivery_delayed: "Delayed",
  delivered: "Delivered",
  opened: "Opened",
  clicked: "Clicked",
  failed: "Failed",
  bounced: "Bounced",
  complained: "Marked as spam",
};

const TONE: Record<EmailStatus, "neutral" | "good" | "warn" | "bad" | "muted"> = {
  sent: "muted",
  delivery_delayed: "warn",
  delivered: "good",
  opened: "good",
  clicked: "good",
  failed: "bad",
  bounced: "bad",
  complained: "bad",
};

export function EmailStatusPill({ status }: { status: EmailStatus }) {
  return <Pill tone={TONE[status] ?? "muted"}>{STATUS_WORDS[status] ?? status}</Pill>;
}

/** An event's type ("email.delivery_delayed") in words. */
export function eventWords(type: string): string {
  const key = type.replace(/^email\./, "") as EmailStatus;
  return STATUS_WORDS[key] ?? key.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());
}

/** A kind in sentence case. */
export const kindWords = (kind: string) => kind.charAt(0).toUpperCase() + kind.slice(1);
