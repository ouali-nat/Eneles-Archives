"use client";

import { use } from "react";
import { dateTime } from "@/components/admin/format";
import { AdminLink, Facts, LoadState, useAdminData } from "@/components/admin/parts";
import { PageHeader, SectionHeading } from "@/components/essential/layout/PageHeader";
import { ArrowLeft } from "@/components/icons";
import { RelativeTime } from "@/components/ui/time";
import { adminAPI } from "@/lib/api/admin";
import { EmailStatusPill, eventWords, kindWords } from "../email-status";

/** One email and every event Resend reported for it, oldest first. */
export default function AdminEmailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { data, error, loading } = useAdminData(() => adminAPI.email(Number(id)), id);

  return (
    <>
      <AdminLink to="/emails" className="inline-flex h-[var(--control-height)] w-fit items-center gap-1.5 type-base text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4 rtl:-scale-x-100" />
        Email
      </AdminLink>
      <LoadState error={error} loading={loading} has={!!data} />
      {data && (
        <>
          <PageHeader title={data.recipients.join(", ") || "Email"} description={data.subject ?? "The subject of a sign-in email is not kept."} actions={<EmailStatusPill status={data.status} />} />
          <Facts
            items={[
              { label: "Kind", value: kindWords(data.kind) },
              { label: "From", value: data.sender ?? "Unknown" },
              { label: "Sent", value: dateTime(data.createdAt) },
              { label: "Delivered", value: data.deliveredAt ? dateTime(data.deliveredAt) : "Not yet" },
              { label: "Opened", value: data.openedAt ? dateTime(data.openedAt) : "Not yet" },
              ...(data.bouncedAt ? [{ label: "Bounced", value: `${dateTime(data.bouncedAt)}${data.bounceType ? `, ${data.bounceType}` : ""}` }] : []),
              ...(data.bounceMessage ? [{ label: "Reason", value: data.bounceMessage }] : []),
              { label: "Resend id", value: <span className="font-mono type-small">{data.resendId}</span> },
            ]}
          />
          <SectionHeading title="Events" description="As Resend reported them, oldest first." />
          {data.events.length === 0 ? (
            <p className="type-base text-muted-foreground">No event has come in for this email yet.</p>
          ) : (
            <ol className="flex flex-col">
              {data.events.map((event) => (
                <li key={event.id} className="flex min-h-11 items-center gap-3 border-t border-line py-2 first:border-t-0">
                  <span className="w-40 shrink-0 type-base font-medium">{eventWords(event.type)}</span>
                  <span className="min-w-0 flex-1 truncate type-base text-muted-foreground">{event.detail ? Object.values(event.detail).join(", ") : ""}</span>
                  <RelativeTime value={event.occurredAt} className="shrink-0 type-small text-muted-foreground" />
                </li>
              ))}
            </ol>
          )}
        </>
      )}
    </>
  );
}
