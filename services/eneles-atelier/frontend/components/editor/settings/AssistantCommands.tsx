"use client";

import { useEffect, useId, useState } from "react";
import { toast } from "sonner";
import { Pencil, Plus, Trash2 } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { BUILT_IN_NAMES, SLASH_COMMANDS, setCustomCommands } from "@/components/editor/assistant/commands";
import { editorSettingsAPI, type AssistantCommand } from "@/lib/api";

const NAME = /^[a-z][a-z0-9-]{1,23}$/;
const EMPTY: AssistantCommand = { name: "", description: "", prompt: "", useSelection: true };

/** One command in a list: its name as it is typed, and what it does. */
function CommandRow({ name, description, children }: { name: string; description: string; children?: React.ReactNode }) {
  return (
    <li className="flex min-h-11 items-center gap-3 px-3 py-1.5">
      <code className="w-28 shrink-0 truncate font-mono type-base text-foreground">/{name}</code>
      <span className="min-w-0 flex-1 truncate type-base text-muted-foreground">{description}</span>
      {children}
    </li>
  );
}

/**
 * The assistant's slash commands, in the editor's settings: the person's own (add, change, and remove them; they are kept with the account and appear in the assistant's "/" list at once) and, under them, the ones the assistant comes with.
 *
 * A command is a name and the prompt it sends. In the prompt, {file} stands for the open file's path and {input} for whatever is typed after the command; a prompt with no {input} has what is typed added at its end.
 */
