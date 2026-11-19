/**
 * The model providers a person can bring a key for, and how each one's models are listed. Chat itself goes through one of two routes (see ai-chat.service.ts): Anthropic's own SDK, or the OpenAI SDK pointed at the provider's OpenAI-compatible endpoint, which every other provider here offers.
 *
 * Model lists come from the provider at the moment (no hand-kept list goes stale), are normalized to `ModelInfo`, and are ordered with the provider's flagship and a fast, cheap model first. Which ids those are is a short list of name patterns per provider; when none matches, the newest-looking model leads.
 */

import { modelName } from './model-name';

export const PROVIDER_IDS = [
  'anthropic',
  'openai',
  'gemini',
  'openrouter',
  'mistral',
  'groq',
  'xai',
  'deepseek',
  'compatible',
] as const;
export type ProviderId = (typeof PROVIDER_IDS)[number];

/** The development-only scripted assistant: no key, no model call. */
export const LOCAL_PROVIDER = 'local';
/** The platform's own keys (set by the operators), when Platform AI is on. */
export const PLATFORM_PROVIDER = 'platform';

export interface ProviderSpec {
  id: ProviderId;
  name: string;
  /** Anthropic speaks its own API; every other provider is called through its OpenAI-compatible endpoint. */
  route: 'anthropic' | 'openai';
  /** Fixed for every provider but `compatible`, whose base URL the person gives. */
  baseUrl: string | null;
  /** Where to make a key, for the settings page. */
  keyUrl: string | null;
  /** What a key starts with, to catch a key pasted under the wrong provider; null when keys have no fixed shape. */
  keyPrefix: string | null;
  /** Ordered patterns: the first model matching `flagship` is suggested as the main model, the first matching `fast` as the quick, cheap one. */
  flagship: RegExp[];
  fast: RegExp[];
  /** Whether a model of this provider can call tools when the listing does not say. null: unknown, tried and dropped if refused. */
  toolsByDefault: boolean | null;
  /** Requests take `max_completion_tokens` rather than `max_tokens`. */
  maxCompletionTokens?: boolean;
}

