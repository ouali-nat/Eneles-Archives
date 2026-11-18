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
import { FileInterceptor } from '@nestjs/platform-express';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { memoryStorage } from 'multer';
import { SnipsService } from './snips.service';
import { StorageService } from '../storage/storage.service';
import { UsageService } from '../usage/usage.service';
import { AiService } from '../ai/ai.service';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { PaginationQueryDto } from '../common/dto/pagination.dto';
import { UpdateSnipDto, UpdateSnipLatexDto } from './dto';

/** Magic-byte signatures for allowed image MIME types */
const MAGIC_BYTES: Record<string, number[][]> = {
  'image/png': [[0x89, 0x50, 0x4e, 0x47]],
  'image/jpeg': [[0xff, 0xd8, 0xff]],
  'image/webp': [[0x52, 0x49, 0x46, 0x46]], // RIFF + validate webp further if needed
  'image/gif': [[0x47, 0x49, 0x46, 0x38]],
  'image/bmp': [[0x42, 0x4d]],
  'image/tiff': [
    [0x49, 0x49, 0x2a, 0x00],
    [0x4d, 0x4d, 0x00, 0x2a],
  ],
};

function verifyMagicBytes(buffer: Buffer, claimedMime: string): boolean {
  const patterns = MAGIC_BYTES[claimedMime];
  if (!patterns) return false;
  return patterns.some((magic) => magic.every((byte, i) => buffer[i] === byte));
}

@Controller('snips')
export class SnipsController {
  private readonly logger = new Logger(SnipsController.name);

  constructor(
    private readonly snipsService: SnipsService,
    private readonly storageService: StorageService,
    private readonly usageService: UsageService,
    private readonly aiService: AiService,
  ) {}

  @Get()
  async findAll(
    @CurrentUser() userId: number,
    @Query() query: PaginationQueryDto,
  ) {
    const result = await this.snipsService.findByUserIdPaginated(userId, {
      page: query.page ?? 1,
      limit: query.limit ?? 20,
      sort: query.sort ?? 'updatedAt',
      order: query.order ?? 'desc',
    });

    // Bulk-sign image URLs to eliminate N+1 (one call per snip)
    const dataWithUrls = await Promise.all(
      result.data.map(async (snip) => {
        let imageUrl: string | null = null;
        if (snip.imagePath) {
          try {
            imageUrl = await this.storageService.getSignedUrl(
              snip.imagePath,
              3600,
            );
          } catch {
            // Non-fatal: imageUrl stays null
          }
        }
        return { ...snip, imageUrl };
      }),
    );

    return { ...result, data: dataWithUrls };
  }

  @Get('user/:userId')
  async findByUserId(
    @CurrentUser() authenticatedUserId: number,
    @Param('userId') userId: string,
  ) {
    // Users can only access their own snips
    if (authenticatedUserId !== +userId) {
      throw new HttpException('Forbidden', HttpStatus.FORBIDDEN);
    }

    const snips = await this.snipsService.findByUserId(+userId);

    // Bulk-sign image URLs
    return Promise.all(
      snips.map(async (snip) => {
        let imageUrl: string | null = null;
        if (snip.imagePath) {
          try {
            imageUrl = await this.storageService.getSignedUrl(
              snip.imagePath,
              3600,
            );
          } catch {
            // Non-fatal
          }
        }
        return { ...snip, imageUrl };
      }),
    );
  }

  @Get(':id/image')
  async getImageUrl(@CurrentUser() userId: number, @Param('id') id: string) {
    const snip = await this.snipsService.findOne(+id);

    if (!snip || snip.userId !== userId) {
      throw new HttpException('Snip not found', HttpStatus.NOT_FOUND);
    }

    // A snip with no stored image must say so: signing an empty key would hand back a link to the bucket itself, and the page would show a broken image instead of its "not available" state.
    if (!snip.imagePath) {
      throw new HttpException('This snip has no image', HttpStatus.NOT_FOUND);
    }

    const imageUrl = await this.storageService.getSignedUrl(
      snip.imagePath,
      3600,
    ); // 1 hour expiry
    return { imageUrl };
  }

  @Get(':id')
  async findOne(@CurrentUser() userId: number, @Param('id') id: string) {
    const snip = await this.snipsService.findOne(+id);

    if (!snip || snip.userId !== userId) {
      throw new HttpException('Snip not found', HttpStatus.NOT_FOUND);
    }

    // If fileSize is missing, try to fetch it from S3
    if (snip && !snip.fileSize && snip.imagePath) {
      try {
        const fileSize = await this.storageService.getFileSize(snip.imagePath);
        if (fileSize !== null) {
          // Update the database with the file size
          await this.snipsService.update(+id, { fileSize });
          // Update the fileSize in the response
          snip.fileSize = fileSize;
        }
      } catch (error) {
        // Silently fail - fileSize will remain null
      }
    }

    return snip;
  }

