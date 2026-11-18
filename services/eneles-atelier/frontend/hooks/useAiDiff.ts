"use client";

import { useEffect, useRef, useState } from "react";
import type { PendingAiDiff } from "@/lib/api";
import { projectsAPI } from "@/lib/api";

/**
 * The assistant's proposal awaiting review, kept with the project on the server so it is still there after a reload or on another device. Accepting and rejecting (whole files or single changes) live with the editor (EditorView), which owns the files; the diff itself is lib/ai-diff.ts.
 */
export function useAiDiff({ projectId, isAuthenticated, canEdit, initialDiff }: { projectId: string; isAuthenticated: boolean; canEdit: boolean; initialDiff: PendingAiDiff | null }) {
  const [aiPendingDiff, setAiPendingDiff] = useState<PendingAiDiff | null>(initialDiff);

  // Persist the pending diff, but only when it differs from what the server already holds: writing on open bumped the project's "last edited" time every time someone merely looked at it.
  const persisted = useRef(JSON.stringify(initialDiff ?? null));
  useEffect(() => {
    if (!isAuthenticated || !canEdit) return;
    const next = JSON.stringify(aiPendingDiff ?? null);
    if (next === persisted.current) return;
    persisted.current = next;
    projectsAPI.updateProject(projectId, { pendingAiDiff: aiPendingDiff }).catch(console.error);
  }, [isAuthenticated, canEdit, projectId, aiPendingDiff]);

  return { aiPendingDiff, setAiPendingDiff };
}
