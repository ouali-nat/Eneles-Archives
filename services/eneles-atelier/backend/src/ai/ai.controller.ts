import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpException,
  HttpStatus,
  Param,
  Post,
  Put,
  Query,
  Req,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type {
  Request as ExpressRequest,
  Response as ExpressResponse,
} from 'express';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import OpenAI, { toFile } from 'openai';
import { AiService } from './ai.service';
import { AiChatService } from './ai-chat.service';
import { AiUsageService } from './ai-usage.service';
import { AiKeysService } from './ai-keys.service';
import { PlatformAiService } from './platform-ai.service';
import { platformAvailable } from './ai-access';
import { PROVIDERS, PROVIDER_IDS, isProviderId } from './ai-providers';
import { redactSecrets } from './ai-secrets';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { AiChatDto } from '../projects/dto/ai-chat.dto';
import { chatInput, streamChat } from './ai-chat-http';

const AUDIO_MIMES = [
  'audio/webm',
  'audio/mp3',
  'audio/mpeg',
  'audio/wav',
  'audio/ogg',
  'audio/mp4',
];

@Controller('ai')
export class AiController {
  constructor(
    private readonly aiService: AiService,
    private readonly aiChatService: AiChatService,
    private readonly usage: AiUsageService,
    private readonly keys: AiKeysService,
    private readonly platform: PlatformAiService,
  ) {}

  /** Whether the editor's assistant can answer for this person, with what, and if not, why and what fixes it. */
  @Get('chat/status')
  chatStatus(@CurrentUser() userId: number) {
    return this.aiChatService.statusFor(userId);
  }

