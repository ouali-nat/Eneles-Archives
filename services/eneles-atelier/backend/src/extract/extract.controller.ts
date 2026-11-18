import {
  Controller,
  Post,
  UploadedFile,
  UseInterceptors,
  Body,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { UseGuards } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ThrottlerGuard } from '@nestjs/throttler';
import { AiService } from '../ai/ai.service';
import { CurrentUser } from '../common/decorators/current-user.decorator';

@Controller('extract')
@UseGuards(ThrottlerGuard)
export class ExtractController {
  constructor(private readonly aiService: AiService) {}

  // The unauthenticated `POST /extract/demo` endpoint that used to live here
  // was removed. It called paid inference with no server-side quota, gated
  // only by a cookie the client controlled, and nothing referenced it once
  // the homepage demo was dropped.

  @Post()
  @UseInterceptors(
    FileInterceptor('file', { limits: { fileSize: 50 * 1024 * 1024 } }),
  )
  async extractPdf(
    @CurrentUser() userId: number,
    @UploadedFile() file: Express.Multer.File,
    @Body('service_id') serviceId?: string,
  ) {
    if (!file) {
      throw new HttpException(
        'Missing required "file" field',
        HttpStatus.BAD_REQUEST,
      );
    }
    if (file.mimetype !== 'application/pdf') {
      throw new HttpException(
        'Only PDF files are allowed',
        HttpStatus.BAD_REQUEST,
      );
    }

    try {
      const result = await this.aiService.extractLatexFromPdf(
        file.buffer,
        file.originalname || 'document.pdf',
        { serviceId: serviceId || undefined },
      );

      // Normalise response: the extraction service may return various shapes:
      // 1. Dict[int, str] from AI service: {"1": "page 1 content", "2": "page 2 content"}
      // 2. {tex: "...", pages: N}
      // 3. Plain string
      if (typeof result === 'string') {
        return {
          tex: result,
          service_id: serviceId || 'deepinfra-olmocr',
        };
      }

      const serviceJson = typeof result === 'object' ? result : {};

      // Check for per-page dict format: keys are numeric strings
      const keys = Object.keys(serviceJson);
      const isPageDict = keys.length > 0 && keys.every((k) => /^\d+$/.test(k));
      if (isPageDict) {
        const sortedKeys = keys.map(Number).sort((a, b) => a - b);
        const combined = sortedKeys.map((k) => serviceJson[k]).join('\n\n');
        return {
          tex: combined,
          pages: sortedKeys.length,
          service_id: serviceId || 'deepinfra-olmocr',
        };
      }

      // Standard named fields
      const tex =
        serviceJson.tex ??
        serviceJson.result ??
        serviceJson.latex ??
        serviceJson.content ??
        serviceJson.output ??
        null;

      return {
        tex:
          tex !== null && tex !== undefined
            ? typeof tex === 'string'
              ? tex
              : JSON.stringify(tex)
            : JSON.stringify(serviceJson, null, 2),
        pages: serviceJson.pages ?? serviceJson.page_count ?? undefined,
        service_id: serviceId || 'deepinfra-olmocr',
      };
    } catch (err: any) {
      if (err instanceof HttpException) throw err;
      throw new HttpException(
        err?.message || 'Extraction failed',
        err?.status || HttpStatus.BAD_GATEWAY,
      );
    }
  }
}
