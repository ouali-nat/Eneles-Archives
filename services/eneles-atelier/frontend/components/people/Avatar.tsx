"use client";

import { useCallback, useId, useMemo, useState, type ComponentProps, type ReactNode } from "react";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";
import { ditherPath, faceOf, gradientBlobs, pixelGlyph, type AvatarPerson, type AvatarPreset } from "@/lib/avatar";
import { cn } from "@/lib/utils";

/**
 * A person's face: their photo, else the generated picture they chose, else one derived from their account. Five sizes on a fixed scale, for the rows they sit in: xs (20) beside small text, sm (24) in dense rows and stacks, md (32) in lists and the account row, lg (40) in cards, xl (80) on the profile.
 */
export type AvatarSize = "xs" | "sm" | "md" | "lg" | "xl";

const SIZE_PX: Record<AvatarSize, number> = { xs: 20, sm: 24, md: 32, lg: 40, xl: 80 };
const SIZE_CLASS: Record<AvatarSize, string> = { xs: "size-5", sm: "size-6", md: "size-8", lg: "size-10", xl: "size-20" };

/** A generated picture alone, in any of the styles, colored by the stylesheet from its hue. */
export function PresetFace({ preset, size = "md", className }: { preset: AvatarPreset; size?: AvatarSize; className?: string }) {
  const common = cn("avatar-face block size-full", className);
  if (preset.style === "gradient") return <GradientFace preset={preset} className={common} />;
  if (preset.style === "pixel") return <PixelFace preset={preset} className={common} />;
  return <DitherFace preset={preset} size={size} className={common} />;
}

/** Two cells per pixel pair, so the dots stay crisp at every size. */
function DitherFace({ preset, size, className }: { preset: AvatarPreset; size: AvatarSize; className: string }) {
  const cells = SIZE_PX[size] / 2;
  const path = useMemo(() => ditherPath(preset.seed, cells), [preset.seed, cells]);
  return (
    <svg viewBox={`0 0 ${cells} ${cells}`} aria-hidden focusable="false" data-hue={preset.hue} className={cn(className, "[shape-rendering:crispEdges]")}>
      <rect width={cells} height={cells} className="fill-(--face-ground)" />
      <path d={path} className="fill-(--face-lit)" />
    </svg>
  );
}

/** Soft shapes in the deep and middle shades over the bright one, blurred together. The blur's region runs past the box so the edge stays full. */
function GradientFace({ preset, className }: { preset: AvatarPreset; className: string }) {
  const blobs = useMemo(() => gradientBlobs(preset.seed), [preset.seed]);
  const filter = `face-blur-${useId().replace(/[^\w-]/g, "")}`;
  return (
    <svg viewBox="0 0 100 100" aria-hidden focusable="false" data-hue={preset.hue} className={className}>
      <defs>
        <filter id={filter} filterUnits="userSpaceOnUse" x="-50" y="-50" width="200" height="200">
          <feGaussianBlur stdDeviation="13" />
        </filter>
      </defs>
      <g filter={`url(#${filter})`}>
        <rect x="-50" y="-50" width="200" height="200" className="fill-(--face-lit)" />
        {blobs.map((b, i) => (
          <ellipse key={i} cx={b.cx} cy={b.cy} rx={b.rx} ry={b.ry} transform={`rotate(${b.turn} ${b.cx} ${b.cy})`} className={b.shade === "ground" ? "fill-(--face-ground)" : "fill-(--face-mid)"} />
        ))}
      </g>
    </svg>
  );
}

/** The glyph inset in the disc: a 5 by 5 grid in an 8 by 8 box, so its corners stay inside the circle. */
function PixelFace({ preset, className }: { preset: AvatarPreset; className: string }) {
  const cells = useMemo(() => pixelGlyph(preset.seed), [preset.seed]);
  return (
    <svg viewBox="-1.5 -1.5 8 8" aria-hidden focusable="false" data-hue={preset.hue} className={cn(className, "[shape-rendering:crispEdges]")}>
      <rect x="-1.5" y="-1.5" width="8" height="8" className="fill-(--face-ground)" />
      {cells.map((c) => (
        <rect key={`${c.x}:${c.y}`} x={c.x} y={c.y} width="1" height="1" className={c.tone === 1 ? "fill-(--face-lit)" : "fill-(--face-mid)"} />
      ))}
    </svg>
  );
}

export type AvatarProps = Omit<ComponentProps<"span">, "children"> & {
  person: AvatarPerson;
  size?: AvatarSize;
  /** Drawn beside the person's name, so a screen reader need not hear it twice. */
  decorative?: boolean;
};

