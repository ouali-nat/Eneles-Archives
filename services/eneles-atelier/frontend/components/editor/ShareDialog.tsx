"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Mail, X } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { CopyButton } from "@/components/ui/copy-button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Spinner } from "@/components/ui/status";
import { projectsAPI, type ProjectCollaborator, type ProjectCollaboratorUser, type ProjectInvitation } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { Avatar } from "@/components/people/Avatar";

type Role = "viewer" | "editor";
type Access = "private" | "view" | "edit";

interface ShareDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectUid: string;
  projectTitle: string;
  isOwner: boolean;
  collaborators: ProjectCollaborator[];
  pendingInvitations: ProjectInvitation[];
  onCollaboratorsChange: () => void;
  initialAccess?: Access;
}

const ROLE_LABEL: Record<Role, string> = { viewer: "Can view", editor: "Can edit" };


/**
 * Who can open a project, in three parts: invite someone (the owner only), the people on it with their roles, and link sharing. There is no visible title: the dialog is opened from "Share" and says what it is by its content; the title exists for assistive technology.
 *
 * The owner shown is the project's real owner, which the dialog asks the server for when it opens, together with the current link-sharing setting, so it is right for a collaborator looking at someone else's project too.
 */
export function ShareDialog({ open, onOpenChange, projectUid, projectTitle, isOwner, collaborators, pendingInvitations, onCollaboratorsChange, initialAccess = "private" }: ShareDialogProps) {
  const { user } = useAuth();
  const [owner, setOwner] = useState<ProjectCollaboratorUser | null>(null);
  const [access, setAccess] = useState<Access>(initialAccess);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Role>("editor");
  const [sending, setSending] = useState(false);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    projectsAPI
      .getCollaborators(projectUid)
      .then((data) => {
        if (cancelled) return;
        setOwner(data.owner);
        setAccess(data.access);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [open, projectUid]);

  const act = useCallback(
    async (work: () => Promise<unknown>, failure: string, success?: string) => {
      try {
        await work();
        if (success) toast.success(success);
        onCollaboratorsChange();
      } catch (err) {
        toast.error(err instanceof Error && err.message ? err.message : failure);
      }
    },
    [onCollaboratorsChange],
  );

  const invite = async (e: React.FormEvent) => {
    e.preventDefault();
    const address = email.trim();
    if (!address || sending) return;
    setSending(true);
    await act(async () => {
      await projectsAPI.inviteCollaborator(projectUid, address, role);
      setEmail("");
    }, "The invitation could not be sent.", `Invitation sent to ${address}`);
    setSending(false);
  };

  const changeAccess = async (next: Access) => {
    const previous = access;
    setAccess(next);
    try {
      await projectsAPI.updateProject(projectUid, { access: next });
    } catch (err) {
      setAccess(previous);
      toast.error(err instanceof Error && err.message ? err.message : "Link sharing could not be changed.");
    }
  };

  // The owner is one person; never list them a second time as a collaborator.
  const others = collaborators.filter((c) => c.userId !== owner?.id);
  const count = (owner ? 1 : 0) + others.length;
  const row = "flex items-center gap-3 px-5 py-2.5";
  const avatar = "grid size-8 shrink-0 place-items-center rounded-full bg-surface type-small font-medium";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="gap-0 overflow-hidden p-0">
        <DialogTitle className="sr-only">Share {projectTitle}</DialogTitle>
        <DialogDescription className="sr-only">Invite people, change their roles, and set link sharing.</DialogDescription>

        {isOwner && (
          <form onSubmit={invite} className="flex items-center gap-2 border-b border-line py-4 ps-5 pe-12">
            <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Add people by email" aria-label="Email address to invite" autoComplete="off" className="min-w-0 flex-1" />
            <Select value={role} onValueChange={(v) => setRole(v as Role)}>
              <SelectTrigger size="default" className="w-28 shrink-0" aria-label="Role for the invitation">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="editor">{ROLE_LABEL.editor}</SelectItem>
                <SelectItem value="viewer">{ROLE_LABEL.viewer}</SelectItem>
              </SelectContent>
            </Select>
            <Button type="submit" disabled={!email.trim() || sending}>
              {sending && <Spinner />}
              Invite
            </Button>
          </form>
        )}

        <section aria-label="People with access" className="max-h-[50vh] overflow-y-auto py-2">
          <h3 className={`flex items-center justify-between px-5 pt-2 pb-1 type-small font-medium text-muted-foreground ${isOwner ? "" : "pe-12"}`}>
            People with access
            <span className="tabular-nums">{count}</span>
          </h3>
          <ul>
            {owner && (
              <li className={row}>
                <Avatar person={owner} size="md" decorative />
                <span className="min-w-0 flex-1">
                  <span className="block truncate type-base font-medium">
                    {owner.name || owner.email}
                    {owner.id === user?.id && <span className="ms-1.5 font-normal text-muted-foreground">(you)</span>}
                  </span>
                  <span className="block truncate type-small text-muted-foreground">{owner.email}</span>
                </span>
                <span className="shrink-0 type-base text-muted-foreground">Owner</span>
              </li>
            )}
            {others.map((c) => (
              <li key={c.id} className={row}>
                <Avatar person={c.user} size="md" decorative />
                <span className="min-w-0 flex-1">
                  <span className="block truncate type-base font-medium">
                    {c.user.name || c.user.email}
                    {c.userId === user?.id && <span className="ms-1.5 font-normal text-muted-foreground">(you)</span>}
                  </span>
                  <span className="block truncate type-small text-muted-foreground">{c.user.email}</span>
                </span>
                {isOwner ? (
                  <>
                    <Select value={c.role} onValueChange={(v) => void act(() => projectsAPI.updateCollaboratorRole(projectUid, c.userId, v as Role), "The role could not be changed.")}>
                      <SelectTrigger size="sm" className="w-28 shrink-0" aria-label={`Role of ${c.user.name || c.user.email}`}>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="editor">{ROLE_LABEL.editor}</SelectItem>
                        <SelectItem value="viewer">{ROLE_LABEL.viewer}</SelectItem>
                      </SelectContent>
                    </Select>
                    <Button variant="ghost" size="icon-sm" aria-label={`Remove ${c.user.name || c.user.email}`} title="Remove" onClick={() => void act(() => projectsAPI.removeCollaborator(projectUid, c.userId), "They could not be removed.", "Removed from the project")}>
                      <X />
                    </Button>
                  </>
                ) : (
                  <span className="shrink-0 type-base text-muted-foreground">{ROLE_LABEL[c.role]}</span>
                )}
              </li>
            ))}
            {pendingInvitations.map((inv) => (
              <li key={`inv-${inv.id}`} className={row}>
                <span className={`${avatar} text-muted-foreground`}>
                  <Mail className="size-4" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate type-base font-medium">{inv.email}</span>
                  <span className="block truncate type-small text-muted-foreground">Invited, {ROLE_LABEL[inv.role].toLowerCase()}</span>
                </span>
                {isOwner && (
                  <Button variant="ghost" size="icon-sm" aria-label={`Cancel the invitation to ${inv.email}`} title="Cancel invitation" onClick={() => void act(() => projectsAPI.cancelInvitation(projectUid, inv.id), "The invitation could not be cancelled.", "Invitation cancelled")}>
                    <X />
                  </Button>
                )}
              </li>
            ))}
          </ul>
        </section>

        <section aria-label="Link sharing" className="flex items-center gap-3 border-t border-line px-5 py-4">
          <span className="min-w-0 flex-1">
            <span className="block type-small font-medium text-muted-foreground">Link sharing</span>
            {isOwner ? (
              <Select value={access} onValueChange={(v) => void changeAccess(v as Access)}>
                <SelectTrigger size="default" className="mt-1.5 w-full" aria-label="Who can open the project with its link">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="private">Only people added above</SelectItem>
                  <SelectItem value="view">Anyone signed in with the link can view</SelectItem>
                  <SelectItem value="edit">Anyone signed in with the link can edit</SelectItem>
                </SelectContent>
              </Select>
            ) : (
              <span className="mt-1 block type-base">
                {access === "private" ? "Only people added above" : access === "view" ? "Anyone signed in with the link can view" : "Anyone signed in with the link can edit"}
              </span>
            )}
          </span>
          <CopyButton text={() => window.location.href} label="Copy link" className="self-end" />
        </section>
      </DialogContent>
    </Dialog>
  );
}
