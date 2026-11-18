import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  ForbiddenException,
  NotFoundException,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import {
  PROJECT_FILE_PATH,
  PROJECT_FILE_PATH_MESSAGE,
} from '../projects/dto/file-path';
import { COMMENT_HUES, CommentsService } from './comments.service';
import { ChatService } from './chat.service';
import { CollaborationGateway } from './collaboration.gateway';
import { ProjectsService } from '../projects/projects.service';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;
const BASE64 = /^[A-Za-z0-9+/=]*$/;
const HUE_MESSAGE = `color must be one of ${COMMENT_HUES.join(', ')}`;

export class CreateCommentDto {
  @IsString()
  @MaxLength(300)
  @Matches(PROJECT_FILE_PATH, { message: PROJECT_FILE_PATH_MESSAGE })
  path: string;

  @IsOptional()
  @IsString()
  @MaxLength(400)
  @Matches(BASE64)
  anchorStart?: string;

  @IsOptional()
  @IsString()
  @MaxLength(400)
  @Matches(BASE64)
  anchorEnd?: string;

  @IsString()
  @MaxLength(1000)
  quote: string;

  @Type(() => Number)
  @IsInt()
  @Min(0)
  offset: number;

  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(5000)
  content: string;

  @IsOptional()
  @IsIn(COMMENT_HUES, { message: HUE_MESSAGE })
  color?: string;
}

class CommentContentDto {
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(5000)
  content: string;
}

/** Resolve or reopen a thread, or change its color (null puts the default back). Either field may be left out. */
export class UpdateCommentDto {
  @IsOptional()
  @IsBoolean()
  resolved?: boolean;

  @ValidateIf((_, value) => value !== undefined && value !== null)
  @IsIn(COMMENT_HUES, { message: HUE_MESSAGE })
  color?: string | null;
}

class AppendTextDto {
  @IsString()
  @MaxLength(300)
  @Matches(PROJECT_FILE_PATH, { message: PROJECT_FILE_PATH_MESSAGE })
  path: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(200_000)
  text: string;
}

class ChatMessageDto {
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(2000)
  content: string;
}

/**
 * Comments and chat. Both are written over HTTP, where the caller and the
 * input are checked, and then announced on the project's live connection so
 * everyone in the project sees them at once.
 */
@Controller('projects')
@UseGuards(ThrottlerGuard)
export class CollaborationController {
  constructor(
    private readonly comments: CommentsService,
    private readonly chat: ChatService,
    private readonly gateway: CollaborationGateway,
    private readonly projects: ProjectsService,
  ) {}

  /**
   * POST /projects/:uid/files/append: add text at the end of a file (a new
   * bibliography entry, say). When the file is open, the text goes into the
   * live document as an ordinary edit, so nobody's typing is overwritten.
   */
  @Post(':uid/files/append')
  @Throttle({ default: { ttl: 60000, limit: 30 } })
  async append(
    @CurrentUser() userId: number,
    @Param('uid') uid: string,
    @Body() dto: AppendTextDto,
  ) {
    const access = await this.projects.checkAccess(uid, userId);
    if (!access.project || !access.canView || access.pendingInvitation)
      throw new NotFoundException('Project not found');
    if (!access.canEdit)
      throw new ForbiddenException(
        'You do not have edit access to this project',
      );
    const file = access.project.files.find((f) => f.path === dto.path);
    if (
      file &&
      !file.isFolder &&
      !file.filePath &&
      (await this.gateway.appendLiveText(uid, dto.path, dto.text))
    ) {
      return { path: dto.path, live: true };
    }
    await this.projects.appendText(access.project.id, dto.path, dto.text);
    if (!file)
      this.gateway.announce(uid, 'files-changed', { reason: 'append' });
    return { path: dto.path, live: false, created: !file };
  }

  private commentsChanged(projectUid: string, path: string) {
    this.gateway.announce(projectUid, 'comments-changed', { path });
  }

  @Get(':uid/comments')
  list(@CurrentUser() userId: number, @Param('uid') uid: string) {
    return this.comments.list(uid, userId);
  }

  @Post(':uid/comments')
  @Throttle({ default: { ttl: 60000, limit: 30 } })
  async create(
    @CurrentUser() userId: number,
    @Param('uid') uid: string,
    @Body() dto: CreateCommentDto,
  ) {
    const { thread, path } = await this.comments.create(uid, userId, dto);
    this.commentsChanged(uid, path);
    return thread;
  }

  @Post(':uid/comments/:threadId/replies')
  @Throttle({ default: { ttl: 60000, limit: 60 } })
  async reply(
    @CurrentUser() userId: number,
    @Param('uid') uid: string,
    @Param('threadId', ParseIntPipe) threadId: number,
    @Body() dto: CommentContentDto,
  ) {
    const { thread, path } = await this.comments.reply(
      uid,
      userId,
      threadId,
      dto.content,
    );
    this.commentsChanged(uid, path);
    return thread;
  }

  @Patch(':uid/comments/:threadId')
  async resolve(
    @CurrentUser() userId: number,
    @Param('uid') uid: string,
    @Param('threadId', ParseIntPipe) threadId: number,
    @Body() dto: UpdateCommentDto,
  ) {
    if (dto.resolved === undefined && dto.color === undefined)
      throw new BadRequestException('Nothing to change');
    const { thread, path } = await this.comments.update(uid, userId, threadId, {
      resolved: dto.resolved,
      color: dto.color,
    });
    this.commentsChanged(uid, path);
    return thread;
  }

  @Delete(':uid/comments/:threadId')
  @HttpCode(HttpStatus.OK)
  async removeThread(
    @CurrentUser() userId: number,
    @Param('uid') uid: string,
    @Param('threadId', ParseIntPipe) threadId: number,
  ) {
    const { path } = await this.comments.removeThread(uid, userId, threadId);
    this.commentsChanged(uid, path);
    return { deleted: true };
  }

  @Patch(':uid/comments/messages/:messageId')
  async editMessage(
    @CurrentUser() userId: number,
    @Param('uid') uid: string,
    @Param('messageId', ParseIntPipe) messageId: number,
    @Body() dto: CommentContentDto,
  ) {
    const { thread, path } = await this.comments.editMessage(
      uid,
      userId,
      messageId,
      dto.content,
    );
    this.commentsChanged(uid, path);
    return thread;
  }

  @Delete(':uid/comments/messages/:messageId')
  @HttpCode(HttpStatus.OK)
  async removeMessage(
    @CurrentUser() userId: number,
    @Param('uid') uid: string,
    @Param('messageId', ParseIntPipe) messageId: number,
  ) {
    const { path } = await this.comments.removeMessage(uid, userId, messageId);
    this.commentsChanged(uid, path);
    return { deleted: true };
  }

  @Get(':uid/chat')
  history(
    @CurrentUser() userId: number,
    @Param('uid') uid: string,
    @Query('before') before?: string,
    @Query('limit') limit?: string,
  ) {
    const b = before ? Number(before) : undefined;
    const l = limit ? Number(limit) : undefined;
    return this.chat.history(
      uid,
      userId,
      Number.isInteger(b) && b! > 0 ? b : undefined,
      Number.isInteger(l) ? l : undefined,
    );
  }

  @Post(':uid/chat')
  @Throttle({ default: { ttl: 60000, limit: 40 } })
  async post(
    @CurrentUser() userId: number,
    @Param('uid') uid: string,
    @Body() dto: ChatMessageDto,
  ) {
    const message = await this.chat.post(uid, userId, dto.content);
    this.gateway.announce(uid, 'chat-message', message);
    return message;
  }
}
