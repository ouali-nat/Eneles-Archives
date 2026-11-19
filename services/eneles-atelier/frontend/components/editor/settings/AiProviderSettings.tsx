"use client";

import { useEffect, useId, useState } from "react";
import { toast } from "sonner";
import { ExternalLink, Eye, EyeOff, KeyRound, Loader2, Trash2 } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { RelativeTime } from "@/components/ui/time";
import { aiAPI, type AiProviderId, type AiProviderInfo, type AiStatus } from "@/lib/api";
import { cn } from "@/lib/utils";
import { forgetModels } from "@/components/editor/assistant/ai-models";
import { notifyAiStatusChanged } from "@/components/editor/assistant/ai-status";
import { ModelPicker } from "@/components/editor/assistant/ModelPicker";

const card = "rounded-[var(--radius-surface)] border border-line bg-card";

/** A labelled field with an optional line under it; the line is the error when there is one. */
function Field({ id, label, hint, error, children, className }: { id: string; label: string; hint?: React.ReactNode; error?: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={cn("flex min-w-0 flex-col gap-1.5", className)}>
      <label htmlFor={id} className="type-base font-medium text-foreground">
        {label}
      </label>
      {children}
      {(error || hint) && (
        <p id={`${id}-hint`} className={cn("type-small", error ? "text-danger" : "text-muted-foreground")}>
          {error || hint}
        </p>
      )}
    </div>
  );
}

/** The assistant's status for this person, read once and again after every change here. */
export function useAiStatus() {
  const [status, setStatus] = useState<AiStatus | null>(null);
  const [failed, setFailed] = useState(false);
  const reload = () =>
    aiAPI
      .chatStatus()
      .then((s) => {
        setStatus(s);
        setFailed(false);
      })
      .catch(() => setFailed(true));
  useEffect(() => {
    void reload();
  }, []);
  return { status, failed, reload };
}

/** Who answers for this person, in a sentence, and what Platform AI means for them. */
function AccessSummary({ status }: { status: AiStatus }) {
  const own = status.keys.length > 0;
  const line = own
    ? `Axya answers with your own ${status.keys.length === 1 ? `${status.keys[0].name ?? status.keys[0].provider} key` : "keys"}. Their providers bill you directly.`
    : status.platform.available
      ? "Axya answers with Eneles's models, which come with your plan. Add your own key to choose other models; it is used first."
      : "Axya needs your own API key from a model provider. Until you add one, it cannot answer.";
  const platform = !status.platform.enabled
    ? "Eneles's own models are paused for now, on every plan: Axya works with your own key."
    : status.platform.available
      ? "Eneles's hosted AI models are available when the platform provider is configured."
      : status.upgrade
        ? "Les modèles IA d’Eneles sont accessibles lorsque le fournisseur IA de la plateforme est configuré."
        : "The platform AI provider is not fully configured yet. Add your own provider key to use Axya in the meantime.";
  return (
    <div className={cn(card, "flex items-start gap-3 p-4")}>
      <span className="grid size-9 shrink-0 place-items-center rounded-[var(--radius)] border border-line bg-surface">
        <KeyRound aria-hidden className="size-4 text-muted-foreground" />
      </span>
      <div className="flex min-w-0 flex-col gap-1">
        <p className="type-base text-foreground">{line}</p>
        <p className="type-small text-muted-foreground">{platform}</p>
      </div>
    </div>
  );
}

