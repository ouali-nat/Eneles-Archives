import { siteUrls } from '../common/site';
import {
  Controller,
  Get,
  Param,
  Query,
  HttpException,
  HttpStatus,
  Res,
} from '@nestjs/common';
import { Public } from '../common/decorators/public.decorator';
import { Response } from 'express';
import { ConfigService } from '@nestjs/config';
import { StorageService } from '../storage/storage.service';

const TIKZ_PREFIX = 'tikz-components';

/**
 * Serves pre-rendered TikZ component images from the builds bucket.
 * Returns a CDN URL (cdn.<DOMAIN_NAME>). Without a domain, a signed storage URL.
 */
@Public()
@Controller('tikz-components')
export class TikzComponentsController {
  constructor(
    private readonly storageService: StorageService,
    private readonly configService: ConfigService,
  ) {}

  /**
   * GET /tikz-components/:libraryId/:exampleId: returns { url } by default. Add ?stream=1 to get PNG bytes.
   */
  @Get(':libraryId/:exampleId')
  async getImage(
    @Param('libraryId') libraryId: string,
    @Param('exampleId') exampleId: string,
    @Query('stream') streamQ: string | undefined,
    @Res() res: Response,
  ) {
    const key = `${TIKZ_PREFIX}/${libraryId}/${exampleId}.png`;
    const exists = await this.storageService.getFileSize(key, 'builds');
    if (exists === null) {
      throw new HttpException(
        `TikZ component image not found: ${libraryId}/${exampleId}. Run prebuild script to generate.`,
        HttpStatus.NOT_FOUND,
      );
    }
    if (streamQ === '1') {
      const obj = await this.storageService.getObject(key, 'builds');
      res.setHeader('Content-Type', obj.ContentType || 'image/png');
      obj.Body.pipe(res);
      return;
    }
    const base = siteUrls().cdn;
    const url = base
      ? `${base}/tikz-components/${libraryId}/${exampleId}?stream=1`
      : await this.storageService.getSignedUrl(key, 3600, 'builds');
    res.json({ url });
  }
}
