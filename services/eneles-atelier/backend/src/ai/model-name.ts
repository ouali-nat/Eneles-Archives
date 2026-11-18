/**
 * A model's name as people write it, from the id a provider uses: `claude-opus-5-5` is Claude Opus 5.5, `claude-sonnet-4-6` is Claude Sonnet 4.6, `gpt-6-luna` is GPT-6 Luna, `gemini-2.5-pro` is Gemini 2.5 Pro, `llama-3.3-70b-versatile` is Llama 3.3 70B Versatile, and `o3-mini` is o3 Mini. A date, a build number, or "latest" at the end of an id is left out, and an OpenRouter-style `vendor/` prefix is dropped. A name that is already a name (it has a space or a capital) is kept as it is.
 *
 * The frontend has the same rules (lib/ai/model-name.ts) for ids it shows; this one names the models a provider lists without a display name of its own.
 */

const WORDS: Record<string, string> = {
  gpt: 'GPT',
  deepseek: 'DeepSeek',
  openai: 'OpenAI',
  xai: 'xAI',
  ai: 'AI',
  vl: 'VL',
  it: 'IT',
};

export function modelName(id: string | null | undefined): string {
  if (!id) return '';
  const raw = id.trim();
  if (!raw || /\s/.test(raw) || /[A-Z]/.test(raw)) return raw;
  const bare = raw.includes('/') ? raw.slice(raw.lastIndexOf('/') + 1) : raw;
  const tokens = bare.split(/[-_:]/).filter(Boolean);
  // A date (20250514, 2025-05-14, 0528), a build number (001), or "latest" at the end says which build, not which model.
  while (tokens.length > 1) {
    const last = tokens[tokens.length - 1];
    if (last === 'latest' || /^\d{3,8}$/.test(last)) tokens.pop();
    else if (
      tokens.length > 3 &&
      /^\d{2}$/.test(last) &&
      /^\d{2}$/.test(tokens[tokens.length - 2]) &&
      /^\d{4}$/.test(tokens[tokens.length - 3])
    )
      tokens.splice(-3, 3);
    else break;
  }
  const out: string[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    // Version numbers split by hyphens are one dotted version: 5 5 is 5.5.
    if (
      /^\d{1,2}$/.test(t) &&
      out.length &&
      /^\d+(\.\d+)*$/.test(out[out.length - 1]) &&
      !out[out.length - 1].includes('B')
    ) {
      out[out.length - 1] += `.${t}`;
      continue;
    }
    let word: string;
    if (WORDS[t]) word = WORDS[t];
    else if (/^o\d/.test(t) && i === 0)
      word = t; // OpenAI's o-series is written in lower case.
    else if (/^\d+(\.\d+)?[bkm]$/i.test(t) || /^\d+x\d+[bkm]$/i.test(t))
      word = t.toUpperCase().replace('X', 'x');
    else if (/^\d/.test(t)) word = t;
    else word = t[0].toUpperCase() + t.slice(1);
    out.push(word);
  }
  // GPT and its version are one word: GPT-6, GPT-4o.
  const joined: string[] = [];
  for (const word of out) {
    const prev = joined[joined.length - 1];
    if (prev === 'GPT' && /^\d/.test(word))
      joined[joined.length - 1] = `GPT-${word}`;
    else joined.push(word);
  }
  return joined.join(' ');
}
