/** Fired on window when the person's dictionary changes, so open editors recheck. */
export const DICTIONARY_CHANGED = "texer:dictionary-changed";

export function announceDictionaryChange(words: string[]) {
  window.dispatchEvent(new CustomEvent(DICTIONARY_CHANGED, { detail: words }));
}
