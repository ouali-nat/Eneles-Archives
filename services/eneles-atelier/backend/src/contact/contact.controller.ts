import {
  Body,
  Controller,
  HttpCode,
  Post,
  ServiceUnavailableException,
  UseGuards,
} from '@nestjs/common';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { Public } from '../common/decorators/public.decorator';
import { EmailService } from '../email/email.service';
import { ContactDto } from './dto/contact.dto';

/** The site's contact form. Anyone may write, a few times an hour from one address; the message goes to the team's inbox with the sender as the reply-to. */
@Controller('contact')
@UseGuards(ThrottlerGuard)
export class ContactController {
  constructor(private readonly email: EmailService) {}

  @Public()
  @Post()
  @HttpCode(200)
  @Throttle({ default: { ttl: 60 * 60 * 1000, limit: 5 } })
  async send(@Body() body: ContactDto): Promise<{ ok: true }> {
    // A bot fills in the field people never see: it is told the message went, and nothing is sent.
    if (body.website) return { ok: true };
    const sent = await this.email.sendContactMessage({
      name: body.name,
      email: body.email,
      topic: body.topic,
      message: body.message,
    });
    if (!sent)
      throw new ServiceUnavailableException(
        'The message could not be sent just now. Try again in a minute, or write to contact@texer.org.',
      );
    return { ok: true };
  }
}