  @Post()
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB hard limit at multer layer
    }),
  )
  async create(
    @CurrentUser() userId: number,
    @UploadedFile() file: any,
    @Body() body: { title?: string },
  ) {
    if (!file) {
      throw new HttpException('No file uploaded', HttpStatus.BAD_REQUEST);
    }

    // Validate file type: check declared MIME allowlist
    const allowedMimeTypes = [
      'image/png',
      'image/jpeg',
      'image/jpg',
      'image/webp',
      'image/gif',
      'image/bmp',
      'image/tiff',
    ];
    const normalizedMime =
      file.mimetype === 'image/jpg' ? 'image/jpeg' : file.mimetype;
    if (!allowedMimeTypes.includes(normalizedMime)) {
      throw new HttpException(
        'Only image files are allowed (PNG, JPEG, WebP, GIF, BMP, TIFF)',
        HttpStatus.BAD_REQUEST,
      );
    }

    // Validate file type: magic byte check (prevents MIME spoofing)
    if (!verifyMagicBytes(file.buffer, normalizedMime)) {
      throw new HttpException(
        'File content does not match the declared image type',
        HttpStatus.BAD_REQUEST,
      );
    }

    // Validate file size (belt-and-suspenders, multer limit is the first line)
    const MAX_FILE_SIZE = 10 * 1024 * 1024;
    if (file.size > MAX_FILE_SIZE) {
      throw new HttpException(
        'File size exceeds the 10MB limit',
        HttpStatus.PAYLOAD_TOO_LARGE,
      );
    }

    // Check if user can upload (will throw if limit reached)
    const canUse = await this.usageService.canUseSnip(userId);
    if (!canUse) {
      throw new HttpException(
        'Snip limit reached for your plan',
        HttpStatus.PAYMENT_REQUIRED,
      );
    }

    await this.usageService.assertUploadFits(userId, file.size || file.buffer.length);

    // Upload to S3
    const timestamp = Date.now();
    const safeName = (file.originalname || 'image.png')
      .replace(/[^a-zA-Z0-9._-]/g, '_')
      .slice(0, 200);
    const s3Key = `${userId}/snips/${timestamp}_${safeName}`;
    await this.storageService.uploadFile(
      file.buffer,
      s3Key,
      file.mimetype || 'image/png',
    );

    // Create snip record
    const snip = await this.snipsService.create({
      userId,
      title: body.title || file.originalname,
      imagePath: s3Key,
      status: 'pending',
      fileSize: file.size,
    });

    // Increment usage
    await this.usageService.incrementSnipUsage(userId);

    return snip;
  }

  @Put(':id')
  async update(
    @CurrentUser() userId: number,
    @Param('id') id: string,
    @Body() updateSnipDto: UpdateSnipDto,
  ) {
    const snip = await this.snipsService.findOne(+id);

    if (!snip || snip.userId !== userId) {
      throw new HttpException('Snip not found', HttpStatus.NOT_FOUND);
    }

    return this.snipsService.update(+id, updateSnipDto);
  }

  @Put(':id/latex')
  async updateLatexContent(
    @CurrentUser() userId: number,
    @Param('id') id: string,
    @Body() updateLatexDto: UpdateSnipLatexDto,
  ) {
    const snip = await this.snipsService.findOne(+id);

    if (!snip || snip.userId !== userId) {
      throw new HttpException('Snip not found', HttpStatus.NOT_FOUND);
    }

    return this.snipsService.updateLatexContent(
      +id,
      updateLatexDto.latexContent,
      updateLatexDto.status,
    );
  }

  @Post(':id/process')
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { ttl: 60000, limit: 10 } }) // 10 snip extractions per minute per IP
  async processSnip(
    @CurrentUser() userId: number,
    @Headers('x-service-id') serviceId: string,
    @Param('id') id: string,
  ) {
    const snip = await this.snipsService.findOne(+id);

    if (!snip || snip.userId !== userId) {
      throw new HttpException('Snip not found', HttpStatus.NOT_FOUND);
    }

    if (snip.status === 'processing') {
      throw new HttpException(
        'Snip is already being processed',
        HttpStatus.CONFLICT,
      );
    }

    // Update status to processing
    await this.snipsService.update(+id, { status: 'processing' });

    try {
      // Get presigned URL for the image
      const imageUrl = await this.storageService.getSignedUrl(snip.imagePath);

      // Download the image from S3
      const imageResponse = await fetch(imageUrl);
      if (!imageResponse.ok) {
        throw new HttpException(
          'Failed to download image from S3',
          HttpStatus.INTERNAL_SERVER_ERROR,
        );
      }
      const imageBuffer = Buffer.from(await imageResponse.arrayBuffer());

      // Extract filename from imagePath
      const filename = snip.imagePath.split('/').pop() || 'image.png';

      // Call AI service with file buffer (defaults to deepinfra-olmocr, override with x-service-id header)
      const result = await this.aiService.extractLatexFromImage(
        imageBuffer,
        filename,
        { serviceId: serviceId || undefined },
      );

      // Extract LaTeX content
      const latexContent =
        result.fragments.length > 0 ? result.fragments[0].content : '';

      // Update snip with results
      await this.snipsService.updateLatexContent(
        +id,
        latexContent,
        'completed',
      );

      // Track conversion usage
      await this.usageService.incrementConversionUsage(userId);

      return {
        id: snip.id,
        status: 'completed',
        latexContent,
        model: result.model,
        duration_ms: result.duration_ms,
      };
    } catch (error) {
      // Update status to error
      await this.snipsService.update(+id, { status: 'error' });
      throw error;
    }
  }

  @Delete(':id')
  async remove(@CurrentUser() userId: number, @Param('id') id: string) {
    const snip = await this.snipsService.findOne(+id);

    if (!snip || snip.userId !== userId) {
      throw new HttpException('Snip not found', HttpStatus.NOT_FOUND);
    }

    // Delete from S3
    try {
      await this.storageService.deleteFile(snip.imagePath);
    } catch (error) {
      // Log but don't fail if S3 deletion fails
      this.logger.error('Failed to delete file from S3:', error);
    }

    return this.snipsService.remove(+id);
  }
}
