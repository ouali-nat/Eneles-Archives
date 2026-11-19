import {
  Controller,
  Get,
  Param,
  Res,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { Response } from 'express';
import { PdfsService } from './pdfs.service';
import { StorageService } from '../storage/storage.service';
import { CurrentUser } from '../common/decorators/current-user.decorator';

@Controller('pdf-images')
export class PdfImagesController {
  constructor(
    private readonly pdfsService: PdfsService,
    private readonly storageService: StorageService,
  ) {}

  @Get(':pdfId/:filename')
  async getImage(
    @CurrentUser() userId: number,
    @Param('pdfId') pdfId: string,
    @Param('filename') filename: string,
    @Res() res: Response,
  ) {
    const pdf = await this.pdfsService.findOne(+pdfId);

    if (!pdf || pdf.userId !== userId) {
      throw new HttpException('Image not found', HttpStatus.NOT_FOUND);
    }

    // Sanitize filename: only allow alphanumeric, dots, hyphens, underscores
    const safeFilename = filename.replace(/[^a-zA-Z0-9._-]/g, '_');
    const key = `${pdf.userId}/pdfs/${pdfId}/images/${safeFilename}`;

    try {
      const signedUrl = await this.storageService.getSignedUrl(key, 3600);
      res.redirect(signedUrl);
    } catch {
      throw new HttpException('Image not found', HttpStatus.NOT_FOUND);
    }
  }
}
