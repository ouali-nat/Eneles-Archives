"use client";

import { useResetWhen } from "@/hooks/useResetWhen";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { useAuth } from "@/lib/auth-context";
import { userTemplatesAPI, type UserTemplate } from "@/lib/api";
import { Container } from "@/components/ui/container";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Segmented } from "@/components/ui/segmented";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { LayoutTemplate, MoreHorizontal, Search, Loader2 } from "@/components/icons";
import { cn } from "@/lib/utils";
import { PageHeader, EmptyState } from "@/components/essential/layout/PageHeader";
import { Skeleton, SkeletonText } from "@/components/ui/skeleton";
import { RelativeTime } from "@/components/ui/time";
import { TexSource } from "@/components/ui/tex-code";
import { texLanguageOf } from "@/lib/tex-highlight";

type Tab = "shared" | "yours" | "review";

const STATUS: Record<string, { label: string; tone: string }> = {
  private: { label: "Private", tone: "bg-surface text-muted-foreground" },
  pending: { label: "Waiting for review", tone: "bg-warning/12 text-warning" },
  approved: { label: "Shared", tone: "bg-success/12 text-success" },
  rejected: { label: "Not approved", tone: "bg-danger/12 text-danger" },
};

function statusOf(t: UserTemplate) {
  if (!t.isPublic) return STATUS.private;
  return STATUS[t.review] ?? STATUS.private;
}

/** Files in a template, when the list came with them. */
function fileCount(t: UserTemplate): number | null {
  return Array.isArray(t.files) ? 1 + t.files.length : t.files === null ? 1 : null;
}

