"use client";

import { useId, useRef, useState, type KeyboardEvent } from "react";
import { ImageUp, RotateCcw, Trash2 } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { PresetFace } from "@/components/people/Avatar";
import {
  AVATAR_HUES,
  AVATAR_STYLES,
  AVATAR_STYLE_LABELS,
  derivedPreset,
  formatPreset,
  isPhotoValue,
  parsePreset,
  shufflePreset,
  type AvatarHue,
  type AvatarPerson,
  type AvatarPreset,
} from "@/lib/avatar";
import { cn } from "@/lib/utils";

const ACCEPTED = ["image/png", "image/jpeg", "image/webp"];
const MAX_BYTES = 2 * 1024 * 1024;

/**
 * The face being edited on the profile, as a draft that the form's Save changes commits: a generated picture (style, variation, and color, each chosen on its own), or a photo, either the one already saved or a new file that is uploaded on save.
 */
export type AvatarDraft = {
  preset: AvatarPreset;
  use: "preset" | "photo";
  /** A new photo, uploaded on save, and its preview. */
  file: File | null;
  preview: string | null;
  /** False once the saved photo has been removed in this draft. */
  keepSaved: boolean;
};

export function initialAvatarDraft(person: AvatarPerson): AvatarDraft {
  const saved = person.avatarUrl ?? null;
  return { preset: parsePreset(saved) ?? derivedPreset(person), use: isPhotoValue(saved) ? "photo" : "preset", file: null, preview: null, keepSaved: true };
}

/** The photo the draft can show: a new one, else the saved one unless it was removed. */
export function draftPhoto(person: AvatarPerson, draft: AvatarDraft): string | null {
  return draft.preview ?? (draft.keepSaved && isPhotoValue(person.avatarUrl) ? (person.avatarUrl as string) : null);
}

/** The person as the draft would show them, for the face beside the form. */
export function personWithDraft(person: AvatarPerson, draft: AvatarDraft): AvatarPerson {
  const photo = draftPhoto(person, draft);
  return { ...person, avatarUrl: draft.use === "photo" && photo ? photo : formatPreset(draft.preset) };
}

/** What saving the draft must do: upload a file, write a preset, or nothing. */
export function avatarChange(person: AvatarPerson, draft: AvatarDraft): { upload: File } | { preset: string } | null {
  if (draft.use === "photo") return draft.file ? { upload: draft.file } : draftPhoto(person, draft) ? null : { preset: formatPreset(draft.preset) };
  const saved = person.avatarUrl ?? null;
  const preset = formatPreset(draft.preset);
  // A person who never chose has the derived picture; keeping it is no change.
  const current = parsePreset(saved) ? saved : isPhotoValue(saved) ? null : formatPreset(derivedPreset(person));
  return preset === current ? null : { preset };
}

const HUE_SWATCH: Record<AvatarHue, string> = {
  grey: "bg-hue-grey",
  red: "bg-hue-red",
  orange: "bg-hue-orange",
  amber: "bg-hue-amber",
  green: "bg-hue-green",
  teal: "bg-hue-teal",
  blue: "bg-hue-blue",
  indigo: "bg-hue-indigo",
  purple: "bg-hue-purple",
  pink: "bg-hue-pink",
};
const title = (word: string) => word[0].toUpperCase() + word.slice(1);

/** Arrow keys move along a row of choices and choose, as in any radio group; Home and End go to the ends. */
function roving(event: KeyboardEvent<HTMLButtonElement>, index: number, count: number, choose: (i: number) => void) {
  const rtl = getComputedStyle(event.currentTarget).direction === "rtl";
  const step = { ArrowRight: rtl ? -1 : 1, ArrowLeft: rtl ? 1 : -1, ArrowDown: 1, ArrowUp: -1 }[event.key];
  const edge = event.key === "Home" ? 0 : event.key === "End" ? count - 1 : null;
  if (step === undefined && edge === null) return;
  event.preventDefault();
  const next = edge ?? (index + (step ?? 0) + count) % count;
  const group = event.currentTarget.parentElement;
  (group?.children[next] as HTMLElement | undefined)?.focus();
  choose(next);
}

/**
 * The Change button beside the face and the small panel it opens: Style (each generated kind, and Photo when there is one), Shuffle for another variation of that style, Color (the ten hues, for any style), and Upload a photo or Remove photo. Everything is a draft until the form is saved.
 */
