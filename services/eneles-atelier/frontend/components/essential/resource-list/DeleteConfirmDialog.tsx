"use client"

import { useState } from "react"
import { AlertTriangle } from "@/components/icons";
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"

interface DeleteConfirmDialogProps {
  isOpen: boolean
  onOpenChange: (open: boolean) => void
  itemCount: number
  itemLabel?: string
  onConfirm: () => void
  onCancel: () => void
}

const CONFIRM_PHRASE = "delete permanently"

export function DeleteConfirmDialog({
  isOpen,
  onOpenChange,
  itemCount,
  itemLabel,
  onConfirm,
  onCancel,
}: DeleteConfirmDialogProps) {
  const [confirmInput, setConfirmInput] = useState("")
  const isConfirmed = confirmInput.toLowerCase() === CONFIRM_PHRASE

  // Reset input when dialog closes
  const [wasOpen, setWasOpen] = useState(isOpen)
  if (wasOpen !== isOpen) {
    setWasOpen(isOpen)
    if (!isOpen) setConfirmInput("")
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && isConfirmed) {
      onConfirm()
    }
  }

  const label = itemLabel || (itemCount === 1 ? "this item" : `${itemCount} items`)

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <div className="flex items-center gap-3 mb-1">
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-danger/10">
              <AlertTriangle className="h-5 w-5 text-danger" />
            </div>
            <DialogTitle>Permanently delete {label}?</DialogTitle>
          </div>
          <DialogDescription className="pt-2">
            This action <span className="font-semibold text-foreground">cannot be undone</span>. 
            This will permanently delete {label} and all associated data.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 py-2">
          <p className="text-sm text-muted-foreground">
            To confirm, type <span className="font-mono font-semibold text-foreground bg-surface px-1.5 py-0.5 rounded">{CONFIRM_PHRASE}</span> below:
          </p>
          <Input
            id="delete-confirm-input"
            placeholder={CONFIRM_PHRASE}
            value={confirmInput}
            onChange={(e) => setConfirmInput(e.target.value)}
            onKeyDown={handleKeyDown}
            autoComplete="off"
            spellCheck={false}
            autoFocus
          />
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onCancel}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            onClick={onConfirm}
            disabled={!isConfirmed}
          >
            Delete permanently
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