export default function TemplatesPage() {
  const { user, isAuthenticated } = useAuth();
  const router = useRouter();
  const [tab, setTab] = useState<Tab>("shared");
  const [reviewer, setReviewer] = useState(false);
  const [shared, setShared] = useState<UserTemplate[] | null>(null);
  const [mine, setMine] = useState<UserTemplate[] | null>(null);
  const [queue, setQueue] = useState<UserTemplate[] | null>(null);
  const [search, setSearch] = useState("");
  const [using, setUsing] = useState<UserTemplate | null>(null);
  const [reporting, setReporting] = useState<UserTemplate | null>(null);
  const [deleting, setDeleting] = useState<UserTemplate | null>(null);
  const [editing, setEditing] = useState<UserTemplate | null>(null);

  const loadShared = useCallback(async (q: string) => {
    try {
      const res = await userTemplatesAPI.list({ search: q || undefined });
      setShared(res.data.filter((t) => t.isPublic && t.review === "approved"));
    } catch {
      setShared([]);
      toast.error("Could not load shared templates");
    }
  }, []);

  const loadMine = useCallback(async () => {
    try {
      setMine((await userTemplatesAPI.mine()).data);
    } catch {
      setMine([]);
      toast.error("Could not load your templates");
    }
  }, []);

  const loadQueue = useCallback(async () => {
    try {
      setQueue((await userTemplatesAPI.reviewQueue()).data);
    } catch {
      setQueue([]);
    }
  }, []);

  useEffect(() => {
    if (!isAuthenticated) return;
    userTemplatesAPI
      .mine()
      .then((r) => setMine(r.data))
      .catch(() => {
        setMine([]);
        toast.error("Could not load your templates");
      });
    userTemplatesAPI
      .reviewAccess()
      .then(({ reviewer }) => {
        setReviewer(reviewer);
        if (reviewer) return userTemplatesAPI.reviewQueue().then((r) => setQueue(r.data));
      })
      .catch(() => setReviewer(false));
  }, [isAuthenticated]);

  // Search as you type, a moment after the last key.
  useEffect(() => {
    if (!isAuthenticated) return;
    const t = setTimeout(() => void loadShared(search.trim()), search ? 300 : 0);
    return () => clearTimeout(t);
  }, [isAuthenticated, search, loadShared]);

  const tabs = useMemo(() => {
    const options: { value: Tab; label: string }[] = [
      { value: "shared", label: "Shared" },
      { value: "yours", label: mine ? `Yours (${mine.length})` : "Yours" },
    ];
    if (reviewer) options.push({ value: "review", label: queue ? `To review (${queue.length})` : "To review" });
    return options;
  }, [mine, reviewer, queue]);

  const setSharing = async (t: UserTemplate, isPublic: boolean) => {
    try {
      await userTemplatesAPI.update(t.id, { isPublic });
      toast.success(isPublic ? "Sent for review. It appears in Shared once approved." : "Only you can see it now");
      void loadMine();
      if (reviewer) void loadQueue();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not change sharing");
    }
  };

  const confirmDelete = async () => {
    if (!deleting) return;
    try {
      await userTemplatesAPI.remove(deleting.id);
      toast.success(`Deleted “${deleting.name}”`);
      setDeleting(null);
      void loadMine();
      void loadShared(search.trim());
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not delete the template");
    }
  };

  return (
    <Container className="flex flex-1 flex-col">
      <div className="flex flex-1 flex-col gap-6">
        <PageHeader
          title="Templates"
          description="Start a project from a shared template, or manage your own. To save one, open a project and choose File, then Save as template."
        />

        <div className="flex flex-wrap items-center justify-between gap-3">
          <Segmented value={tab} onValueChange={setTab} options={tabs} label="Which templates" />
          {tab === "shared" && (
            <div className="relative w-full max-w-xs">
              <Search className="pointer-events-none absolute start-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search shared templates"
                className="ps-8"
                aria-label="Search shared templates"
              />
            </div>
          )}
        </div>

        {tab === "shared" && (
          <TemplateGrid
            items={shared}
            empty={
              search
                ? "No shared template matches that search."
                : "Nobody has shared a template yet. Templates appear here once a reviewer approves them."
            }
            render={(t) => (
              <TemplateCard key={t.id} template={t}>
                <Button size="sm" onClick={() => setUsing(t)}>
                  Use template
                </Button>
                {t.userId !== user?.id && (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button size="sm" variant="ghost" aria-label={`More for ${t.name}`}>
                        <MoreHorizontal />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem variant="destructive" onSelect={() => setReporting(t)}>
                        Report
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                )}
              </TemplateCard>
            )}
          />
        )}

        {tab === "yours" && (
          <TemplateGrid
            items={mine}
            empty="You have not saved a template yet. Open a project and choose File, then Save as template."
            render={(t) => (
              <TemplateCard key={t.id} template={t} showStatus>
                <Button size="sm" onClick={() => setUsing(t)}>
                  Use template
                </Button>
                <Button size="sm" variant="outline" onClick={() => setEditing(t)}>
                  Edit
                </Button>
                {t.isPublic && t.review === "rejected" && (
                  <Button size="sm" variant="outline" onClick={() => void setSharing(t, true)}>
                    Send for review again
                  </Button>
                )}
                <Button size="sm" variant="outline" onClick={() => void setSharing(t, !t.isPublic)}>
                  {t.isPublic ? "Stop sharing" : "Share"}
                </Button>
                <Button size="sm" variant="ghost" className="text-danger" onClick={() => setDeleting(t)}>
                  Delete
                </Button>
              </TemplateCard>
            )}
          />
        )}

        {tab === "review" && reviewer && (
          <ReviewQueue
            items={queue}
            onDecided={() => {
              void loadQueue();
              void loadShared(search.trim());
              void loadMine();
            }}
          />
        )}
      </div>

      <UseTemplateDialog
        template={using}
        onClose={() => setUsing(null)}
        onCreated={(uid) => router.push(`/projects/${uid}`)}
      />
      <ReportDialog template={reporting} onClose={() => setReporting(null)} />
      <EditDialog
        template={editing}
        onClose={() => setEditing(null)}
        onSaved={() => {
          setEditing(null);
          void loadMine();
          void loadShared(search.trim());
          if (reviewer) void loadQueue();
        }}
      />
      <AlertDialog open={!!deleting} onOpenChange={(o) => !o && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete “{deleting?.name}”?</AlertDialogTitle>
            <AlertDialogDescription>
              Projects already started from it keep their files. If it was shared, it leaves the
              Shared list too.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction className={buttonVariants({ variant: "destructive" })} onClick={() => void confirmDelete()}>
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Container>
  );
}

function TemplateGrid({
  items,
  empty,
  render,
}: {
  items: UserTemplate[] | null;
  empty: string;
  render: (t: UserTemplate) => React.ReactNode;
}) {
  if (items === null) return <TemplateGridSkeleton />;
  if (items.length === 0) {
    return (
      <EmptyState icon={LayoutTemplate}>{empty}</EmptyState>
    );
  }
  return <div className="grid gap-3 @min-[40rem]:grid-cols-2 @5xl:grid-cols-3">{items.map(render)}</div>;
}

/** Template cards in TemplateCard's own frame (name, two lines of description, the byline, and the buttons' row), in the grid the cards will fill. */
function TemplateGridSkeleton({ columns = 3, count = 3 }: { columns?: 1 | 3; count?: number }) {
  return (
    <div role="status" aria-label="Loading templates" className={cn("grid gap-3", columns === 3 && "@min-[40rem]:grid-cols-2 @5xl:grid-cols-3")}>
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="flex flex-col rounded-[var(--radius-card)] border border-line bg-card p-4 shadow-lit-drop">
          <SkeletonText className="type-base" width={["55%", "40%", "62%"][i % 3]} />
          <div className="mt-2">
            <SkeletonText className="type-small" width="92%" />
            <SkeletonText className="type-small" width="70%" />
          </div>
          <div className="mt-3 flex gap-1">
            <Skeleton className="h-5 w-14" />
            <Skeleton className="h-5 w-16" />
          </div>
          <SkeletonText className="mt-3 type-tiny" width="45%" />
          <div className="mt-4 flex items-center gap-2">
            <Skeleton className="h-[var(--control-height)] w-28 rounded-[var(--radius)]" />
          </div>
        </div>
      ))}
    </div>
  );
}