/** One saved key: its provider, the last four characters, and when it was added and last used. Removing it is immediate. */
function KeyRow({ k, onRemoved }: { k: AiStatus["keys"][number]; onRemoved: () => void }) {
  const [busy, setBusy] = useState(false);
  const remove = async () => {
    setBusy(true);
    try {
      await aiAPI.removeKey(k.provider);
      forgetModels(k.provider);
      toast.success(`${k.name ?? k.provider} key removed`);
      onRemoved();
    } catch (e) {
      toast.error(e instanceof Error && e.message ? e.message : "The key could not be removed.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <li className="flex min-h-14 flex-wrap items-center gap-x-4 gap-y-1 px-4 py-2.5">
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="type-base font-medium text-foreground">{k.name ?? k.provider}</span>
        <span className="flex min-w-0 flex-wrap gap-x-2 type-small text-muted-foreground">
          <span className="font-mono">…{k.last4}</span>
          {k.baseUrl && <span className="min-w-0 truncate font-mono">{k.baseUrl}</span>}
          <span>
            Added <RelativeTime value={k.createdAt} lowercase />
          </span>
          <span>{k.lastUsedAt ? <>Last used <RelativeTime value={k.lastUsedAt} lowercase /></> : "Not used yet"}</span>
        </span>
      </div>
      <Button type="button" variant="ghost" size="sm" onClick={() => void remove()} disabled={busy} className="text-muted-foreground hover:text-danger">
        {busy ? <Loader2 aria-hidden className="size-4 animate-spin" /> : <Trash2 aria-hidden className="size-4" />}
        Remove
      </Button>
    </li>
  );
}

/** Adding (or replacing) a key: the provider, the key, and for an OpenAI-compatible API its base URL. The key is checked with the provider before it is stored. */
function AddKey({ providers, status, onSaved, autoFocus }: { providers: AiProviderInfo[]; status: AiStatus; onSaved: () => void; autoFocus?: boolean }) {
  const id = useId();
  const [provider, setProvider] = useState<AiProviderId>(() => (status.keys.some((k) => k.provider === "anthropic") ? "openai" : "anthropic"));
  const [key, setKey] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [show, setShow] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const info = providers.find((p) => p.id === provider);
  const existing = status.keys.find((k) => k.provider === provider);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!key.trim()) return setError("Paste the API key.");
    if (info?.needsBaseUrl && !baseUrl.trim()) return setError("Enter the base URL of the API.");
    setSaving(true);
    setError("");
    try {
      const saved = await aiAPI.saveKey(provider, key.trim(), info?.needsBaseUrl ? baseUrl.trim() : undefined);
      forgetModels(provider);
      setKey("");
      setShow(false);
      // Ready for another provider: the next one without a key.
      const next = providers.find((p) => p.id !== provider && !status.keys.some((k) => k.provider === p.id));
      if (next) setProvider(next.id);
      toast.success(`${info?.name ?? provider} key saved`, { description: `${saved.models} ${saved.models === 1 ? "model" : "models"} available.` });
      onSaved();
    } catch (err) {
      setError(err instanceof Error && err.message ? err.message : "The key could not be saved.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={(e) => void save(e)} className="flex flex-col gap-4 p-4" aria-label="Add an API key">
      <div className="grid gap-4 @min-[36rem]/ai:grid-cols-[minmax(0,14rem)_minmax(0,1fr)]">
        <Field id={`${id}-provider`} label="Provider">
          <Select value={provider} onValueChange={(v) => { setProvider(v as AiProviderId); setError(""); }}>
            <SelectTrigger id={`${id}-provider`} className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {providers.map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  {p.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <Field
          id={`${id}-key`}
          label="API key"
          error={error}
          hint={
            existing
              ? `Saving replaces the key ending ${existing.last4}.`
              : info?.keyUrl && (
                  <a href={info.keyUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 underline underline-offset-4 hover:text-foreground">
                    Get a {info.name} key
                    <ExternalLink aria-hidden className="size-3.5" />
                  </a>
                )
          }
        >
          <div className="relative">
            <Input
              id={`${id}-key`}
              type={show ? "text" : "password"}
              value={key}
              onChange={(e) => {
                setKey(e.target.value);
                setError("");
              }}
              placeholder={info?.keyPrefix ? `${info.keyPrefix}…` : "Paste the key"}
              autoComplete="off"
              spellCheck={false}
              autoFocus={autoFocus}
              maxLength={512}
              aria-invalid={!!error || undefined}
              aria-describedby={`${id}-key-hint`}
              className="pe-11 font-mono"
            />
            <Button type="button" variant="ghost" size="icon-sm" onClick={() => setShow((s) => !s)} aria-label={show ? "Hide the key" : "Show the key"} className="absolute end-0.5 top-1/2 -translate-y-1/2 text-muted-foreground">
              {show ? <EyeOff aria-hidden className="size-4" /> : <Eye aria-hidden className="size-4" />}
            </Button>
          </div>
        </Field>
      </div>
      {info?.needsBaseUrl && (
        <Field id={`${id}-url`} label="Base URL" hint="Any API that speaks OpenAI's chat completions, such as Ollama (http://localhost:11434/v1 while developing) or a hosted gateway. It must be https and public.">
          <Input id={`${id}-url`} value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder="https://example.com/v1" spellCheck={false} autoComplete="off" className="font-mono" />
        </Field>
      )}
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={saving}>
          {saving && <Loader2 aria-hidden className="size-4 animate-spin" />}
          {saving ? `Checking with ${info?.name ?? "the provider"}` : existing ? "Check and replace" : "Check and save"}
        </Button>
        <p className="type-small text-muted-foreground">The key is checked with one call that lists models, then stored encrypted. It is never shown again.</p>
      </div>
    </form>
  );
}

/** The account's default model and the settings sent with every request. */
function Defaults({ status, onSaved }: { status: AiStatus; onSaved: () => void }) {
  const id = useId();
  const prefs = status.preferences;
  const [temperature, setTemperature] = useState(prefs.temperature?.toString() ?? "");
  const [maxTokens, setMaxTokens] = useState(prefs.maxOutputTokens?.toString() ?? "");
  const [note, setNote] = useState(prefs.systemNote ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const choice = prefs.provider ? { provider: prefs.provider, model: prefs.model } : null;
  const dirty = temperature !== (prefs.temperature?.toString() ?? "") || maxTokens !== (prefs.maxOutputTokens?.toString() ?? "") || note !== (prefs.systemNote ?? "");
  const anthropic = (prefs.provider ?? status.keys[0]?.provider) === "anthropic";

  const pickModel = async (next: { provider: string; model: string | null }) => {
    try {
      await aiAPI.savePreferences({ provider: next.provider, model: next.model });
      onSaved();
      toast.success("Default model saved");
    } catch (e) {
      toast.error(e instanceof Error && e.message ? e.message : "The default could not be saved.");
    }
  };

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    const t = temperature.trim() === "" ? null : Number(temperature);
    const m = maxTokens.trim() === "" ? null : Number(maxTokens);
    if (t !== null && (!Number.isFinite(t) || t < 0 || t > 2)) return setError("Temperature is a number from 0 to 2, or empty for the model's own.");
    if (m !== null && (!Number.isInteger(m) || m < 256 || m > 128000)) return setError("The longest answer is a whole number of tokens from 256 to 128,000, or empty.");
    setSaving(true);
    setError("");
    try {
      await aiAPI.savePreferences({ temperature: t, maxOutputTokens: m, systemNote: note.trim() || null });
      onSaved();
      toast.success("Assistant settings saved");
    } catch (err) {
      setError(err instanceof Error && err.message ? err.message : "The settings could not be saved.");
    } finally {
      setSaving(false);
    }
  };

  const usable = status.keys.length > 0 || status.platform.available || status.localModel;
  return (
    <form onSubmit={(e) => void save(e)} className="flex flex-col gap-4 p-4" aria-label="Default model and options">
      <Field id={`${id}-model`} label="Default model" hint={usable ? "Used for new conversations. Each conversation can switch model from the composer, and remembers its choice." : "Add a key first."}>
        {usable ? <ModelPicker id={`${id}-model`} status={status} value={choice} onChange={(c) => void pickModel(c)} variant="field" /> : <Input id={`${id}-model`} disabled value="No model yet" readOnly />}
      </Field>
      <div className="grid gap-4 @min-[36rem]/ai:grid-cols-2">
        <Field id={`${id}-temp`} label="Temperature" hint={anthropic ? "Not sent to Anthropic models, which choose their own." : "From 0 (focused) to 2 (varied). Empty uses the model's own."}>
          <Input id={`${id}-temp`} inputMode="decimal" value={temperature} onChange={(e) => setTemperature(e.target.value)} placeholder="Model default" />
        </Field>
        <Field id={`${id}-max`} label="Longest answer, in tokens" hint="Empty uses 8,192, or less when the model allows less.">
          <Input id={`${id}-max`} inputMode="numeric" value={maxTokens} onChange={(e) => setMaxTokens(e.target.value)} placeholder="8192" />
        </Field>
      </div>
      <Field id={`${id}-note`} label="A note for Axya" error={error} hint={`Added to Axya's instructions in every conversation: your field's conventions, your language, how terse to be. ${note.length} of 2,000 characters.`}>
        <Textarea id={`${id}-note`} value={note} onChange={(e) => setNote(e.target.value.slice(0, 2000))} rows={3} placeholder="For example: I write in British English. Prefer \cref over \ref." />
      </Field>
      <div>
        <Button type="submit" disabled={!dirty || saving}>
          {saving && <Loader2 aria-hidden className="size-4 animate-spin" />}
          Save
        </Button>
      </div>
    </form>
  );
}

/**
 * Where a person sets up the assistant: who answers for them, their API keys (add, replace, remove), the default model, and options sent with every request. The same component is the AI page in the account settings and the top of the editor's Settings, Axya tab.
 */
export function AiProviderSettings({ heading = true, autoFocus = false, className }: { heading?: boolean; autoFocus?: boolean; className?: string }) {
  const { status, failed, reload } = useAiStatus();
  const [providers, setProviders] = useState<AiProviderInfo[] | null>(null);
  useEffect(() => {
    aiAPI
      .providers()
      .then(setProviders)
      .catch(() => setProviders([]));
  }, []);
  const changed = () => {
    void reload();
    notifyAiStatusChanged();
  };

  if (failed) return <p className="type-base text-muted-foreground">The assistant&rsquo;s settings could not be loaded. Reload the page to try again.</p>;
  if (!status || !providers)
    return (
      <div className="flex flex-col gap-3" aria-busy>
        <Skeleton className="h-20 w-full" />
        <Skeleton className="h-40 w-full" />
      </div>
    );

  const section = (title: string, description: string) =>
    heading ? (
      <div className="flex flex-col gap-0.5">
        <h3 className="type-base font-semibold text-foreground">{title}</h3>
        <p className="type-small text-muted-foreground">{description}</p>
      </div>
    ) : null;

  return (
    <div className={cn("@container/ai flex flex-col gap-6", className)}>
      <AccessSummary status={status} />

      <section className="flex flex-col gap-3" aria-label="API keys">
        {section("API keys", "One key per provider. Keys are stored encrypted and used only by our server to call the provider for you.")}
        {!status.canStoreKeys ? (
          <p className={cn(card, "p-4 type-base text-muted-foreground")}>This server cannot store API keys yet: an administrator has to set AI_KEY_SECRET first.</p>
        ) : (
          <div className={cn(card, "flex flex-col divide-y divide-line")}>
            {status.keys.length > 0 && (
              <ul className="flex flex-col divide-y divide-line" aria-label="Your keys">
                {status.keys.map((k) => (
                  <KeyRow key={k.provider} k={k} onRemoved={changed} />
                ))}
              </ul>
            )}
            <AddKey providers={providers} status={status} onSaved={changed} autoFocus={autoFocus} />
          </div>
        )}
      </section>

      <section className="flex flex-col gap-3" aria-label="Model and options">
        {section("Model and options", "What Axya uses unless a conversation chooses otherwise.")}
        <div className={card}>
          <Defaults key={JSON.stringify(status.preferences)} status={status} onSaved={changed} />
        </div>
      </section>
    </div>
  );
}