export const PROVIDERS: Record<ProviderId, ProviderSpec> = {
  anthropic: {
    id: 'anthropic',
    name: 'Anthropic',
    route: 'anthropic',
    baseUrl: 'https://api.anthropic.com',
    keyUrl: 'https://console.anthropic.com/settings/keys',
    keyPrefix: 'sk-ant-',
    flagship: [/^claude-opus-5-5$/, /^claude-opus-\d/, /^claude-sonnet-\d/],
    fast: [/^claude-haiku-5-5$/, /^claude-haiku-\d/],
    toolsByDefault: true,
  },
  openai: {
    id: 'openai',
    name: 'OpenAI',
    route: 'openai',
    baseUrl: 'https://api.openai.com/v1',
    keyUrl: 'https://platform.openai.com/api-keys',
    keyPrefix: 'sk-',
    flagship: [/^gpt-6-astra$/, /^gpt-6(\.\d+)?-sol$/, /^gpt-\d+(\.\d+)?$/],
    fast: [/^gpt-6-luna$/, /^gpt-\d+(\.\d+)?-(luna|mini|nano)$/],
    toolsByDefault: true,
    maxCompletionTokens: true,
  },
  gemini: {
    id: 'gemini',
    name: 'Google Gemini',
    route: 'openai',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    keyUrl: 'https://aistudio.google.com/apikey',
    keyPrefix: null,
    flagship: [/^gemini-\d+(\.\d+)?-pro$/, /^gemini-\d+(\.\d+)?-pro/],
    fast: [
      /^gemini-\d+(\.\d+)?-flash$/,
      /^gemini-\d+(\.\d+)?-flash(?!.*(image|tts|audio|live))/,
    ],
    toolsByDefault: true,
  },
  openrouter: {
    id: 'openrouter',
    name: 'OpenRouter',
    route: 'openai',
    baseUrl: 'https://openrouter.ai/api/v1',
    keyUrl: 'https://openrouter.ai/settings/keys',
    keyPrefix: 'sk-or-',
    flagship: [
      /^anthropic\/claude-opus-5\.5$/,
      /^anthropic\/claude-sonnet-5\.5$/,
      /^openai\/gpt-6-astra$/,
    ],
    fast: [
      /^anthropic\/claude-haiku-5\.5$/,
      /^openai\/gpt-6-luna$/,
      /^google\/gemini-[\d.]+-flash$/,
    ],
    toolsByDefault: null,
  },
  mistral: {
    id: 'mistral',
    name: 'Mistral',
    route: 'openai',
    baseUrl: 'https://api.mistral.ai/v1',
    keyUrl: 'https://console.mistral.ai/api-keys',
    keyPrefix: null,
    flagship: [
      /^mistral-large-latest$/,
      /^mistral-large/,
      /^mistral-medium-latest$/,
    ],
    fast: [/^mistral-small-latest$/, /^mistral-small/, /^ministral/],
    toolsByDefault: null,
  },
  groq: {
    id: 'groq',
    name: 'Groq',
    route: 'openai',
    baseUrl: 'https://api.groq.com/openai/v1',
    keyUrl: 'https://console.groq.com/keys',
    keyPrefix: 'gsk_',
    flagship: [
      /^openai\/gpt-oss-120b$/,
      /^moonshotai\/kimi/,
      /^llama-3\.3-70b/,
    ],
    fast: [/^openai\/gpt-oss-20b$/, /^llama-3\.1-8b-instant$/],
    toolsByDefault: true,
  },
  xai: {
    id: 'xai',
    name: 'xAI',
    route: 'openai',
    baseUrl: 'https://api.x.ai/v1',
    keyUrl: 'https://console.x.ai',
    keyPrefix: 'xai-',
    flagship: [
      /^grok-\d+(\.\d+)?$/,
      /^grok-\d+(\.\d+)?-(?!.*(fast|mini|image|vision))/,
    ],
    fast: [/^grok-\d+(\.\d+)?-fast/, /^grok-.*mini/],
    toolsByDefault: true,
  },
  deepseek: {
    id: 'deepseek',
    name: 'DeepSeek',
    route: 'openai',
    baseUrl: 'https://api.deepseek.com/v1',
    keyUrl: 'https://platform.deepseek.com/api_keys',
    keyPrefix: 'sk-',
    flagship: [/^deepseek-reasoner$/, /^deepseek-v\d/],
    fast: [/^deepseek-chat$/],
    toolsByDefault: true,
  },
  compatible: {
    id: 'compatible',
    name: 'OpenAI-compatible',
    route: 'openai',
    baseUrl: null,
    keyUrl: null,
    keyPrefix: null,
    flagship: [],
    fast: [],
    toolsByDefault: null,
  },
};

export const isProviderId = (value: unknown): value is ProviderId =>
  typeof value === 'string' &&
  (PROVIDER_IDS as readonly string[]).includes(value);

export interface ModelInfo {
  id: string;
  name: string;
  /** Tokens the model reads at once; null when the provider does not say. */
  contextTokens: number | null;
  /** The most it writes in one answer; null when the provider does not say. */
  maxOutputTokens: number | null;
  /** Whether it can call the assistant's editing tools: true, false, or null for not known (tried, and answered without edits if refused). */
  tools: boolean | null;
  /** The provider's flagship or its fast, cheap model, shown first. */
  suggested?: 'flagship' | 'fast';
}

/** Model ids that are not chat models (embeddings, speech, images, moderation), left out of every list. */
const NOT_CHAT =
  /(embed|embedding|whisper|tts|transcribe|speech|audio|realtime|dall-e|image|imagen|veo|moderation|omni-moderation|rerank|guard|aqa|babbage|davinci|search|sora|computer-use|vision-only|ocr)/i;

export function isChatModel(id: string): boolean {
  return !NOT_CHAT.test(id);
}

/** A rough "newer first" key from the version numbers in an id: claude-opus-5-5 and gpt-6.1 both read as versions. */
function versionKey(id: string): number[] {
  return (id.match(/\d+/g) ?? []).slice(0, 3).map(Number);
}

