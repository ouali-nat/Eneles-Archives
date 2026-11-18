"use client";

import { useId, useState } from "react";
import { toast } from "sonner";
import { AlertTriangle, Trash2 } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/status";
import { usersAPI } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";

/** What deleting does, and when, as the API and the daily cleanup do it (backend/src/users/users.service.ts). */
const NOW = "You are signed out on every device, and your Atelier sessions and API keys stop working.";
const LATER = "Your projects (including the ones you share), snips, PDFs, and uploaded files are erased for good. Comments you left on other people's projects stay, under the name Deleted user.";

/**
 * Deleting the account, the same on Profile and Settings. At rest it is one line and one button in a faintly tinted card, so it is found but never shouts. The confirmation says exactly what happens now and what happens in 30 days, and keeps its delete button locked until the account's email address is typed. Clicking outside does not close it; Cancel and Escape do.
 */
export function DeleteAccount() {
  const { user, logout } = useAuth();
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState("");
  const id = useId();
  const email = user?.email ?? "";
  const confirmed = !!email && typed.trim().toLowerCase() === email.toLowerCase();

  const close = () => {
    if (deleting) return;
    setOpen(false);
    setTyped("");
    setError("");
  };

  const remove = async () => {
    if (!confirmed || deleting) return;
    setDeleting(true);
    setError("");
    try {
      await usersAPI.deleteAccount();
      setOpen(false);
      toast.success("Your account is deleted");
      logout();
    } catch (e) {
      setError(e instanceof Error && e.message ? e.message : "The account could not be deleted. Try again in a minute.");
    } finally {
      setDeleting(false);
    }
  };

  return (
    <section
      aria-labelledby={`${id}-title`}
      className="flex flex-wrap items-center justify-between gap-4 rounded-[var(--radius-surface)] border border-[color-mix(in_oklch,var(--danger)_35%,var(--line))] bg-[color-mix(in_oklch,var(--danger)_5%,var(--card))] p-5"
    >
      <div className="flex min-w-0 flex-1 basis-72 flex-col gap-1">
        <h2 id={`${id}-title`} className="type-large font-semibold text-danger">
          Delete account
        </h2>
        <p className="type-base text-muted-foreground">Closes your account now and erases everything in it after 30 days.</p>
      </div>
      <Button variant="destructive" className="shrink-0" onClick={() => setOpen(true)}>
        <Trash2 />
        Delete account
      </Button>

      <Dialog open={open} onOpenChange={(next) => (next ? setOpen(true) : close())}>
        <DialogContent className="@min-[40rem]:max-w-md" onInteractOutside={(event) => event.preventDefault()}>
          <DialogHeader>
            <DialogTitle>Delete your account?</DialogTitle>
            <DialogDescription className="sr-only">Your account closes now and everything in it is erased after 30 days.</DialogDescription>
          </DialogHeader>
          <form
            className="flex flex-col gap-4"
            onSubmit={(event) => {
              event.preventDefault();
              void remove();
            }}
          >
            <div id={`${id}-warning`} className="flex gap-3 rounded-[var(--radius-card)] border border-[color-mix(in_oklch,var(--danger)_35%,var(--line))] bg-[color-mix(in_oklch,var(--danger)_7%,var(--panel))] p-3">
              <AlertTriangle aria-hidden className="mt-0.5 size-4 shrink-0 text-danger" />
              <div className="flex min-w-0 flex-col gap-2 type-base">
              <dl className="flex flex-col gap-2">
                <div>
                  <dt className="font-medium">Now</dt>
                  <dd className="text-muted-foreground">{NOW}</dd>
                </div>
                <div>
                  <dt className="font-medium">In 30 days</dt>
                  <dd className="text-muted-foreground">{LATER}</dd>
                </div>
              </dl>
              <p className="text-muted-foreground">There is no way back after that. Signing up again with this address starts a new, empty account.</p>
              </div>
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor={`${id}-confirm`} className="type-base">
                Type <code className="rounded-[var(--radius-inset)] bg-surface px-1.5 py-px font-mono text-[0.92em]">{email}</code> to confirm
              </label>
              <Input
                id={`${id}-confirm`}
                type="email"
                value={typed}
                onChange={(event) => setTyped(event.target.value)}
                placeholder={email}
                autoComplete="off"
                autoCapitalize="none"
                spellCheck={false}
                autoFocus
                aria-invalid={error ? true : undefined}
                aria-describedby={`${id}-warning${error ? ` ${id}-error` : ""}`}
              />
              {error && (
                <p id={`${id}-error`} className="type-small text-danger" role="alert">
                  {error}
                </p>
              )}
            </div>
            <DialogFooter className="mt-1">
              <Button type="button" variant="ghost" disabled={deleting} onClick={close}>
                Cancel
              </Button>
              <Button type="submit" variant="destructive" disabled={!confirmed || deleting}>
                {deleting ? <Spinner /> : <Trash2 />}
                Delete account
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </section>
  );
}
