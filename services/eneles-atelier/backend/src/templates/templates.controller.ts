import { siteUrls } from '../common/site';
import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  Query,
  ParseIntPipe,
  HttpException,
  HttpStatus,
  HttpCode,
  Res,
  UseGuards,
} from '@nestjs/common';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { ReviewerGuard } from '../common/guards/reviewer.guard';
import { ReportTemplateDto, ReviewTemplateDto } from './dto/template-fields';
import { Public } from '../common/decorators/public.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Response } from 'express';
import { ConfigService } from '@nestjs/config';
import { StorageService } from '../storage/storage.service';
import { TemplatesService } from './templates.service';
import {
  CreateTemplateDto,
  UpdateTemplateDto,
  TemplateFromProjectDto,
  UseTemplateDto,
} from './dto';
import { PaginationQueryDto } from '../common/dto/pagination.dto';

const TEMPLATES_PREFIX = 'latex-templates';

/**
 * Template endpoints:
 * - Pre-rendered template PDF/thumbnails (public, no auth)
 * - Custom template CRUD (authenticated)
 */
@Controller('templates')
export class TemplatesController {
  constructor(
    private readonly storageService: StorageService,
    private readonly configService: ConfigService,
    private readonly templatesService: TemplatesService,
  ) {}

  // ─── Pre-rendered template assets (public) ─────────────────────

  /**
   * GET /templates/prebuilt/:id/pdf: returns { url } by default. Add ?stream=1 to get PDF bytes.
   */
  @Public()
  @Get('prebuilt/:id/pdf')
  async getPdf(
    @Param('id') id: string,
    @Query('stream') streamQ: string | undefined,
    @Res() res: Response,
  ) {
    const key = `${TEMPLATES_PREFIX}/${id}.pdf`;
    const exists = await this.storageService.getFileSize(key, 'builds');
    if (exists === null) {
      throw new HttpException(
        `Template PDF not found: ${id}. Run prebuild script to generate.`,
        HttpStatus.NOT_FOUND,
      );
    }
    if (streamQ === '1') {
      const obj = await this.storageService.getObject(key, 'builds');
      res.setHeader('Content-Type', obj.ContentType || 'application/pdf');
      obj.Body.pipe(res);
      return;
    }
    const base = siteUrls().cdn;
    const url = base
      ? `${base}/templates/${id}/pdf?stream=1`
      : await this.storageService.getSignedUrl(key, 3600, 'builds');
    res.json({ url });
  }

  /**
   * GET /templates/prebuilt/:id/thumb: returns { url } by default. Add ?stream=1 to get PNG bytes.
   */
  @Public()
  @Get('prebuilt/:id/thumb')
  async getThumb(
    @Param('id') id: string,
    @Query('stream') streamQ: string | undefined,
    @Res() res: Response,
  ) {
    const key = `${TEMPLATES_PREFIX}/${id}-thumb.png`;
    const exists = await this.storageService.getFileSize(key, 'builds');
    if (exists === null) {
      throw new HttpException(
        `Template thumbnail not found: ${id}. Run prebuild script to generate.`,
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
      ? `${base}/templates/${id}/thumb?stream=1`
      : await this.storageService.getSignedUrl(key, 3600, 'builds');
    res.json({ url });
  }

  // ─── Custom template CRUD (authenticated) ─────────────────────

  /**
   * GET /templates: list all templates (public + user's private).
   * Supports ?category=X&search=Y&page=1&limit=20
   */
  @Get()
  async findAll(
    @CurrentUser() userId: number,
    @Query() pagination: PaginationQueryDto,
    @Query('category') category?: string,
    @Query('search') search?: string,
  ) {
    return this.templatesService.findAll({
      userId,
      category,
      search,
      page: pagination.page,
      limit: pagination.limit,
    });
  }

  /**
   * GET /templates/mine: list only the current user's custom templates.
   */
  @Get('mine')
  async findMine(
    @CurrentUser() userId: number,
    @Query() pagination: PaginationQueryDto,
  ) {
    return this.templatesService.findMine(userId, {
      page: pagination.page,
      limit: pagination.limit,
    });
  }

  /**
   * GET /templates/review/access: whether the caller reviews templates, so
   * the app knows to show the queue.
   */
  @Get('review/access')
  async reviewAccess(@CurrentUser() userId: number) {
    return { reviewer: await this.templatesService.canReview(userId) };
  }

  /**
   * POST /templates/from-project/:uid: save a project as a template.
   */
  @Post('from-project/:uid')
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { ttl: 60000, limit: 10 } })
  async fromProject(
    @CurrentUser() userId: number,
    @Param('uid') uid: string,
    @Body() dto: TemplateFromProjectDto,
  ) {
    return this.templatesService.fromProject(userId, uid, dto);
  }

  /**
   * POST /templates/:id/use: start a new project from a template.
   */
  @Post(':id/use')
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { ttl: 60000, limit: 20 } })
  async use(
    @CurrentUser() userId: number,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UseTemplateDto,
  ) {
    return this.templatesService.use(id, userId, dto.title);
  }

  /**
   * GET /templates/review: shared templates waiting for a reviewer.
   * Declared before `:id` so the word is not read as an id.
   */
  @Get('review')
  @UseGuards(ReviewerGuard)
  async reviewQueue(@Query() pagination: PaginationQueryDto) {
    return this.templatesService.reviewQueue({
      page: pagination.page,
      limit: pagination.limit,
    });
  }

  /**
   * POST /templates/:id/review: approve or reject a waiting template.
   */
  @Post(':id/review')
  @HttpCode(HttpStatus.OK)
  @UseGuards(ReviewerGuard)
  async review(
    @CurrentUser() userId: number,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: ReviewTemplateDto,
  ) {
    return this.templatesService.decide(id, userId, dto.decision, dto.note);
  }

  /**
   * POST /templates/:id/report: flag a shared template as inappropriate.
   */
  @Post(':id/report')
  @HttpCode(HttpStatus.OK)
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { ttl: 60000, limit: 10 } })
  async report(
    @CurrentUser() userId: number,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: ReportTemplateDto,
  ) {
    return this.templatesService.report(id, userId, dto.reason);
  }

  /**
   * GET /templates/:id: get a single template by ID.
   */
  @Get(':id')
  async findOne(
    @CurrentUser() userId: number,
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.templatesService.findOne(id, userId);
  }

  /**
   * POST /templates: create a custom template.
   */
  @Post()
  async create(@CurrentUser() userId: number, @Body() dto: CreateTemplateDto) {
    return this.templatesService.create({ userId, ...dto });
  }

  /**
   * PUT /templates/:id: update a custom template.
   */
  @Put(':id')
  async update(
    @CurrentUser() userId: number,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateTemplateDto,
  ) {
    return this.templatesService.update(id, userId, dto);
  }

  /**
   * DELETE /templates/:id: delete a custom template.
   */
  @Delete(':id')
  async remove(
    @CurrentUser() userId: number,
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.templatesService.remove(id, userId);
  }
}