export function Avatar({ person, size = "md", decorative = false, className, ...props }: AvatarProps) {
  const face = faceOf(person);
  const [failed, setFailed] = useState<string | null>(null);
  const [loaded, setLoaded] = useState<string | null>(null);
  const photo = face.kind === "photo" && failed !== face.src ? face.src : null;
  const ready = !!photo && loaded === photo;
  const name = person.name?.trim() || person.email || "Someone";
  // An image that finished before React saw it (cached) never fires onLoad, so the mounted element is asked directly.
  const watch = useCallback(
    (node: HTMLImageElement | null) => {
      if (node && photo && node.complete && node.naturalWidth > 0) setLoaded(photo);
    },
    [photo],
  );
  return (
    <span
      {...props}
      role={decorative ? undefined : "img"}
      aria-label={decorative ? undefined : name}
      aria-hidden={decorative || undefined}
      data-avatar=""
      className={cn("relative inline-flex shrink-0 overflow-hidden rounded-full", !ready && "bg-surface", SIZE_CLASS[size], className)}
    >
      {/* The generated picture is drawn while a photo loads, or if it fails, so the disc is never empty. Once the photo has faded in, the picture under it is hidden (after the fade), so nothing shows at the photo's antialiased edge. */}
      <PresetFace
        preset={face.kind === "photo" ? face.fallback : face.preset}
        size={size}
        className={cn(ready && "invisible transition-[visibility] delay-(--motion-fade-duration) duration-0")}
      />
      {photo && (
        // eslint-disable-next-line @next/next/no-img-element -- photos are people's own uploads behind a signed link.
        <img
          ref={watch}
          src={photo}
          alt=""
          className={cn("absolute inset-0 size-full object-cover transition-opacity duration-(--motion-fade-duration)", ready ? "opacity-100" : "opacity-0")}
          onLoad={() => setLoaded(photo)}
          onError={() => setFailed(photo)}
        />
      )}
    </span>
  );
}

/** A person in a stack: their face, and what the hover card says under their name. */
export type GroupPerson = AvatarPerson & { key?: string | number; role?: string | null; detail?: ReactNode };

const OVERLAP: Record<AvatarSize, string> = { xs: "-ms-1", sm: "-ms-1.5", md: "-ms-2", lg: "-ms-2.5", xl: "-ms-4" };
const PLUS_TYPE: Record<AvatarSize, string> = { xs: "type-micro", sm: "type-micro", md: "type-tiny", lg: "type-small", xl: "type-large" };
/** The ring is the color of the ground the stack sits on, so overlapping faces read as cut out of it. */
const RING = { background: "ring-background", panel: "ring-panel", card: "ring-card", surface: "ring-surface" } as const;

function displayName(person: AvatarPerson) {
  return person.name?.trim() || person.email || "Someone";
}

/** The card a face opens on hover: the face again, the name, and the role or other detail. */
function PersonCardBody({ person }: { person: GroupPerson }) {
  const secondary = person.detail ?? person.role ?? (person.name ? person.email : null);
  return (
    <div className="flex items-center gap-3">
      <Avatar person={person} size="lg" decorative />
      <div className="min-w-0">
        <p className="truncate type-base font-medium">{displayName(person)}</p>
        {secondary && <p className="truncate type-small text-muted-foreground">{secondary}</p>}
      </div>
    </div>
  );
}

/**
 * Overlapping faces, the first in front, with a ring in the color of the ground beneath them. Past `max`, a +n tile stands for the rest. Hovering a face opens its person's card (name and role); hovering the +n tile lists the rest. The group's accessible name lists everyone with their role, so the stack needs no focus stops of its own and can sit inside a row that is itself a link.
 */
export function AvatarGroup({
  people,
  max = 4,
  size = "sm",
  ring = "card",
  label,
  className,
}: {
  people: GroupPerson[];
  max?: number;
  size?: AvatarSize;
  ring?: keyof typeof RING;
  /** What the group is ("Collaborators", "People here"); the names follow it. */
  label?: string;
  className?: string;
}) {
  if (people.length === 0) return null;
  // With exactly one more than fits, the face is shown instead of a +1 tile that takes the same room.
  const shown = people.length > max ? people.slice(0, max - 1) : people;
  const rest = people.slice(shown.length);
  const names = people.map((p) => (p.role ? `${displayName(p)} (${p.role})` : displayName(p))).join(", ");
  return (
    <span role="group" aria-label={label ? `${label}: ${names}` : names} className={cn("isolate inline-flex items-center", className)}>
      {shown.map((person, index) => (
        <HoverCard key={person.key ?? person.id ?? person.email ?? index} openDelay={120} closeDelay={80}>
          <HoverCardTrigger asChild>
            <span
              aria-hidden
              className={cn("relative inline-flex rounded-full ring-2", RING[ring], index > 0 && OVERLAP[size])}
              style={{ zIndex: shown.length - index + 1 }}
            >
              <Avatar person={person} size={size} decorative />
            </span>
          </HoverCardTrigger>
          <HoverCardContent side="bottom" align="center" sideOffset={8} className="w-auto max-w-72 min-w-48 rounded-[var(--radius-card)] p-3">
            <PersonCardBody person={person} />
          </HoverCardContent>
        </HoverCard>
      ))}
      {rest.length > 0 && (
        <HoverCard openDelay={120} closeDelay={80}>
          <HoverCardTrigger asChild>
            <span
              aria-hidden
              className={cn("relative z-0 inline-flex items-center justify-center rounded-full bg-surface font-medium text-muted-foreground tabular-nums ring-2", SIZE_CLASS[size], PLUS_TYPE[size], RING[ring], OVERLAP[size])}
            >
              +{rest.length}
            </span>
          </HoverCardTrigger>
          <HoverCardContent side="bottom" align="center" sideOffset={8} className="w-auto max-w-80 min-w-56 rounded-[var(--radius-card)] p-1.5">
            <ul className="flex flex-col">
              {rest.map((person, index) => (
                <li key={person.key ?? person.id ?? person.email ?? index} className="flex items-center gap-2.5 rounded-[var(--radius-item)] px-2 py-1.5">
                  <Avatar person={person} size="sm" decorative />
                  <span className="min-w-0 flex-1 truncate type-base">{displayName(person)}</span>
                  {person.role && <span className="shrink-0 type-small text-muted-foreground">{person.role}</span>}
                </li>
              ))}
            </ul>
          </HoverCardContent>
        </HoverCard>
      )}
    </span>
  );
}
