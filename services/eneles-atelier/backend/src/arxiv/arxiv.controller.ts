import {
  Controller,
  Get,
  Query,
  UseGuards,
  BadRequestException,
  PayloadTooLargeException,
  HttpException,
  BadGatewayException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { Public } from '../common/decorators/public.decorator';

const ARXIV_ABS = 'https://export.arxiv.org/api/query?id_list=';
const ARXIV_SRC = 'https://arxiv.org/src/';

/**
 * Both arXiv identifier schemes, with an optional version suffix:
 *   new style   2301.12345  or  2301.12345v2
 *   old style   math.GT/0309136  or  hep-th/9901001v3
 *
 * Anything else is rejected before it can be interpolated into a URL. The
 * host is fixed so this was never a full SSRF, but unvalidated input in a URL
 * path is exactly the shape of bug that becomes one after a refactor.
 */
const ARXIV_ID =
  /^(?:\d{4}\.\d{4,5}|[a-z-]+(?:\.[A-Z]{2})?\/\d{7})(?:v\d{1,3})?$/;

/** arXiv source tarballs are rarely over a few MB; this is a generous ceiling. */
const MAX_SOURCE_BYTES = 50 * 1024 * 1024;

async function fetchArxivMeta(id: string) {
  const res = await fetch(`${ARXIV_ABS}${id}`, { cache: 'no-store' });
  const xml = await res.text();
  const versionMatches = xml.match(/<arxiv:version[^>]*>/g) || [];
  // The feed has its own <title> ("arXiv Query: ..."); the paper's is the one inside <entry>.
  const titleMatch = xml.match(/<entry>[\s\S]*?<title>([\s\S]*?)<\/title>/);
  const title = titleMatch?.[1]?.replace(/\s+/g, ' ').trim();
  return { versionCount: versionMatches.length, title };
}

@Controller('arxiv')
@UseGuards(ThrottlerGuard)
export class ArxivController {
  @Public()
  @Get()
  // Public and outbound-fetching, so it needs a ceiling. Ten a minute is
  // plenty for a human importing papers and useless as an amplifier.
  @Throttle({ default: { ttl: 60000, limit: 10 } })
  async getArxivSource(@Query('id') id?: string) {
    if (!id?.trim()) {
      throw new BadRequestException('Missing id');
    }

    const trimmedId = id.trim();
    if (!ARXIV_ID.test(trimmedId)) {
      throw new BadRequestException(
        'Not a valid arXiv identifier. Expected e.g. 2301.12345 or math.GT/0309136.',
      );
    }
    const hasVersion = /v\d+$/i.test(trimmedId);

    try {
      const meta = await fetchArxivMeta(trimmedId);

      if (!hasVersion && meta.versionCount > 1) {
        return {
          needsVersion: true,
          versionCount: meta.versionCount,
          title: meta.title,
          message: `This paper has ${meta.versionCount} versions. Please specify one, e.g. ${trimmedId}v${meta.versionCount} (latest) or ${trimmedId}v1.`,
        };
      }

      const srcRes = await fetch(`${ARXIV_SRC}${trimmedId}`, {
        cache: 'no-store',
      });
      if (!srcRes.ok) {
        throw new UnprocessableEntityException(
          srcRes.status === 404
            ? 'arXiv has no paper with this identifier.'
            : 'arXiv has no LaTeX source for this paper. Some papers are published as a PDF only.',
        );
      }

      const contentType = srcRes.headers.get('content-type') || '';

      // Refuse to buffer an unbounded body. Check the declared length first,
      // then the real one, since Content-Length is advisory.
      const declared = Number(srcRes.headers.get('content-length') || 0);
      if (declared > MAX_SOURCE_BYTES) {
        throw new PayloadTooLargeException(
          'arXiv source exceeds the 50 MB limit',
        );
      }
      const buffer = Buffer.from(await srcRes.arrayBuffer());
      if (buffer.length > MAX_SOURCE_BYTES) {
        throw new PayloadTooLargeException(
          'arXiv source exceeds the 50 MB limit',
        );
      }

      return {
        title: meta.title,
        contentType,
        data: buffer.toString('base64'),
      };
    } catch (err: any) {
      // Our own refusals (a bad identifier, no source, too large) already say what happened.
      if (err instanceof HttpException) throw err;
      throw new BadGatewayException('arXiv could not be reached. Try again in a moment.');
    }
  }
}
