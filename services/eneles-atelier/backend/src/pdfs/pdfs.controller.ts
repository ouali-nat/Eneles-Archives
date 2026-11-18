import {
  Body,
  Controller,
  Delete,
  Get,
  Logger,
  Param,
  Post,
  Put,
  Query,
  UploadedFile,
  UseGuards,
  UseInterceptors,
  Headers,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { FileInterceptor } from '@nestjs/platform-express';
import { ConfigService } from '@nestjs/config';
import { PdfsService } from './pdfs.service';
import { StorageService } from '../storage/storage.service';
import { UsageService } from '../usage/usage.service';
import { AiService } from '../ai/ai.service';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { PaginationQueryDto } from '../common/dto/pagination.dto';
import { UpdatePdfDto, UpdatePdfLatexDto } from './dto';
import { getPdfPageCount } from '../common/pdf-utils';

/** PDF magic bytes: %PDF */
const PDF_MAGIC = [0x25, 0x50, 0x44, 0x46];

function isPdfBuffer(buffer: Buffer): boolean {
  return PDF_MAGIC.every((byte, i) => buffer[i] === byte);
}

/** Strip path separators, null bytes, and unicode oddities from user-supplied filenames */
function sanitizeFilename(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 200);
}
@Controller('pdfs')
export class PdfsController {
  private readonly logger = new Logger(PdfsController.name);

  constructor(
    private readonly pdfsService: PdfsService,
    private readonly storageService: StorageService,
    private readonly usageService: UsageService,
    private readonly aiService: AiService,
    private readonly configService: ConfigService,
  ) {}

  @Get()
  async findAll(
    @CurrentUser() userId: number,
    @Query() query: PaginationQueryDto,
  ) {
    // If any pagination param is explicitly provided, use paginated response
    return this.pdfsService.findByUserIdPaginated(userId, {
      page: query.page ?? 1,
      limit: query.limit ?? 20,
      sort: query.sort ?? 'updatedAt',
      order: query.order ?? 'desc',
    });
  }

  @Get(':id/preview')
  async getPreviewUrl(@CurrentUser() userId: number, @Param('id') id: string) {
    const pdf = await this.pdfsService.findOne(+id);

    if (!pdf || pdf.userId !== userId) {
      throw new HttpException('PDF not found', HttpStatus.NOT_FOUND);
    }

    if (!pdf.filePath) {
      throw new HttpException('This PDF has no stored file', HttpStatus.NOT_FOUND);
    }

    const previewUrl = await this.storageService.getSignedUrl(
      pdf.filePath,
      3600,
    ); // 1 hour expiry
    return { previewUrl: `${previewUrl}#page=1` };
  }

  /**
   * The first-page PNG made at upload. PDFs uploaded before thumbnails existed
   * (or whose thumbnail failed) answer 404, and the client falls back to an icon.
   */
  @Get(':id/thumbnail')
  async getThumbnailUrl(@CurrentUser() userId: number, @Param('id') id: string) {
    const pdf = await this.pdfsService.findOne(+id);

    if (!pdf || pdf.userId !== userId) {
      throw new HttpException('PDF not found', HttpStatus.NOT_FOUND);
    }

    const key = `${pdf.filePath}-thumb.png`;
    if ((await this.storageService.getFileSize(key)) === null) {
      throw new HttpException('No thumbnail for this PDF', HttpStatus.NOT_FOUND);
    }

    return { thumbnailUrl: await this.storageService.getSignedUrl(key, 3600) };
  }

  @Get(':id')
  async findOne(@CurrentUser() userId: number, @Param('id') id: string) {
    const pdf = await this.pdfsService.findOne(+id);

    if (!pdf || pdf.userId !== userId) {
      throw new HttpException('PDF not found', HttpStatus.NOT_FOUND);
    }

    return pdf;
  }

  @Get('user/:userId')
  async findByUserId(
    @CurrentUser() authenticatedUserId: number,
    @Param('userId') userId: string,
  ) {
    // Users can only access their own PDFs
    if (authenticatedUserId !== +userId) {
      throw new HttpException('Forbidden', HttpStatus.FORBIDDEN);
    }

    return this.pdfsService.findByUserId(+userId);
  }

