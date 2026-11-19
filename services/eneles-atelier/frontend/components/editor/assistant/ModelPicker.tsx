"use client";

import { useState } from "react";
import { Command as CommandPrimitive } from "cmdk";
import { Check, ChevronDown, Loader2, RotateCcw, Search, Settings2 } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import type { AiModel, AiStatus } from "@/lib/api";
import { cn } from "@/lib/utils";
import { choiceLabel, choosableProviders, formatTokens, refreshModels, useModels } from "./ai-models";
import type { ModelChoice } from "./history";
import { modelName } from "@/lib/ai/model-name";

/** What a model can do, in two short tags: its context, and whether it can edit files (the assistant's edits need tool use). */
export function ModelFacts({ model, className }: { model: Pick<AiModel, "contextTokens" | "tools" | "suggested">; className?: string }) {
  const context = formatTokens(model.contextTokens);
  return (
    <span className={cn("flex shrink-0 items-center gap-1.5 type-small text-muted-foreground", className)}>
      {model.suggested && <span className="rounded-[var(--radius-inset)] bg-surface px-1.5 text-foreground">{model.suggested === "flagship" ? "Best" : "Fast"}</span>}
      {context && <span className="tabular-nums">{context}</span>}
      {model.tools === false ? (
        <span className="text-warning" title="This model cannot use tools: Axya answers, but cannot propose edits.">
          No edits
        </span>
      ) : model.tools === null ? (
        <span title="The provider does not say whether this model can use tools. Axya tries, and answers without edits if it cannot.">Edits?</span>
      ) : null}
    </span>
  );
}

/**
 * The composer's model picker: the model answering this conversation, and a searchable list of every model the person can use, grouped by provider (their own keys, then the platform when it is on, then the local test model in development), the suggested models first, each with its context size and whether it can edit files. The choice is remembered with the conversation and for the next one.
 */
