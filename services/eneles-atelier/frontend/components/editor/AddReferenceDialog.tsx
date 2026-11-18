"use client";

import { useResetWhen } from "@/hooks/useResetWhen";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { referencesAPI } from "@/lib/api";
import { parseBibEntries } from "@/lib/latex/references";
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
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2 } from "@/components/icons";

const NEW_FILE = "__new__";

/**
 * Look a paper up by DOI or arXiv ID, check the BibTeX entry, and add it to
 * one of the project's .bib files, citing it at the cursor if wanted.
 */
export function AddReferenceDialog({
  open,
  onOpenChange,
  projectId,
  bibFiles,
  canCite,
  onAdded,
  onAppend,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
  /** The project's .bib files and their text. */
  bibFiles: { path: string; text: string }[];
  /** The open file can take a \cite. */
  canCite: boolean;
  onAdded: (result: { key: string; path: string; cite: boolean; created: boolean }) => void;
  /** Adds the entry to the file where the project is not on the server (a folder in the desktop app); the lookup still goes through the API. */
  onAppend?: (path: string, text: string) => Promise<{ created: boolean }>;
}) {
  const [id, setId] = useState("");
  const [bibtex, setBibtex] = useState("");
  const [target, setTarget] = useState<string>(NEW_FILE);
  const [newName, setNewName] = useState("references.bib");
  const [cite, setCite] = useState(true);
  const [busy, setBusy] = useState<null | "lookup" | "add">(null);

  useResetWhen(open, () => {
    if (!open) return;
    setId("");
    setBibtex("");
    setTarget(bibFiles[0]?.path ?? NEW_FILE);
    setCite(canCite);
  });

  const entry = useMemo(() => parseBibEntries(bibtex, "")[0] ?? null, [bibtex]);
  const path = target === NEW_FILE ? newName.trim() : target;
  const existing = useMemo(() => {
    const file = bibFiles.find((f) => f.path === path);
    return new Set(file ? parseBibEntries(file.text, path).map((e) => e.key) : []);
  }, [bibFiles, path]);
  const duplicate = !!entry && existing.has(entry.key);

  const lookup = async () => {
    if (!id.trim()) return;
    setBusy("lookup");
    try {
      const ref = await referencesAPI.lookup(id.trim());
      // A key the file already has gets a letter: smith2020b.
      let key = ref.key;
      for (let c = 98; existing.has(key) && c < 123; c++) key = `${ref.key}${String.fromCharCode(c)}`;
      setBibtex(key === ref.key ? ref.bibtex : ref.bibtex.replace(`{${ref.key},`, `{${key},`));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not look that up");
    } finally {
      setBusy(null);
    }
  };

  const add = async () => {
    if (!entry || !path) return;
    if (!/^[\w./-]+\.bib$/.test(path)) {
      toast.error("Name the file like references.bib");
      return;
    }
    setBusy("add");
    try {
      const r = onAppend ? await onAppend(path, bibtex.trim() + "\n") : await referencesAPI.appendToFile(projectId, path, bibtex.trim() + "\n");
      onAdded({ key: entry.key, path, cite: cite && canCite, created: !!r.created });
      toast.success(`Added ${entry.key} to ${path}`);
      onOpenChange(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not add the reference");
    } finally {
      setBusy(null);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !busy && onOpenChange(o)}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Add a reference</DialogTitle>
          <DialogDescription>
            Paste a DOI, an arXiv ID, or a link to either. The entry comes from the publisher&apos;s
            registry or arXiv; check it before adding.
          </DialogDescription>
        </DialogHeader>

        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void lookup();
          }}
        >
          <Input
            value={id}
            onChange={(e) => setId(e.target.value)}
            placeholder="10.1093/comjnl/27.2.97 or 1706.03762"
            aria-label="DOI or arXiv ID"
            autoFocus
          />
          <Button type="submit" variant="outline" disabled={!id.trim() || !!busy}>
            {busy === "lookup" && <Loader2 className="animate-spin" />} Look up
          </Button>
        </form>

        {bibtex && (
          <div className="flex flex-col gap-3">
            <Textarea
              value={bibtex}
              onChange={(e) => setBibtex(e.target.value)}
              rows={9}
              className="font-mono type-tiny"
              aria-label="BibTeX entry"
            />
            {!entry && <p className="type-small text-danger">This is not a BibTeX entry any more.</p>}
            {duplicate && <p className="type-small text-warning">{path} already has an entry called {entry?.key}.</p>}
            <div className="flex flex-wrap items-center gap-2">
              <span className="type-small">Add to</span>
              <Select value={target} onValueChange={setTarget}>
                <SelectTrigger className="w-48 type-small" aria-label="Bibliography file">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {bibFiles.map((f) => (
                    <SelectItem key={f.path} value={f.path}>
                      {f.path}
                    </SelectItem>
                  ))}
                  <SelectItem value={NEW_FILE}>A new file</SelectItem>
                </SelectContent>
              </Select>
              {target === NEW_FILE && (
                <Input value={newName} onChange={(e) => setNewName(e.target.value)} className="w-44" aria-label="New file name" />
              )}
            </div>
            {canCite && (
              <label className="flex items-center gap-2 type-small">
                <Checkbox checked={cite} onCheckedChange={(v) => setCite(v === true)} />
                Cite it at the cursor
              </label>
            )}
            {target === NEW_FILE && (
              <p className="type-tiny text-muted-foreground">
                Remember to load it: <code className="font-mono">\bibliography{"{"}{newName.replace(/\.bib$/, "")}{"}"}</code> or{" "}
                <code className="font-mono">\addbibresource{"{"}{newName}{"}"}</code>.
              </p>
            )}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={!!busy}>
            Cancel
          </Button>
          <Button onClick={() => void add()} disabled={!entry || duplicate || !!busy}>
            {busy === "add" && <Loader2 className="animate-spin" />} Add reference
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
