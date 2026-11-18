import { HttpException, HttpStatus, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { planAllowance } from '../common/plans';
import OpenAI from 'openai';
import Anthropic from '@anthropic-ai/sdk';
import {
  EditSession,
  TOOL_SPECS,
  buildSystemPrompt,
  localReply,
  type ChatInput,
  type ChatTurn,
  type FileEdit,
} from './ai-chat.tools';
import { AiUsageService } from './ai-usage.service';
import { AiKeysService, type Credentials } from './ai-keys.service';
import { PlatformAiService } from './platform-ai.service';
import { decideAccess, platformAvailable } from './ai-access';
import { plansActive } from '../common/billing';
import {
  LOCAL_PROVIDER,
  PLATFORM_PROVIDER,
  PROVIDERS,
  isProviderId,
  type ProviderId,
} from './ai-providers';
import { redactSecrets } from './ai-secrets';
import { guardedFetch } from './url-guard';
import { CHAT_PER_HOUR, CHAT_PER_MINUTE } from './ai-limits';

export type { ProjectFile, FileEdit } from './ai-chat.tools';

export interface ChatResponse {
  message?: string;
  edits: FileEdit[];
  /** The files the assistant read to answer, project files and reference papers alike. */
  read?: string[];
}

/** What the server streams while it answers, one server-sent event each. */
export type ChatEvent =
  | {
      type: 'meta';
      provider: string;
      providerName: string;
      model: string;
      source: 'own' | 'platform' | 'local';
      tools: boolean;
      trimmed: { sent: number; total: number } | null;
    }
  | { type: 'text'; delta: string }
  | {
      type: 'activity';
      id: string;
      tool: string;
      path: string | null;
      state: 'running' | 'done' | 'failed';
    }
  | { type: 'notice'; message: string }
  | { type: 'result'; message: string; edits: FileEdit[]; read: string[] }
  | { type: 'error'; message: string; code: string; retryable: boolean }
  | { type: 'done' };

export type Emit = (event: ChatEvent) => void;

/** Tool rounds per request before the assistant must answer. */
const MAX_TURNS = 8;
/** When a provider does not say how much a model reads, plan for this much. */
const DEFAULT_CONTEXT = 32_000;
/** The default length of one answer when the person has not set one. */
const DEFAULT_OUTPUT = 8_192;
/** A provider that sends nothing for this long is given up on. */
const REQUEST_TIMEOUT_MS = 120_000;

/** A rough token count: about 3.5 characters a token for prose and LaTeX. Only used to decide how much history fits. */
export const estimateTokens = (text: string) => Math.ceil(text.length / 3.5);

/**
 * Which earlier turns fit in the model's context with the new question and the instructions, newest kept first. Returns the turns to send and how many were left out.
 */
export function fitHistory(
  history: ChatTurn[],
  budgetTokens: number,
): { turns: ChatTurn[]; dropped: number } {
  const kept: ChatTurn[] = [];
  let used = 0;
  for (let i = history.length - 1; i >= 0; i--) {
    const cost = estimateTokens(history[i].content) + 8;
    if (used + cost > budgetTokens) break;
    used += cost;
    kept.unshift(history[i]);
  }
  // A conversation sent to a model starts with the person's turn.
  while (kept.length && kept[0].role !== 'user') kept.shift();
  return { turns: kept, dropped: history.length - kept.length };
}

/** Everything one answer needs: who pays, which model, and how it is called. */
export interface ChatRoute {
  source: 'own' | 'platform' | 'local';
  provider: ProviderId | typeof LOCAL_PROVIDER;
  model: string;
  credentials: Credentials | null;
  /** Whether the model takes the editing tools: true, false, or null for not known (tried, and dropped if refused). */
  tools: boolean | null;
  contextTokens: number | null;
  maxOutputTokens: number;
  temperature: number | null;
  systemNote: string | null;
}

/** What one assistant message used, added up across its round trips. */
interface Meter {
  model: string | null;
  requests: number;
  inputTokens: number;
  outputTokens: number;
}

const OPENAI_TOOLS: OpenAI.Chat.Completions.ChatCompletionTool[] =
  TOOL_SPECS.map((t) => ({
    type: 'function',
    function: {
      name: t.name,
      description: t.description,
      parameters: t.parameters,
    },
  }));

const ANTHROPIC_TOOLS: Anthropic.Tool[] = TOOL_SPECS.map((t) => ({
  name: t.name,
  description: t.description,
  input_schema: t.parameters as unknown as Anthropic.Tool.InputSchema,
}));

class ChatFailure extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly retryable: boolean,
  ) {
    super(message);
  }
}

