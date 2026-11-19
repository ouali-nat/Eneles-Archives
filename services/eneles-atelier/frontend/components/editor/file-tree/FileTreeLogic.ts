import { type ProjectFileItem, type TreeNode } from "./FileTreeTypes";

/** Build a nested tree from flat file list using path prefixes */
export function buildTree(files: ProjectFileItem[]): TreeNode[] {
    const folders = files.filter((f) => f.type === "folder");
    const nonFolders = files.filter((f) => f.type !== "folder");

    const folderMap = new Map<string, TreeNode>();
    const roots: TreeNode[] = [];

    const sortedFolders = [...folders].sort(
        (a, b) => a.path.split("/").length - b.path.split("/").length
    );

    for (const folder of sortedFolders) {
        const node: TreeNode = { file: folder, children: [] };
        folderMap.set(folder.path, node);

        const parts = folder.path.split("/");
        if (parts.length > 1) {
            const parentPath = parts.slice(0, -1).join("/");
            const parent = folderMap.get(parentPath);
            if (parent) {
                parent.children.push(node);
                continue;
            }
        }
        roots.push(node);
    }

    for (const file of nonFolders) {
        const parts = file.path.split("/");
        if (parts.length > 1) {
            const parentPath = parts.slice(0, -1).join("/");
            const parent = folderMap.get(parentPath);
            if (parent) {
                parent.children.push({ file, children: [] });
                continue;
            }
        }
        roots.push({ file, children: [] });
    }

    const sortLevel = (nodes: TreeNode[]) => {
        nodes.sort((a, b) => {
            if (a.file.type === "folder" && b.file.type !== "folder") return -1;
            if (a.file.type !== "folder" && b.file.type === "folder") return 1;
            const aName = a.file.path.split("/").pop() || "";
            const bName = b.file.path.split("/").pop() || "";
            return aName.localeCompare(bName);
        });
        for (const n of nodes) {
            if (n.children.length) sortLevel(n.children);
        }
    };
    sortLevel(roots);

    return roots;
}
