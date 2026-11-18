"use client";

import { useLabelColors } from "@/hooks/useLabelColors";
import { LabelChip } from "@/components/essential/resource-list/LabelChip";

import { useState, useEffect, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import { Snip, snipsAPI } from "@/lib/api";
import { ResourceList } from "@/components/essential/resource-list/ResourceList";
import { SnipPanel } from "@/components/essential/snips/SnipPanel";
import { SnipThumb } from "@/components/essential/snips/SnipThumb";
import { ImageIcon } from "@/components/icons";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { formatFileSize } from "@/lib/utils";


interface SnipWithTags extends Snip {
  tags?: string[];
  imageUrl?: string;
  metadata?: {
    size?: string;
  };
}

export default function SnipsPage() {
  const { user, isAuthenticated } = useAuth();
  const router = useRouter();
  const [snips, setSnips] = useState<SnipWithTags[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isUploading, setIsUploading] = useState<boolean>(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const snipsRef = useRef<SnipWithTags[]>([]);
  useEffect(() => {
    snipsRef.current = snips;
  });
  const closePanel = useCallback(() => setOpenId(null), []);
  const stepPanel = useCallback((direction: -1 | 1) => {
    setOpenId((current) => {
      const list = snipsRef.current;
      const index = list.findIndex((s) => s.id === current);
      return list[index + direction]?.id ?? current;
    });
  }, []);
  const { colors: tagColors, setColor: saveTagColor } = useLabelColors();

  // Show the loader again whenever a sign-in starts a new fetch. The first fetch needs nothing: `isLoading` starts true.
  const [wasAuthenticated, setWasAuthenticated] = useState(isAuthenticated);
  if (wasAuthenticated !== isAuthenticated) {
    setWasAuthenticated(isAuthenticated);
    if (isAuthenticated) setIsLoading(true);
  }

  // Fetch snips from API on component mount
  useEffect(() => {
    if (!isAuthenticated) return;

    const fetchSnips = async () => {
      try {
        const res = await snipsAPI.getMySnips();
        const snipsWithUrls = res.data.map((snip) => ({
          ...snip,
          imageUrl: snip.imageUrl || undefined,
          latexCode: snip.latexContent,
          description: snip.originalText,
          processingStatus: (snip.status === "error"
            ? "failed"
            : snip.status) as SnipWithTags["processingStatus"],
        }));
        setSnips(snipsWithUrls);
      } catch (error) {
        console.error("Error fetching snips:", error);
        toast.error("Failed to load your snips");
        setSnips([]);
      } finally {
        setIsLoading(false);
      }
    };

    fetchSnips();
  }, [isAuthenticated]);

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "completed":
        return (
          <Badge variant="default" className="bg-hue-green">
            Completed
          </Badge>
        );
      case "processing":
        return (
          <Badge variant="default" className="bg-hue-amber">
            Processing
          </Badge>
        );
      case "error":
        return <Badge variant="destructive">Error</Badge>;
      default:
        return <Badge variant="outline">Pending</Badge>;
    }
  };

  const handleSnipUpload = useCallback(
    async (file: File) => {
      if (!isAuthenticated) {
        toast.error("You must be logged in to upload");
        return;
      }

      setIsUploading(true);

      try {
        const newSnip = (await snipsAPI.create(file,
          file.name,
        )) as SnipWithTags;

        // Fetch the image URL from backend
        try {
          const imageUrl = await snipsAPI.getSnipImageUrl(newSnip.id.toString(),
          );
          newSnip.imageUrl = imageUrl;
        } catch (error) {
          console.error(
            `Failed to get image URL for new snip ${newSnip.id}:`,
            error,
          );
          newSnip.imageUrl = undefined;
        }

        newSnip.title = file.name;
        newSnip.tags = [];

        // Update status to processing
        newSnip.status = "processing";
        setSnips((prevSnips) => [newSnip, ...prevSnips]);

        toast.success("Image uploaded successfully. Processing...");

        // Automatically process the snip
        try {
          const result = await snipsAPI.processSnip(newSnip.id.toString(),
          );

          // Update the snip with processing results
          setSnips((prevSnips) =>
            prevSnips.map((snip) =>
              snip.id === newSnip.id
                ? {
                    ...snip,
                    status: result.status as any,
                    latexContent: result.latexContent,
                  }
                : snip,
            ),
          );

          toast.success("Image processed successfully");
        } catch (error: any) {
          console.error("Error processing image:", error);
          // Set status to pending on error so user can retry
          setSnips((prevSnips) =>
            prevSnips.map((snip) =>
              snip.id === newSnip.id
                ? {
                    ...snip,
                    status: "pending" as any,
                  }
                : snip,
            ),
          );
          toast.error("Processing failed. You can retry from the detail page.");
        }
      } catch (error: any) {
        console.error("Error uploading image:", error);
        toast.error(error.message || "Failed to upload image");
      } finally {
        setIsUploading(false);
      }
    },
    [isAuthenticated],
  );

  // Handle clipboard paste for images
  useEffect(() => {
    const handlePaste = async (e: ClipboardEvent) => {
      // Only handle if not typing in an input/textarea
      const target = e.target as HTMLElement;
      if (
        target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.isContentEditable
      ) {
        return;
      }

      const items = e.clipboardData?.items;
      if (!items) return;

      // Look for image in clipboard
      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        if (item.type.indexOf("image") !== -1) {
          e.preventDefault();

          const file = item.getAsFile();
          if (file) {
            // Generate a filename with timestamp
            const timestamp = Date.now();
            const extension = file.type.split("/")[1] || "png";
            const filename = `clipboard-${timestamp}.${extension}`;

            // Create a new File object with the filename
            const fileWithName = new File([file], filename, {
              type: file.type,
            });

            // Upload the image
            await handleSnipUpload(fileWithName);
          }
          break;
        }
      }
    };

    window.addEventListener("paste", handlePaste);
    return () => {
      window.removeEventListener("paste", handlePaste);
    };
  }, [handleSnipUpload]);

  const handleDelete = async (id: string) => {
    if (!isAuthenticated) return;

    try {
      await snipsAPI.deleteSnip(id);
      setSnips((prev) => prev.filter((snip) => snip.id !== id));
    } catch (error) {
      console.error("Error deleting snip:", error);
      throw error;
    }
  };

  const handleArchive = async (ids: string[]) => {
    if (!isAuthenticated) return;

    try {
      const updates = ids
        .map((id) => {
          const snip = snips.find((s) => s.id === id);
          if (!snip) return null;
          const currentTags = snip.tags || [];
          const isArchived = currentTags.includes("archived");
          const updatedTags = isArchived
            ? currentTags.filter((tag) => tag !== "archived")
            : [...currentTags, "archived"];
          return { id, updatedTags };
        })
        .filter(Boolean) as { id: string; updatedTags: string[] }[];

      await Promise.all(
        updates.map(({ id, updatedTags }) =>
          snipsAPI.updateSnip(id, { tags: updatedTags }),
        ),
      );

      // Update local state in one batch
      setSnips((prev) =>
        prev.map((s) => {
          const update = updates.find((u) => u.id === s.id);
          return update ? { ...s, tags: update.updatedTags } : s;
        }),
      );

      if (ids.length === 1) {
        const snip = snips.find((s) => s.id === ids[0]);
        const isArchived = snip?.tags?.includes("archived");
        toast.success(isArchived ? "Snip archived" : "Snip unarchived");
      } else {
        toast.success(`${ids.length} snip(s) archived`);
      }
    } catch (error) {
      console.error("Error archiving snips:", error);
      toast.error("Failed to archive snip(s)");
    }
  };

  const handleLabel = async (ids: string[], tag: string, color?: string) => {
    if (!isAuthenticated) return;
    try {
      const updates = ids
        .map((id) => {
          const snip = snips.find((s) => s.id === id);
          if (!snip) return null;
          const currentTags = snip.tags || [];
          const updatedTags = currentTags.includes(tag)
            ? currentTags.filter((t) => t !== tag)
            : [...currentTags, tag];
          return { id, updatedTags };
        })
        .filter(Boolean) as { id: string; updatedTags: string[] }[];

      await Promise.all(
        updates.map(({ id, updatedTags }) =>
          snipsAPI.updateSnip(id, { tags: updatedTags }),
        ),
      );

      // Update local state in one batch
      setSnips((prev) =>
        prev.map((s) => {
          const update = updates.find((u) => u.id === s.id);
          return update ? { ...s, tags: update.updatedTags } : s;
        }),
      );

      if (color) saveTagColor(tag, color);
      toast.success(
        ids.length === 1
          ? `Label "${tag}" updated`
          : `Label "${tag}" updated for ${ids.length} snip(s)`,
      );
    } catch (error) {
      console.error("Error updating label:", error);
      toast.error("Failed to update label");
    }
  };

  // Pressing a snip shows it in a panel beside the list (its own page is a button there), so snips can be looked through and copied without leaving the list.
  const openIndex = openId ? snips.findIndex((s) => s.id === openId) : -1;
  const openSnip = openIndex >= 0 ? snips[openIndex] : null;

  return (
    <>
    <ResourceList<SnipWithTags>
      items={snips}
      isLoading={isLoading}
      isUploading={isUploading}
      title="Snips"
      itemNoun="snips"
      preview="thumb"
      description="Upload, process, and extract LaTeX from images"
      acceptFileType="image/*"
      fileTypeLabel="image"
      onUpload={handleSnipUpload}
      onDelete={handleDelete}
      onArchive={handleArchive}
      onLabel={handleLabel}
      onItemClick={(snip) => setOpenId(snip.id)}
      getPreviewUrl={(snip) => snip.imageUrl || null}
      formatFileSize={(snip) => {
        if (!snip.fileSize) return null;
        return formatFileSize(snip.fileSize);
      }}
      getMetadata={(snip) => {
        if (!snip.fileSize) return null;
        return { size: formatFileSize(snip.fileSize) };
      }}
      renderItemPreview={(snip, previewUrl) => <SnipThumb imageUrl={previewUrl} latex={snip.latexContent} title={snip.title} className="size-32 rounded-[var(--radius)]" />}
      renderItemMetadata={(snip) => {
        const snipTags = (snip.tags || []).filter(
          (t: string) => t !== "archived",
        );
        return (
          <div className="flex items-center gap-1.5">
            {snipTags.map((tag: string) => {
              return <LabelChip key={tag} label={tag} color={tagColors[tag]} />;
            })}
          </div>
        );
      }}
      getStatusBadge={getStatusBadge}
      tagColors={tagColors}
    />
    <SnipPanel
      snip={openSnip}
      position={openSnip ? { index: openIndex, total: snips.length } : undefined}
      onClose={closePanel}
      onStep={stepPanel}
      onDelete={handleDelete}
      status={openSnip ? getStatusBadge(openSnip.status) : undefined}
      labelColors={tagColors}
    />
    </>
  );
}