/**
 * The assistant's chat. Each request is routed (the person's own key first, then the platform's keys when Platform AI is on and the plan includes it, or the local test model in development), then answered as a stream: text as it is written, each file the assistant reads or changes as it does, and at the end the proposed edits. Stopping the request (the browser closes the connection) aborts the call at the provider.
 */
@Injectable()
export class AiChatService {
  private readonly logger = new Logger(AiChatService.name);

  constructor(
    private configService: ConfigService,
    private prisma: PrismaService,
    private usage: AiUsageService,
    private keys: AiKeysService,
    private platform: PlatformAiService,
  ) {}

  private get production(): boolean {
    return this.configService.get<string>('NODE_ENV') === 'production';
  }

  /** Whether the assistant comes with this user's plan on the platform's keys. */
  async planIncludesAssistant(userId: number): Promise<boolean> {
    const user = await this.prisma.client.user.findUnique({
      where: { id: userId },
      select: { subscriptionType: true },
    });
    return planAllowance(user?.subscriptionType).aiAssistant;
  }

  async preferences(userId: number) {
    const row = await this.prisma.client.aiPreference.findUnique({
      where: { userId },
    });
    return {
      provider: row?.provider ?? null,
      model: row?.model ?? null,
      temperature: row?.temperature ?? null,
      maxOutputTokens: row?.maxOutputTokens ?? null,
      systemNote: row?.systemNote ?? null,
    };
  }

  async savePreferences(userId: number, body: Record<string, unknown>) {
    const data: {
      provider?: string | null;
      model?: string | null;
      temperature?: number | null;
      maxOutputTokens?: number | null;
      systemNote?: string | null;
    } = {};
    if ('provider' in body) {
      const p = body.provider;
      if (
        p !== null &&
        !isProviderId(p) &&
        p !== PLATFORM_PROVIDER &&
        !(p === LOCAL_PROVIDER && !this.production)
      )
        throw new HttpException('Unknown provider.', HttpStatus.BAD_REQUEST);
      data.provider = p ?? null;
    }
    if ('model' in body) {
      const m = body.model;
      if (m !== null && (typeof m !== 'string' || m.length > 200))
        throw new HttpException('Unknown model.', HttpStatus.BAD_REQUEST);
      data.model = m || null;
    }
    if ('temperature' in body) {
      const t = body.temperature;
      if (
        t !== null &&
        (typeof t !== 'number' || !Number.isFinite(t) || t < 0 || t > 2)
      )
        throw new HttpException(
          'Temperature is between 0 and 2.',
          HttpStatus.BAD_REQUEST,
        );
      data.temperature = t;
    }
    if ('maxOutputTokens' in body) {
      const n = body.maxOutputTokens;
      if (
        n !== null &&
        (typeof n !== 'number' ||
          !Number.isInteger(n) ||
          n < 256 ||
          n > 128_000)
      )
        throw new HttpException(
          'The longest answer is between 256 and 128,000 tokens.',
          HttpStatus.BAD_REQUEST,
        );
      data.maxOutputTokens = n;
    }
    if ('systemNote' in body) {
      const s = body.systemNote;
      if (s !== null && (typeof s !== 'string' || s.length > 2000))
        throw new HttpException(
          'The note is at most 2,000 characters.',
          HttpStatus.BAD_REQUEST,
        );
      data.systemNote = typeof s === 'string' && s.trim() ? s.trim() : null;
    }
    await this.prisma.client.aiPreference.upsert({
      where: { userId },
      create: { userId, ...data },
      update: data,
    });
    return this.preferences(userId);
  }

