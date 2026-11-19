"use client";

import { useState, useRef, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Loader2, FileArchive, FlaskConical, FilePlus, Upload, X, AlertCircle, LayoutTemplate, Check, FileCode } from "@/components/icons";
import { entriesFromZip, fetchArxivSource, pickMain, type ImportEntry } from "@/lib/project-import";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { API_URL } from "@/lib/api";
import {
  LATEX_TEMPLATES,
  LATEX_TEMPLATE_CATEGORIES,
  LaTeXTemplate,
  getTemplateById,
} from "@/lib/latex/templates";
import { getTemplateThumbUrl } from "@/lib/api";

export interface TemplateOption {
  id: string;
  name: string;
  description?: string;
}

interface NewProjectDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreate: (data: {
    name: string;
    description?: string;
    templateId?: string;
    tags?: string[];
    content?: string;
    /** Every file of an imported ZIP or archive. */
    entries?: ImportEntry[];
  }) => Promise<void>;
  templates?: TemplateOption[];
  defaultTemplateId?: string;
  /** Where the project will live, drawn above the buttons of the New, ZIP, and arXiv tabs (the desktop app chooses between a folder on the computer and the cloud). */
  destination?: React.ReactNode;
}

type Tab = "new" | "template" | "zip" | "arxiv";

const TAB_ORDER: Tab[] = ["new", "template", "zip", "arxiv"];

// ─── Helpers ──────────────────────────────────────────────────────────────────

const fetchArxiv = async (id: string) => {
  const result = await fetchArxivSource(id);
  return result.ok || result.needsVersion ? result : { ok: false as const, error: result.error };
};

// ─── Template Card ─────────────────────────────────────────────────────────

function TemplateCard({
  t,
  selected,
  onClick,
}: {
  t: LaTeXTemplate;
  selected: boolean;
  onClick: () => void;
}) {
  const [thumbUrl, setThumbUrl] = useState<string | null>(null);
  const [thumbError, setThumbError] = useState(false);

  useEffect(() => {
    getTemplateThumbUrl(t.id)
      .then((url) => setThumbUrl(url))
      .catch(() => setThumbError(true));
  }, [t.id]);

  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "relative w-full text-start rounded-xl border transition-[border-color,box-shadow] overflow-hidden",
        selected
          ? "border-accent ring-2 ring-accent/20"
          : "border-line hover:border-accent/40",
      )}
    >
      <div className="aspect-[3/4] bg-surface/40 overflow-hidden relative">
        {thumbUrl && !thumbError ? (
          <img
            src={thumbUrl}
            alt={`${t.name} preview`}
            className="w-full h-full object-contain"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <FileCode className="h-10 w-10 text-muted-foreground/30" />
          </div>
        )}
        {selected && (
          <div className="absolute inset-0 bg-accent/10 flex items-center justify-center">
            <div className="bg-accent rounded-full p-1.5">
              <Check className="h-4 w-4 text-on-accent" />
            </div>
          </div>
        )}
      </div>
      <div className="px-3 py-2.5 border-t border-line">
        <p className="text-sm font-medium leading-tight">{t.name}</p>
        <p className="text-xs text-muted-foreground mt-0.5 line-clamp-1">
          {t.description}
        </p>
      </div>
    </button>
  );
}

// ─── Tab animation variants ────────────────────────────────────────────────

function getDirection(from: Tab, to: Tab) {
  return TAB_ORDER.indexOf(to) > TAB_ORDER.indexOf(from) ? 1 : -1;
}

const variants = {
  enter: (dir: number) => ({ x: dir * 24, opacity: 0 }),
  center: { x: 0, opacity: 1 },
  exit: (dir: number) => ({ x: dir * -24, opacity: 0 }),
};

// ─── Dialog ────────────────────────────────────────────────────────────────

