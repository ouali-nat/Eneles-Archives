"use client";

import { useEffect, useSyncExternalStore } from "react";
import { aiAPI, type AiModel, type AiStatus } from "@/lib/api";
import { modelName } from "@/lib/ai/model-name";

/**
 * The models each connected provider offers this person, fetched once a page (the server caches them for an hour too) and shared by every picker: the composer's, the editor's settings, and the AI page. `refreshModels` asks the provider again.
 */

type Entry = { state: "loading" | "ready" | "error"; models: AiModel[]; error?: string };
const entries = new Map<string, Entry>();
const listeners = new Set<() => void>();
let version = 0;
const notify = () => {
  version++;
  listeners.forEach((l) => l());
};

function load(provider: string, refresh = false) {
  const known = entries.get(provider);
  if (known && !refresh && known.state !== "error") return;
  entries.set(provider, { state: "loading", models: known?.models ?? [] });
  notify();
  aiAPI
    .models(provider, refresh)
    .then((models) => entries.set(provider, { state: "ready", models }))
    .catch((e: unknown) => entries.set(provider, { state: "error", models: known?.models ?? [], error: e instanceof Error ? e.message : "The models could not be listed." }))
    .finally(notify);
}

export const refreshModels = (provider: string) => load(provider, true);

/** Forgets a provider's models (its key was removed or replaced). */
export function forgetModels(provider: string) {
  entries.delete(provider);
  notify();
}

/** The models of each provider in `providers`, loading those not yet known. */
export function useModels(providers: readonly string[]): ReadonlyMap<string, Entry> {
  const key = providers.join(",");
  useEffect(() => {
    for (const p of key ? key.split(",") : []) load(p);
  }, [key]);
  useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => version,
    () => 0,
  );
  return entries;
}

/** The providers a person can choose from, in order: their own keys, then the platform when it is available, then the local test model in development. */
export function choosableProviders(status: AiStatus): Array<{ id: string; name: string }> {
  const out = status.keys.map((k) => ({ id: k.provider as string, name: k.name ?? k.provider }));
  if (status.platform.available) out.push({ id: "platform", name: "Eneles" });
  if (status.localModel) out.push({ id: "local", name: "Development" });
  return out;
}

/** "200K", "1M": a context size at a glance. */
export function formatTokens(n: number | null): string | null {
  if (!n) return null;
  if (n >= 1_000_000) return `${Number((n / 1_000_000).toFixed(n % 1_000_000 ? 1 : 0))}M`;
  if (n >= 1_000) return `${Math.round(n / 1_000)}K`;
  return String(n);
}

/** What the composer shows for a choice: the model's name, or what the default resolves to. */
export function choiceLabel(status: AiStatus, choice: { provider: string; model: string | null } | null, models: ReadonlyMap<string, Entry>): string {
  const resolved = choice ?? (status.preferences.provider ? { provider: status.preferences.provider, model: status.preferences.model } : null);
  if (!resolved) {
    if (status.source === "platform") return status.platform.model ? modelName(status.platform.model) : "Eneles";
    const first = status.keys[0]?.provider;
    const list = first ? models.get(first)?.models : undefined;
    return modelName(list?.[0]?.name) || "Default model";
  }
  if (resolved.provider === "local") return "Local test model";
  if (resolved.provider === "platform") return status.platform.model ? modelName(status.platform.model) : "Eneles";
  const list = models.get(resolved.provider)?.models ?? [];
  const model = resolved.model ? list.find((m) => m.id === resolved.model) : list[0];
  return modelName(model?.name ?? resolved.model) || "Default model";
}
