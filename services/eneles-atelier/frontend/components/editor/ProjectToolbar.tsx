"use client";

import { useState } from "react";
import { Save, FileText, Code, LayoutTemplate, Hash, History, MessageSquare, MessagesSquare, ArrowLeft, PanelLeft, PanelRight, PanelBottom, UserPlus, Settings, Keyboard, Command, Sigma, Sparkles } from "@/components/icons";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
  DropdownMenuCheckboxItem,
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  DropdownMenuSubContent,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { AxyaMark } from "@/components/editor/assistant/Conversation";
import {
  type ProjectCollaborator,
  type ProjectCollaboratorUser,
} from "@/lib/api";
import { LATEX_ENVIRONMENTS } from "@/lib/editor/commands";
import { PresenceAvatars } from "./PresenceAvatars";
import { BrandMarks } from "@/components/BrandMarks";
import { type RemoteUser } from "@/hooks/useCollaboration";
import Link from "next/link";
import { EditableTitle } from "@/components/editor/EditableTitle";
import { SaveStatus } from "@/components/ui/status";
import type { Workspace } from "@/components/editor/workspace/DockWorkspace";
import { LAYOUTS } from "@/components/editor/workspace/layouts";
import { PANELS, PANEL_IDS, type PanelId } from "@/components/editor/workspace/panels";

interface ProjectToolbarProps {
  projectTitle: string;
  onTitleChange?: (title: string) => void;
  onSave: () => void;
  onDownloadPdf?: () => void;
  onDownloadSource?: () => void;
  onSaveAsTemplate?: () => void;
  onOpenGithub?: () => void;
  onOpenWordCount?: () => void;
  /** Open the History panel filtered to the file being edited. */
  onShowFileHistory?: () => void;
  /** The dock: the View menu arranges it, and the panel buttons show and hide its panels. */
  workspace: Workspace;
  /** The assistant is a dock panel or floats over the editor; which, whether it is showing, and how to change both. */
  assistant: { form: "panel" | "dock"; on: boolean; toggle: () => void; setForm: (form: "panel" | "dock") => void };
  /** Open comments and suggestions in the current file. */
  reviewCount?: number;
  chatUnread?: number;
  /** Errors in the last compile, marked on the Logs button. */
  logErrors?: number;
  onOpenSettings?: () => void;
  onCompile?: () => void;
  onBack: () => void;
  onShareClick?: () => void;
  isSaving?: boolean;
  canEdit?: boolean;
  collaborators?: ProjectCollaborator[];
  owner?: ProjectCollaboratorUser | null;
  onToggleDrawing?: () => void;
  remoteUsers?: RemoteUser[];
  filePathMap?: Record<string, string>;
  onOpenCommandPalette?: () => void;
  onOpenInsertPalette?: () => void;
  onOpenShortcuts?: () => void;
  /** Opens the first-run tutorial again. */
  onShowTutorial?: () => void;
  onInsertSnippet?: (text: string) => void;
  saveStatus?: "saved" | "saving" | "unsaved" | "error";
  /** Set when this project is a reference paper: the project it belongs to. */
  referenceOf?: { uid: string; title: string } | null;
}