  /**
   * What the editor and the settings page show before anyone types: whether the assistant can answer for this person, with what, and if not, why and what fixes it.
   */
  async statusFor(userId: number) {
    const [keys, platform, plan, prefs] = await Promise.all([
      this.keys.list(userId),
      this.platform.state(),
      this.planIncludesAssistant(userId),
      this.preferences(userId),
    ]);
    const keySet = new Set(
      this.keys.canStore ? keys.map((k) => k.provider) : [],
    );
    const decision = decideAccess({
      requested: null,
      preferred: prefs.provider,
      keys: keySet,
      platformEnabled: platform.enabled,
      platformConfigured: platform.configured,
      planIncludesAssistant: plan,
      production: this.production,
    });
    const platformOk = platformAvailable({
      platformEnabled: platform.enabled,
      platformConfigured: platform.configured,
      planIncludesAssistant: plan,
    });
    return {
      available: decision.ok,
      /** Kept for older clients: who answers by default. */
      provider: decision.ok ? decision.provider : null,
      reason: decision.ok ? null : decision.reason,
      // Upgrade is offered only while plans are on sale.
      upgrade: decision.ok ? false : decision.upgrade && plansActive(this.configService),
      source: decision.ok ? decision.source : null,
      canStoreKeys: this.keys.canStore,
      platform: {
        enabled: platform.enabled,
        configured: platform.configured,
        included: plan,
        available: platformOk,
        model: platformOk ? platform.model : null,
      },
      keys: keys.map((k) => ({
        provider: k.provider,
        name: PROVIDERS[k.provider].name,
        last4: k.last4,
        baseUrl: k.baseUrl,
        createdAt: k.createdAt,
        lastUsedAt: k.lastUsedAt,
      })),
      preferences: prefs,
      /** The scripted local model, offered in development only. */
      localModel: !this.production,
      dictation: keySet.has('openai')
        ? 'own'
        : platformOk
          ? 'platform'
          : !this.production &&
              this.configService.get<string>('AI_CHAT_LIVE_IN_DEV') !== 'true'
            ? 'local'
            : 'browser',
    };
  }

  /** Throws a plain message when the person may not use the assistant at all; used by routes that need any access (dictation through the platform). */
  async assertPlanIncludesAssistant(userId: number): Promise<void> {
    if (!(await this.planIncludesAssistant(userId))) {
      throw new HttpException(
        'The AI assistant comes with the Pro and Team plans.',
        HttpStatus.PAYMENT_REQUIRED,
      );
    }
  }

