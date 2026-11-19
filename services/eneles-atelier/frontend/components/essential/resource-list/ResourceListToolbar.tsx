"use client"

import { motion, AnimatePresence } from "framer-motion"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Search, Trash2, Archive, Tag, X } from "@/components/icons";

interface ResourceListToolbarProps {
  /** The plural noun of the list as it reads in a sentence ("PDFs", "snips"), used as written. */
  itemNoun: string
  selectMode: boolean
  selectedCount: number
  searchQuery: string
  onSearchChange: (value: string) => void
  customTags: string[]
  selectedTag: string
  onSelectedTagChange: (value: string) => void
  showArchived: boolean
  onToggleArchived: () => void
  hasArchive: boolean
  hasLabel: boolean
  onBulkArchive: () => void
  onBulkLabel: () => void
  onBulkDelete: () => void
  onExitSelectMode: () => void
  /** Drawn before the search. */
  start?: React.ReactNode
  /** The bulk delete's label, for a list whose items are only taken off it. */
  deleteLabel?: string
}

export function ResourceListToolbar({
  itemNoun,
  selectMode,
  selectedCount,
  searchQuery,
  onSearchChange,
  customTags,
  selectedTag,
  onSelectedTagChange,
  showArchived,
  onToggleArchived,
  hasArchive,
  hasLabel,
  onBulkArchive,
  onBulkLabel,
  onBulkDelete,
  onExitSelectMode,
  start,
  deleteLabel,
}: ResourceListToolbarProps) {
  return (
    <AnimatePresence mode="wait">
      {selectMode ? (
        <motion.div
          key="selection-bar"
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -10 }}
          transition={{ duration: 0.2 }}
          className="flex items-center justify-between p-4 bg-surface rounded-lg h-11"
        >
          <span className="text-sm font-medium">
            {selectedCount > 0 ? `${selectedCount} item(s) selected` : 'Select items'}
          </span>
          <div className="flex gap-2">
            {selectedCount > 0 && (
              <>
                {hasArchive && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={onBulkArchive}
                  >
                    <Archive className="me-2 h-4 w-4" />
                    Archive
                  </Button>
                )}
                {hasLabel && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={onBulkLabel}
                  >
                    <Tag className="me-2 h-4 w-4" />
                    Label
                  </Button>
                )}
                <Button
                  size="sm"
                  variant={deleteLabel ? "outline" : "destructive"}
                  onClick={onBulkDelete}
                >
                  {deleteLabel ? <X className="me-2 h-4 w-4" /> : <Trash2 className="me-2 h-4 w-4" />}
                  {deleteLabel ?? "Delete"}
                </Button>
              </>
            )}
            <Button
              size="sm"
              variant="ghost"
              onClick={onExitSelectMode}
            >
              Cancel
            </Button>
          </div>
        </motion.div>
      ) : (
        <motion.div
          key="search-filters"
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -10 }}
          transition={{ duration: 0.2 }}
          className="flex items-center gap-3"
        >
          {start}
          <div className="relative flex-1">
            <Search className="absolute start-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input 
              type="search"
              aria-label={`Search ${itemNoun}`}
              placeholder={`Search ${itemNoun}`}
              className="ps-9"
              value={searchQuery}
              onChange={(e) => onSearchChange(e.target.value)}
            />
          </div>
          
          {/* Custom Labels Filter - only show if there are custom labels */}
          {customTags.length > 0 && (
            <Select value={selectedTag} onValueChange={onSelectedTagChange}>
              <SelectTrigger className="w-[180px]">
                <SelectValue placeholder="Filter by label" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All labels</SelectItem>
                {customTags.map(tag => (
                  <SelectItem key={tag} value={tag}>
                    {tag}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}

          {/* Archive Toggle */}
          {hasArchive && (
            <Button
              variant={showArchived ? "default" : "outline"}
              onClick={onToggleArchived}
            >
              <Archive className="me-2 h-4 w-4" />
              {showArchived ? "Show active" : "Show archived"}
            </Button>
          )}
        </motion.div>
      )}
    </AnimatePresence>
  )
}
