"use client";

import { useState } from "react";
import { projectsAPI } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Download, FileText } from "@/components/icons";

/** An image or other binary file in a project: shown, with how to use it. `src` and `onDownload` stand in for the API's address and the browser's download where the file is not on the server (a folder in the desktop app). */
export function BinaryPreview({ projectId, fileId, path, src, onDownload }: { projectId: string; fileId: string; path: string; src?: string | null; onDownload?: () => void }) {
  const url = src !== undefined ? (src ?? "") : projectsAPI.rawFileUrl(projectId, fileId);
  const name = path.split("/").pop() ?? path;
  const isImage = /\.(png|jpe?g|gif|webp)$/i.test(path);
  const [broken, setBroken] = useState(false);
  const usage = /\.(png|jpe?g|pdf|eps)$/i.test(path)
    ? `\\includegraphics{${path}}`
    : null;

  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 overflow-auto bg-background p-6 text-center">
      {isImage && url && !broken ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={url}
          alt={name}
          onError={() => setBroken(true)}
          className="max-h-[70%] max-w-full rounded-[var(--radius-inset)] border border-line object-contain"
        />
      ) : (
        <FileText className="size-12 text-muted-foreground" aria-hidden />
      )}
      <div className="flex flex-col gap-1">
        <p className="type-base font-medium">{name}</p>
        <p className="max-w-md type-small text-muted-foreground">
          {broken ? "This image could not be shown. " : ""}
          This file is used as it is when the project compiles.
          {usage && (
            <>
              {" "}Insert it with <code className="rounded bg-surface px-1 font-mono">{usage}</code>.
            </>
          )}
        </p>
      </div>
      {onDownload ? (
        <Button variant="outline" size="sm" onClick={onDownload}>
          <Download /> Download
        </Button>
      ) : (
        <Button asChild variant="outline" size="sm">
          <a href={url} download={name}>
            <Download /> Download
          </a>
        </Button>
      )}
    </div>
  );
}