export function AssistantCommandsSettings() {
  const [commands, setCommands] = useState<AssistantCommand[] | null>(null);
  const [failed, setFailed] = useState(false);
  // The command in the form: a new one (index null) or the one at `index`.
  const [editing, setEditing] = useState<{ index: number | null; draft: AssistantCommand } | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const id = useId();

  useEffect(() => {
    let live = true;
    editorSettingsAPI
      .getAssistantCommands()
      .then((list) => {
        if (!live) return;
        setCommands(list);
        setCustomCommands(list);
      })
      .catch(() => live && setFailed(true));
    return () => {
      live = false;
    };
  }, []);

  const save = async (next: AssistantCommand[], done: string) => {
    setSaving(true);
    try {
      const saved = await editorSettingsAPI.updateAssistantCommands(next);
      setCommands(saved);
      setCustomCommands(saved);
      setEditing(null);
      setError("");
      toast.success(done);
    } catch (e) {
      setError(e instanceof Error ? e.message : "The commands could not be saved.");
    } finally {
      setSaving(false);
    }
  };

  const submit = () => {
    if (!editing || !commands) return;
    const draft = { ...editing.draft, name: editing.draft.name.trim().toLowerCase().replace(/^\//, ""), description: editing.draft.description.trim(), prompt: editing.draft.prompt.trim() };
    if (!NAME.test(draft.name)) return setError("A name is 2 to 24 lowercase letters, digits, or hyphens, and starts with a letter.");
    if (BUILT_IN_NAMES.has(draft.name)) return setError(`/${draft.name} is one of Axya's own commands. Choose another name.`);
    if (commands.some((c, i) => c.name === draft.name && i !== editing.index)) return setError(`You already have a command named /${draft.name}.`);
    if (!draft.prompt) return setError("Write the prompt the command sends.");
    const next = editing.index === null ? [...commands, draft] : commands.map((c, i) => (i === editing.index ? draft : c));
    void save(next, editing.index === null ? `/${draft.name} added` : `/${draft.name} saved`);
  };

  const change = (patch: Partial<AssistantCommand>) => {
    setError("");
    setEditing((current) => (current ? { ...current, draft: { ...current.draft, ...patch } } : current));
  };

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h3 className="text-base font-semibold text-foreground">Axya</h3>
        <p className="mt-0.5 type-base text-muted-foreground">Slash commands are prompts you send by name. Type / in the assistant to see them.</p>
      </div>

      <section aria-labelledby={`${id}-yours`}>
        <div className="mb-2 flex items-center justify-between gap-3">
          <h4 id={`${id}-yours`} className="type-small font-medium text-muted-foreground">
            Your commands
          </h4>
          {!editing && commands && (
            <Button variant="outline" onClick={() => setEditing({ index: null, draft: EMPTY })}>
              <Plus /> New command
            </Button>
          )}
        </div>

        {editing && (
          <form
            className="mb-3 flex flex-col gap-4 rounded-[var(--radius-card)] border border-line bg-card p-4"
            onSubmit={(e) => {
              e.preventDefault();
              submit();
            }}
          >
            <div className="grid gap-4 @min-[34rem]:grid-cols-[11rem_minmax(0,1fr)]">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor={`${id}-name`}>Name</Label>
                <div className="relative">
                  <span aria-hidden className="pointer-events-none absolute inset-y-0 start-3 flex items-center font-mono type-base text-muted-foreground">
                    /
                  </span>
                  <Input id={`${id}-name`} autoFocus spellCheck={false} autoComplete="off" maxLength={24} placeholder="rewrite" className="ps-6 font-mono" value={editing.draft.name} onChange={(e) => change({ name: e.target.value.toLowerCase() })} />
                </div>
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor={`${id}-description`}>Description</Label>
                <Input id={`${id}-description`} maxLength={120} placeholder="What it does, in a few words" value={editing.draft.description} onChange={(e) => change({ description: e.target.value })} />
              </div>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={`${id}-prompt`}>Prompt</Label>
              <Textarea id={`${id}-prompt`} rows={5} maxLength={4000} className="max-h-60 min-h-28" placeholder="Rewrite the selected text in the active voice and keep every LaTeX command as it is." value={editing.draft.prompt} onChange={(e) => change({ prompt: e.target.value })} />
              <p className="type-small text-muted-foreground">
                <code className="font-mono text-foreground">{"{file}"}</code> stands for the open file, and <code className="font-mono text-foreground">{"{input}"}</code> for what you type after the command.
              </p>
            </div>
            <div className="flex items-center justify-between gap-4">
              <div className="min-w-0">
                <Label htmlFor={`${id}-selection`}>Include the selection</Label>
                <p className="type-small text-muted-foreground">Send the text selected in the editor with the prompt, when there is some.</p>
              </div>
              <Switch id={`${id}-selection`} checked={editing.draft.useSelection} onCheckedChange={(on) => change({ useSelection: on })} />
            </div>
            {error && (
              <p role="alert" className="type-small text-danger">
                {error}
              </p>
            )}
            <div className="flex justify-end gap-2">
              <Button type="button" variant="ghost" onClick={() => (setEditing(null), setError(""))}>
                Cancel
              </Button>
              <Button type="submit" disabled={saving}>
                {editing.index === null ? "Add command" : "Save"}
              </Button>
            </div>
          </form>
        )}

        {failed ? (
          <p className="rounded-[var(--radius-card)] border border-line bg-card px-3 py-6 text-center type-base text-muted-foreground">Your commands could not be loaded. Close settings and open them again.</p>
        ) : !commands ? (
          <div className="flex flex-col gap-2 rounded-[var(--radius-card)] border border-line bg-card p-3">
            <Skeleton className="h-5 w-2/3" />
            <Skeleton className="h-5 w-1/2" />
          </div>
        ) : commands.length === 0 ? (
          !editing && <p className="rounded-[var(--radius-card)] border border-dashed border-line px-3 py-6 text-center type-base text-muted-foreground">None yet. Add one for a prompt you send often.</p>
        ) : (
          <ul className="divide-y divide-line rounded-[var(--radius-card)] border border-line bg-card">
            {commands.map((command, index) => (
              <CommandRow key={command.name} name={command.name} description={command.description || command.prompt}>
                <span className="flex shrink-0 items-center gap-0.5">
                  <Button variant="ghost" size="icon-sm" aria-label={`Edit /${command.name}`} title="Edit" disabled={saving} onClick={() => (setError(""), setEditing({ index, draft: command }))}>
                    <Pencil />
                  </Button>
                  <Button variant="ghost" size="icon-sm" aria-label={`Delete /${command.name}`} title="Delete" disabled={saving} className="text-muted-foreground hover:text-danger" onClick={() => void save(commands.filter((_, i) => i !== index), `/${command.name} deleted`)}>
                    <Trash2 />
                  </Button>
                </span>
              </CommandRow>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby={`${id}-built-in`}>
        <h4 id={`${id}-built-in`} className="mb-2 type-small font-medium text-muted-foreground">
          Built in
        </h4>
        <ul className="divide-y divide-line rounded-[var(--radius-card)] border border-line bg-card">
          {SLASH_COMMANDS.map((command) => (
            <CommandRow key={command.name} name={command.name} description={command.description} />
          ))}
        </ul>
      </section>
    </div>
  );
}