function MenuTrigger({
  children,
  label,
}: {
  children: React.ReactNode;
  label: string;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="px-2.5 font-medium text-foreground hover:bg-surface-hover"
        >
          {label}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-[180px]">
        {children}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** A submenu of a toolbar menu. */
function SubMenu({ label, className, children }: { label: string; className?: string; children: React.ReactNode }) {
  return (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger>{label}</DropdownMenuSubTrigger>
      <DropdownMenuSubContent className={className}>{children}</DropdownMenuSubContent>
    </DropdownMenuSub>
  );
}

/** A toolbar button for one dock panel. Pressed while the panel is on screen; a press opens it, brings it in front of the tabs it shares a group with, or, when it already is in front, closes it. */
function PanelToggle({ id, workspace, label, title, children }: { id: PanelId; workspace: Workspace; label: string; title: string; children: React.ReactNode }) {
  const visible = workspace.isVisible(id);
  return (
    <Button
      variant="ghost"
      size="icon"
      className={cn("relative size-8", visible && "bg-surface-hover")}
      onClick={() => workspace.toggle(id)}
      aria-label={label}
      aria-pressed={visible}
      title={title}
    >
      {children}
    </Button>
  );
}

export function ProjectToolbar({
  projectTitle,
  onTitleChange,
  onSave,
  onDownloadPdf,
  onDownloadSource,
  onSaveAsTemplate,
  onOpenGithub,
  onOpenWordCount,
  onShowFileHistory,
  workspace,
  assistant,
  reviewCount = 0,
  chatUnread = 0,
  logErrors = 0,
  onOpenSettings,
  onCompile,
  onToggleDrawing,
  onBack,
  onShareClick,
  isSaving = false,
  canEdit = true,
  collaborators = [],
  owner,
  remoteUsers = [],
  filePathMap = {},
  onOpenCommandPalette,
  onOpenInsertPalette,
  onOpenShortcuts,
  onShowTutorial,
  onInsertSnippet,
  saveStatus,
  referenceOf,
}: ProjectToolbarProps) {

  return (
    <div className="flex items-center justify-between px-2 h-12 border-b bg-background shrink-0 relative">
      <div className="flex items-center gap-0.5 shrink-0">
        <Button
          variant="ghost"
          size="icon"
          className="size-8 shrink-0"
          onClick={onBack}
          aria-label="Back to projects"
          title="Back to projects"
        >
          <ArrowLeft aria-hidden className="h-4 w-4 rtl:-scale-x-100" />
        </Button>
        <div className="w-px h-5 bg-line mx-0.5" />
        <MenuTrigger label="File">
          <DropdownMenuItem onClick={onSave} disabled={isSaving || !canEdit}>
            <Save className="h-4 w-4 me-2" />
            Save{" "}
            <span className="ms-auto text-xs text-muted-foreground">
              Ctrl+S
            </span>
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={onDownloadPdf} disabled={!onDownloadPdf}>
            <FileText className="h-4 w-4 me-2" /> Download PDF
          </DropdownMenuItem>
          <DropdownMenuItem onClick={onDownloadSource}>
            <Code className="h-4 w-4 me-2" /> Download ZIP
          </DropdownMenuItem>
          {onShowFileHistory && (
            <DropdownMenuItem onClick={onShowFileHistory}>
              <History className="h-4 w-4 me-2" /> History of this file
            </DropdownMenuItem>
          )}
          {onOpenWordCount && (
            <DropdownMenuItem onClick={onOpenWordCount}>
              <Hash className="h-4 w-4 me-2" /> Word count
            </DropdownMenuItem>
          )}
          {onOpenGithub && (
            <DropdownMenuItem onClick={onOpenGithub}>
              <BrandMarks.gitHub className="h-4 w-4 me-2" /> GitHub…
            </DropdownMenuItem>
          )}
          {onSaveAsTemplate && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={onSaveAsTemplate}>
                <LayoutTemplate className="h-4 w-4 me-2" /> Save as template…
              </DropdownMenuItem>
            </>
          )}
        </MenuTrigger>
        <MenuTrigger label="Edit">
          {LATEX_ENVIRONMENTS.map((env) => (
            <DropdownMenuItem
              key={env.label}
              onClick={() => onInsertSnippet?.(env.template)}
              disabled={!onInsertSnippet}
            >
              <Sigma className="h-4 w-4 me-2" /> {env.label}
            </DropdownMenuItem>
          ))}
        </MenuTrigger>
        <MenuTrigger label="View">
          <SubMenu label="Layouts" className="min-w-[220px]">
            {LAYOUTS.map((layout) => (
              <DropdownMenuCheckboxItem key={layout.id} checked={workspace.layoutId === layout.id} onSelect={() => workspace.applyLayout(layout.id)}>
                {layout.name}
              </DropdownMenuCheckboxItem>
            ))}
          </SubMenu>
          <SubMenu label="Panels" className="min-w-[180px]">
            {PANEL_IDS.map((id) => {
              // A floating assistant is not in the dock, but it is still switched on and off here.
              const floating = id === "assistant" && assistant.form === "dock";
              return (
                <DropdownMenuCheckboxItem
                  key={id}
                  checked={floating ? assistant.on : workspace.isOpen(id)}
                  disabled={!PANELS[id].closable}
                  // Stays open, so several panels can be switched in one visit.
                  onSelect={(event) => event.preventDefault()}
                  onCheckedChange={(checked) => (floating ? assistant.toggle() : checked ? workspace.show(id) : workspace.hide(id))}
                >
                  {PANELS[id].title}
                </DropdownMenuCheckboxItem>
              );
            })}
          </SubMenu>
          <SubMenu label="Axya" className="min-w-[180px]">
            <DropdownMenuCheckboxItem checked={assistant.form === "panel"} onSelect={() => assistant.setForm("panel")}>
              As a panel
            </DropdownMenuCheckboxItem>
            <DropdownMenuCheckboxItem checked={assistant.form === "dock"} onSelect={() => assistant.setForm("dock")}>
              Floating over the editor
            </DropdownMenuCheckboxItem>
          </SubMenu>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => workspace.reset()}>Reset layout</DropdownMenuItem>
          {onShowTutorial && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={onShowTutorial}>Show the tutorial</DropdownMenuItem>
            </>
          )}
        </MenuTrigger>
        {onOpenCommandPalette && (
          <Button
            variant="ghost"
            size="icon"
            className="size-8 max-sm:hidden"
            onClick={onOpenCommandPalette}
            title="Command palette (Ctrl+K)"
          >
            <Command className="h-4 w-4" />
          </Button>
        )}
        {onOpenShortcuts && (
          <Button
            variant="ghost"
            size="icon"
            className="size-8 max-sm:hidden"
            onClick={onOpenShortcuts}
            title="Keyboard shortcuts"
          >
            <Keyboard className="h-4 w-4" />
          </Button>
        )}
      </div>

      {/* On a phone the menus and Share fill the bar; the project's name is in the browser tab and on the projects page. */}
      <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 flex items-center justify-center max-w-[40%] pointer-events-none z-10 max-sm:hidden">
        <div className="pointer-events-auto flex min-w-0 items-center gap-2">
            <EditableTitle value={projectTitle} onChange={(title) => onTitleChange?.(title)} label="Project title" disabled={!canEdit} />
            <SaveStatus state={saveStatus ?? "idle"} />
            {referenceOf && (
              <Link
                href={`/projects/${referenceOf.uid}`}
                title={`A reference paper attached to ${referenceOf.title}. Open that project.`}
                className="max-w-40 shrink-0 truncate rounded-[var(--radius-inset)] bg-surface px-1.5 py-0.5 type-micro font-medium text-muted-foreground transition-colors hover:text-foreground"
              >
                Reference for {referenceOf.title}
              </Link>
            )}
        </div>
      </div>

      <div className="flex items-center gap-1 shrink-0">
        <PresenceAvatars remoteUsers={remoteUsers} filePathMap={filePathMap} />

        {/* Below 1024px there is no room for them beside the title, which they ran into; View → Panels and the command palette (Ctrl+K) open and close every panel. */}
        <div className="flex items-center gap-0.5 max-lg:hidden">
          <Button
            variant="ghost"
            size="icon"
            className={cn("relative size-8", (assistant.form === "dock" ? assistant.on : workspace.isVisible("assistant")) && "bg-surface-hover")}
            onClick={assistant.toggle}
            aria-label="Axya"
            aria-pressed={assistant.form === "dock" ? assistant.on : workspace.isVisible("assistant")}
            title="Axya, the assistant"
          >
            <AxyaMark size={16} />
          </Button>
          <PanelToggle id="review" workspace={workspace} label={reviewCount ? `Review, ${reviewCount} open in this file` : "Review"} title="Comments and suggestions">
            <MessageSquare className="size-4" />
            {reviewCount > 0 && (
              <span className="absolute -end-0.5 -top-0.5 min-w-3.5 rounded-full bg-warning px-1 text-[9px] font-semibold leading-3.5 text-background">
                {reviewCount > 99 ? "99+" : reviewCount}
              </span>
            )}
          </PanelToggle>
          <PanelToggle id="chat" workspace={workspace} label={chatUnread ? `Chat, ${chatUnread} new` : "Chat"} title="Project chat">
            <MessagesSquare className="size-4" />
            {chatUnread > 0 && <span className="absolute -end-0.5 -top-0.5 size-2 rounded-full bg-accent" aria-hidden />}
          </PanelToggle>
          <PanelToggle id="files" workspace={workspace} label="Files panel" title="Files panel">
            <PanelLeft className="size-4" />
          </PanelToggle>
          <PanelToggle id="logs" workspace={workspace} label={logErrors ? `Logs panel, ${logErrors} ${logErrors === 1 ? "error" : "errors"}` : "Logs panel"} title="Logs panel">
            <PanelBottom className="size-4" />
            {logErrors > 0 && <span className="absolute -end-0.5 -top-0.5 size-2 rounded-full bg-danger" aria-hidden />}
          </PanelToggle>
          <PanelToggle id="pdf" workspace={workspace} label="PDF preview" title="PDF preview">
            <PanelRight className="size-4" />
          </PanelToggle>
        </div>

        <div className="w-px h-5 bg-line mx-0.5 max-sm:hidden" />

        <Button
          variant="outline"
          size="sm"
          className="gap-1.5"
          onClick={onShareClick}
        >
          <UserPlus className="size-4" /> Share
        </Button>
        <Button variant="ghost" size="icon" onClick={onOpenSettings} aria-label="Project settings" title="Project settings">
          <Settings aria-hidden className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