  @Post()
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: 50 * 1024 * 1024 }, // 50 MB hard limit at multer layer
    }),
  )
  async create(
    @CurrentUser() userId: number,
    @UploadedFile() file: any,
    @Body() body: { title?: string; pageCount?: number },
  ) {
    if (!file) {
      throw new HttpException('No file uploaded', HttpStatus.BAD_REQUEST);
    }

    if (file.mimetype !== 'application/pdf') {
      throw new HttpException(
        'Only PDF files are allowed',
        HttpStatus.BAD_REQUEST,
      );
    }

    // Verify magic bytes: don't trust multer's MIME claim
    if (!isPdfBuffer(file.buffer)) {
      throw new HttpException(
        'File content does not match PDF format',
        HttpStatus.BAD_REQUEST,
      );
    }

    // Parse PDF to get actual page count when not provided
    let pageCount = body.pageCount;
    if (pageCount == null) {
      try {
        pageCount = await getPdfPageCount(file.buffer);
      } catch {
        pageCount = 1;
      }
    }
    const canUse = await this.usageService.canUsePdfPage(userId, pageCount);
    if (!canUse) {
      const { used, limit } = await this.usageService.getPdfPageUsage(userId);
      const msg =
        limit === -1
          ? 'PDF page limit reached for your plan'
          : `PDF page limit reached (${used}/${limit} pages used this month). Upgrade for more.`;
      throw new HttpException(msg, HttpStatus.PAYMENT_REQUIRED);
    }

    await this.usageService.assertUploadFits(userId, file.size || file.buffer.length);

    // Upload to S3
    const timestamp = Date.now();
    const safeName = sanitizeFilename(file.originalname || 'document.pdf');
    const s3Key = `${userId}/pdfs/${timestamp}_${safeName}`;
    await this.storageService.uploadFile(file.buffer, s3Key, file.mimetype);

    // Create PDF record
    const pdf = await this.pdfsService.create({
      userId,
      title: body.title || file.originalname,
      filePath: s3Key,
      fileSize: file.size || file.buffer.length,
      pageCount,
      status: 'pending',
    });

    // Increment usage
    await this.usageService.incrementPdfPageUsage(userId, pageCount);

    // Generate and upload thumbnail (non-blocking, so a failure here doesn't fail the upload)
    this.generateThumbnail(file.buffer)
      .then(async (thumb) => {
        if (thumb) {
          const thumbKey = `${s3Key}-thumb.png`;
          await this.storageService.uploadFile(thumb, thumbKey, 'image/png');
          this.logger.log(
            `Thumbnail generated: ${thumbKey} (${(thumb.length / 1024).toFixed(0)} KB)`,
          );
        }
      })
      .catch((err) =>
        this.logger.warn(`Thumbnail upload failed: ${err.message}`),
      );

    return pdf;
  }

  @Put(':id')
  async update(
    @CurrentUser() userId: number,
    @Param('id') id: string,
    @Body() updatePdfDto: UpdatePdfDto,
  ) {
    const pdf = await this.pdfsService.findOne(+id);

    if (!pdf || pdf.userId !== userId) {
      throw new HttpException('PDF not found', HttpStatus.NOT_FOUND);
    }

    return this.pdfsService.update(+id, updatePdfDto);
  }

  @Put(':id/latex')
  async updateLatexContent(
    @CurrentUser() userId: number,
    @Param('id') id: string,
    @Body() updateLatexDto: UpdatePdfLatexDto,
  ) {
    const pdf = await this.pdfsService.findOne(+id);

    if (!pdf || pdf.userId !== userId) {
      throw new HttpException('PDF not found', HttpStatus.NOT_FOUND);
    }

    return this.pdfsService.updateLatexContent(
      +id,
      updateLatexDto.latexContent,
      updateLatexDto.status,
    );
  }

  @Post(':id/process')
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { ttl: 60000, limit: 5 } }) // 5 PDF extractions per minute per IP
  async processPdf(
    @CurrentUser() userId: number,
    @Headers('x-service-id') serviceId: string,
    @Param('id') id: string,
  ) {
    const pdf = await this.pdfsService.findOne(+id);

    if (!pdf || pdf.userId !== userId) {
      throw new HttpException('PDF not found', HttpStatus.NOT_FOUND);
    }

    if (pdf.status === 'processing') {
      throw new HttpException(
        'PDF is already being processed',
        HttpStatus.CONFLICT,
      );
    }

    // Update status to processing
    await this.pdfsService.update(+id, { status: 'processing' });

    try {
      // Download PDF from S3
      const presignedUrl = await this.storageService.getSignedUrl(pdf.filePath);

      // Fetch PDF content
      const response = await fetch(presignedUrl);
      const pdfBuffer = Buffer.from(await response.arrayBuffer());

      // Call AI service (defaults to deepinfra-olmocr, override with x-service-id header)
      const result = await this.aiService.extractLatexFromPdf(
        pdfBuffer,
        pdf.title || 'document.pdf',
        { serviceId: serviceId || undefined },
      );

      // Handle different response formats from the AI service
      let latexContent = '';
      let pageCount = 1;

      if (typeof result === 'string') {
        // If result is a string, use it directly
        latexContent = result;
      } else if (Array.isArray(result)) {
        // If result is an array, join it
        latexContent = result.join('\n\n');
        pageCount = result.length;
      } else if (typeof result === 'object' && result !== null) {
        // If result is an object with page numbers
        const entries = Object.entries(result);
        if (entries.length > 0) {
          const sortedEntries = entries.sort(
            ([a], [b]) => Number(a) - Number(b),
          );
          pageCount = sortedEntries.length;

          latexContent = sortedEntries
            .map(([pageNum, content]) => {
              if (typeof content === 'string') {
                return `% Page ${pageNum}\n${content}`;
              } else if (Array.isArray(content)) {
                // Handle array of objects with TeX property
                const texContent =
                  content.find((c: any) => c?.TeX)?.TeX ||
                  content.find((c: any) => c?.text)?.text ||
                  (typeof content[0] === 'string' ? content[0] : '');
                return `% Page ${pageNum}\n${texContent}`;
              } else if (content && typeof content === 'object') {
                // Handle single object with TeX or text property
                const texContent =
                  (content as any).TeX || (content as any).text || '';
                return `% Page ${pageNum}\n${texContent}`;
              }
              return `% Page ${pageNum}\n${JSON.stringify(content)}`;
            })
            .join('\n\n');
        }
      } else {
        // Fallback: convert to string
        latexContent = String(result);
      }

      // Get actual page count from PDF (Marker returns {1: content}, so use parsed count)
      try {
        const parsedPageCount = await getPdfPageCount(pdfBuffer);
        if (parsedPageCount > 0) pageCount = parsedPageCount;
      } catch {
        /* keep pageCount from result */
      }

      // Extract base64 images, upload to S3, replace with URLs
      latexContent = await this.uploadInlineImages(latexContent, userId, +id);

      // Update PDF with results (including page count)
      await this.pdfsService.updateLatexContent(
        +id,
        latexContent,
        'completed',
        pageCount,
      );

      // Track conversion usage
      await this.usageService.incrementConversionUsage(userId);

      return {
        id: pdf.id,
        status: 'completed',
        latexContent,
        pageCount,
      };
    } catch (error) {
      // Update status to error
      await this.pdfsService.update(+id, { status: 'error' });
      throw error;
    }
  }

  /**
   * Generate a PNG thumbnail from the first page of a PDF buffer.
   * Returns null if generation fails (non-fatal).
   */
  private async generateThumbnail(pdfBuffer: Buffer): Promise<Buffer | null> {
    try {
      const { pdf } = await import('pdf-to-img');
      const doc = await pdf(pdfBuffer, { scale: 1.5 });
      for await (const page of doc) {
        // Return the first page only
        return Buffer.from(page);
      }
      return null;
    } catch (err) {
      this.logger.warn(`Thumbnail generation failed: ${err.message}`);
      return null;
    }
  }

  /**
   * Find base64 data URIs in markdown, upload each to S3,
   * and replace with API-served image URLs.
   */
  private async uploadInlineImages(
    markdown: string,
    userId: number,
    pdfId: number,
  ): Promise<string> {
    const regex =
      /!\[([^\]]*)\]\((data:image\/([^;]+);base64,([A-Za-z0-9+/=]+))\)/g;
    let match: RegExpExecArray | null;
    const replacements: {
      full: string;
      alt: string;
      ext: string;
      b64: string;
    }[] = [];

    while ((match = regex.exec(markdown)) !== null) {
      replacements.push({
        full: match[0],
        alt: match[1],
        ext: match[3] === 'jpeg' ? 'jpg' : match[3],
        b64: match[4],
      });
    }

    if (replacements.length === 0) return markdown;

    let result = markdown;
    const uploadPromises: Promise<void>[] = [];

    for (let i = 0; i < replacements.length; i++) {
      const { full, alt, ext, b64 } = replacements[i];
      const filename = `img_${i}.${ext}`;
      const s3Key = `${userId}/pdfs/${pdfId}/images/${filename}`;
      const buffer = Buffer.from(b64, 'base64');
      const mime = ext === 'jpg' ? 'image/jpeg' : `image/${ext}`;

      uploadPromises.push(
        this.storageService
          .uploadFile(buffer, s3Key, mime)
          .then(() => {
            this.logger.log(
              `Uploaded extracted image: ${s3Key} (${(buffer.length / 1024).toFixed(0)} KB)`,
            );
          })
          .catch((err) => {
            this.logger.error(`Failed to upload image ${filename}:`, err);
          }),
      );

      // Use a relative path: the frontend resolves it against its own API_URL
      result = result.replace(
        full,
        `![${alt}](/pdf-images/${pdfId}/${filename})`,
      );
    }

    await Promise.all(uploadPromises);

    return result;
  }

  @Delete(':id')
  async remove(@CurrentUser() userId: number, @Param('id') id: string) {
    const pdf = await this.pdfsService.findOne(+id);

    if (!pdf || pdf.userId !== userId) {
      throw new HttpException('PDF not found', HttpStatus.NOT_FOUND);
    }

    // Delete from S3
    try {
      await this.storageService.deleteFile(pdf.filePath);
    } catch (error) {
      // Log but don't fail if S3 deletion fails
      this.logger.error('Failed to delete file from S3:', error);
    }

    return this.pdfsService.remove(+id);
  }
}