function TemplateCard({
  template: t,
  showStatus = false,
  children,
}: {
  template: UserTemplate;
  showStatus?: boolean;
  children: React.ReactNode;
}) {
  const status = statusOf(t);
  const files = fileCount(t);
  return (
    <div className="flex flex-col rounded-[var(--radius-card)] border border-line bg-card p-4 shadow-lit-drop">
      <div className="flex items-start justify-between gap-3">
        <h2 className="min-w-0 break-words type-base font-semibold">{t.name}</h2>
        {showStatus && (
          <span className={cn("shrink-0 rounded-[var(--radius-inset)] px-2 py-0.5 type-micro font-medium", status.tone)}>
            {status.label}
          </span>
        )}
      </div>
      {t.description && (
        <p className="mt-2 line-clamp-3 type-small text-muted-foreground">{t.description}</p>
      )}
      {showStatus && t.isPublic && t.review === "rejected" && t.reviewNote && (
        <p className="mt-3 rounded-[var(--radius-inset)] bg-danger/8 px-3 py-2 type-small">
          <span className="font-medium">Reviewer’s note: </span>
          {t.reviewNote}
          <span className="mt-1 block text-muted-foreground">Edit it, or send it for review again.</span>
        </p>
      )}
      {showStatus && !!t.reportCount && t.review === "pending" && (
        <p className="mt-3 type-small text-warning">
          Reported by {t.reportCount} {t.reportCount === 1 ? "person" : "people"}, so it is hidden until a reviewer looks again.
        </p>
      )}
      {t.tags.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1">
          {t.tags.slice(0, 6).map((tag) => (
            <span key={tag} className="rounded-[var(--radius-inset)] bg-surface px-1.5 py-0.5 type-micro text-muted-foreground">
              {tag}
            </span>
          ))}
        </div>
      )}
      <p className="mt-3 flex-1 type-tiny text-muted-foreground">
        {[
          t.user?.name ? `By ${t.user.name}` : null,
          files === null ? null : files === 1 ? "1 file" : `${files} files`,
          t.usageCount > 0 ? `used ${t.usageCount} ${t.usageCount === 1 ? "time" : "times"}` : null,
        ]
          .filter(Boolean)
          .join(" · ")}
      </p>
      <div className="mt-4 flex flex-wrap items-center gap-2">{children}</div>
    </div>
  );
}

