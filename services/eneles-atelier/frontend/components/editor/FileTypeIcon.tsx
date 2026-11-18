"use client";

import { useSyncExternalStore } from "react";
import { useTheme } from "next-themes";
import { cn } from "@/lib/utils";

/**
 * File and folder icons from Material Icon Theme (MIT), the set most editors' file trees use, so a .tex, .bib, or .sty file looks the way people already know it.
 *
 * The icons and the manifest that maps names to them are static files under /file-icons, copied there on install (scripts/postinstall.mjs). The manifest is fetched once, the first time a tree is shown; until it arrives every entry shows the generic file or folder icon, so nothing shifts when it does.
 */
interface IconTables {
  extensions: Record<string, string>;
  names: Record<string, string>;
  folders: Record<string, string>;
}
interface Manifest extends IconTables {
  file: string;
  folder: string;
  /** Overrides for light backgrounds, where a few icons would be too pale. */
  light: IconTables;
}

let manifest: Manifest | null = null;
let requested = false;
const listeners = new Set<() => void>();

function subscribe(listener: () => void) {
  listeners.add(listener);
  if (!requested) {
    requested = true;
    fetch("/file-icons/manifest.json")
      .then((res) => (res.ok ? (res.json() as Promise<Manifest>) : null))
      .then((data) => {
        manifest = data;
        listeners.forEach((l) => l());
      })
      .catch(() => undefined);
  }
  return () => listeners.delete(listener);
}

function fileIcon(tables: IconTables, name: string): string | undefined {
  if (tables.names[name]) return tables.names[name];
  // The longest extension wins: "main.synctex.gz" tries "synctex.gz" before "gz".
  const parts = name.split(".");
  for (let i = 1; i < parts.length; i++) {
    const icon = tables.extensions[parts.slice(i).join(".")];
    if (icon) return icon;
  }
  return undefined;
}

function iconFor(m: Manifest | null, filename: string, isFolder: boolean, isExpanded: boolean, light: boolean): string {
  const name = (filename.split("/").pop() ?? filename).toLowerCase();
  if (isFolder) {
    const icon = (light && m?.light.folders[name]) || m?.folders[name] || m?.folder || "folder";
    return isExpanded ? `${icon}-open` : icon;
  }
  if (!m) return "file";
  return (light && fileIcon(m.light, name)) || fileIcon(m, name) || m.file;
}

interface FileTypeIconProps {
  filename: string;
  isFolder?: boolean;
  isExpanded?: boolean;
  className?: string;
}

export function FileTypeIcon({ filename, isFolder = false, isExpanded = false, className = "h-4 w-4 shrink-0" }: FileTypeIconProps) {
  const m = useSyncExternalStore(
    subscribe,
    () => manifest,
    () => null,
  );
  const { resolvedTheme } = useTheme();
  const icon = iconFor(m, filename, isFolder, isExpanded, resolvedTheme === "light");
  // Decorative: the name beside it says what the entry is.
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={`/file-icons/${icon}.svg`} alt="" aria-hidden draggable={false} className={cn("select-none", className)} />;
}
