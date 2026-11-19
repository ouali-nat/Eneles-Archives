"use client";

import { useState, useEffect, useCallback } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Plus, Trash2, Loader2, BookOpen } from "@/components/icons";
import { useAuth } from "@/lib/auth-context";
import { editorSettingsAPI } from "@/lib/api";
import { announceDictionaryChange } from "@/lib/spell/personal";

interface DictionaryDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Where the words are kept, when not with the account: the desktop app keeps them on the computer. */
  store?: DictionaryStore | null;
}

/** A personal dictionary kept somewhere other than the account. With one, the dialog works signed in or not. */
export interface DictionaryStore {
  list: () => Promise<string[]>;
  add: (word: string) => Promise<unknown>;
  remove: (word: string) => Promise<unknown>;
}

const ACCOUNT: DictionaryStore = {
  list: () => editorSettingsAPI.getDictionary().then((d) => d.words || []),
  add: (word) => editorSettingsAPI.addWord(word),
  remove: (word) => editorSettingsAPI.removeWord(word),
};

export function DictionaryDialog({ open, onOpenChange, store = null }: DictionaryDialogProps) {
  const { isAuthenticated: signedIn } = useAuth();
  // With a store of its own the dialog does not need the account.
  const isAuthenticated = signedIn || !!store;
  const wordStore = store ?? ACCOUNT;
  const [words, setWords] = useState<string[]>([]);
  const [newWord, setNewWord] = useState("");
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);

  // Show the loader again whenever a new load starts (the dialog opens, or a sign-in arrives while it is open). The first load needs nothing: `loading` starts true.
  const loadWanted = open && isAuthenticated;
  const [prevLoadWanted, setPrevLoadWanted] = useState(loadWanted);
  if (prevLoadWanted !== loadWanted) {
    setPrevLoadWanted(loadWanted);
    if (loadWanted) setLoading(true);
  }

  // Load dictionary on open
  useEffect(() => {
    if (!open || !isAuthenticated) return;
    wordStore
      .list()
      .then(setWords)
      .catch(console.error)
      .finally(() => setLoading(false));
    // The store is read when the dialog opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, isAuthenticated]);

  const handleAdd = useCallback(async () => {
    const trimmed = newWord.trim().toLowerCase();
    if (!trimmed || !isAuthenticated || words.includes(trimmed)) return;

    setAdding(true);
    try {
      await wordStore.add(trimmed);
      const next = [...words, trimmed].sort();
      setWords(next);
      announceDictionaryChange(next);
      setNewWord("");
    } catch (e) {
      console.error("Failed to add word:", e);
    } finally {
      setAdding(false);
    }
  }, [newWord, isAuthenticated, words, wordStore]);

  const handleRemove = useCallback(
    async (word: string) => {
      if (!isAuthenticated) return;
      // Optimistic removal
      const next = words.filter((w) => w !== word);
      setWords(next);
      try {
        await wordStore.remove(word);
        announceDictionaryChange(next);
      } catch (e) {
        console.error("Failed to remove word:", e);
        // Revert on error
        setWords((prev) => [...prev, word].sort());
      }
    },
    [isAuthenticated, words, wordStore]
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="@min-[40rem]:max-w-[420px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-lg">
            <BookOpen className="h-5 w-5" />
            Custom Dictionary
          </DialogTitle>
        </DialogHeader>

        <p className="text-xs text-muted-foreground -mt-1">
          Words added here won&apos;t be flagged by the spellchecker.
        </p>

        {/* Add word input */}
        <div className="flex gap-2">
          <Input
            placeholder="Add a word…"
            value={newWord}
            onChange={(e) => setNewWord(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleAdd()}
            className="h-9"
          />
          <Button
            size="sm"
            className="h-9 px-3"
            onClick={handleAdd}
            disabled={!newWord.trim() || adding}
          >
            {adding ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Plus className="h-4 w-4" />
            )}
          </Button>
        </div>

        {/* Word list */}
        {loading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : words.length === 0 ? (
          <div className="text-center py-8 text-sm text-muted-foreground">
            No custom words yet. Add some above.
          </div>
        ) : (
          <ScrollArea className="max-h-[300px] rounded-md border">
            <div className="p-1">
              {words.map((word) => (
                <div
                  key={word}
                  className="flex items-center justify-between px-3 py-1.5 rounded hover:bg-surface/50 group"
                >
                  <span className="text-sm font-mono">{word}</span>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 w-7 p-0 opacity-0 group-hover:opacity-100 transition-opacity text-danger hover:text-danger"
                    onClick={() => handleRemove(word)}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              ))}
            </div>
          </ScrollArea>
        )}

        <div className="text-xs text-muted-foreground text-end">
          {words.length} word{words.length !== 1 ? "s" : ""}
        </div>
      </DialogContent>
    </Dialog>
  );
}