function compareNewestFirst(a: ModelInfo, b: ModelInfo): number {
  const va = versionKey(a.id);
  const vb = versionKey(b.id);
  for (let i = 0; i < Math.max(va.length, vb.length); i++) {
    const d = (vb[i] ?? -1) - (va[i] ?? -1);
    if (d) return d;
  }
  return a.id.localeCompare(b.id);
}

/** Orders a provider's models: the suggested flagship, then the suggested fast model, then the rest newest first; dated snapshots and previews after their plain names. */
export function rankModels(
  provider: ProviderId,
  models: ModelInfo[],
): ModelInfo[] {
  const spec = PROVIDERS[provider];
  const chat = models.filter((m) => isChatModel(m.id));
  const seen = new Set<string>();
  const unique = chat.filter((m) =>
    seen.has(m.id) ? false : (seen.add(m.id), true),
  );
  const pick = (patterns: RegExp[], taken: string | null) => {
    for (const p of patterns) {
      const hit = unique
        .filter((m) => p.test(m.id) && m.id !== taken)
        .sort(compareNewestFirst)[0];
      if (hit) return hit;
    }
    return null;
  };
  const flagship = pick(spec.flagship, null);
  const fast = pick(spec.fast, flagship?.id ?? null);
  const noisy = (id: string) =>
    /(\d{4}-?\d{2}-?\d{2}|preview|exp|beta|:)/i.test(id);
  const rest = unique
    .filter((m) => m !== flagship && m !== fast)
    .sort(
      (a, b) =>
        Number(noisy(a.id)) - Number(noisy(b.id)) || compareNewestFirst(a, b),
    );
  return [
    ...(flagship ? [{ ...flagship, suggested: 'flagship' as const }] : []),
    ...(fast ? [{ ...fast, suggested: 'fast' as const }] : []),
    ...rest,
  ];
}

const num = (v: unknown): number | null =>
  typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.floor(v) : null;
const str = (v: unknown): string | null =>
  typeof v === 'string' && v ? v : null;

/** One provider's raw model list, in whatever shape it answers, as `ModelInfo`. */
export function normalizeModels(
  provider: ProviderId,
  payload: unknown,
): ModelInfo[] {
  const spec = PROVIDERS[provider];
  const body = payload as { data?: unknown[]; models?: unknown[] } | unknown[];
  const rows = (
    Array.isArray(body) ? body : (body?.data ?? body?.models ?? [])
  ) as Array<Record<string, unknown>>;
  const out: ModelInfo[] = [];
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue;
    // Gemini's own listing names models "models/gemini-…" and says which can generate text.
    let id = str(row.id) ?? str(row.name);
    if (!id) continue;
    if (provider === 'gemini') {
      id = id.replace(/^models\//, '');
      const methods = row.supportedGenerationMethods;
      if (Array.isArray(methods) && !methods.includes('generateContent'))
        continue;
    }
    const capabilities = (row.capabilities ?? {}) as Record<string, unknown>;
    const params = Array.isArray(row.supported_parameters)
      ? (row.supported_parameters as string[])
      : null;
    let tools: boolean | null = spec.toolsByDefault;
    if (params) tools = params.includes('tools');
    else if (typeof capabilities.function_calling === 'boolean')
      tools = capabilities.function_calling;
    else if (provider === 'anthropic') tools = true;
    const top = (row.top_provider ?? {}) as Record<string, unknown>;
    out.push({
      id,
      name:
        str(row.display_name) ??
        str(row.displayName) ??
        (provider === 'openrouter' ? str(row.name) : undefined) ??
        modelName(id),
      contextTokens:
        num(row.max_input_tokens) ??
        num(row.context_length) ??
        num(row.context_window) ??
        num(row.max_context_length) ??
        num(row.inputTokenLimit) ??
        num(top.context_length),
      maxOutputTokens:
        num(row.max_tokens) ??
        num(row.outputTokenLimit) ??
        num(top.max_completion_tokens) ??
        num(row.max_completion_tokens),
      tools,
    });
  }
  return out;
}
