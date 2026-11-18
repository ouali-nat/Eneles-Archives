"use client";

import { useResetWhen } from "@/hooks/useResetWhen";
import { useEffect, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { userTemplatesAPI } from "@/lib/api";
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
import { Switch } from "@/components/ui/switch";
import { Loader2 } from "@/components/icons";

/** Save the open project's text files as a template, private or shared after review. */
export function SaveTemplateDialog({
  open,
  onOpenChange,
  projectId,
  projectTitle,
  beforeSave,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
  projectTitle: string;
  /** Saves the open file first, so the template has the latest text. */
  beforeSave?: () => Promise<unknown> | void;
}) {
  const [name, setName] = useState(projectTitle);
  const [description, setDescription] = useState("");
  const [share, setShare] = useState(false);
  const [busy, setBusy] = useState(false);

  useResetWhen(open, () => {
    if (open) {
      setName(projectTitle);
      setDescription("");
      setShare(false);
    }
  });

  const save = async () => {
    if (!name.trim()) return;
    setBusy(true);
    try {
      await beforeSave?.();
      const { leftOut } = await userTemplatesAPI.fromProject(projectId, {
        name: name.trim(),
        description: description.trim() || undefined,
        isPublic: share,
      });
      const parts = [share ? "Saved and sent for review." : "Saved as a private template."];
      if (leftOut > 0) {
        parts.push(`${leftOut} image${leftOut === 1 ? "" : "s"} or other upload${leftOut === 1 ? " was" : "s were"} left out: templates hold text files only.`);
      }
      toast.success(parts.join(" "), {
        action: { label: "View", onClick: () => window.open("/templates", "_self") },
      });
      onOpenChange(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not save the template");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !busy && onOpenChange(o)}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Save as template</DialogTitle>
          <DialogDescription>
            A copy of this project’s text files, to start new projects from. Your templates are on
            the <Link href="/templates" className="underline underline-offset-4">Templates</Link> page.
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
            <label htmlFor="template-name" className="type-small font-medium">
              Name
            </label>
            <Input id="template-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={200} required autoFocus />
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="template-description" className="type-small font-medium">
              Description (optional)
            </label>
            <Textarea
              id="template-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              maxLength={2000}
              rows={3}
              placeholder="What it is for, and what to change first"
            />
          </div>
          <label className="flex items-start justify-between gap-4">
            <span className="flex flex-col">
              <span className="type-small font-medium">Share with everyone</span>
              <span className="type-small text-muted-foreground">
                A reviewer checks it first. Until then, only you can see it.
              </span>
            </span>
            <Switch checked={share} onCheckedChange={setShare} aria-label="Share with everyone" />
          </label>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
              Cancel
            </Button>
            <Button type="submit" disabled={busy || !name.trim()}>
              {busy && <Loader2 className="animate-spin" />}
              Save template
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