  /**
   * The assistant for a project that is not on Eneles (a folder in the desktop app): the same question and the same answer as `POST /projects/:uid/ai/chat/stream`, with the same limits, for the signed-in person. Every file comes with the question, so there is no project to check and no reference papers to add; nothing is stored but the person's usage.
   */
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { ttl: 60000, limit: 30 } }) // per address; the assistant also limits each person (ai-limits.ts)
  @Post('chat/stream')
  async chatStream(
    @CurrentUser() userId: number,
    @Body() body: AiChatDto,
    @Req() req: ExpressRequest,
    @Res() res: ExpressResponse,
  ) {
    await streamChat(
      this.aiChatService,
      body,
      chatInput(userId, body),
      req,
      res,
    );
  }

  /** The providers a key can be added for, with where to make one. */
  @Get('providers')
  providers() {
    return PROVIDER_IDS.map((id) => ({
      id,
      name: PROVIDERS[id].name,
      keyUrl: PROVIDERS[id].keyUrl,
      keyPrefix: PROVIDERS[id].keyPrefix,
      needsBaseUrl: id === 'compatible',
    }));
  }

  /** The person's keys: provider, last four characters, and dates. Never the key. */
  @Get('keys')
  async listKeys(@CurrentUser() userId: number) {
    return { canStore: this.keys.canStore, keys: await this.keys.list(userId) };
  }

  /** Checks a key with the provider (a model list), then seals and stores it. */
  @Post('keys')
  saveKey(
    @CurrentUser() userId: number,
    @Body() body: { provider?: unknown; key?: unknown; baseUrl?: unknown },
  ) {
    return this.keys.save(userId, body?.provider, body?.key, body?.baseUrl);
  }

  @Delete('keys/:provider')
  @HttpCode(204)
  async removeKey(
    @CurrentUser() userId: number,
    @Param('provider') provider: string,
  ) {
    await this.keys.remove(userId, provider);
  }

  /** The models a connected provider offers this person, best first. `refresh=1` asks the provider again. */
  @Get('models')
  async models(
    @CurrentUser() userId: number,
    @Query('provider') provider: string,
    @Query('refresh') refresh?: string,
  ) {
    if (provider === 'platform') {
      const [state, plan] = await Promise.all([
        this.platform.state(),
        this.aiChatService.planIncludesAssistant(userId),
      ]);
      if (
        !platformAvailable({
          platformEnabled: state.enabled,
          platformConfigured: state.configured,
          planIncludesAssistant: plan,
        }) ||
        !state.model
      )
        return { provider, models: [] };
      return {
        provider,
        models: [
          {
            id: state.model,
            name: state.model,
            contextTokens: null,
            maxOutputTokens: null,
            tools: true,
            suggested: 'flagship',
          },
        ],
      };
    }
    if (!isProviderId(provider))
      throw new HttpException('Unknown provider.', HttpStatus.BAD_REQUEST);
    return {
      provider,
      models: await this.keys.modelsFor(userId, provider, refresh === '1'),
    };
  }

  @Get('preferences')
  preferences(@CurrentUser() userId: number) {
    return this.aiChatService.preferences(userId);
  }

  @Put('preferences')
  savePreferences(
    @CurrentUser() userId: number,
    @Body() body: Record<string, unknown>,
  ) {
    return this.aiChatService.savePreferences(userId, body ?? {});
  }

  /** The person's own recent AI use, by model. */
  @Get('usage')
  usageSummary(@CurrentUser() userId: number, @Query('days') days?: string) {
    const n = Math.min(365, Math.max(1, Math.floor(Number(days) || 30)));
    return this.usage.summaryFor(userId, n);
  }

  /**
   * Speech to text for dictation. With the person's own OpenAI key, OpenAI transcribes it; in development without AI_CHAT_LIVE_IN_DEV a fixed sentence comes back; otherwise the platform's speech service, when Platform AI is on and the plan includes it. With none of these the answer is 409 with `code: "browser"`, and the editor uses the browser's own speech recognition instead.
   */
  @Post('speech/transcribe')
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { ttl: 60000, limit: 10 } }) // 10 clips a minute
  @UseInterceptors(
    FileInterceptor('audio', { limits: { fileSize: 25 * 1024 * 1024 } }),
  )
  async transcribeSpeech(
    @CurrentUser() userId: number,
    @UploadedFile() file: Express.Multer.File,
  ) {
    if (!file)
      throw new HttpException(
        'Missing required "audio" field',
        HttpStatus.BAD_REQUEST,
      );
    const mime = file.mimetype?.toLowerCase() || '';
    if (!AUDIO_MIMES.includes(mime) && !mime.startsWith('audio/'))
      throw new HttpException(
        'Invalid audio format. Use WebM, MP3, WAV, or OGG.',
        HttpStatus.BAD_REQUEST,
      );

    const started = Date.now();
    const own = await this.keys.credentials(userId, 'openai');
    if (own) {
      const count = (ok: boolean, model: string) =>
        this.usage.record({
          userId,
          kind: 'dictation',
          provider: 'openai',
          model,
          audioBytes: file.size,
          durationMs: Date.now() - started,
          ok,
          keySource: 'own',
        });
      const client = new OpenAI({
        apiKey: own.key,
        timeout: 60_000,
        maxRetries: 1,
      });
      const models = [
        process.env.OPENAI_TRANSCRIBE_MODEL,
        'gpt-4o-mini-transcribe',
        'whisper-1',
      ].filter((m): m is string => !!m);
      for (const model of models) {
        try {
          const upload = await toFile(
            file.buffer,
            file.originalname || 'audio.webm',
            { type: mime || 'audio/webm' },
          );
          const result = await client.audio.transcriptions.create({
            file: upload,
            model,
            prompt: 'LaTeX',
          });
          count(true, model);
          return { text: result.text ?? '', source: 'own' };
        } catch (err) {
          const status = (err as { status?: number }).status;
          if (
            (status === 404 || status === 400) &&
            model !== models[models.length - 1]
          )
            continue;
          count(false, model);
          if (status === 401 || status === 403)
            throw new HttpException(
              'OpenAI refused your key. Check it in AI settings.',
              HttpStatus.BAD_REQUEST,
            );
          if (status === 429)
            throw new HttpException(
              'OpenAI is limiting requests for your key. Try again in a minute.',
              HttpStatus.TOO_MANY_REQUESTS,
            );
          throw new HttpException(
            `Transcription failed: ${redactSecrets(String((err as Error).message ?? ''), own.key).slice(0, 160)}`,
            HttpStatus.BAD_GATEWAY,
          );
        }
      }
    }

    // Outside production nothing is sent to the speech service: a fixed sentence comes back, so the dictation interface can be worked on without a key. AI_CHAT_LIVE_IN_DEV=true uses the real service.
    if (
      process.env.NODE_ENV !== 'production' &&
      process.env.AI_CHAT_LIVE_IN_DEV !== 'true'
    ) {
      await new Promise((resolve) => setTimeout(resolve, 900));
      return {
        text: 'This is a local dictation sample. No audio left this machine.',
        source: 'local',
      };
    }

    const [state, plan] = await Promise.all([
      this.platform.state(),
      this.aiChatService.planIncludesAssistant(userId),
    ]);
    if (!state.enabled || !plan)
      throw new HttpException(
        {
          message:
            'Dictation uses your browser’s speech recognition. Add an OpenAI key in AI settings to transcribe with OpenAI.',
          code: 'browser',
        },
        HttpStatus.CONFLICT,
      );

    const count = (ok: boolean) =>
      this.usage.record({
        userId,
        kind: 'dictation',
        provider: 'speech',
        audioBytes: file.size,
        durationMs: Date.now() - started,
        ok,
        keySource: 'platform',
      });
    try {
      const result = await this.aiService.transcribeSpeech(
        file.buffer,
        file.originalname || 'audio.webm',
        { prompt: 'Use LaTeX' },
      );
      count(true);
      return { ...result, source: 'platform' };
    } catch (err: unknown) {
      count(false);
      if (err instanceof HttpException) throw err;
      const e = err as { message?: string; status?: number };
      throw new HttpException(
        e?.message || 'Transcription failed',
        e?.status || HttpStatus.BAD_GATEWAY,
      );
    }
  }
}
