"use client"

import { useRef, useState } from "react"
import { X } from "@/components/icons";
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { LabelChip } from "@/components/essential/resource-list/LabelChip"
import { LABEL_HUES, LABEL_HUE_CLASSES, LABEL_HUE_NAMES, type LabelHue } from "@/lib/labels"
import { cn } from "@/lib/utils"


interface LabelDialogProps {
  isOpen: boolean
  onOpenChange: (open: boolean) => void
  currentTags: string[]
  tagColors: Record<string, string>
  onAddTag: (tag: string, color?: string) => void
  onRemoveTag: (tag: string) => void
}

export function LabelDialog({
  isOpen,
  onOpenChange,
  currentTags,
  tagColors,
  onAddTag,
  onRemoveTag,
}: LabelDialogProps) {
  const [input, setInput] = useState("")
  const [selectedColor, setSelectedColor] = useState<LabelHue | undefined>(undefined)
  const swatches = useRef<(HTMLButtonElement | null)[]>([])

  // One tab stop for the group; arrows move and select, Home and End go to the ends.
  const onSwatchKey = (e: React.KeyboardEvent, index: number) => {
    const last = LABEL_HUES.length - 1
    const next =
      e.key === "ArrowRight" || e.key === "ArrowDown" ? (index === last ? 0 : index + 1)
      : e.key === "ArrowLeft" || e.key === "ArrowUp" ? (index === 0 ? last : index - 1)
      : e.key === "Home" ? 0
      : e.key === "End" ? last
      : null
    if (next === null) return
    e.preventDefault()
    setSelectedColor(LABEL_HUES[next])
    swatches.current[next]?.focus()
  }

  const handleAdd = () => {
    const tag = input.trim()
    if (!tag) return
    onAddTag(tag, selectedColor)
    setInput("")
    setSelectedColor(undefined)
  }

  return (
    <Dialog open={isOpen} onOpenChange={(v) => { if (!v) { setInput(""); setSelectedColor(undefined) } onOpenChange(v) }}>
      <DialogContent className="@min-[40rem]:max-w-sm">
        <DialogHeader>
          <DialogTitle>Labels</DialogTitle>
        </DialogHeader>

        {/* Existing tags */}
        {currentTags.length > 0 && (
          <div className="flex flex-col gap-1.5 pb-3 border-b border-line">
            {currentTags.map((tag) => (
              <div key={tag} className="flex items-center justify-between gap-2">
                <LabelChip label={tag} color={tagColors[tag]} className="type-small" />
                <button
                  type="button"
                  onClick={() => onRemoveTag(tag)}
                  aria-label={`Remove label ${tag}`}
                  className="rounded-[var(--radius-inset)] p-1 text-muted-foreground transition-colors hover:bg-surface-hover hover:text-foreground"
                >
                  <X className="size-3.5" />
                </button>
              </div>
            ))}
          </div>
        )}

        {/* Add new tag */}
        <div className="space-y-3 pt-1">
          <Input
            placeholder="Label name"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); handleAdd() } }}
            autoFocus
          />

          <div className="space-y-1.5">
            <p id="label-color" className="type-tiny text-muted-foreground">Color</p>
            <div role="radiogroup" aria-labelledby="label-color" className="flex flex-wrap items-center gap-2">
              {LABEL_HUES.map((hue, i) => {
                const checked = selectedColor === hue
                const focusable = checked || (!selectedColor && i === 0)
                return (
                  <button
                    key={hue}
                    ref={(el) => { swatches.current[i] = el }}
                    type="button"
                    role="radio"
                    aria-checked={checked}
                    aria-label={LABEL_HUE_NAMES[hue]}
                    title={LABEL_HUE_NAMES[hue]}
                    tabIndex={focusable ? 0 : -1}
                    onClick={() => setSelectedColor(checked ? undefined : hue)}
                    onKeyDown={(e) => onSwatchKey(e, i)}
                    className={cn(
                      "size-5 rounded-full ring-offset-2 ring-offset-panel transition-shadow",
                      LABEL_HUE_CLASSES[hue].swatch,
                      checked && "ring-2 ring-foreground",
                    )}
                  />
                )
              })}
            </div>
          </div>

          <Button
            type="button"
            className="w-full"
            disabled={!input.trim()}
            onClick={handleAdd}
          >
            Add label
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