export function AvatarChooser({ person, draft, onChange }: { person: AvatarPerson; draft: AvatarDraft; onChange: (draft: AvatarDraft) => void }) {
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  const [error, setError] = useState("");
  const photo = draftPhoto(person, draft);
  const styles: ("photo" | (typeof AVATAR_STYLES)[number])[] = [...(photo ? (["photo"] as const) : []), ...AVATAR_STYLES];
  const selectedStyle = draft.use === "photo" && photo ? "photo" : draft.preset.style;

  const setPreset = (preset: AvatarPreset) => onChange({ ...draft, preset, use: "preset" });
  const chooseStyle = (style: (typeof styles)[number]) => (style === "photo" ? onChange({ ...draft, use: "photo" }) : setPreset({ ...draft.preset, style }));

  const pick = (file: File | undefined) => {
    if (!file) return;
    if (!ACCEPTED.includes(file.type)) return setError("Choose a PNG, JPEG, or WebP image.");
    if (file.size > MAX_BYTES) return setError(`That image is ${(file.size / 1024 / 1024).toFixed(1)} MB; photos up to 2 MB work.`);
    setError("");
    if (draft.preview) URL.revokeObjectURL(draft.preview);
    onChange({ ...draft, use: "photo", file, preview: URL.createObjectURL(file) });
  };

  const removePhoto = () => {
    if (draft.preview) URL.revokeObjectURL(draft.preview);
    setError("");
    onChange({ ...draft, use: "preset", file: null, preview: null, keepSaved: false });
  };

  const tile =
    "flex w-[72px] flex-col items-center gap-1.5 rounded-[var(--radius-tray)] border bg-surface p-2 type-small text-muted-foreground transition-[border-color,background-color,color] hover:bg-surface-hover hover:text-foreground aria-checked:border-foreground aria-checked:text-foreground";

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button type="button" variant="outline">
          Change
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" sideOffset={8} className="flex w-[min(25rem,calc(100vw-2rem))] flex-col gap-4 p-4">
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between gap-2">
            <p id={`${id}-style`} className="type-base font-medium">
              Style
            </p>
            <Button type="button" variant="ghost" size="sm" disabled={selectedStyle === "photo"} onClick={() => setPreset(shufflePreset(draft.preset))}>
              <RotateCcw />
              Shuffle
            </Button>
          </div>
          <div role="radiogroup" aria-labelledby={`${id}-style`} className="flex flex-wrap gap-2">
            {styles.map((style, index) => {
              const checked = style === selectedStyle;
              return (
                <button
                  key={style}
                  type="button"
                  role="radio"
                  aria-checked={checked}
                  tabIndex={checked ? 0 : -1}
                  onClick={() => chooseStyle(style)}
                  onKeyDown={(event) => roving(event, index, styles.length, (i) => chooseStyle(styles[i]))}
                  className={cn(tile, "border-line")}
                >
                  <span className="block size-8 overflow-hidden rounded-full">
                    {style === "photo" && photo ? (
                      // eslint-disable-next-line @next/next/no-img-element -- the person's own photo, or the file they just picked.
                      <img src={photo} alt="" className="size-full object-cover" />
                    ) : (
                      <PresetFace preset={{ ...draft.preset, style: style as AvatarPreset["style"] }} size="md" />
                    )}
                  </span>
                  {style === "photo" ? "Photo" : AVATAR_STYLE_LABELS[style as AvatarPreset["style"]]}
                </button>
              );
            })}
          </div>
        </div>

        {selectedStyle !== "photo" && (
          <div className="flex flex-col gap-2">
            <p id={`${id}-color`} className="type-base font-medium">
              Color
            </p>
            <div role="radiogroup" aria-labelledby={`${id}-color`} className="flex flex-wrap gap-1">
              {AVATAR_HUES.map((hue, index) => {
                const checked = hue === draft.preset.hue;
                return (
                  <button
                    key={hue}
                    type="button"
                    role="radio"
                    aria-checked={checked}
                    aria-label={title(hue)}
                    title={title(hue)}
                    tabIndex={checked ? 0 : -1}
                    onClick={() => setPreset({ ...draft.preset, hue })}
                    onKeyDown={(event) => roving(event, index, AVATAR_HUES.length, (i) => setPreset({ ...draft.preset, hue: AVATAR_HUES[i] }))}
                    className="grid size-8 place-items-center rounded-full border border-transparent transition-colors hover:border-line aria-checked:border-foreground"
                  >
                    <span className={cn("block size-5 rounded-full", HUE_SWATCH[hue])} />
                  </button>
                );
              })}
            </div>
          </div>
        )}

        <div className="flex flex-col gap-2 border-t border-line pt-4">
          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" variant="outline" onClick={() => input.current?.click()}>
              <ImageUp />
              {photo ? "Replace photo" : "Upload a photo"}
            </Button>
            {photo && (
              <Button type="button" variant="ghost" onClick={removePhoto}>
                <Trash2 />
                Remove photo
              </Button>
            )}
          </div>
          <p className="type-small text-muted-foreground" aria-live="polite">
            {error ? <span className="text-danger">{error}</span> : "PNG, JPEG, or WebP, up to 2 MB. Changes apply when you save."}
          </p>
          <input
            ref={input}
            type="file"
            tabIndex={-1}
            aria-hidden
            className="sr-only"
            accept={ACCEPTED.join(",")}
            onChange={(event) => {
              pick(event.target.files?.[0]);
              event.target.value = "";
            }}
          />
        </div>
      </PopoverContent>
    </Popover>
  );
}
