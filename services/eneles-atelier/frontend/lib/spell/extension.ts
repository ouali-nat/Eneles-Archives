/**
 * Spell checking for the LaTeX editor: misspelled words get a wavy
 * underline; right-clicking one offers suggestions, "Add to dictionary" and
 * "Ignore". Words come from spellWords(), so commands, math, and code are
 * never flagged. One worker per language is shared by every open editor.
 */
import {
  EditorView,
  ViewPlugin,
  Decoration,
  type DecorationSet,
  type ViewUpdate,
  showTooltip,
  type Tooltip,
  keymap,
} from "@codemirror/view";
import { StateEffect, StateField, type Extension, type Text } from "@codemirror/state";
import { spellWords } from "./latex-words";

export interface SpellOptions {
  /** A folder under /dictionaries, such as "en" or "en-GB". */
  lang: string;
  /** The person's own dictionary. */
  personalWords: string[];
  /** Saves a word to the person's dictionary. */
  onAddWord?: (word: string) => void;
}

// ── Worker client ──────────────────────────────────────────────

class SpellClient {
  private worker: Worker;
  private nextId = 1;
  private waiting = new Map<number, (value: unknown) => void>();
  private cache = new Map<string, boolean>();
  private ignored = new Set<string>();
  private personalKey = "";
  ready: Promise<boolean>;

  constructor(readonly lang: string) {
    this.worker = new Worker(new URL("./spell.worker.ts", import.meta.url), { type: "module" });
    this.ready = new Promise((resolve) => {
      const onReady = (event: MessageEvent) => {
        const msg = event.data;
        if (msg.type === "ready" || msg.type === "failed") {
          this.worker.removeEventListener("message", onReady);
          resolve(msg.type === "ready");
        }
      };
      this.worker.addEventListener("message", onReady);
    });
    this.worker.addEventListener("message", (event: MessageEvent) => {
      const msg = event.data;
      if (msg.type !== "checked" && msg.type !== "suggested") return;
      const done = this.waiting.get(msg.id);
      this.waiting.delete(msg.id);
      done?.(msg.type === "checked" ? msg.wrong : msg.list);
    });
    this.worker.postMessage({ type: "load", lang });
  }

  setPersonal(words: string[]) {
    const key = words.join("\n");
    if (key === this.personalKey) return;
    this.personalKey = key;
    this.cache.clear();
    this.worker.postMessage({ type: "personal", words });
  }

  ignore(word: string) {
    this.ignored.add(word);
  }

  private ask<T>(message: object): Promise<T> {
    const id = this.nextId++;
    return new Promise<T>((resolve) => {
      this.waiting.set(id, resolve as (value: unknown) => void);
      this.worker.postMessage({ ...message, id });
    });
  }

  /** The words in `words` that are misspelled. */
  async wrong(words: string[]): Promise<Set<string>> {
    const unknown = words.filter((w) => !this.cache.has(w));
    if (unknown.length > 0) {
      const wrong = new Set(await this.ask<string[]>({ type: "check", words: unknown }));
      for (const w of unknown) this.cache.set(w, !wrong.has(w));
    }
    return new Set(words.filter((w) => this.cache.get(w) === false && !this.ignored.has(w)));
  }

  suggest(word: string): Promise<string[]> {
    return this.ask<string[]>({ type: "suggest", word });
  }
}

const clients = new Map<string, SpellClient>();
function clientFor(lang: string): SpellClient {
  let client = clients.get(lang);
  if (!client) {
    client = new SpellClient(lang);
    clients.set(lang, client);
  }
  return client;
}

// ── Extension ──────────────────────────────────────────────────

interface MenuState {
  from: number;
  to: number;
  word: string;
  suggestions: string[] | null;
}

const MAX_WORDS = 50_000;

