"use client";

import { useResetWhen } from "@/hooks/useResetWhen";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { githubAPI, type GithubPullResult, type GithubStatus } from "@/lib/api";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { BrandMarks } from "@/components/BrandMarks";
import { Loader2 } from "@/components/icons";
import { RelativeTime } from "@/components/ui/time";

/**
 * Link the project to a GitHub repository, then push and pull. The owner
 * gives a token that can write the repository's contents; it is stored
 * encrypted and never shown again.
 */
export function GithubDialog({
  open,
  onOpenChange,
  projectId,
  beforeSync,
  onPulled,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
  /** Saves the open file first. */
  beforeSync?: () => Promise<unknown> | void;
  /** Files changed: reload them. */
  onPulled: () => void;
}) {
  const [status, setStatus] = useState<GithubStatus | null>(null);
  const [busy, setBusy] = useState<null | "link" | "push" | "pull" | "unlink">(null);
  const [repo, setRepo] = useState("");
  const [branch, setBranch] = useState("");
  const [token, setToken] = useState("");
  const [message, setMessage] = useState("");
  const [result, setResult] = useState<GithubPullResult | null>(null);
  const [firstPull, setFirstPull] = useState(false);

  const load = useCallback(async () => {
    try {
      setStatus(await githubAPI.status(projectId));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not load GitHub sync");
    }
  }, [projectId]);

  useResetWhen(open, () => {
    if (!open) return;
    setResult(null);
    setToken("");
  });
  useEffect(() => {
    if (!open) return;
    githubAPI
      .status(projectId)
      .then(setStatus)
      .catch((e) => toast.error(e instanceof Error ? e.message : "Could not load GitHub sync"));
  }, [open, projectId]);

  const run = async <T,>(kind: NonNullable<typeof busy>, fn: () => Promise<T>) => {
    setBusy(kind);
    try {
      return await fn();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "GitHub sync failed");
      return undefined;
    } finally {
      setBusy(null);
    }
  };

  const link = () =>
    run("link", async () => {
      const s = await githubAPI.link(projectId, { repo, branch: branch || undefined, token });
      setStatus(s);
      setToken("");
      setFirstPull(!!s.remoteHasCommits);
      toast.success(`Linked to ${s.repo}`);
    });

  const pull = (preferGithub: boolean) =>
    run("pull", async () => {
      await beforeSync?.();
      const r = await githubAPI.pull(projectId, preferGithub);
      setResult(r);
      setFirstPull(false);
      if (r.upToDate) toast("Already up to date with GitHub");
      else onPulled();
      await load();
    });

  const push = () =>
    run("push", async () => {
      await beforeSync?.();
      const r = await githubAPI.push(projectId, message || undefined);
      setMessage("");
      toast.success(r.upToDate ? "GitHub already has these files" : `Pushed ${r.changed} changed and ${r.deleted} deleted file${r.deleted === 1 ? "" : "s"}`);
      await load();
    });

  const unlink = () =>
    run("unlink", async () => {
      setStatus(await githubAPI.unlink(projectId));
      setResult(null);
      toast.success("Unlinked from GitHub. The repository is unchanged.");
    });

  return (
    <Dialog open={open} onOpenChange={(o) => !busy && onOpenChange(o)}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <BrandMarks.gitHub className="size-4" /> GitHub
          </DialogTitle>
          <DialogDescription>
            Keep this project in a GitHub repository. Push sends your changes as a commit; pull
            brings in commits made on GitHub. Free on every plan.
          </DialogDescription>
        </DialogHeader>

        {!status ? (
          <div className="flex items-center gap-2 py-6 text-muted-foreground">
            <Loader2 className="size-4 animate-spin" /> Loading
          </div>
        ) : !status.linked ? (
          status.canSync ? (
            <form
              className="flex flex-col gap-3"
              onSubmit={(e) => {
                e.preventDefault();
                void link();
              }}
            >
              <div className="flex flex-col gap-1.5">
                <label htmlFor="gh-repo" className="type-small font-medium">Repository</label>
                <Input id="gh-repo" value={repo} onChange={(e) => setRepo(e.target.value)} placeholder="owner/name" required autoFocus />
              </div>
              <div className="flex flex-col gap-1.5">
                <label htmlFor="gh-branch" className="type-small font-medium">Branch (optional)</label>
                <Input id="gh-branch" value={branch} onChange={(e) => setBranch(e.target.value)} placeholder="The repository's default branch" />
              </div>
              <div className="flex flex-col gap-1.5">
                <label htmlFor="gh-token" className="type-small font-medium">Access token</label>
                <Input id="gh-token" type="password" value={token} onChange={(e) => setToken(e.target.value)} autoComplete="off" required />
                <p className="type-tiny text-muted-foreground">
                  On GitHub, create a{" "}
                  <a
                    href="https://github.com/settings/personal-access-tokens/new"
                    target="_blank"
                    rel="noreferrer"
                    className="underline underline-offset-4"
                  >
                    fine-grained token
                  </a>{" "}
                  for this repository with read and write access to Contents. It is stored
                  encrypted and only used for this project&apos;s pushes and pulls.
                </p>
              </div>
              <DialogFooter>
                <Button type="submit" disabled={!!busy || !repo.trim() || !token.trim()}>
                  {busy === "link" && <Loader2 className="animate-spin" />} Link repository
                </Button>
              </DialogFooter>
            </form>
          ) : (
            <p className="type-small text-muted-foreground">This project is not linked to GitHub. The owner can link it.</p>
          )
        ) : (
          <div className="flex flex-col gap-4">
            <div className="rounded-[var(--radius-item)] border border-line bg-surface p-3 type-small">
              <p>
                <a href={status.url} target="_blank" rel="noreferrer" className="font-medium underline underline-offset-4">
                  {status.repo}
                </a>{" "}
                on <span className="font-mono">{status.branch}</span>
              </p>
              <p className="mt-1 type-tiny text-muted-foreground">
                {status.lastSyncedAt ? (
                  <>
                    Last synced <RelativeTime value={status.lastSyncedAt} lowercase />, at commit {status.lastCommitSha?.slice(0, 7)}
                  </>
                ) : (
                  "Not synced yet"
                )}
              </p>
            </div>

            {!status.canSync ? (
              <p className="type-small text-muted-foreground">Only the project owner can push and pull.</p>
            ) : firstPull ? (
              <div className="flex flex-col gap-2">
                <p className="type-small">
                  The repository already has files. For files both sides have, which version should
                  this project keep?
                </p>
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" onClick={() => void pull(true)} disabled={!!busy}>
                    {busy === "pull" && <Loader2 className="animate-spin" />} Use GitHub&apos;s
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => void pull(false)} disabled={!!busy}>
                    Keep mine, save GitHub&apos;s beside them
                  </Button>
                </div>
              </div>
            ) : (
              <>
                <div className="flex flex-col gap-1.5">
                  <label htmlFor="gh-message" className="type-small font-medium">Commit message (optional)</label>
                  <Input id="gh-message" value={message} onChange={(e) => setMessage(e.target.value)} placeholder="Update from Eneles" maxLength={500} />
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" onClick={() => void push()} disabled={!!busy}>
                    {busy === "push" && <Loader2 className="animate-spin" />} Push to GitHub
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => void pull(false)} disabled={!!busy}>
                    {busy === "pull" && <Loader2 className="animate-spin" />} Pull from GitHub
                  </Button>
                  <Button size="sm" variant="ghost" className="ms-auto text-muted-foreground" onClick={() => void unlink()} disabled={!!busy}>
                    Unlink
                  </Button>
                </div>
              </>
            )}

            {result && !result.upToDate && (
              <div className="flex flex-col gap-1 rounded-[var(--radius-item)] border border-line p-3 type-small">
                <p className="font-medium">Pulled from GitHub</p>
                {[
                  ["Updated", result.updated],
                  ["Added", result.added],
                  ["Removed", result.removed],
                ]
                  .filter(([, list]) => (list as string[]).length)
                  .map(([label, list]) => (
                    <p key={label as string} className="break-words text-muted-foreground">
                      {label as string}: {(list as string[]).join(", ")}
                    </p>
                  ))}
                {result.conflicts.map((c) => (
                  <p key={c.path} className="break-words text-warning">
                    {c.path}: {c.reason}.{c.copy && ` GitHub's version is in ${c.copy}.`}
                  </p>
                ))}
                {result.skipped.map((s) => (
                  <p key={s.path} className="break-words text-muted-foreground">
                    Not brought in: {s.path} ({s.reason})
                  </p>
                ))}
              </div>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
