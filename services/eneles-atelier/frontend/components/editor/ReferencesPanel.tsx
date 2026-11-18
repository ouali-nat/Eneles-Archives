"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { ChevronRight, ExternalLink, Loader2, Plus, Trash2 } from "@/components/icons";
import { FileTypeIcon } from "@/components/editor/FileTypeIcon";
import { Button } from "@/components/ui/button";
import { CopyButton } from "@/components/ui/copy-button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { projectsAPI, type ProjectReference } from "@/lib/api";
import { fetchArxivSource, importProject } from "@/lib/project-import";
import { cn } from "@/lib/utils";
import { TexSource } from "@/components/ui/tex-code";
import { texLanguageOf } from "@/lib/tex-highlight";

/**
 * The References panel: arXiv papers attached to the project, each kept with its full LaTeX source.
 *
 * - Add a paper by its arXiv ID. Its source is unpacked into a reference of this project, not into the project's own files, so it never mixes with the author's work or their GitHub repository.
 * - Open a paper to browse its files, read a source file in place, or open the whole paper in the editor to compile it.
 * - The AI assistant can read every attached paper (see the backend's ai-chat tools), so questions like "use the notation from the attached paper" work.
 */
export function ReferencesPanel({ projectId }: { projectId: string }) {
  const [references, setReferences] = useState<ProjectReference[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [arxivId, setArxivId] = useState("");
  const [adding, setAdding] = useState<string | null>(null);
  const [hint, setHint] = useState<{ text: string; error: boolean } | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [viewing, setViewing] = useState<{ reference: ProjectReference; path: string } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    if (!projectId) return;
    try {
      setReferences(await projectsAPI.listReferences(projectId));
    } catch {
      // The section stays empty; adding a paper reports its own errors.
    } finally {
      setLoaded(true);
    }
  }, [projectId]);

  useEffect(() => {
    if (!projectId) return;
    let cancelled = false;
    projectsAPI
      .listReferences(projectId)
      .then((list) => !cancelled && setReferences(list))
      .catch(() => undefined)
      .finally(() => !cancelled && setLoaded(true));
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  const add = async () => {
    const id = arxivId.trim().replace(/^arxiv:/i, "").replace(/^https?:\/\/arxiv\.org\/(?:abs|pdf)\//i, "").replace(/\.pdf$/i, "");
    if (!id || adding) return;
    if (references.some((r) => r.arxivId === id)) {
      setHint({ text: "That paper is already attached.", error: false });
      return;
    }
    setHint(null);
    setAdding("Fetching from arXiv");
    try {
      const source = await fetchArxivSource(id);
      if (!source.ok) {
        setHint(source.needsVersion ? { text: source.message, error: false } : { text: source.error, error: true });
        return;
      }
      const { project, skipped } = await importProject(source.title, source.entries, (done, total) => setAdding(`Saving ${done} of ${total} files`), {
        referenceOf: projectId,
        arxivId: id,
      });
      setArxivId("");
      await load();
      setExpanded(project.uid);
      if (skipped.length) toast.message(`Attached, but ${skipped.length} ${skipped.length === 1 ? "file was" : "files were"} left out`, { description: skipped[0].reason });
    } catch (e) {
      setHint({ text: e instanceof Error ? e.message : "Could not attach that paper.", error: true });
    } finally {
      setAdding(null);
    }
  };

  const remove = async (reference: ProjectReference) => {
    setConfirming(null);
    const before = references;
    setReferences((list) => list.filter((r) => r.uid !== reference.uid));
    try {
      await projectsAPI.removeReference(projectId, reference.uid);
    } catch (e) {
      setReferences(before);
      toast.error(e instanceof Error ? e.message : "Could not remove the reference");
    }
  };

  return (
    <div className="flex h-full flex-col bg-panel">
      <form
        className="flex shrink-0 items-center gap-1.5 border-b border-line p-2"
        onSubmit={(e) => {
          e.preventDefault();
          void add();
        }}
      >
        <Input
          ref={inputRef}
          value={arxivId}
          onChange={(e) => {
            setArxivId(e.target.value);
            setHint(null);
          }}
          placeholder="arXiv ID, e.g. 1706.03762"
          aria-label="arXiv ID of the paper to attach"
          disabled={!!adding}
          className="min-w-0 flex-1"
        />
        <Button type="submit" size="icon" variant="outline" disabled={!arxivId.trim() || !!adding} aria-label="Attach paper" title="Attach paper">
          {adding ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
        </Button>
      </form>
      {(adding || hint) && (
        <p role="status" className={cn("shrink-0 px-3 py-2 type-small", hint?.error ? "text-danger" : "text-muted-foreground")}>
          {adding ?? hint?.text}
        </p>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto py-1">
        {loaded && references.length === 0 && !adding && (
          <p className="px-3 py-2 type-base text-muted-foreground">
            Attach a paper to keep its LaTeX source beside your project. You can read it, compile it, and the assistant can use it as context.
          </p>
        )}
        {references.map((reference) => {
          const open = expanded === reference.uid;
          return (
            <div key={reference.uid}>
              <div className="group flex items-center gap-1 pe-1.5 hover:bg-surface-hover/50">
                <button
                  type="button"
                  onClick={() => setExpanded(open ? null : reference.uid)}
                  aria-expanded={open}
                  className="flex min-h-10 min-w-0 flex-1 items-start gap-1.5 py-2 ps-3 text-start [&>svg]:mt-0.5"
                >
                  <ChevronRight className={cn("size-4 shrink-0 text-muted-foreground transition-transform", open && "rotate-90")} />
                  <span className="min-w-0 flex-1">
                    <span className="line-clamp-2 type-base">{reference.title}</span>
                    {reference.arxivId && <span className="block truncate font-mono type-small text-muted-foreground">arXiv:{reference.arxivId}</span>}
                  </span>
                </button>
                {confirming === reference.uid ? (
                  <>
                    <Button size="sm" variant="destructive" className="px-2" onClick={() => void remove(reference)}>
                      Remove
                    </Button>
                    <Button size="sm" variant="ghost" className="px-2" onClick={() => setConfirming(null)}>
                      Keep
                    </Button>
                  </>
                ) : (
                  <span className="flex shrink-0 items-center opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100">
                    <Button asChild variant="ghost" size="icon-sm" title="Open in the editor to compile">
                      <a href={`/projects/${reference.uid}`} target="_blank" rel="noreferrer" aria-label={`Open ${reference.title} in the editor`}>
                        <ExternalLink className="size-4" />
                      </a>
                    </Button>
                    <Button variant="ghost" size="icon-sm" title="Remove reference" aria-label={`Remove ${reference.title}`} onClick={() => setConfirming(reference.uid)}>
                      <Trash2 className="size-4" />
                    </Button>
                  </span>
                )}
              </div>
              {open && (
                <ul className="pb-1">
                  {reference.files.map((file) => (
                    <li key={file.id}>
                      <button
                        type="button"
                        disabled={file.isBinary}
                        onClick={() => setViewing({ reference, path: file.path })}
                        title={file.isBinary ? "Figures and other binary files open with the paper in the editor" : `Read ${file.path}`}
                        className="flex min-h-8 w-full items-center gap-2 py-1 ps-8 pe-3 text-start type-base text-muted-foreground transition-colors enabled:hover:bg-surface-hover/50 enabled:hover:text-foreground disabled:opacity-60"
                      >
                        <FileTypeIcon filename={file.path} className="size-4 shrink-0" />
                        <span className="truncate">{file.path}</span>
                        {file.isMain && <span className="ms-auto shrink-0 type-small text-muted-foreground">Main</span>}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          );
        })}
      </div>

      <ReferenceSourceDialog viewing={viewing} onClose={() => setViewing(null)} />
    </div>
  );
}

/** One source file of a reference paper, read-only, with copy and a way into the editor. */
function ReferenceSourceDialog({ viewing, onClose }: { viewing: { reference: ProjectReference; path: string } | null; onClose: () => void }) {
  return (
    <Dialog open={!!viewing} onOpenChange={(open) => !open && onClose()}>
      <DialogContent size="wide" className="flex max-h-[85vh] flex-col gap-4">
        <DialogHeader>
          <DialogTitle className="truncate font-mono type-base">{viewing?.path}</DialogTitle>
          <DialogDescription className="truncate">{viewing?.reference.title}</DialogDescription>
        </DialogHeader>
        {/* Keyed by file, so each file starts from "loading" without an effect having to reset it. */}
        {viewing && <ReferenceSource key={`${viewing.reference.uid}/${viewing.path}`} referenceUid={viewing.reference.uid} path={viewing.path} />}
      </DialogContent>
    </Dialog>
  );
}

function ReferenceSource({ referenceUid, path }: { referenceUid: string; path: string }) {
  const [content, setContent] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    projectsAPI
      .getFiles(referenceUid)
      .then((files) => {
        if (cancelled) return;
        const file = files.find((f) => f.path === path);
        if (file && typeof file.content === "string") setContent(file.content);
        else setFailed(true);
      })
      .catch(() => !cancelled && setFailed(true));
    return () => {
      cancelled = true;
    };
  }, [referenceUid, path]);

  return (
    <>
      <div className="min-h-0 flex-1 overflow-auto rounded-[var(--radius)] border border-line bg-background">
        {failed ? (
          <p className="p-4 type-base text-muted-foreground">This file could not be loaded.</p>
        ) : content === null ? (
          <p className="p-4 type-base text-muted-foreground">Loading…</p>
        ) : (
          <pre className="p-4 font-mono text-[12px] leading-relaxed whitespace-pre-wrap [overflow-wrap:anywhere]">
            <TexSource source={content} language={texLanguageOf(path)} />
          </pre>
        )}
      </div>
      <div className="flex items-center justify-between gap-2">
        <CopyButton text={() => content ?? ""} label="Copy source" />
        <Button asChild variant="outline">
          <a href={`/projects/${referenceUid}`} target="_blank" rel="noreferrer">
            Open paper in the editor
            <ExternalLink aria-hidden />
          </a>
        </Button>
      </div>
    </>
  );
}
