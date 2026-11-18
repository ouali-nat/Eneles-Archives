"use client";

import { useMemo, type CSSProperties, type ReactNode } from "react";
import * as DropdownMenuPrimitive from "@radix-ui/react-dropdown-menu";
import { Avatar } from "@/components/people/Avatar";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Check } from "@/components/icons";
import { COMMENT_HUES, commentHue, hueLabel, hueVar, type CommentHue } from "@/lib/review/hues";
import { cn } from "@/lib/utils";

/** Someone who can appear in a thread or the chat, and be mentioned. */
export interface Person {
  id: number;
  name: string;
  avatarUrl?: string | null;
}

/** A person's face in a thread or the chat: the same picture they have everywhere else in the app, 24px beside a name by default. */
export function PersonAvatar({ person, size = "sm", className }: { person: { id: number; name: string | null; avatarUrl?: string | null }; size?: "sm" | "md"; className?: string }) {
  return <Avatar person={{ id: person.id, name: person.name ?? undefined, avatarUrl: person.avatarUrl }} size={size === "sm" ? "sm" : "md"} decorative className={className} />;
}

/** A comment's or message's text, with line breaks kept and @mentions of known people marked. */
export function MessageBody({ text, people, className }: { text: string; people: readonly Person[]; className?: string }) {
  const pieces = useMemo(() => {
    const names = [...new Set(people.map((p) => p.name).filter(Boolean))].sort((a, b) => b.length - a.length);
    if (names.length === 0) return [text];
    const escaped = names.map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
    const pattern = new RegExp(`(^|[\\s(])@(${escaped.join("|")})(?![\\p{L}\\p{N}])`, "gu");
    const out: ReactNode[] = [];
    let at = 0;
    for (const match of text.matchAll(pattern)) {
      const start = (match.index ?? 0) + match[1].length;
      if (start > at) out.push(text.slice(at, start));
      out.push(
        <span key={start} className="rounded-[var(--radius-inset)] bg-accent/12 px-0.5 font-medium text-foreground">
          @{match[2]}
        </span>,
      );
      at = start + 1 + match[2].length;
    }
    if (at < text.length) out.push(text.slice(at));
    return out;
  }, [text, people]);
  return <p className={cn("whitespace-pre-wrap break-words type-base text-foreground", className)}>{pieces}</p>;
}

/** Hands a comment's hue to the classes inside as --thread-hue. */
export function hueStyle(hue: string | null | undefined): CSSProperties {
  return { "--thread-hue": hueVar(hue) } as CSSProperties;
}

/** A comment's hue as a ring swatch: a 2px ring in the hue over a half-strength fill, at 16px in a list and 20px on its own. */
export function HueSwatch({ hue, size = "sm", className }: { hue: string | null | undefined; size?: "sm" | "md"; className?: string }) {
  return (
    <span
      aria-hidden
      className={cn("hue-swatch inline-block shrink-0 rounded-full border-2 border-[color:var(--thread-hue)] bg-[color-mix(in_srgb,var(--thread-hue)_50%,transparent)]", size === "sm" ? "size-4" : "size-5", className)}
      style={hueStyle(hue)}
    />
  );
}

/** The hues as radio rows of a menu: the swatch, the name, and a check at the end of the current one. The composer's color button and a thread's Color submenu both list them. */
export function HueRadioItems({ value, onChange }: { value: string | null | undefined; onChange: (hue: CommentHue) => void }) {
  return (
    <DropdownMenuPrimitive.RadioGroup value={commentHue(value)} onValueChange={(next) => onChange(next as CommentHue)}>
      {COMMENT_HUES.map((hue) => (
        <DropdownMenuPrimitive.RadioItem
          key={hue}
          value={hue}
          className="relative flex min-h-[var(--control-height)] cursor-default select-none items-center gap-2 rounded-[var(--radius-item)] px-2.5 type-base text-foreground outline-hidden focus:bg-surface-hover data-[state=checked]:font-medium"
        >
          <HueSwatch hue={hue} />
          <span className="min-w-0 flex-1 truncate">{hueLabel(hue)}</span>
          <DropdownMenuPrimitive.ItemIndicator className="ms-auto inline-flex shrink-0">
            <Check className="size-4" />
          </DropdownMenuPrimitive.ItemIndicator>
        </DropdownMenuPrimitive.RadioItem>
      ))}
    </DropdownMenuPrimitive.RadioGroup>
  );
}

/** A comment's color as the value at the end of a menu row ("Color ◍ Amber ›"): the swatch and the name, quiet, beside the row's chevron. */
export function HueValue({ hue }: { hue: string | null | undefined }) {
  return (
    <span className="ms-auto flex shrink-0 items-center gap-1.5 ps-3 type-small text-muted-foreground">
      <HueSwatch hue={hue} className="size-3.5" />
      {hueLabel(commentHue(hue))}
    </span>
  );
}

/** The color of a comment being written: a quiet square button holding the hue's swatch, named by its tooltip, that opens the list of hues. */
export function HueSelect({ hue, onChange, label = "Highlight color" }: { hue: CommentHue; onChange: (hue: CommentHue) => void; label?: string }) {
  const name = `${label}: ${hueLabel(hue)}`;
  return (
    <DropdownMenu modal={false}>
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <Button type="button" variant="ghost" size="icon-sm" aria-label={name} className="data-[state=open]:bg-surface-hover">
              <HueSwatch hue={hue} size="md" />
            </Button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent side="top">{name}</TooltipContent>
      </Tooltip>
      <DropdownMenuContent align="start" sideOffset={6} className="w-44 p-1" aria-label={label}>
        <HueRadioItems value={hue} onChange={onChange} />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** The quoted passage a comment is about: a quiet block marked with the comment's hue. */
export function QuoteBlock({ quote, hue, active, className }: { quote: string; hue: string | null | undefined; active?: boolean; className?: string }) {
  const one = quote.replace(/\s+/g, " ").trim();
  return (
    <blockquote
      className={cn(
        "m-0 rounded-e-[var(--radius-inset)] border-s-[3px] border-s-[color:var(--thread-hue)] py-1 ps-2.5 pe-2 font-mono type-small text-muted-foreground transition-[background-color]",
        active ? "bg-[color-mix(in_oklch,var(--thread-hue)_16%,transparent)]" : "bg-[color-mix(in_oklch,var(--thread-hue)_7%,transparent)]",
        className,
      )}
      style={hueStyle(hue)}
    >
      <span className="line-clamp-2 break-words">{one || "(empty)"}</span>
    </blockquote>
  );
}