function UseTemplateDialog({
  template,
  onClose,
  onCreated,
}: {
  template: UserTemplate | null;
  onClose: () => void;
  onCreated: (uid: string) => void;
}) {
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);
  useResetWhen(template, () => {
    if (template) setTitle(template.name);
  });

  const create = async () => {
    if (!template) return;
    setBusy(true);
    try {
      const project = await userTemplatesAPI.use(template.id, title.trim() || template.name);
      onCreated(project.uid);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not create the project");
      setBusy(false);
    }
  };

  return (
    <Dialog open={!!template} onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New project from “{template?.name}”</DialogTitle>
          <DialogDescription>The project starts with a copy of the template’s files.</DialogDescription>
        </DialogHeader>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void create();
          }}
          className="flex flex-col gap-2"
        >
          <label htmlFor="use-title" className="type-small font-medium">
            Project name
          </label>
          <Input id="use-title" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} autoFocus />
          <DialogFooter className="mt-4">
            <Button type="button" variant="outline" onClick={onClose} disabled={busy}>
              Cancel
            </Button>
            <Button type="submit" disabled={busy}>
              {busy && <Loader2 className="animate-spin" />}
              Create project
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function EditDialog({
  template,
  onClose,
  onSaved,
}: {
  template: UserTemplate | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [tags, setTags] = useState("");
  const [busy, setBusy] = useState(false);
  useResetWhen(template, () => {
    if (!template) return;
    setName(template.name);
    setDescription(template.description ?? "");
    setTags(template.tags.join(", "));
  });

  const save = async () => {
    if (!template || !name.trim()) return;
    setBusy(true);
    try {
      await userTemplatesAPI.update(template.id, {
        name: name.trim(),
        description: description.trim(),
        tags: tags
          .split(",")
          .map((t) => t.trim().toLowerCase())
          .filter(Boolean)
          .slice(0, 20),
      });
      toast.success(template.isPublic ? "Saved and sent for review" : "Saved");
      onSaved();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not save the changes");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={!!template} onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit template</DialogTitle>
          <DialogDescription>
            {template?.isPublic
              ? "Saving sends it back for review; until a reviewer approves it, only you can see it."
              : "To change its files, save the project as a template again."}
          </DialogDescription>
        </DialogHeader>
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          <div className="flex flex-col gap-1.5">
            <label htmlFor="edit-name" className="type-small font-medium">Name</label>
            <Input id="edit-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={200} required />
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="edit-description" className="type-small font-medium">Description</label>
            <Textarea id="edit-description" value={description} onChange={(e) => setDescription(e.target.value)} maxLength={2000} rows={3} />
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="edit-tags" className="type-small font-medium">Tags, separated by commas</label>
            <Input id="edit-tags" value={tags} onChange={(e) => setTags(e.target.value)} placeholder="thesis, physics" />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={busy}>
              Cancel
            </Button>
            <Button type="submit" disabled={busy || !name.trim()}>
              {busy && <Loader2 className="animate-spin" />}
              Save
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function ReportDialog({ template, onClose }: { template: UserTemplate | null; onClose: () => void }) {
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  useResetWhen(template, () => {
    if (template) setReason("");
  });

  const send = async () => {
    if (!template) return;
    setBusy(true);
    try {
      await userTemplatesAPI.report(template.id, reason.trim() || undefined);
      toast.success("Thanks. A reviewer will take a look.");
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not send the report");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={!!template} onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Report “{template?.name}”</DialogTitle>
          <DialogDescription>
            Reviewers see reports. When enough people report a template, it is hidden until a
            reviewer checks it again.
          </DialogDescription>
        </DialogHeader>
        <label htmlFor="report-reason" className="type-small font-medium">
          What is wrong with it? (optional)
        </label>
        <Textarea
          id="report-reason"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          maxLength={500}
          rows={3}
        />
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button variant="destructive" onClick={() => void send()} disabled={busy}>
            Report
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ReviewQueue({ items, onDecided }: { items: UserTemplate[] | null; onDecided: () => void }) {
  if (items === null) return <TemplateGridSkeleton columns={1} count={3} />;
  if (items.length === 0) return <EmptyState icon={LayoutTemplate}>Nothing is waiting for review.</EmptyState>;
  return (
    <div className="flex flex-col gap-3">
      <p className="type-small text-muted-foreground">
        Oldest first. Approving shows a template to everyone signed in; a note on a rejection goes to the author.
      </p>
      {items.map((t) => (
        <ReviewItem key={t.id} template={t} onDecided={onDecided} />
      ))}
    </div>
  );
}

function ReviewItem({ template: t, onDecided }: { template: UserTemplate; onDecided: () => void }) {
  const [rejecting, setRejecting] = useState(false);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  const files = Array.isArray(t.files) ? t.files : [];

  const decide = async (decision: "approve" | "reject") => {
    setBusy(true);
    try {
      await userTemplatesAPI.decide(t.id, decision, decision === "reject" ? note.trim() || undefined : undefined);
      toast.success(decision === "approve" ? `Approved “${t.name}”` : `Rejected “${t.name}”`);
      onDecided();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not save the decision");
      setBusy(false);
    }
  };

  return (
    <article className="rounded-[var(--radius-card)] border border-line bg-card p-4 shadow-lit-drop">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="break-words type-base font-semibold">{t.name}</h2>
          <p className="type-tiny text-muted-foreground">
            {[t.user?.name, t.user?.email].filter(Boolean).join(" · ")} · sent{" "}
            <RelativeTime value={t.updatedAt} lowercase />
            {!!t.reportCount && ` · reported by ${t.reportCount}`}
          </p>
        </div>
        <div className="flex gap-2">
          <Button size="sm" onClick={() => void decide("approve")} disabled={busy}>
            Approve
          </Button>
          <Button size="sm" variant="outline" onClick={() => setRejecting((v) => !v)} disabled={busy}>
            Reject
          </Button>
        </div>
      </div>
      {t.description && <p className="mt-2 type-small text-muted-foreground">{t.description}</p>}
      {t.tags.length > 0 && <p className="mt-2 type-tiny text-muted-foreground">Tags: {t.tags.join(", ")}</p>}

      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="mt-3 type-small text-accent underline-offset-4 hover:underline"
        aria-expanded={open}
      >
        {open ? "Hide the source" : `Show the source (${files.length + 1} ${files.length ? "files" : "file"})`}
      </button>
      {open && (
        <div className="mt-2 flex flex-col gap-2">
          {[{ path: "main.tex", content: t.content ?? "" }, ...files].map((f) => (
            <div key={f.path}>
              <p className="type-tiny font-medium">{f.path}</p>
              <pre className="mt-1 max-h-72 overflow-auto rounded-[var(--radius-inset)] bg-background p-3 font-mono type-tiny whitespace-pre-wrap break-words">
                <TexSource source={f.content} language={texLanguageOf(f.path)} />
              </pre>
            </div>
          ))}
        </div>
      )}

      {rejecting && (
        <div className="mt-3 flex flex-col gap-2">
          <label htmlFor={`note-${t.id}`} className="type-small font-medium">
            Note to the author (optional)
          </label>
          <Textarea id={`note-${t.id}`} value={note} onChange={(e) => setNote(e.target.value)} maxLength={1000} rows={3} />
          <div className="flex gap-2">
            <Button size="sm" variant="destructive" onClick={() => void decide("reject")} disabled={busy}>
              Reject template
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setRejecting(false)} disabled={busy}>
              Cancel
            </Button>
          </div>
        </div>
      )}
    </article>
  );
}
