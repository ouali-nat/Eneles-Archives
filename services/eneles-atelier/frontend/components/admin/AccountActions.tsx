"use client";

import { useState, type ReactNode } from "react";
import { toast } from "sonner";
import { AlertDialog, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { adminAPI, type AdminMe, type AdminPlan, type AdminUserDetail } from "@/lib/api/admin";
import { cn } from "@/lib/utils";
import { count, title } from "./format";

const PLANS: AdminPlan[] = ["free", "pro", "team", "enterprise"];

type Dialog = "signOut" | "verify" | "twoFactor" | "plan" | "admin" | "email" | "status" | "delete";

/** One action: what it is, what it does, and its button, or the reason it cannot be used here. */
function Row({ name, children, action }: { name: string; children: ReactNode; action: ReactNode }) {
  return (
    <div className="flex flex-col gap-3 p-4 @min-[40rem]:flex-row @min-[40rem]:items-center @min-[40rem]:justify-between @min-[40rem]:gap-6">
      <div className="min-w-0">
        <p className="type-base font-medium">{name}</p>
        <p className="mt-0.5 type-small text-muted-foreground">{children}</p>
      </div>
      <div className="shrink-0">{action}</div>
    </div>
  );
}

/**
 * The actions an administrator can take on one account, at the bottom of its page. Each opens a dialog that says what will happen before anything does, and the API writes each to the audit log.
 *
 * Who may do what (the API enforces the same rules): every administrator can sign an account out everywhere, mark its email verified, turn off its two-factor sign-in, change its plan, and disable or enable it. Only the root administrator can change an email address, delete an account, make or remove an administrator, or act on another administrator's account. Nobody can act on the root account or on their own account from here.
 */
export function AccountActions({ detail, me, onChanged, onDeleted }: { detail: AdminUserDetail; me: AdminMe; onChanged: () => void | Promise<void>; onDeleted: () => void }) {
  const u = detail.user;
  const [open, setOpen] = useState<Dialog | null>(null);
  const [busy, setBusy] = useState(false);
  const [plan, setPlan] = useState<AdminPlan>(u.subscriptionType as AdminPlan);
  const [email, setEmail] = useState("");
  const [confirm, setConfirm] = useState("");
  const suspended = u.accountStatus === "suspended";

  // Why nothing, or only some things, can be done here. The API refuses the same cases.
  const locked = u.root ? "This is the root administrator's account. It cannot be changed from the panel." : u.id === me.id ? "This is your own account. Change it from the site's Settings page instead." : u.accountStatus === "deleted" ? "This account has been deleted. Its data is erased after the grace period." : u.isAdmin && !me.root ? "Only the root administrator can change another administrator's account." : null;
  const rootOnly = me.root ? null : "Only the root administrator can do this.";

  const show = (dialog: Dialog) => {
    setPlan(u.subscriptionType as AdminPlan);
    setEmail("");
    setConfirm("");
    setOpen(dialog);
  };

  async function run(task: () => Promise<unknown>, done: string, after: () => void | Promise<void> = onChanged) {
    setBusy(true);
    try {
      await task();
      toast.success(done);
      setOpen(null);
      await after();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not do this. Try again.");
    } finally {
      setBusy(false);
    }
  }

  const button = (dialog: Dialog, label: string, options: { disabled?: string | boolean | null; danger?: boolean } = {}) => (
    <Button variant={options.danger ? "destructive" : "outline"} disabled={!!locked || !!options.disabled} onClick={() => show(dialog)} className="w-full @min-[40rem]:w-auto">
      {label}
    </Button>
  );
  const note = (text: string | null | false | undefined) => (text ? <span className="mt-1 block text-foreground">{text}</span> : null);

  const live = detail.liveSessions;
  const sessions = `${count(live)} live ${live === 1 ? "session" : "sessions"}`;

  return (
    <section aria-labelledby="account-actions" className="flex flex-col gap-3">
      <div>
        <h2 id="account-actions" className="text-lg font-semibold">
          Account actions
        </h2>
        <p className="mt-1 type-base text-muted-foreground">Each asks before it does anything, and is written to the audit log under your name.</p>
      </div>
      {locked && <p className="rounded-[var(--radius-card)] border border-line bg-card px-4 py-3 type-base">{locked}</p>}
      <div className={cn("divide-y divide-line rounded-[var(--radius-card)] border border-line bg-card", locked && "opacity-60")}>
        <Row name="Sign out everywhere" action={button("signOut", "Sign out everywhere")}>
          Ends every session ({sessions}) and closes any editor they have open. They can sign in again straight away.
        </Row>
        <Row name="Email verification" action={button("verify", "Mark verified", { disabled: u.verified })}>
          {u.verified ? "The address is verified." : "The address has not been verified. Mark it verified if you have confirmed it some other way."}
        </Row>
        <Row name="Two-factor sign-in" action={button("twoFactor", "Turn off", { disabled: !u.twoFactorEnabled })}>
          {u.twoFactorEnabled ? "On. Turn it off for someone who has lost their authenticator; they then sign in with the emailed code alone." : "Off for this account."}
        </Row>
        <Row name="Plan" action={button("plan", "Change plan")}>
          On the {title(u.subscriptionType)} plan. A change here is a courtesy on the account only and does not touch Stripe.
        </Row>
        <Row name="Administrator" action={button("admin", u.isAdmin ? "Remove administrator" : "Make administrator", { disabled: rootOnly })}>
          {u.isAdmin ? "Can open this panel." : "Cannot open this panel."}
          {note(rootOnly)}
        </Row>
        <Row name="Email address" action={button("email", "Change email", { disabled: rootOnly })}>
          {u.email}. Changing it signs the account out everywhere.
          {note(rootOnly)}
        </Row>
        <Row name={suspended ? "Enable account" : "Disable account"} action={button("status", suspended ? "Enable account" : "Disable account", { danger: !suspended })}>
          {suspended ? "This account is disabled: it cannot sign in. Enabling it lets it sign in again." : "Stops the account from signing in and ends its sessions now. Nothing is deleted, and you can enable it again."}
        </Row>
        <Row name="Delete account" action={button("delete", "Delete account", { danger: true, disabled: rootOnly })}>
          The same as deleting it from its own Settings page: the subscription ends now, and its data is erased after the grace period.
          {note(rootOnly)}
        </Row>
      </div>

      <AlertDialog open={open !== null} onOpenChange={(next) => !next && !busy && setOpen(null)}>
        <AlertDialogContent>
          {open === "signOut" && (
            <Confirm title={`Sign ${u.name} out everywhere?`} busy={busy} confirm="Sign out everywhere" onCancel={() => setOpen(null)} onConfirm={() => run(() => adminAPI.signOutEverywhere(u.id), `${u.name} is signed out everywhere.`)}>
              This ends {sessions} at once and closes any editor they have open. Nothing else changes, and they can sign in again with a new code.
            </Confirm>
          )}
          {open === "verify" && (
            <Confirm title={`Mark ${u.email} verified?`} busy={busy} confirm="Mark verified" onCancel={() => setOpen(null)} onConfirm={() => run(() => adminAPI.markVerified(u.id), "The address is marked verified.")}>
              The account is treated as if its owner had entered a code sent to this address. Do this only if you have confirmed the address some other way.
            </Confirm>
          )}
          {open === "twoFactor" && (
            <Confirm title="Turn off two-factor sign-in?" busy={busy} confirm="Turn off" onCancel={() => setOpen(null)} onConfirm={() => run(() => adminAPI.disableTwoFactor(u.id), "Two-factor sign-in is off for this account.")}>
              Their authenticator app stops being asked for: the next sign-in needs only the code emailed to {u.email}. They can turn it on again in Settings. Do this only once you are sure the request comes from the account&apos;s owner.
            </Confirm>
          )}
          {open === "plan" && (
            <Confirm
              title={`Change ${u.name}'s plan`}
              busy={busy}
              confirm="Change plan"
              disabled={plan === u.subscriptionType}
              onCancel={() => setOpen(null)}
              onConfirm={() => run(() => adminAPI.setPlan(u.id, plan), `${u.name} is now on the ${title(plan)} plan.`)}
              body={
                <div className="flex flex-col gap-2">
                  <Label htmlFor="admin-plan">Plan</Label>
                  <Select value={plan} onValueChange={(v) => setPlan(v as AdminPlan)}>
                    <SelectTrigger id="admin-plan" className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {PLANS.map((p) => (
                        <SelectItem key={p} value={p}>
                          {title(p)}
                          {p === u.subscriptionType ? " (current)" : ""}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              }
            >
              This changes the plan on the account only, as a courtesy. Stripe is not told: nothing is charged, refunded, or canceled, and a paid subscription keeps billing as before. Stripe may set the plan again when it next reports on a subscription.
            </Confirm>
          )}
          {open === "admin" && (
            <Confirm
              title={u.isAdmin ? `Remove ${u.name} as an administrator?` : `Make ${u.name} an administrator?`}
              busy={busy}
              confirm={u.isAdmin ? "Remove administrator" : "Make administrator"}
              onCancel={() => setOpen(null)}
              onConfirm={() => run(() => adminAPI.setAdmin(u.id, !u.isAdmin), u.isAdmin ? `${u.name} is no longer an administrator.` : `${u.name} is now an administrator.`)}
            >
              {u.isAdmin ? "They lose access to this panel on their next request." : "They can open this panel, see every account's metadata and usage, and disable accounts, sign them out, and change their plans. They cannot delete accounts, change addresses, or make administrators."}
            </Confirm>
          )}
          {open === "email" && (
            <Confirm
              title="Change the email address"
              busy={busy}
              confirm="Change email"
              disabled={!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()) || email.trim().toLowerCase() === u.email.toLowerCase()}
              onCancel={() => setOpen(null)}
              onConfirm={() => run(() => adminAPI.changeEmail(u.id, email.trim()), `The address is now ${email.trim().toLowerCase()}.`)}
              body={
                <div className="flex flex-col gap-2">
                  <Label htmlFor="admin-email-new">New address</Label>
                  <Input id="admin-email-new" type="email" autoComplete="off" value={email} onChange={(e) => setEmail(e.target.value)} placeholder={u.email} />
                </div>
              }
            >
              The account signs in with the new address from now on, and is signed out everywhere ({sessions}), since each session carries the old one. No email is sent to either address, so make sure the new one is right.
            </Confirm>
          )}
          {open === "status" &&
            (suspended ? (
              <Confirm title={`Enable ${u.name}'s account?`} busy={busy} confirm="Enable account" onCancel={() => setOpen(null)} onConfirm={() => run(() => adminAPI.setStatus(u.id, "active"), `${u.name}'s account is enabled.`)}>
                They can sign in again with a code sent to {u.email}. Their projects and files were never touched.
              </Confirm>
            ) : (
              <Confirm title={`Disable ${u.name}'s account?`} busy={busy} danger confirm="Disable account" onCancel={() => setOpen(null)} onConfirm={() => run(() => adminAPI.setStatus(u.id, "suspended"), `${u.name}'s account is disabled.`)}>
                They are signed out everywhere now ({sessions}), cannot sign in, and their API keys stop working. Signing in shows them that the account was disabled by an administrator. Nothing is deleted, and you can enable the account again from this page.
              </Confirm>
            ))}
          {open === "delete" && (
            <Confirm
              title={`Delete ${u.name}'s account?`}
              busy={busy}
              danger
              confirm="Delete account"
              disabled={confirm.trim().toLowerCase() !== u.email.toLowerCase()}
              onCancel={() => setOpen(null)}
              onConfirm={() => run(() => adminAPI.deleteUser(u.id, confirm.trim()), `${u.name}'s account is deleted.`, onDeleted)}
              body={
                <div className="flex flex-col gap-2">
                  <Label htmlFor="admin-delete-confirm">
                    Type <span className="font-mono">{u.email}</span> to confirm
                  </Label>
                  <Input id="admin-delete-confirm" autoComplete="off" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
                </div>
              }
            >
              This is what the person&apos;s own &ldquo;Delete account&rdquo; does. A paid subscription is canceled on Stripe now, every session and API key ends, and the account can no longer sign in. Its projects, files, snips, and PDFs are erased for good after the grace period. There is no way to undo this from the panel.
            </Confirm>
          )}
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}

/** The inside of one action's dialog: what will happen, any field it needs, and Cancel beside the action. */
function Confirm({ title: heading, children, body, confirm, danger = false, disabled = false, busy, onConfirm, onCancel }: { title: string; children: ReactNode; body?: ReactNode; confirm: string; danger?: boolean; disabled?: boolean; busy: boolean; onConfirm: () => void; onCancel: () => void }) {
  return (
    <form
      className="flex flex-col gap-5"
      onSubmit={(event) => {
        event.preventDefault();
        if (!disabled && !busy) onConfirm();
      }}
    >
      <AlertDialogHeader>
        <AlertDialogTitle>{heading}</AlertDialogTitle>
        <AlertDialogDescription className="type-base">{children}</AlertDialogDescription>
      </AlertDialogHeader>
      {body}
      <AlertDialogFooter>
        <Button type="button" variant="outline" disabled={busy} onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" variant={danger ? "destructive" : "default"} disabled={disabled || busy}>
          {busy ? "Working" : confirm}
        </Button>
      </AlertDialogFooter>
    </form>
  );
}
