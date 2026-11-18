import {
  BadRequestException,
  Controller,
  Headers,
  HttpCode,
  Logger,
  Post,
  Req,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import type { RawBodyRequest } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request } from 'express';
import { Public } from '../common/decorators/public.decorator';
import { PrismaService } from '../prisma/prisma.service';
import {
  eventDetail,
  maskCodes,
  nextStatus,
  verifyResendWebhook,
  type ResendEvent,
} from './email-events';

/** The time column each event fills in, the first time it happens. */
const FIRST_AT: Record<
  string,
  'deliveredAt' | 'openedAt' | 'clickedAt' | 'bouncedAt' | 'complainedAt'
> = {
  'email.delivered': 'deliveredAt',
  'email.opened': 'openedAt',
  'email.clicked': 'clickedAt',
  'email.bounced': 'bouncedAt',
  'email.complained': 'complainedAt',
};

/**
 * Resend's webhook: what happened to each email after it was sent (delivered, delayed, opened, clicked, bounced, complained, failed). Point Resend at `https://api.<domain>/email/webhook` with the email events, and set `RESEND_WEBHOOK_SECRET` to the endpoint's signing secret. Every request is verified against that secret over the raw body (`email-events.ts`); a retried delivery is counted once. What is kept is in `EmailMessage` and `EmailEvent` (schema.prisma), for the admin panel's Email page.
 */
@Controller('email')
export class EmailWebhookController {
  private readonly logger = new Logger(EmailWebhookController.name);

  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
  ) {}

  @Public()
  @Post('webhook')
  @HttpCode(200)
  async webhook(
    @Req() req: RawBodyRequest<Request>,
    @Headers('svix-id') id?: string,
    @Headers('svix-timestamp') timestamp?: string,
    @Headers('svix-signature') signature?: string,
  ) {
    const secret = this.config.get<string>('RESEND_WEBHOOK_SECRET');
    // Without the secret nothing can be verified; Resend retries until it is set.
    if (!secret)
      throw new ServiceUnavailableException(
        'The email webhook is not set up on this server.',
      );
    const raw = req.rawBody;
    if (
      !raw ||
      !verifyResendWebhook(secret, { id, timestamp, signature }, raw)
    ) {
      throw new UnauthorizedException('The webhook signature is not valid.');
    }
    let event: ResendEvent;
    try {
      event = JSON.parse(raw.toString('utf8')) as ResendEvent;
    } catch {
      throw new BadRequestException('The webhook body is not JSON.');
    }
    const resendId = event.data?.email_id;
    if (!event.type?.startsWith('email.') || !resendId)
      return { received: true, ignored: true };

    // A retried delivery has the same Svix id: count it once.
    if (
      await this.prisma.client.emailEvent.findUnique({
        where: { webhookId: id! },
        select: { id: true },
      })
    ) {
      return { received: true, duplicate: true };
    }

    const occurredAt = new Date(event.created_at ?? Date.now());
    const to = Array.isArray(event.data?.to)
      ? event.data.to
      : event.data?.to
        ? [event.data.to]
        : [];
    try {
      await this.prisma.client.$transaction(async (tx) => {
        const message =
          (await tx.emailMessage.findUnique({ where: { resendId } })) ??
          (await tx.emailMessage.create({
            data: {
              resendId,
              kind: 'other',
              recipients: to,
              sender: event.data?.from ?? null,
              subject: event.data?.subject
                ? maskCodes(event.data.subject)
                : null,
              createdAt: event.data?.created_at
                ? new Date(event.data.created_at)
                : occurredAt,
            },
          }));
        const detail = eventDetail(event);
        await tx.emailEvent.create({
          data: {
            messageId: message.id,
            type: event.type,
            occurredAt,
            webhookId: id!,
            detail: detail ?? undefined,
          },
        });
        const firstAt = FIRST_AT[event.type];
        await tx.emailMessage.update({
          where: { id: message.id },
          data: {
            status: nextStatus(message.status, event.type),
            lastEventAt:
              !message.lastEventAt || occurredAt > message.lastEventAt
                ? occurredAt
                : message.lastEventAt,
            ...(firstAt && !message[firstAt] ? { [firstAt]: occurredAt } : {}),
            ...(event.type === 'email.bounced'
              ? {
                  bounceType: detail?.type ?? null,
                  bounceMessage: detail?.message ?? null,
                }
              : {}),
          },
        });
      });
    } catch (error) {
      // Two deliveries of one event racing past the duplicate check: the unique webhook id stops the second.
      if ((error as { code?: string }).code === 'P2002')
        return { received: true, duplicate: true };
      this.logger.error(
        `Could not record an email event: ${(error as Error).message}`,
      );
      throw error;
    }
    return { received: true };
  }
}
