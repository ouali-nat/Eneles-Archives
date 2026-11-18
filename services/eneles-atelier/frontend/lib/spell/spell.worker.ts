/// <reference lib="webworker" />
/**
 * Spell checking off the main thread. Loading a Hunspell dictionary takes a
 * second or more and suggestions can take a few hundred milliseconds, so
 * both happen here.
 *
 * Messages in:  { type: "load", lang } | { type: "check", id, words }
 *               | { type: "suggest", id, word } | { type: "personal", words }
 * Messages out: { type: "ready", lang } | { type: "failed", lang }
 *               | { type: "checked", id, wrong } | { type: "suggested", id, list }
 */
import nspell from "nspell";

type Speller = ReturnType<typeof nspell>;

let speller: Speller | null = null;
let loadedLang: string | null = null;
let personal = new Set<string>();

const scope = self as unknown as DedicatedWorkerGlobalScope;

function correct(word: string): boolean {
  if (!speller) return true;
  if (personal.has(word) || personal.has(word.toLowerCase())) return true;
  return speller.correct(word);
}

scope.onmessage = async (event: MessageEvent) => {
  const msg = event.data;
  if (msg.type === "load") {
    const lang = String(msg.lang);
    if (!/^[a-z]{2}(-[A-Z]{2})?$/.test(lang)) {
      scope.postMessage({ type: "failed", lang });
      return;
    }
    try {
      const [aff, dic] = await Promise.all([
        fetch(`/dictionaries/${lang}/index.aff`).then((r) => {
          if (!r.ok) throw new Error(String(r.status));
          return r.text();
        }),
        fetch(`/dictionaries/${lang}/index.dic`).then((r) => {
          if (!r.ok) throw new Error(String(r.status));
          return r.text();
        }),
      ]);
      speller = nspell(aff, dic);
      loadedLang = lang;
      scope.postMessage({ type: "ready", lang });
    } catch {
      scope.postMessage({ type: "failed", lang });
    }
    return;
  }
  if (msg.type === "personal") {
    personal = new Set((msg.words as string[]).flatMap((w) => [w, w.toLowerCase()]));
    return;
  }
  if (msg.type === "check") {
    const wrong = (msg.words as string[]).filter((w) => !correct(w));
    scope.postMessage({ type: "checked", id: msg.id, lang: loadedLang, wrong });
    return;
  }
  if (msg.type === "suggest") {
    const list = speller ? speller.suggest(String(msg.word)).slice(0, 6) : [];
    scope.postMessage({ type: "suggested", id: msg.id, list });
  }
};