export function NewProjectDialog({
  open,
  onOpenChange,
  onCreate,
  defaultTemplateId,
  destination,
}: NewProjectDialogProps) {
  const [tab, setTab] = useState<Tab>("new");
  const [prevTab, setPrevTab] = useState<Tab>("new");
  const [isLoading, setIsLoading] = useState(false);

  // New
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>(
    defaultTemplateId ?? "",
  );

  // Template browser
  const [categoryFilter, setCategoryFilter] = useState("All");

  // ZIP
  const [zipFile, setZipFile] = useState<File | null>(null);
  const [zipName, setZipName] = useState("");
  const [zipDragging, setZipDragging] = useState(false);
  const zipInputRef = useRef<HTMLInputElement>(null);

  // ArXiv
  const [arxivId, setArxivId] = useState("");
  const [arxivHint, setArxivHint] = useState<string | null>(null);
  const [arxivError, setArxivError] = useState<string | null>(null);

  const switchTab = (t: Tab) => {
    setPrevTab(tab);
    setTab(t);
  };

  const reset = () => {
    setTab("new");
    setPrevTab("new");
    setName("");
    setDescription("");
    setSelectedTemplateId(defaultTemplateId ?? "");
    setCategoryFilter("All");
    setZipFile(null);
    setZipName("");
    setZipDragging(false);
    setArxivId("");
    setArxivHint(null);
    setArxivError(null);
  };

  const handleClose = (v: boolean) => {
    if (!v) reset();
    onOpenChange(v);
  };

  const visibleTemplates =
    categoryFilter === "All"
      ? LATEX_TEMPLATES
      : LATEX_TEMPLATES.filter((t) => t.category === categoryFilter);

  // ── Submits ─────────────────────────────────────────────────────────────

  const submitNew = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    try {
      await onCreate({
        name: name.trim() || "Untitled Project",
        description: description.trim() || undefined,
        templateId: selectedTemplateId || undefined,
      });
      reset();
      onOpenChange(false);
    } finally {
      setIsLoading(false);
    }
  };

  const submitZip = async () => {
    if (!zipFile) return;
    setIsLoading(true);
    try {
      const entries = await entriesFromZip(zipFile);
      if (!pickMain(entries)) {
        alert("No .tex files found in the ZIP.");
        return;
      }
      await onCreate({
        name: zipName.trim() || zipFile.name.replace(/\.zip$/i, ""),
        entries,
      });
      reset();
      onOpenChange(false);
    } catch (err: any) {
      alert(err.message || "Failed to extract ZIP");
    } finally {
      setIsLoading(false);
    }
  };

  const submitArxiv = async () => {
    setArxivHint(null);
    setArxivError(null);
    const id = arxivId.trim();
    if (!id) return;
    setIsLoading(true);
    try {
      const result = await fetchArxiv(id);
      if (!result.ok && (result as any).needsVersion) {
        setArxivHint((result as any).message);
        return;
      }
      if (!result.ok) {
        setArxivError((result as any).error);
        return;
      }
      await onCreate({
        name: result.title,
        entries: result.entries,
      });
      reset();
      onOpenChange(false);
    } finally {
      setIsLoading(false);
    }
  };

  const handleZipDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setZipDragging(false);
    const f = e.dataTransfer.files[0];
    if (f?.name.endsWith(".zip")) {
      setZipFile(f);
      if (!zipName) setZipName(f.name.replace(/\.zip$/i, ""));
    }
  };

  const handleZipFile = (f: File | null) => {
    if (!f) return;
    setZipFile(f);
    if (!zipName) setZipName(f.name.replace(/\.zip$/i, ""));
  };

  const dir = getDirection(prevTab, tab);

  const tabs = [
    {
      id: "new" as Tab,
      label: "New",
      icon: <FilePlus className="h-3.5 w-3.5" />,
    },
    {
      id: "template" as Tab,
      label: "Templates",
      icon: <LayoutTemplate className="h-3.5 w-3.5" />,
    },
    {
      id: "zip" as Tab,
      label: "Import ZIP",
      icon: <FileArchive className="h-3.5 w-3.5" />,
    },
    {
      id: "arxiv" as Tab,
      label: "ArXiv",
      icon: <FlaskConical className="h-3.5 w-3.5" />,
    },
  ];

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      {/* Fixed size: w-full on mobile, max-w-2xl on desktop. Fixed height via min/max to prevent jumps. */}
      <DialogContent
        className="w-full max-w-[95vw] @min-[40rem]:max-w-2xl p-0 gap-0 overflow-hidden flex flex-col"
        style={{ height: "min(680px, 90vh)" }}
      >
        <DialogHeader className="px-4 @min-[40rem]:px-6 pt-5 pb-0 shrink-0">
          <DialogTitle className="text-base @min-[40rem]:text-lg font-semibold">
            Create project
          </DialogTitle>
        </DialogHeader>

        {/* Tab bar */}
        <div className="flex gap-0.5 px-4 @min-[40rem]:px-6 pt-3 shrink-0 overflow-x-auto scrollbar-none">
          {tabs.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => switchTab(t.id)}
              className={cn(
                "flex items-center gap-1.5 px-2.5 @min-[40rem]:px-3 py-1.5 text-xs @min-[40rem]:text-sm rounded-md transition-colors whitespace-nowrap shrink-0",
                tab === t.id
                  ? "bg-surface text-foreground font-medium"
                  : "text-muted-foreground hover:text-foreground hover:bg-surface/50",
              )}
            >
              {t.icon}
              <span className="hidden xs:inline @min-[40rem]:inline">{t.label}</span>
              <span className="xs:hidden @min-[40rem]:hidden">
                {t.label.split(" ")[0]}
              </span>
              {t.id === "template" && selectedTemplateId && (
                <span className="h-1.5 w-1.5 rounded-full bg-accent" />
              )}
            </button>
          ))}
        </div>

        <div className="h-px bg-line mx-4 @min-[40rem]:mx-6 mt-2 shrink-0" />

        {/* Animated tab content, takes remaining height */}
        <div className="relative flex-1 overflow-hidden">
          <AnimatePresence initial={false} custom={dir} mode="wait">
            <motion.div
              key={tab}
              custom={dir}
              variants={variants}
              initial="enter"
              animate="center"
              exit="exit"
              transition={{ duration: 0.18, ease: "easeInOut" }}
              className="absolute inset-0 flex flex-col overflow-y-auto"
            >
              {/* ── New ─────────────────────────────────────────────────── */}
              {tab === "new" && (
                <form
                  onSubmit={submitNew}
                  className="flex flex-col flex-1 px-4 @min-[40rem]:px-6 py-4 @min-[40rem]:py-5 gap-4"
                >
                  <div className="space-y-1.5">
                    <Label htmlFor="proj-name">Project name</Label>
                    <Input
                      id="proj-name"
                      placeholder="e.g. Thesis Chapter 1"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      autoFocus
                    />
                  </div>

                  <div className="space-y-1.5">
                    <Label htmlFor="proj-desc">
                      Description{" "}
                      <span className="text-muted-foreground font-normal">
                        (optional)
                      </span>
                    </Label>
                    <Textarea
                      id="proj-desc"
                      placeholder="What is this project about?"
                      value={description}
                      onChange={(e) => setDescription(e.target.value)}
                      rows={3}
                      className="resize-none text-sm"
                    />
                  </div>

                  {destination}

                  <div className="mt-auto flex justify-end gap-2 pt-2">
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => onOpenChange(false)}
                    >
                      Cancel
                    </Button>
                    <Button type="submit" disabled={isLoading}>
                      {isLoading ? (
                        <>
                          <Loader2 className="me-2 h-4 w-4 animate-spin" />
                          Creating…
                        </>
                      ) : (
                        "Create project"
                      )}
                    </Button>
                  </div>
                </form>
              )}

              {/* ── Templates ───────────────────────────────────────────── */}
              {tab === "template" && (
                <div className="flex flex-col flex-1 min-h-0">
                  {/* Category chips */}
                  <div className="flex gap-1.5 px-4 @min-[40rem]:px-6 py-3 flex-wrap shrink-0">
                    {["All", ...LATEX_TEMPLATE_CATEGORIES].map((cat) => (
                      <button
                        key={cat}
                        type="button"
                        onClick={() => setCategoryFilter(cat)}
                        className={cn(
                          "px-2.5 py-0.5 text-xs rounded-full border transition-colors font-medium",
                          categoryFilter === cat
                            ? "bg-foreground text-background border-foreground"
                            : "border-line text-muted-foreground hover:border-foreground/40 hover:text-foreground",
                        )}
                      >
                        {cat}
                      </button>
                    ))}
                  </div>

                  {/* Card grid, scrollable */}
                  <div className="flex-1 overflow-y-auto px-4 @min-[40rem]:px-6 pb-2">
                    <div className="grid grid-cols-2 @min-[40rem]:grid-cols-3 gap-2 @min-[40rem]:gap-3">
                      {visibleTemplates.map((t) => (
                        <TemplateCard
                          key={t.id}
                          t={t}
                          selected={selectedTemplateId === t.id}
                          onClick={() => {
                            setSelectedTemplateId(t.id);
                            switchTab("new");
                          }}
                        />
                      ))}
                    </div>
                  </div>

                  {/* Footer */}
                  <div className="shrink-0 border-t border-line px-4 @min-[40rem]:px-6 py-3 flex justify-between items-center gap-2">
                    <p className="text-xs text-muted-foreground truncate">
                      {visibleTemplates.length} template
                      {visibleTemplates.length !== 1 ? "s" : ""}
                      {selectedTemplateId && (
                        <span className="ms-1.5 text-foreground">
                          · {getTemplateById(selectedTemplateId)?.name}
                        </span>
                      )}
                    </p>
                    <div className="flex gap-2 shrink-0">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          setSelectedTemplateId("");
                          switchTab("new");
                        }}
                      >
                        Scratch
                      </Button>
                      <Button
                        size="sm"
                        disabled={!selectedTemplateId}
                        onClick={() => switchTab("new")}
                      >
                        Use
                      </Button>
                    </div>
                  </div>
                </div>
              )}

              {/* ── ZIP Import ──────────────────────────────────────────── */}
              {tab === "zip" && (
                <div className="flex flex-col flex-1 px-4 @min-[40rem]:px-6 py-4 @min-[40rem]:py-5 gap-4">
                  <div
                    onDragOver={(e) => {
                      e.preventDefault();
                      setZipDragging(true);
                    }}
                    onDragLeave={() => setZipDragging(false)}
                    onDrop={handleZipDrop}
                    onClick={() => zipInputRef.current?.click()}
                    className={cn(
                      "flex-1 min-h-[140px] border-2 border-dashed rounded-lg p-6 text-center cursor-pointer transition-colors select-none flex flex-col items-center justify-center",
                      zipDragging
                        ? "border-accent bg-accent/5"
                        : "border-line hover:border-accent/50 hover:bg-surface/30",
                      zipFile && "border-accent/50 bg-accent/5",
                    )}
                  >
                    <input
                      ref={zipInputRef}
                      type="file"
                      accept=".zip"
                      className="sr-only"
                      onChange={(e) =>
                        handleZipFile(e.target.files?.[0] ?? null)
                      }
                    />
                    {zipFile ? (
                      <div className="flex items-center gap-3">
                        <FileArchive className="h-8 w-8 text-foreground shrink-0" />
                        <div className="text-start min-w-0">
                          <p className="font-medium text-sm truncate">
                            {zipFile.name}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {(zipFile.size / 1024).toFixed(1)} KB
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setZipFile(null);
                          }}
                          className="ms-2 text-muted-foreground hover:text-foreground"
                        >
                          <X className="h-4 w-4" />
                        </button>
                      </div>
                    ) : (
                      <>
                        <Upload className="h-8 w-8 mb-2 text-muted-foreground" />
                        <p className="text-sm text-muted-foreground">
                          Drop a{" "}
                          <span className="font-medium text-foreground">
                            .zip
                          </span>{" "}
                          or click to browse
                        </p>
                        <p className="text-xs text-muted-foreground/60 mt-1">
                          Main <code>.tex</code> detected automatically
                        </p>
                      </>
                    )}
                  </div>

                  {zipFile && (
                    <div className="space-y-1.5">
                      <Label htmlFor="zip-name">Project name</Label>
                      <Input
                        id="zip-name"
                        value={zipName}
                        onChange={(e) => setZipName(e.target.value)}
                        placeholder="Project name"
                      />
                    </div>
                  )}

                  {destination}

                  <div className="mt-auto flex justify-end gap-2">
                    <Button
                      variant="outline"
                      onClick={() => onOpenChange(false)}
                    >
                      Cancel
                    </Button>
                    <Button
                      onClick={submitZip}
                      disabled={!zipFile || isLoading}
                    >
                      {isLoading ? (
                        <>
                          <Loader2 className="me-2 h-4 w-4 animate-spin" />
                          Importing…
                        </>
                      ) : (
                        "Import project"
                      )}
                    </Button>
                  </div>
                </div>
              )}

              {/* ── ArXiv ───────────────────────────────────────────────── */}
              {tab === "arxiv" && (
                <div className="flex flex-col flex-1 px-4 @min-[40rem]:px-6 py-4 @min-[40rem]:py-5 gap-4">
                  <div className="space-y-1.5">
                    <Label htmlFor="arxiv-id">ArXiv ID</Label>
                    <Input
                      id="arxiv-id"
                      placeholder="e.g. 2301.01234 or 2301.01234v2"
                      value={arxivId}
                      onChange={(e) => {
                        setArxivId(e.target.value);
                        setArxivHint(null);
                        setArxivError(null);
                      }}
                      onKeyDown={(e) => e.key === "Enter" && submitArxiv()}
                      autoFocus
                    />
                    <p className="text-xs text-muted-foreground">
                      Add <code>v2</code>, <code>v3</code>… for a specific
                      version. If omitted and multiple exist, you&apos;ll be
                      prompted.
                    </p>
                  </div>

                  {arxivHint && (
                    <div className="flex gap-2 rounded-md border border-hue-amber/30 bg-hue-amber/10 px-3 py-2.5 text-sm text-hue-amber dark:text-hue-amber">
                      <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
                      <span>{arxivHint}</span>
                    </div>
                  )}
                  {arxivError && (
                    <div className="flex gap-2 rounded-md border border-danger/30 bg-danger/10 px-3 py-2.5 text-sm text-danger">
                      <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
                      <span>{arxivError}</span>
                    </div>
                  )}

                  {destination}

                  <div className="mt-auto flex justify-end gap-2">
                    <Button
                      variant="outline"
                      onClick={() => onOpenChange(false)}
                    >
                      Cancel
                    </Button>
                    <Button
                      onClick={submitArxiv}
                      disabled={!arxivId.trim() || isLoading}
                    >
                      {isLoading ? (
                        <>
                          <Loader2 className="me-2 h-4 w-4 animate-spin" />
                          Fetching…
                        </>
                      ) : (
                        "Import from ArXiv"
                      )}
                    </Button>
                  </div>
                </div>
              )}
            </motion.div>
          </AnimatePresence>
        </div>
      </DialogContent>
    </Dialog>
  );
}