export function ModelPicker({ status, value, onChange, onOpenSettings, disabled = false, variant = "quiet", id }: { status: AiStatus; value: ModelChoice | null; onChange: (choice: ModelChoice) => void; onOpenSettings?: () => void; disabled?: boolean; /** quiet: the composer's text trigger; field: a full-width control for a settings form. */ variant?: "quiet" | "field"; id?: string }) {
  const [open, setOpen] = useState(false);
  const providers = choosableProviders(status);
  const remote = providers.map((p) => p.id).filter((id) => id !== "local");
  const models = useModels(remote);
  const label = choiceLabel(status, value, models);
  // What answers when nothing is chosen: the account's default, else the first key's suggested model, else the platform.
  const current = value ?? (status.preferences.provider ? { provider: status.preferences.provider, model: status.preferences.model } : status.keys[0] ? { provider: status.keys[0].provider as string, model: null } : status.platform.available ? { provider: "platform", model: null } : null);
  const isCurrent = (provider: string, model: string | null, index: number) => !!current && current.provider === provider && (current.model ? current.model === model : index === 0);
  const pick = (choice: ModelChoice) => {
    onChange(choice);
    setOpen(false);
  };
  const item = "flex min-h-10 cursor-default items-center gap-2 rounded-[var(--radius-item)] px-2 py-1.5 type-base outline-hidden select-none data-[selected=true]:bg-surface-hover";

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        {variant === "field" ? (
          <Button id={id} type="button" variant="outline" disabled={disabled} aria-label={`Model: ${label}`} className="w-full min-w-0 justify-between font-normal">
            <span className="min-w-0 truncate">{label}</span>
            <ChevronDown aria-hidden className="size-4 shrink-0 text-muted-foreground" />
          </Button>
        ) : (
          <Button type="button" variant="ghost" size="sm" disabled={disabled} aria-label={`Model: ${label}`} title="Choose the model" className="min-w-0 max-w-48 gap-1 px-2 font-normal text-muted-foreground hover:text-foreground">
            <span className="min-w-0 truncate type-small">{label}</span>
            <ChevronDown aria-hidden className="size-4 shrink-0" />
          </Button>
        )}
      </PopoverTrigger>
      <PopoverContent align="start" side={variant === "field" ? "bottom" : "top"} className="w-[min(24rem,calc(100vw-2rem))] p-0">
        <CommandPrimitive loop className="flex flex-col">
          <div className="flex h-11 items-center gap-2 border-b border-line px-3">
            <Search aria-hidden className="size-4 shrink-0 text-muted-foreground" />
            <CommandPrimitive.Input autoFocus placeholder="Search models" className="h-10 w-full bg-transparent type-base outline-hidden placeholder:text-muted-foreground" />
          </div>
          <CommandPrimitive.List className="max-h-80 overflow-y-auto p-1">
            <CommandPrimitive.Empty className="px-3 py-6 text-center type-base text-muted-foreground">No model matches.</CommandPrimitive.Empty>
            {providers.map((p) => {
              if (p.id === "local") {
                return (
                  <CommandPrimitive.Group key={p.id} heading="Development" className="[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:type-small [&_[cmdk-group-heading]]:text-muted-foreground">
                    <CommandPrimitive.Item value="local test model" onSelect={() => pick({ provider: "local", model: null })} className={item}>
                      <span className="min-w-0 flex-1 truncate">Local test model</span>
                      <span className="type-small text-muted-foreground">No model call</span>
                      <Check aria-hidden className={cn("size-4 shrink-0", current?.provider === "local" ? "opacity-100" : "opacity-0")} />
                    </CommandPrimitive.Item>
                  </CommandPrimitive.Group>
                );
              }
              const entry = models.get(p.id);
              const list = entry?.models ?? [];
              const key = status.keys.find((k) => k.provider === p.id);
              return (
                <CommandPrimitive.Group key={p.id} heading={key ? `${p.name} · key ending ${key.last4}` : p.name} className="[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:type-small [&_[cmdk-group-heading]]:text-muted-foreground">
                  {entry?.state === "loading" && !list.length && (
                    <CommandPrimitive.Item disabled value={`${p.id} loading`} className={cn(item, "text-muted-foreground")}>
                      <Loader2 aria-hidden className="size-4 animate-spin" />
                      Listing models
                    </CommandPrimitive.Item>
                  )}
                  {entry?.state === "error" && (
                    <CommandPrimitive.Item value={`${p.id} retry`} onSelect={() => refreshModels(p.id)} className={cn(item, "text-muted-foreground")}>
                      <RotateCcw aria-hidden className="size-4" />
                      <span className="min-w-0 truncate">{entry.error ?? "The models could not be listed."} Try again.</span>
                    </CommandPrimitive.Item>
                  )}
                  {list.map((m, i) => (
                    <CommandPrimitive.Item key={m.id} value={`${p.name} ${m.name} ${m.id}`} onSelect={() => pick({ provider: p.id, model: m.id })} className={item} title={m.id}>
                      <span className="min-w-0 flex-1 truncate">{modelName(m.name)}</span>
                      <ModelFacts model={m} />
                      <Check aria-hidden className={cn("size-4 shrink-0", isCurrent(p.id, m.id, i) ? "opacity-100" : "opacity-0")} />
                    </CommandPrimitive.Item>
                  ))}
                </CommandPrimitive.Group>
              );
            })}
          </CommandPrimitive.List>
          <div className="flex items-center gap-1 border-t border-line p-1">
            <Button type="button" variant="ghost" size="sm" onClick={() => remote.forEach(refreshModels)} disabled={!remote.length} className="font-normal text-muted-foreground">
              <RotateCcw aria-hidden className="size-4" />
              Refresh lists
            </Button>
            {onOpenSettings && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => {
                  setOpen(false);
                  onOpenSettings();
                }}
                className="ms-auto font-normal text-muted-foreground"
              >
                <Settings2 aria-hidden className="size-4" />
                Keys and models
              </Button>
            )}
          </div>
        </CommandPrimitive>
      </PopoverContent>
    </Popover>
  );
}