  /**
   * Decides who answers and with which model, before anything is streamed, so a refusal is a normal HTTP error with a code the editor turns into the block card (never a raw provider error). Also counts the request against the person's rate limits.
   */
  async route(
    userId: number,
    requested: { provider?: string | null; model?: string | null },
  ): Promise<ChatRoute> {
    for (const limit of [CHAT_PER_MINUTE, CHAT_PER_HOUR]) {
      const r = limit.take(userId);
      if (!r.ok)
        throw new HttpException(
          {
            message: `You have sent a lot of messages. Wait ${r.retryAfter} seconds, then try again.`,
            code: 'rate_limited',
            retryAfter: r.retryAfter,
          },
          HttpStatus.TOO_MANY_REQUESTS,
        );
    }
    const [keySet, platform, plan, prefs] = await Promise.all([
      this.keys.keySet(userId),
      this.platform.state(),
      this.planIncludesAssistant(userId),
      this.preferences(userId),
    ]);
    const decision = decideAccess({
      requested: requested.provider ?? null,
      preferred: prefs.provider,
      keys: keySet,
      platformEnabled: platform.enabled,
      platformConfigured: platform.configured,
      planIncludesAssistant: plan,
      production: this.production,
    });
    if (!decision.ok) {
      const upgrade = decision.upgrade && plansActive(this.configService);
      throw new HttpException(
        {
          message: upgrade
            ? 'Add your own API key to use Axya, or upgrade to a plan that includes it.'
            : 'Add your own API key to use Axya.',
          code: 'no_key',
          upgrade,
        },
        HttpStatus.PAYMENT_REQUIRED,
      );
    }
    const temperature = prefs.temperature;
    const systemNote = prefs.systemNote;
    if (decision.source === 'local') {
      return {
        source: 'local',
        provider: LOCAL_PROVIDER,
        model: 'Local test model',
        credentials: null,
        tools: true,
        contextTokens: null,
        maxOutputTokens: DEFAULT_OUTPUT,
        temperature: null,
        systemNote,
      };
    }
    // In development the platform's keys are not spent unless AI_CHAT_LIVE_IN_DEV=true: the platform path answers from the local script instead, as it always has.
    if (
      decision.source === 'platform' &&
      !this.production &&
      this.configService.get<string>('AI_CHAT_LIVE_IN_DEV') !== 'true'
    ) {
      return {
        source: 'local',
        provider: LOCAL_PROVIDER,
        model: 'Local test model',
        credentials: null,
        tools: true,
        contextTokens: null,
        maxOutputTokens: DEFAULT_OUTPUT,
        temperature: null,
        systemNote,
      };
    }
    if (decision.source === 'platform') {
      const creds = this.platform.credentials()!;
      return {
        source: 'platform',
        provider: creds.provider,
        model: creds.model,
        credentials: {
          provider: creds.provider,
          key: creds.key,
          baseUrl: creds.baseUrl,
          guarded: false,
          local: false,
        },
        tools: true,
        contextTokens: null,
        maxOutputTokens: prefs.maxOutputTokens ?? DEFAULT_OUTPUT,
        temperature,
        systemNote,
      };
    }
    const provider = decision.provider;
    const credentials = await this.keys.credentials(userId, provider);
    if (!credentials)
      throw new HttpException(
        {
          message:
            'Your saved key cannot be read. Add it again in AI settings.',
          code: 'no_key',
          upgrade: false,
        },
        HttpStatus.PAYMENT_REQUIRED,
      );
    // The model: the one asked for, else the account's default for this provider, else the provider's suggested model.
    let model =
      requested.provider === provider && requested.model
        ? requested.model
        : prefs.provider === provider && prefs.model
          ? prefs.model
          : null;
    let models: Awaited<ReturnType<AiKeysService['modelsFor']>> = [];
    try {
      models = await this.keys.modelsFor(userId, provider);
    } catch {
      // The list is a convenience; a model named explicitly can still be tried.
    }
    if (!model) model = models[0]?.id ?? null;
    if (!model)
      throw new HttpException(
        {
          message: `Choose a ${PROVIDERS[provider].name} model in AI settings.`,
          code: 'no_model',
        },
        HttpStatus.BAD_REQUEST,
      );
    const info = models.find((m) => m.id === model) ?? null;
    const ceiling = info?.maxOutputTokens ?? null;
    const wanted = prefs.maxOutputTokens ?? DEFAULT_OUTPUT;
    return {
      source: 'own',
      provider,
      model,
      credentials,
      tools: info ? info.tools : PROVIDERS[provider].toolsByDefault,
      contextTokens: info?.contextTokens ?? null,
      maxOutputTokens: ceiling ? Math.min(wanted, ceiling) : wanted,
      temperature,
      systemNote,
    };
  }

  /** The non-streaming form, for API clients: the same answer, collected. */
  async chat(
    input: ChatInput & { provider?: string; model?: string },
  ): Promise<ChatResponse> {
    const route = await this.route(input.userId!, {
      provider: input.provider,
      model: input.model,
    });
    let result: ChatResponse = { message: '', edits: [], read: [] };
    let failure: { message: string; code: string } | null = null;
    await this.stream(
      route,
      input,
      (e) => {
        if (e.type === 'result')
          result = { message: e.message, edits: e.edits, read: e.read };
        if (e.type === 'error') failure = e;
      },
      new AbortController().signal,
    );
    if (failure)
      throw new HttpException(
        (failure as { message: string }).message,
        HttpStatus.BAD_GATEWAY,
      );
    return result;
  }

