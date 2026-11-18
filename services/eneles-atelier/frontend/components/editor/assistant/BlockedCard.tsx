"use client";

import Link from "next/link";
import { KeyRound } from "@/components/icons";
import { Button } from "@/components/ui/button";
import type { AiStatus } from "@/lib/api";

/**
 * In place of the composer when nothing can answer for this person: why, and the action that fixes it. Add an API key opens the editor's settings at Axya, where a key is added without leaving the project. Upgrade shows only when Platform AI is on and the plan lacks it. In development, the local test model can be chosen instead.
 */
export function BlockedCard({ status, onOpenSettings, onUseLocal }: { status: AiStatus; onOpenSettings?: () => void; onUseLocal?: () => void }) {
  const why = !status.canStoreKeys
    ? "This server cannot store API keys yet: an administrator has to set it up."
    : status.upgrade
      ? "Add an API key from a model provider to use the assistant. The hosted Eneles AI provider is available when the platform has configured it."
      : "Axya works with your own API key from a model provider, such as Anthropic, OpenAI, Google, or OpenRouter. Your key stays on our server, sealed, and is never shown again.";
  return (
    <section aria-label="Axya needs an API key" className="flex flex-col gap-3 rounded-[var(--radius-tray)] border border-line bg-card p-4">
      <div className="flex items-start gap-3">
        <span className="grid size-9 shrink-0 place-items-center rounded-[var(--radius)] border border-line bg-surface">
          <KeyRound aria-hidden className="size-4 text-muted-foreground" />
        </span>
        <div className="flex min-w-0 flex-col gap-1">
          <h3 className="type-base font-medium text-foreground">Add an API key to use Axya</h3>
          <p className="type-small text-muted-foreground">{why}</p>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {status.canStoreKeys && onOpenSettings && (
          <Button type="button" onClick={onOpenSettings}>
            Add an API key
          </Button>
        )}
        {status.upgrade && (
          <Button asChild variant="outline">
            <Link href="/billing">Upgrade</Link>
          </Button>
        )}
        {onUseLocal && (
          <Button type="button" variant="ghost" onClick={onUseLocal} className="text-muted-foreground">
            Use the local test model
          </Button>
        )}
      </div>
    </section>
  );
}
