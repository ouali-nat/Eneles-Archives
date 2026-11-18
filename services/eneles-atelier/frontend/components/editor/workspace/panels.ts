import { BookOpen, Code, FileText, Folder, History, List, MessageSquare, MessagesSquare, Sparkles, Terminal, type Icon } from "@/components/icons";

/** Every panel of the editor screen. Each is a first-class dock panel: it can be tabbed with any other, split to any side, resized, closed, and reopened. */
export const PANEL_IDS = ["files", "contents", "references", "history", "editor", "pdf", "logs", "review", "chat", "assistant"] as const;

export type PanelId = (typeof PANEL_IDS)[number];

export interface PanelInfo {
  /** The tab's text and the name in the View menu, in sentence case. */
  title: string;
  icon: Icon;
  /** The editor is the one panel that cannot be closed: everything else is arranged around it. */
  closable: boolean;
}

export const PANELS: Record<PanelId, PanelInfo> = {
  files: { title: "Files", icon: Folder, closable: true },
  contents: { title: "Contents", icon: List, closable: true },
  references: { title: "References", icon: BookOpen, closable: true },
  history: { title: "History", icon: History, closable: true },
  editor: { title: "Editor", icon: Code, closable: false },
  pdf: { title: "PDF", icon: FileText, closable: true },
  logs: { title: "Logs", icon: Terminal, closable: true },
  review: { title: "Review", icon: MessageSquare, closable: true },
  chat: { title: "Chat", icon: MessagesSquare, closable: true },
  assistant: { title: "Axya", icon: Sparkles, closable: true },
};

export function isPanelId(value: unknown): value is PanelId {
  return typeof value === "string" && (PANEL_IDS as readonly string[]).includes(value);
}