export function spellCheck(options: SpellOptions): Extension {
  const client = clientFor(options.lang);
  client.setPersonal(options.personalWords);

  const setMarks = StateEffect.define<DecorationSet>();
  const setMenu = StateEffect.define<MenuState | null>();
  const mark = Decoration.mark({ class: "cm-misspelled" });

  const marks = StateField.define<DecorationSet>({
    create: () => Decoration.none,
    update(value, tr) {
      for (const e of tr.effects) if (e.is(setMarks)) return e.value;
      if (!tr.docChanged) return value;
      // A mark the edit touched is dropped until the next check.
      const touched: [number, number][] = [];
      tr.changes.iterChangedRanges((_fa, _ta, fromB, toB) => touched.push([fromB, toB]));
      return value.map(tr.changes).update({
        filter: (from, to) => !touched.some(([a, b]) => from <= b && to >= a),
      });
    },
    provide: (f) => EditorView.decorations.from(f),
  });

  const menu = StateField.define<MenuState | null>({
    create: () => null,
    update(value, tr) {
      for (const e of tr.effects) if (e.is(setMenu)) return e.value;
      if (value && (tr.docChanged || tr.selection)) return null;
      return value;
    },
    provide: (f) => showTooltip.from(f, (m) => (m ? menuTooltip(m) : null)),
  });

  const recheck = StateEffect.define<null>();

  function menuTooltip(m: MenuState): Tooltip {
    return {
      pos: m.from,
      above: false,
      create(view) {
        const dom = document.createElement("div");
        dom.className =
          // The interface's own face and sizes, whatever the editor's text is set in (monospace in Code, the document's serif in Visual), so it reads as one of the app's menus.
          "cm-spell-menu min-w-[13rem] rounded-[var(--radius-popover)] border border-line bg-panel/95 p-1 font-sans type-base font-normal not-italic leading-normal tracking-normal text-foreground shadow-popover backdrop-blur-md";
        dom.setAttribute("role", "menu");
        const item = (label: string, onClick: () => void, muted = false) => {
          const b = document.createElement("button");
          b.type = "button";
          b.setAttribute("role", "menuitem");
          b.className = `flex min-h-9 w-full items-center rounded-[var(--radius-item)] px-2.5 py-1.5 font-sans type-base text-start outline-hidden hover:bg-surface-hover focus-visible:bg-surface-hover ${muted ? "text-muted-foreground hover:text-foreground" : "font-medium"}`;
          b.textContent = label;
          b.addEventListener("mousedown", (e) => e.preventDefault());
          b.addEventListener("click", onClick);
          dom.appendChild(b);
          return b;
        };
        const close = () => view.dispatch({ effects: setMenu.of(null) });

        if (m.suggestions === null) {
          const p = document.createElement("div");
          p.className = "flex min-h-9 items-center px-2.5 py-1.5 font-sans type-base text-muted-foreground";
          p.textContent = "Finding suggestions…";
          dom.appendChild(p);
        } else if (m.suggestions.length === 0) {
          const p = document.createElement("div");
          p.className = "flex min-h-9 items-center px-2.5 py-1.5 font-sans type-base text-muted-foreground";
          p.textContent = "No suggestions";
          dom.appendChild(p);
        } else {
          for (const s of m.suggestions) {
            item(s, () => {
              if (view.state.sliceDoc(m.from, m.to) !== m.word) return close();
              view.dispatch({
                changes: { from: m.from, to: m.to, insert: s },
                effects: setMenu.of(null),
                userEvent: "input.spelling",
              });
              view.focus();
            });
          }
        }
        const sep = document.createElement("div");
        sep.className = "bg-line -mx-1 my-1 h-px";
        dom.appendChild(sep);
        if (options.onAddWord) {
          item(`Add “${m.word}” to your dictionary`, () => {
            options.onAddWord?.(m.word);
            client.ignore(m.word);
            view.dispatch({ effects: [setMenu.of(null), recheck.of(null)] });
            view.focus();
          }, true);
        }
        item("Ignore in this session", () => {
          client.ignore(m.word);
          view.dispatch({ effects: [setMenu.of(null), recheck.of(null)] });
          view.focus();
        }, true);
        return { dom };
      },
    };
  }

  const checker = ViewPlugin.fromClass(
    class {
      private timer: ReturnType<typeof setTimeout> | null = null;
      private run = 0;
      private destroyed = false;

      constructor(view: EditorView) {
        this.schedule(view, 50);
      }

      update(u: ViewUpdate) {
        const asked = u.transactions.some((tr) => tr.effects.some((e) => e.is(recheck)));
        if (u.docChanged || asked) this.schedule(u.view, asked ? 0 : 500);
      }

      schedule(view: EditorView, ms: number) {
        if (this.timer) clearTimeout(this.timer);
        this.timer = setTimeout(() => void this.check(view), ms);
      }

      async check(view: EditorView) {
        if (!(await client.ready) || this.destroyed) return;
        const run = ++this.run;
        const doc: Text = view.state.doc;
        const words = spellWords(doc.toString()).slice(0, MAX_WORDS);
        const wrong = await client.wrong([...new Set(words.map((w) => w.word))]);
        if (this.destroyed || run !== this.run || view.state.doc !== doc) return;
        const head = view.state.selection.main.head;
        const ranges = words
          // The word being typed is not judged until the cursor leaves it.
          .filter((w) => wrong.has(w.word) && !(view.hasFocus && head === w.to))
          .map((w) => mark.range(w.from, w.to));
        view.dispatch({ effects: setMarks.of(Decoration.set(ranges, true)) });
      }

      destroy() {
        this.destroyed = true;
        if (this.timer) clearTimeout(this.timer);
      }
    },
  );

  const openMenu = EditorView.domEventHandlers({
    contextmenu(event, view) {
      const pos = view.posAtCoords({ x: event.clientX, y: event.clientY });
      if (pos === null) return false;
      const hit: { range: { from: number; to: number } | null } = { range: null };
      view.state.field(marks).between(pos, pos, (from, to) => {
        if (from <= pos && pos <= to) hit.range = { from, to };
      });
      if (!hit.range) return false;
      const { from, to } = hit.range;
      event.preventDefault();
      const word = view.state.sliceDoc(from, to);
      view.dispatch({ effects: setMenu.of({ from, to, word, suggestions: null }) });
      void client.suggest(word).then((suggestions) => {
        const open = view.state.field(menu, false);
        if (open && open.from === from && open.word === word) {
          view.dispatch({ effects: setMenu.of({ from, to, word, suggestions }) });
        }
      });
      return true;
    },
  });

  const closeOnEscape = keymap.of([
    {
      key: "Escape",
      run: (view) => {
        if (!view.state.field(menu, false)) return false;
        view.dispatch({ effects: setMenu.of(null) });
        return true;
      },
    },
  ]);

  const theme = EditorView.baseTheme({
    ".cm-misspelled": {
      textDecoration: "underline wavy var(--danger)",
      textDecorationSkipInk: "none",
      textUnderlineOffset: "3px",
      textDecorationThickness: "1px",
    },
    ".cm-tooltip:has(> .cm-spell-menu)": {
      background: "transparent",
      border: "none",
    },
  });

  return [marks, menu, checker, openMenu, closeOnEscape, theme];
}

/** The dictionary folder for a spellcheckLang setting, or null when off. */
export function dictionaryFor(setting: string | undefined | null): string | null {
  switch (setting) {
    case "en":
    case "en-GB":
    case "es":
    case "fr":
    case "de":
    case "pt":
    case "it":
      return setting;
    default:
      return null;
  }
}