  /** Answers one question on `route`, streaming events through `emit`. Never throws: a failure is an `error` event. */
  async stream(
    route: ChatRoute,
    input: ChatInput,
    emit: Emit,
    signal: AbortSignal,
  ): Promise<void> {
    const providerName =
      route.provider === LOCAL_PROVIDER
        ? 'Local'
        : PROVIDERS[route.provider].name;
    const meter: Meter = {
      model: route.model,
      requests: 0,
      inputTokens: 0,
      outputTokens: 0,
    };
    const started = Date.now();
    let ok = false;
    // The history that fits: what is left of the context after the instructions, the question, the tools, and room for the answer.
    const context = route.contextTokens ?? DEFAULT_CONTEXT;
    const fixed =
      estimateTokens(buildSystemPrompt(input)) +
      estimateTokens(input.message) +
      1_500 +
      Math.min(route.maxOutputTokens, Math.floor(context / 4));
    const history = input.history ?? [];
    const fit = fitHistory(
      history,
      Math.max(0, Math.floor((context - fixed) * 0.6)),
    );
    const sentInput: ChatInput = { ...input, history: fit.turns };
    const tools = route.tools !== false;
    emit({
      type: 'meta',
      provider: route.provider,
      providerName,
      model: route.model,
      source: route.source,
      tools,
      trimmed: fit.dropped
        ? { sent: fit.turns.length, total: history.length }
        : null,
    });
    if (!tools)
      emit({
        type: 'notice',
        message: `${route.model} cannot use tools, so Axya answers without proposing edits. Choose a model marked "Edits" to change files.`,
      });
    try {
      if (route.source === 'local')
        await this.streamLocal(sentInput, emit, signal);
      else if (PROVIDERS[route.provider as ProviderId].route === 'anthropic')
        await this.streamAnthropic(
          route,
          sentInput,
          emit,
          signal,
          meter,
          tools,
          context,
        );
      else
        await this.streamOpenAI(
          route,
          sentInput,
          emit,
          signal,
          meter,
          tools,
          context,
        );
      ok = true;
      if (!signal.aborted) emit({ type: 'done' });
    } catch (err) {
      if (signal.aborted) return;
      const failure =
        err instanceof ChatFailure
          ? err
          : this.describe(err, providerName, route);
      emit({
        type: 'error',
        message: failure.message,
        code: failure.code,
        retryable: failure.retryable,
      });
    } finally {
      if (input.userId && (meter.requests > 0 || route.source === 'local')) {
        this.usage.record({
          userId: input.userId,
          kind: 'chat',
          provider: route.source === 'local' ? 'local' : route.provider,
          model: route.model,
          requests: meter.requests || 1,
          inputTokens: meter.inputTokens,
          outputTokens: meter.outputTokens,
          durationMs: Date.now() - started,
          ok: ok && !signal.aborted,
          keySource: route.source,
        });
      }
    }
  }

  private instructions(
    input: ChatInput,
    route: ChatRoute,
    tools: boolean,
  ): string {
    const parts = [buildSystemPrompt(input)];
    if (!tools)
      parts.push(
        'You cannot change files in this conversation: this model has no tool use, so you cannot read files beyond what is above either. Answer in text; when a change would help, show it as a LaTeX code block the author can copy.',
      );
    if (route.systemNote)
      parts.push(
        `The author's own note for you (follow it unless it conflicts with the rules above):\n${route.systemNote}`,
      );
    return parts.join('\n\n');
  }

  /** A tool result too long for the model's context is cut, with a note saying so. */
  private fitResult(result: string, context: number): string {
    const limit = Math.max(4_000, Math.floor(context * 3.5 * 0.4));
    return result.length > limit
      ? `${result.slice(0, limit)}\n\n[The file continues; it was cut to fit the model's context.]`
      : result;
  }

  /** The scripted development reply, streamed in small bursts like a model would, so the interface can be exercised without a key. */
  private async streamLocal(input: ChatInput, emit: Emit, signal: AbortSignal) {
    const reply = localReply(input);
    for (const path of reply.read) {
      emit({
        type: 'activity',
        id: `read:${path}`,
        tool: 'read_file',
        path,
        state: 'done',
      });
    }
    const words = reply.message.match(/\S+\s*|\s+/g) ?? [];
    for (let i = 0; i < words.length; i += 3) {
      if (signal.aborted) return;
      emit({ type: 'text', delta: words.slice(i, i + 3).join('') });
      await new Promise((r) => setTimeout(r, 30));
    }
    for (const edit of reply.edits)
      emit({
        type: 'activity',
        id: `edit:${edit.path}`,
        tool: edit.created ? 'write_file' : 'replace_in_file',
        path: edit.path,
        state: 'done',
      });
    emit({
      type: 'result',
      message: reply.message,
      edits: reply.edits,
      read: reply.read,
    });
  }

