import type { ProjectFile } from "@/lib/api";
import type { ProjectFileItem } from "@/components/editor/file-tree/FileTreeTypes";

/** The editor's view of a project's files: kinds for icons, binary files marked. */
export function toFileItems(files: ProjectFile[]): ProjectFileItem[] {
  return files.map((f) => {
    if (f.isFolder) return { id: f.id.toString(), path: f.path, isMain: false, type: "folder" as const };
    const type: ProjectFileItem["type"] = f.path.endsWith(".tex")
      ? "tex"
      : f.path.endsWith(".bib")
        ? "bib"
        : /\.(sty|cls)$/.test(f.path)
          ? "sty"
          : /\.(png|jpe?g|gif|svg|webp)$/i.test(f.path)
            ? "image"
            : "other";
    return { id: f.id.toString(), path: f.path, isMain: f.isMain, type, binary: !!f.filePath };
  });
}
