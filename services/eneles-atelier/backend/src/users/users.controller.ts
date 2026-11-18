import { UpdateProfileDto } from './dto/update-profile.dto';
import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
  Res,
  HttpException,
  HttpStatus,
  Logger,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { UseGuards } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { SkipThrottle, ThrottlerGuard } from '@nestjs/throttler';
import { UsersService } from './users.service';
import { StorageService } from '../storage/storage.service';
import { PrismaService } from '../prisma/prisma.service';
import { BillingService } from '../billing/billing.service';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { Response } from 'express';
import { isStoredPhoto, publicAvatarUrl } from './avatar';

@Controller('users')
@UseGuards(ThrottlerGuard)
export class UsersController {
  private readonly logger = new Logger(UsersController.name);

  constructor(
    private readonly usersService: UsersService,
    private readonly storageService: StorageService,
    private readonly prisma: PrismaService,
    private readonly billingService: BillingService,
  ) {}

  // `POST /users/check-email` was removed. It was public, returned
  // `{ exists: boolean }` for any address, and nothing in the frontend called
  // it: a user-enumeration oracle with no consumer.

  @Get('profile')
  async getProfile(@CurrentUser() userId: number) {
    try {
      const user = await this.usersService.findOne(userId);

      if (!user) {
        throw new HttpException('User not found', HttpStatus.NOT_FOUND);
      }

      // Never expose sensitive fields to the client
      const { password, twoFactorSecret, ...safeUser } = user as any;
      // An uploaded photo goes out as a signed link; a generated picture as it is.
      safeUser.avatarUrl = await publicAvatarUrl(safeUser.avatarUrl, this.storageService);
      return safeUser;
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }
      throw new HttpException(
        (error as any)?.message || 'Failed to get profile',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  // ── by-email and findAll removed: user enumeration vectors ──
  // H5: POST /users/by-email let authenticated users look up any user's email→id
  // H6: GET /users leaked admin-like semantics
  // Neither endpoint is called by the frontend.

  /**
   * Export all user data (GDPR compliance).
   */
  @Get('profile/export')
  async exportData(@CurrentUser() userId: number) {
    const user = await this.usersService.findOne(userId);
    if (!user) {
      throw new HttpException('User not found', HttpStatus.NOT_FOUND);
    }

    // Gather all user data in parallel
    const [snips, pdfs, sessions, apiKeys, projects] = await Promise.all([
      this.prisma.client.snip.findMany({
        where: { userId },
        select: {
          id: true,
          title: true,
          latexContent: true,
          originalText: true,
          tags: true,
          createdAt: true,
        },
      }),
      this.prisma.client.pDF.findMany({
        where: { userId },
        select: {
          id: true,
          title: true,
          latexContent: true,
          tags: true,
          pageCount: true,
          createdAt: true,
        },
      }),
      this.prisma.client.session.findMany({
        where: { userId },
        select: {
          id: true,
          deviceType: true,
          browser: true,
          os: true,
          ipAddress: true,
          createdAt: true,
        },
      }),
      this.prisma.client.apiKey.findMany({
        where: { userId },
        select: { id: true, name: true, keyPrefix: true, createdAt: true },
      }),
      this.prisma.client.project.findMany({
        where: { userId },
        select: {
          id: true,
          uid: true,
          title: true,
          tags: true,
          createdAt: true,
          files: { select: { path: true, content: true } },
        },
      }),
    ]);

    const { twoFactorSecret, ...safeUser } = user as any;

    return {
      exportedAt: new Date().toISOString(),
      user: safeUser,
      projects,
      snips,
      pdfs,
      sessions,
      apiKeys,
    };
  }

  /**
   * Someone's uploaded photo, for the faces in project lists, share dialogs, and presence, whose payloads carry only the storage key. Answers with a redirect to a short-lived signed link, or 404 when the person has no photo (the browser then draws their generated picture). Any signed-in person may see any avatar, as they appear wherever people collaborate.
   */
  @Get(':id/avatar')
  @SkipThrottle()
  async avatar(@Param('id') id: string, @Res() res: Response) {
    // The site shows these in an <img>, and it is a different origin on the same site; the default policy (same-origin) makes the browser refuse both the redirect and the 404.
    res.setHeader('Cross-Origin-Resource-Policy', 'same-site');
    const user = Number.isInteger(+id) ? await this.usersService.findOne(+id) : null;
    const key = user?.avatarUrl;
    if (!isStoredPhoto(key)) {
      res.status(HttpStatus.NOT_FOUND).end();
      return;
    }
    const url = await publicAvatarUrl(key, this.storageService);
    if (!url) {
      res.status(HttpStatus.NOT_FOUND).end();
      return;
    }
    res.setHeader('Cache-Control', 'private, max-age=3600');
    res.redirect(HttpStatus.FOUND, url);
  }

  @Get(':id')
  async findOne(@CurrentUser() userId: number, @Param('id') id: string) {
    // Users can only access their own profile
    if (userId !== +id) {
      throw new HttpException('Forbidden', HttpStatus.FORBIDDEN);
    }

    return this.usersService.findOne(+id);
  }

  /**
   * Update own profile via JWT identity (no user-id path param needed).
   * This is the preferred update route: no extra GET round-trip required.
   */
  @Put('profile')
  async updateOwnProfile(@CurrentUser() userId: number, @Body() body: UpdateProfileDto) {
    return this.usersService.updateProfile(userId, body);
  }

  /**
   * Upload avatar image. Accepts PNG, JPEG, WebP. Max 2MB.
   */
  @Post('profile/avatar')
  @UseInterceptors(
    FileInterceptor('avatar', { limits: { fileSize: 2 * 1024 * 1024 } }),
  )
  async uploadAvatar(@CurrentUser() userId: number, @UploadedFile() file: any) {
    if (!file) {
      throw new HttpException('No file uploaded', HttpStatus.BAD_REQUEST);
    }

    const allowed = ['image/png', 'image/jpeg', 'image/webp'];
    if (!allowed.includes(file.mimetype)) {
      throw new HttpException(
        'Only PNG, JPEG, or WebP images are allowed',
        HttpStatus.BAD_REQUEST,
      );
    }

    const ext =
      file.mimetype === 'image/png'
        ? 'png'
        : file.mimetype === 'image/webp'
          ? 'webp'
          : 'jpg';
    const s3Key = `${userId}/avatar/avatar.${ext}`;
    const previous = (await this.usersService.findOne(userId))?.avatarUrl;
    await this.storageService.uploadFile(file.buffer, s3Key, file.mimetype);
    // A photo of another type had another key; it is no longer used.
    if (isStoredPhoto(previous) && previous !== s3Key) {
      this.storageService.deleteFile(previous).catch(() => undefined);
    }

    const avatarUrl = await this.storageService.getSignedUrl(s3Key, 86400); // 24h URL
    await this.usersService.update(userId, { avatarUrl: s3Key });

    return { avatarUrl };
  }

  /**
   * Delete own account via JWT identity.
   */
  @Delete('profile')
  async deleteOwnProfile(@CurrentUser() userId: number) {
    await this.billingService.endForDeletedAccount(userId);
    return this.usersService.remove(userId);
  }

  // DEPRECATED: This endpoint creates users directly without OTP verification
  // Users should ONLY be created through /auth/signup after OTP verification
  // @Post()
  // create(
  //   @Body()
  //   createUserDto: {
  //     email: string;
  //     name: string;
  //     subscriptionType?: 'free' | 'pro' | 'team' | 'enterprise';
  //   },
  // ) {
  //   throw new HttpException(
  //     'Direct user creation is not allowed. Use /auth/signup instead.',
  //     HttpStatus.FORBIDDEN,
  //   );
  // }

  @Put(':id')
  async update(
    @CurrentUser() authenticatedUserId: number,
    @Param('id') id: string,
    @Body() body: UpdateProfileDto,
  ) {
    // Users can only update their own profile, and only its allow-listed fields.
    if (authenticatedUserId !== +id) {
      throw new HttpException('Forbidden', HttpStatus.FORBIDDEN);
    }
    return this.usersService.updateProfile(authenticatedUserId, body);
  }

  @Delete(':id')
  async remove(
    @CurrentUser() authenticatedUserId: number,
    @Param('id') id: string,
  ) {
    // Users can only delete their own account
    if (authenticatedUserId !== +id) {
      throw new HttpException('Forbidden', HttpStatus.FORBIDDEN);
    }

    await this.billingService.endForDeletedAccount(+id);
    return this.usersService.remove(+id);
  }
}