  private openaiClient(route: ChatRoute): OpenAI {
    const c = route.credentials!;
    return new OpenAI({
      apiKey: c.key,
      baseURL: c.baseUrl,
      timeout: REQUEST_TIMEOUT_MS,
      maxRetries: 1,
      ...(c.guarded
        ? {
            fetch: guardedFetch(c.local),
          }
        : {}),
      defaultHeaders:
        route.provider === 'openrouter'
          ? { 'HTTP-Referer': 'https://aurore-section-archivescom.vercel.app', 'X-Title': 'Eneles' }
          : undefined,
    });
  }

  private async streamOpenAI(
    route: ChatRoute,
    input: ChatInput,
    emit: Emit,
    signal: AbortSignal,
    meter: Meter,
    withTools: boolean,
    context: number,
  ) {
    const client = this.openaiClient(route);
    const spec = PROVIDERS[route.provider as ProviderId];
    const session = new EditSession(input.files, input.references);
    const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
      { role: 'system', content: this.instructions(input, route, withTools) },
      ...(input.history ?? []).map((t) => ({
        role: t.role,
        content: t.content,
      })),
      { role: 'user', content: input.message },
    ];
    let tools = withTools;
    let usageOption =
      route.provider !== 'mistral' && route.provider !== 'compatible';
    let text = '';
    const say = (delta: string) => {
      if (!delta) return;
      text += delta;
      emit({ type: 'text', delta });
    };

