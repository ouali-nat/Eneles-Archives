"use client";

import { useId, useState, type FormEvent } from "react";
import { AlertCircle, Check, Loader2, Send } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { API_URL } from "@/lib/api/client";

/** What a message can be about; the API accepts these and no others (backend/src/contact/dto/contact.dto.ts). */
const TOPICS = ["Support", "Billing", "Teams and institutions", "Self-hosting", "Feedback", "Press", "Something else"] as const;
type Topic = (typeof TOPICS)[number];

/**
 * The contact form: name, email, what it is about, and the message, sent to the team's inbox with the writer's address to reply to (POST /contact). The API checks every field again and says what is wrong in words; those words are shown under the form. A field people never see catches bots. Sent, the form gives way to a note saying so, with a way to write another.
 */
export function ContactForm() {
  const id = useId();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [topic, setTopic] = useState<Topic>("Support");
  const [message, setMessage] = useState("");
  const [website, setWebsite] = useState("");
  const [state, setState] = useState<{ kind: "idle" | "sending" | "sent" } | { kind: "error"; message: string }>({ kind: "idle" });

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setState({ kind: "sending" });
    try {
      const res = await fetch(`${API_URL}/contact`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name, email, topic, message, website }) });
      if (res.ok) {
        setState({ kind: "sent" });
        return;
      }
      const body = (await res.json().catch(() => null)) as { message?: string | string[] } | null;
      const why = Array.isArray(body?.message) ? body.message.join(" ") : body?.message;
      setState({ kind: "error", message: res.status === 429 ? "That is a few messages in a short time. Try again in an hour, or write to le formulaire de contact Eneles." : (why ?? "The message could not be sent. Try again, or write to le formulaire de contact Eneles.") });
    } catch {
      setState({ kind: "error", message: "The message could not be sent: the connection failed. Try again, or write to le formulaire de contact Eneles." });
    }
  };

  if (state.kind === "sent") {
    return (
      <div role="status" className="flex flex-col items-center gap-3 rounded-[var(--radius-surface)] border border-line bg-card px-6 py-14 text-center">
        <span className="grid size-12 place-items-center rounded-full bg-success/15 text-success">
          <Check className="size-6" />
        </span>
        <p className="type-large font-semibold">{name.trim() ? `Thanks, ${name.trim().split(/\s+/)[0]}. It is on its way.` : "Thanks. It is on its way."}</p>
        <p className="max-w-sm type-base text-muted-foreground">We read every message and reply to {email} from a person, usually within a working day.</p>
        <Button
          variant="outline"
          className="mt-3"
          onClick={() => {
            setMessage("");
            setState({ kind: "idle" });
          }}
        >
          Write another
        </Button>
      </div>
    );
  }

  const sending = state.kind === "sending";
  return (
    <form onSubmit={submit} className="flex flex-col gap-5 rounded-[var(--radius-surface)] border border-line bg-card p-6 @min-[40rem]:p-8" noValidate={false}>
      <div className="grid gap-5 @min-[40rem]:grid-cols-2">
        <div className="flex flex-col gap-2">
          <Label htmlFor={`${id}-name`}>Name</Label>
          <Input id={`${id}-name`} name="name" autoComplete="name" required maxLength={120} value={name} onChange={(e) => setName(e.target.value)} placeholder="Ada Lovelace" />
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor={`${id}-email`}>Email</Label>
          <Input id={`${id}-email`} name="email" type="email" autoComplete="email" required maxLength={254} value={email} onChange={(e) => setEmail(e.target.value)} placeholder="ada@example.org" />
        </div>
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor={`${id}-topic`}>What it is about</Label>
        <Select value={topic} onValueChange={(v) => setTopic(v as Topic)}>
          <SelectTrigger id={`${id}-topic`} className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {TOPICS.map((t) => (
              <SelectItem key={t} value={t}>
                {t}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor={`${id}-message`}>Message</Label>
        <Textarea id={`${id}-message`} name="message" required minLength={10} maxLength={5000} rows={7} value={message} onChange={(e) => setMessage(e.target.value)} placeholder="What happened, what you expected, and the project link if it helps." className="min-h-40 resize-y" />
        <p className="flex justify-between type-small text-muted-foreground">
          <span>A link to the project, or a screenshot described in words, helps us help faster.</span>
          <span className="shrink-0 tabular-nums">{message.length > 4500 ? `${5000 - message.length} left` : ""}</span>
        </p>
      </div>
      {/* People never see this field; a bot that fills it in is told the message went, and nothing is sent. */}
      <div aria-hidden className="absolute -start-[10000px] h-px w-px overflow-hidden">
        <label htmlFor={`${id}-website`}>Website</label>
        <input id={`${id}-website`} name="website" tabIndex={-1} autoComplete="off" value={website} onChange={(e) => setWebsite(e.target.value)} />
      </div>

      {state.kind === "error" && (
        <p role="alert" className="flex items-start gap-2 rounded-[var(--radius)] border border-danger/30 bg-danger/8 px-3 py-2.5 type-base text-foreground">
          <AlertCircle className="mt-0.5 size-4 shrink-0 text-danger" />
          {state.message}
        </p>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="type-small text-muted-foreground">Your address is used only to reply to you.</p>
        <Button type="submit" disabled={sending}>
          {sending ? <Loader2 className="animate-spin" /> : <Send />}
          {sending ? "Sending" : "Send the message"}
        </Button>
      </div>
    </form>
  );
}
