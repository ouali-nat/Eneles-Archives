"use client";

import { useState, type ReactNode } from "react";
import { Check, ChevronDown, FileText, Users } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList, CommandSeparator } from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Avatar } from "@/components/people/Avatar";
import { FileTypeIcon } from "@/components/editor/FileTypeIcon";
import { cn, formatCount } from "@/lib/utils";
import type { HistoryFacets } from "@/lib/api";
import { baseName } from "./grouping";

/** The box in front of each choice of a multiple choice list. */
function Tick({ on }: { on: boolean }) {
  return (
    <span aria-hidden className={cn("grid size-4 shrink-0 place-items-center rounded-[var(--radius-inset)] border", on ? "border-accent bg-accent text-on-accent" : "border-line")}>
      {on && <Check className="size-3 text-on-accent" strokeWidth={2.5} />}
    </span>
  );
}

const itemClass = "min-h-10 gap-2.5 px-2.5";

function FilterButton({ icon, label, active, open, ...props }: { icon: ReactNode; label: string; active: boolean; open: boolean } & React.ComponentProps<typeof Button>) {
  return (
    <Button
      variant="outline"
      size="sm"
      data-active={active || undefined}
      aria-expanded={open}
      className="min-w-0 max-w-72 flex-1 justify-start gap-2 px-2.5 data-active:border-accent/60 data-active:bg-accent/8"
      {...props}
    >
      {icon}
      <span className="min-w-0 flex-1 truncate text-start">{label}</span>
      <ChevronDown className="size-4 text-muted-foreground" />
    </Button>
  );
}

/** Files: which files' history to show. "All files" until some are chosen; deleted and renamed files are listed too, marked so. */
export function FilesFilter({ facets, value, onChange }: { facets: HistoryFacets | null; value: string[]; onChange: (paths: string[]) => void }) {
  const [open, setOpen] = useState(false);
  const paths = facets?.paths ?? [];
  const label = value.length === 0 ? "All files" : value.length === 1 ? baseName(value[0]) : `${value.length} files`;
  const toggle = (path: string) => onChange(value.includes(path) ? value.filter((p) => p !== path) : [...value, path]);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <FilterButton
          icon={value.length === 1 ? <FileTypeIcon filename={value[0]} className="size-4 shrink-0" /> : <FileText className="text-muted-foreground" />}
          label={label}
          active={value.length > 0}
          open={open}
          aria-label={`Files: ${value.length ? value.join(", ") : "all files"}`}
        />
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80 max-w-[calc(100vw-2rem)] p-0">
        <Command>
          <CommandInput placeholder="Search files" aria-label="Search files" />
          <CommandList className="max-h-80 p-1">
            <CommandEmpty className="px-3 py-6 text-center type-base text-muted-foreground">No files match</CommandEmpty>
            <CommandGroup className="p-0">
              <CommandItem value="all files" onSelect={() => onChange([])} className={itemClass}>
                <Tick on={value.length === 0} />
                <span className="flex-1">All files</span>
              </CommandItem>
            </CommandGroup>
            {paths.length > 0 && <CommandSeparator className="my-1" />}
            <CommandGroup className="p-0">
              {paths.map((p) => (
                <CommandItem key={p.path} value={p.path} onSelect={() => toggle(p.path)} className={itemClass}>
                  <Tick on={value.includes(p.path)} />
                  <FileTypeIcon filename={p.path} className="size-4 shrink-0" />
                  <span className={cn("min-w-0 flex-1 truncate", p.status !== "current" && "text-muted-foreground")} title={p.path}>
                    {p.path}
                  </span>
                  <span className="shrink-0 type-small text-muted-foreground tabular-nums">{p.status === "deleted" ? "Deleted" : p.status === "renamed" ? "Renamed" : p.versions}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

/** People: whose changes to show. "Everyone" until someone is chosen; it lists everyone with history in the project, people who have since left it included, even when there is only one. */
export function PeopleFilter({ facets, value, onChange, currentUserId }: { facets: HistoryFacets | null; value: number[]; onChange: (ids: number[]) => void; currentUserId: number | null }) {
  const [open, setOpen] = useState(false);
  const people = facets?.authors ?? [];
  const chosen = people.filter((p) => value.includes(p.id));
  const label = value.length === 0 ? "Everyone" : value.length === 1 ? (chosen[0]?.name ?? "1 person") : `${value.length} people`;
  const toggle = (id: number) => onChange(value.includes(id) ? value.filter((p) => p !== id) : [...value, id]);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <FilterButton
          icon={chosen.length === 1 ? <Avatar person={chosen[0]} size="xs" decorative /> : <Users className="text-muted-foreground" />}
          label={label}
          active={value.length > 0}
          open={open}
          aria-label={`People: ${value.length ? chosen.map((p) => p.name).join(", ") : "everyone"}`}
        />
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72 max-w-[calc(100vw-2rem)] p-0">
        <Command>
          {people.length > 6 && <CommandInput placeholder="Search people" aria-label="Search people" />}
          <CommandList className="max-h-80 p-1">
            <CommandEmpty className="px-3 py-6 text-center type-base text-muted-foreground">No one matches</CommandEmpty>
            <CommandGroup className="p-0">
              <CommandItem value="everyone" onSelect={() => onChange([])} className={itemClass}>
                <Tick on={value.length === 0} />
                <span className="flex-1">Everyone</span>
              </CommandItem>
            </CommandGroup>
            {people.length > 0 && <CommandSeparator className="my-1" />}
            <CommandGroup className="p-0">
              {people.map((p) => (
                <CommandItem key={p.id} value={`${p.name} ${p.id}`} onSelect={() => toggle(p.id)} className={cn(itemClass, "py-1.5")}>
                  <Tick on={value.includes(p.id)} />
                  <Avatar person={p} size="sm" decorative />
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate">
                      {p.name}
                      {p.id === currentUserId && <span className="text-muted-foreground"> (you)</span>}
                    </span>
                    {(p.gone || !p.member) && <span className="truncate type-small text-muted-foreground">{p.gone ? "Account deleted" : "Not a collaborator now"}</span>}
                  </span>
                  <span className="shrink-0 type-small text-muted-foreground tabular-nums" aria-label={formatCount(p.versions, "version", "versions")}>
                    {p.versions}
                  </span>
                </CommandItem>
              ))}
            </CommandGroup>
            {facets && facets.unattributed > 0 && (
              <p className="px-2.5 pt-2 pb-1.5 type-small text-muted-foreground">
                {formatCount(facets.unattributed, "older version names", "older versions name")} no one: they were saved before authors were recorded.
              </p>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