    for (let turn = 0; turn < MAX_TURNS; turn++) {
      if (signal.aborted) return;
      const params: OpenAI.Chat.Completions.ChatCompletionCreateParamsStreaming =
        {
          model: route.model,
          messages,
          stream: true,
          ...(usageOption ? { stream_options: { include_usage: true } } : {}),
          ...(tools
            ? { tools: OPENAI_TOOLS, tool_choice: 'auto' as const }
            : {}),
          ...(route.temperature !== null
            ? { temperature: route.temperature }
            : {}),
          ...(spec.maxCompletionTokens
            ? { max_completion_tokens: route.maxOutputTokens }
            : { max_tokens: route.maxOutputTokens }),
        };
      let stream: AsyncIterable<OpenAI.Chat.Completions.ChatCompletionChunk>;
      try {
        stream = await client.chat.completions.create(params, { signal });
      } catch (err) {
        // A model or server that refuses tools, or the usage option, is asked again without them, once.
        const status = (err as { status?: number }).status;
        const message = String((err as { message?: string }).message ?? '');
        if (
          status === 400 &&
          tools &&
          /tool|function/i.test(message) &&
          route.tools !== true
        ) {
          tools = false;
          messages[0] = {
            role: 'system',
            content: this.instructions(input, route, false),
          };
          emit({
            type: 'notice',
            message: `${route.model} does not support tools here, so Axya answers without proposing edits.`,
          });
          turn--;
          continue;
        }
        if (
          status === 400 &&
          usageOption &&
          /stream_options|include_usage/i.test(message)
        ) {
          usageOption = false;
          turn--;
          continue;
        }
        throw err;
      }
      meter.requests += 1;
      // Text from a later round starts a new paragraph, once it comes.
      let separate = turn > 0 && !!text && !text.endsWith('\n');
      const calls = new Map<
        number,
        { id: string; name: string; args: string }
      >();
      let roundText = '';
      for await (const chunk of stream) {
        if (chunk.usage) {
          meter.inputTokens += chunk.usage.prompt_tokens ?? 0;
          meter.outputTokens += chunk.usage.completion_tokens ?? 0;
        }
        const choice = chunk.choices?.[0];
        if (!choice) continue;
        const delta = choice.delta ?? {};
        if (typeof delta.content === 'string' && delta.content) {
          roundText += delta.content;
          if (separate) say('\n\n');
          separate = false;
          say(delta.content);
        }
        for (const part of delta.tool_calls ?? []) {
          const index = part.index ?? 0;
          const call = calls.get(index) ?? { id: '', name: '', args: '' };
          if (part.id) call.id = part.id;
          if (part.function?.name) {
            const first = !call.name;
            call.name += part.function.name;
            if (first)
              emit({
                type: 'activity',
                id: call.id || `call-${turn}-${index}`,
                tool: call.name,
                path: null,
                state: 'running',
              });
          }
          if (part.function?.arguments) call.args += part.function.arguments;
          calls.set(index, call);
        }
      }
      if (!calls.size) break;
      const toolCalls = [...calls.entries()]
        .sort((a, b) => a[0] - b[0])
        .map(([index, c]) => ({ ...c, id: c.id || `call_${turn}_${index}` }));
      messages.push({
        role: 'assistant',
        content: roundText || null,
        tool_calls: toolCalls.map((c) => ({
          id: c.id,
          type: 'function' as const,
          function: { name: c.name, arguments: c.args || '{}' },
        })),
      });
      for (const call of toolCalls) {
        const args = this.parseArgs(call.args);
        const path = typeof args.path === 'string' ? args.path : null;
        const { ok, result } = session.run(call.name, args);
        emit({
          type: 'activity',
          id: call.id,
          tool: call.name,
          path,
          state: ok ? 'done' : 'failed',
        });
        messages.push({
          role: 'tool',
          tool_call_id: call.id,
          content: this.fitResult(result, context),
        });
      }
    }
    if (!signal.aborted)
      emit({
        type: 'result',
        message: text.trim(),
        edits: session.edits(),
        read: session.read(),
      });
  }

  private async streamAnthropic(
    route: ChatRoute,
    input: ChatInput,
    emit: Emit,
    signal: AbortSignal,
    meter: Meter,
    withTools: boolean,
    context: number,
  ) {
    const client = new Anthropic({
      apiKey: route.credentials!.key,
      timeout: REQUEST_TIMEOUT_MS,
      maxRetries: 1,
    });
    const session = new EditSession(input.files, input.references);
    const messages: Anthropic.MessageParam[] = [
      ...(input.history ?? []).map((t) => ({
        role: t.role,
        content: t.content,
      })),
      { role: 'user', content: input.message },
    ];
    let text = '';
    for (let turn = 0; turn < MAX_TURNS; turn++) {
      if (signal.aborted) return;
      // No temperature: current Claude models refuse sampling settings.
      const stream = client.messages.stream(
        {
          model: route.model,
          max_tokens: route.maxOutputTokens,
          system: this.instructions(input, route, withTools),
          messages,
          ...(withTools ? { tools: ANTHROPIC_TOOLS } : {}),
        },
        { signal },
      );
      meter.requests += 1;
      let first = true;
      for await (const event of stream) {
        if (
          event.type === 'content_block_start' &&
          event.content_block.type === 'tool_use'
        ) {
          emit({
            type: 'activity',
            id: event.content_block.id,
            tool: event.content_block.name,
            path: null,
            state: 'running',
          });
        }
        if (
          event.type === 'content_block_delta' &&
          event.delta.type === 'text_delta' &&
          event.delta.text
        ) {
          if (first && turn > 0 && text && !text.endsWith('\n')) {
            text += '\n\n';
            emit({ type: 'text', delta: '\n\n' });
          }
          first = false;
          text += event.delta.text;
          emit({ type: 'text', delta: event.delta.text });
        }
      }
      const message = await stream.finalMessage();
      meter.inputTokens += message.usage?.input_tokens ?? 0;
      meter.outputTokens += message.usage?.output_tokens ?? 0;
      if (message.stop_reason === 'refusal')
        throw new ChatFailure(
          'The model declined to answer this request.',
          'refusal',
          false,
        );
      const results: Anthropic.ToolResultBlockParam[] = [];
      for (const block of message.content) {
        if (block.type !== 'tool_use') continue;
        const args = (block.input ?? {}) as Record<string, unknown>;
        const { ok, result } = session.run(block.name, args);
        emit({
          type: 'activity',
          id: block.id,
          tool: block.name,
          path: typeof args.path === 'string' ? args.path : null,
          state: ok ? 'done' : 'failed',
        });
        results.push({
          type: 'tool_result',
          tool_use_id: block.id,
          content: this.fitResult(result, context),
          is_error: !ok,
        });
      }
      if (!results.length) break;
      messages.push(
        { role: 'assistant', content: message.content },
        { role: 'user', content: results },
      );
    }
    if (!signal.aborted)
      emit({
        type: 'result',
        message: text.trim(),
        edits: session.edits(),
        read: session.read(),
      });
  }

  /** A provider's failure as one sentence the person can act on. Never includes the key, and never the provider's raw answer beyond a short, cleaned reason. */
  private describe(err: unknown, name: string, route: ChatRoute): ChatFailure {
    const e = err as {
      status?: number;
      name?: string;
      message?: string;
      code?: string;
      cause?: { code?: string };
      error?: { error?: { message?: string }; message?: string };
    };
    const status = e?.status;
    const key = route.credentials?.key;
    const reason = redactSecrets(
      String(e?.error?.error?.message ?? e?.error?.message ?? e?.message ?? ''),
      key,
    )
      .replace(/\s+/g, ' ')
      .slice(0, 200);
    const own = route.source === 'own';
    if (status === 401 || status === 403)
      return new ChatFailure(
        own
          ? `${name} refused your key. Check it in AI settings, or add a new one.`
          : `${name} refused the platform's key. Try again later.`,
        'key_refused',
        false,
      );
    if (status === 402)
      return new ChatFailure(
        `${name} says the account behind ${own ? 'your key' : 'this key'} is out of credit.`,
        'quota',
        false,
      );
    if (status === 429)
      return new ChatFailure(
        `${name} is limiting requests${own ? ' for your key' : ''} (rate limit or quota). Wait a moment, then try again.`,
        'rate_limited',
        true,
      );
    if (status === 404)
      return new ChatFailure(
        `${name} does not offer ${route.model} to this key. Choose another model.`,
        'model',
        false,
      );
    if (status === 400 || status === 413 || status === 422) {
      if (
        /context|too long|maximum.*tokens|token limit|prompt is too long/i.test(
          reason,
        )
      )
        return new ChatFailure(
          'This conversation is too long for the model. Start a new conversation, or choose a model with a larger context.',
          'context',
          false,
        );
      return new ChatFailure(
        `${name} refused the request${reason ? `: ${reason}` : '.'}`,
        'refused',
        false,
      );
    }
    if (status === 529 || (status && status >= 500))
      return new ChatFailure(
        `${name} is having problems right now. Try again in a moment.`,
        'provider_down',
        true,
      );
    if (e?.code === 'EADDRBLOCKED' || e?.cause?.code === 'EADDRBLOCKED')
      return new ChatFailure(
        'That base URL points at a private or reserved network address, which the server does not call.',
        'blocked',
        false,
      );
    if (e?.name === 'APIConnectionTimeoutError' || e?.name === 'TimeoutError')
      return new ChatFailure(
        `${name} took too long to answer. Try again.`,
        'timeout',
        true,
      );
    if (
      /terminated|premature|ECONNRESET|other side closed|socket hang up/i.test(
        String(e?.message ?? '') + String(e?.cause?.code ?? ''),
      )
    )
      return new ChatFailure(
        `The connection to ${name} dropped in the middle of the answer.`,
        'interrupted',
        true,
      );
    if (
      e?.name === 'APIConnectionError' ||
      /fetch failed|ECONNREFUSED|ENOTFOUND|socket|network/i.test(
        String(e?.message ?? ''),
      )
    )
      return new ChatFailure(
        `Could not reach ${name}. Try again in a moment.`,
        'unreachable',
        true,
      );
    this.logger.warn(
      `Assistant request to ${name} failed: ${redactSecrets(String(e?.message ?? err), key)}`,
    );
    return new ChatFailure(
      `Something went wrong while ${name} was answering. Try again.`,
      'unknown',
      true,
    );
  }

  private parseArgs(raw: string | undefined): Record<string, unknown> {
    try {
      const value: unknown = JSON.parse(raw || '{}');
      return value && typeof value === 'object'
        ? (value as Record<string, unknown>)
        : {};
    } catch {
      return {};
    }
  }
}
