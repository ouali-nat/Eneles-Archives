import { HttpException, HttpStatus } from '@nestjs/common';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { isStoredPhoto, randomAvatarPreset } from './avatar';

@Injectable()
export class UsersService {
  private readonly logger = new Logger(UsersService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storageService: StorageService,
  ) {}

  async findAll() {
    try {
      return await this.prisma.client.user.findMany();
    } catch (error) {
      this.logger.error(`Error finding all users: ${error.message}`);
      return [];
    }
  }

  async findOne(id: number) {
    try {
      return await this.prisma.client.user.findUnique({
        where: { id },
      });
    } catch (error) {
      this.logger.error(`Error finding user by ID: ${error.message}`);
      return null;
    }
  }

  async findBySupabaseUserId(supabaseUserId: string) {
    return this.prisma.client.user.findUnique({ where: { supabaseUserId } });
  }

  async findByEmail(email: string) {
    // Case-insensitive: addresses are normalized on the way in, but rows created before that may still carry mixed case. Errors are not swallowed: returning null on a database failure (missing tables, connection down) made login silently answer "no account" and let signup proceed to a verify step that then crashed.
    return this.prisma.client.user.findFirst({
      where: { email: { equals: email.trim(), mode: 'insensitive' } },
    });
  }

  async create(userData: {
    email: string;
    name: string;
    subscriptionType?: 'free' | 'pro' | 'team' | 'enterprise';
    verified?: boolean;
    supabaseUserId?: string;
  }) {
    try {
      // Every new account starts with a generated picture, chosen at random, which the person can change on their profile.
      return await this.prisma.client.user.create({
        data: { ...userData, avatarUrl: randomAvatarPreset() },
      });
    } catch (error) {
      this.logger.error(`Error creating user: ${error.message}`);
      throw error;
    }
  }

  /**
   * A person editing their own profile: only the allow-listed fields are
   * written, whatever else the caller sends.
   */
  async updateProfile(id: number, dto: UpdateProfileDto) {
    const current = await this.prisma.client.user.findUnique({
      where: { id },
      select: { email: true, avatarUrl: true },
    });
    if (!current)
      throw new HttpException('User not found', HttpStatus.NOT_FOUND);
    if (
      dto.email !== undefined &&
      dto.email.trim().toLowerCase() !== current.email.toLowerCase()
    ) {
      throw new HttpException(
        'Changing your email address is not available yet.',
        HttpStatus.BAD_REQUEST,
      );
    }
    const data: Record<string, string | null> = {};
    for (const key of ['name', 'bio', 'affiliation', 'location'] as const) {
      if (dto[key] !== undefined) data[key] = dto[key].trim();
    }
    // A generated picture (validated by the DTO) or null. Either replaces an uploaded photo, whose file is then deleted.
    if (dto.avatarUrl !== undefined) {
      data.avatarUrl = dto.avatarUrl;
      if (isStoredPhoto(current.avatarUrl) && current.avatarUrl !== dto.avatarUrl) {
        const key = current.avatarUrl;
        this.storageService.deleteFile(key).catch((err: any) => this.logger.warn(`Could not delete the old avatar ${key}: ${err?.message}`));
      }
    }
    return this.update(id, data as Parameters<UsersService['update']>[1]);
  }

  async update(
    id: number,
    userData: {
      email?: string;
      name?: string;
      bio?: string;
      affiliation?: string;
      location?: string;
      avatarUrl?: string | null;
      verified?: boolean;
      supabaseUserId?: string;
      subscriptionType?: 'free' | 'pro' | 'team' | 'enterprise';
    },
  ) {
    try {
      return await this.prisma.client.user.update({
        where: { id },
        data: userData,
      });
    } catch (error) {
      this.logger.error(`Error updating user: ${error.message}`);
      throw error;
    }
  }

  /**
   * Soft-delete: marks account as deleted, deactivates sessions.
   * Data persists for 30 days for abuse prevention; the daily cleanup then
   * calls purgeDeletedAccount().
   */
  async remove(id: number) {
    try {
      // Deactivate all sessions
      await this.prisma.client.session.updateMany({
        where: { userId: id },
        data: { isActive: false },
      });

      // Revoke all API keys (model has no isActive, so just delete)
      await this.prisma.client.apiKey.deleteMany({
        where: { userId: id },
      });

      return await this.prisma.client.user.update({
        where: { id },
        data: { accountStatus: 'deleted' },
      });
    } catch (error) {
      this.logger.error(`Error soft-deleting user: ${error.message}`);
      throw error;
    }
  }

  /**
   * Wipe all data for a deleted user and reset their account for re-signup.
   * Called when someone signs up with an email that belongs to a deleted account.
   * Also cleans up S3 files so orphaned data doesn't accumulate.
   */
  async wipeAndReset(id: number, newName: string) {
    try {
      // ── Gather S3 keys before deleting DB records ────────────────────
      await this.deleteUserS3Files(id);

      // ── Delete all related DB records in a transaction ──────────────
      await this.prisma.client.$transaction([
        this.prisma.client.session.deleteMany({ where: { userId: id } }),
        this.prisma.client.oTP.deleteMany({ where: { userId: id } }),
        this.prisma.client.snip.deleteMany({ where: { userId: id } }),
        this.prisma.client.pDF.deleteMany({ where: { userId: id } }),
        this.prisma.client.usageRecord.deleteMany({ where: { userId: id } }),
        this.prisma.client.apiKey.deleteMany({ where: { userId: id } }),
        this.prisma.client.editorSettings.deleteMany({ where: { userId: id } }),
        this.prisma.client.userDictionary.deleteMany({ where: { userId: id } }),
        this.prisma.client.userMacro.deleteMany({ where: { userId: id } }),
        this.prisma.client.projectCollaborator.deleteMany({
          where: { userId: id },
        }),
        this.prisma.client.project.deleteMany({ where: { userId: id } }),
        // Anonymize audit logs, keeping the event record for security continuity
        // but remove the link back to this specific user
        this.prisma.client.auditLog.updateMany({
          where: { userId: id },
          data: { userId: null },
        }),
      ]);

      // Reset the user record
      return await this.prisma.client.user.update({
        where: { id },
        data: {
          name: newName,
          bio: null,
          affiliation: null,
          location: null,
          avatarUrl: randomAvatarPreset(),
          subscriptionType: 'free',
          verified: true,
          twoFactorEnabled: false,
          twoFactorSecret: null,
          settings: ['system'],
          notificationSettings: [true, true, true, false, true],
          accountStatus: 'active',
        },
      });
    } catch (error) {
      this.logger.error(`Error wiping user data: ${error.message}`);
      throw error;
    }
  }

  /**
   * Erase a deleted account for good: files in storage, content, and personal
   * details. The user row stays, anonymized, so payment and subscription
   * records (which accounting rules require keeping) still have an owner but
   * no name or address. Run by the daily cleanup after the grace period.
   */
  async purgeDeletedAccount(id: number) {
    const user = await this.prisma.client.user.findUnique({
      where: { id },
      select: { accountStatus: true },
    });
    if (!user || user.accountStatus !== 'deleted') return false;
    await this.wipeAndReset(id, 'Deleted user');
    await this.prisma.client.user.update({
      where: { id },
      data: {
        email: `deleted+${id}@deleted.invalid`,
        name: 'Deleted user',
        verified: false,
        accountStatus: 'deleted',
      },
    });
    return true;
  }

  /**
   * Delete all S3 files belonging to a user (snip images + PDF files).
   * Fire-and-forget per file: a failed S3 delete must never block user deletion.
   */
  private async deleteUserS3Files(userId: number): Promise<void> {
    try {
      // Gather S3 keys from snips
      const snips = await this.prisma.client.snip.findMany({
        where: { userId },
        select: { imagePath: true },
      });

      // Gather S3 keys from PDFs
      const pdfs = await this.prisma.client.pDF.findMany({
        where: { userId },
        select: { filePath: true },
      });

      // And images and other binary files in the user's own projects
      const assets = await this.prisma.client.projectFile.findMany({
        where: { project: { userId }, filePath: { not: null } },
        select: { filePath: true },
      });

      // And an uploaded profile photo
      const owner = await this.prisma.client.user.findUnique({
        where: { id: userId },
        select: { avatarUrl: true },
      });

      const s3Keys = [
        ...(isStoredPhoto(owner?.avatarUrl) ? [owner.avatarUrl] : []),
        ...snips.map((s) => s.imagePath).filter(Boolean),
        ...pdfs.map((p) => p.filePath).filter(Boolean),
        ...assets.map((a) => a.filePath).filter((k): k is string => !!k),
      ];

      if (s3Keys.length === 0) return;

      this.logger.log(`Deleting ${s3Keys.length} S3 files for user ${userId}`);

      // Delete in parallel. Each individual failure is logged but doesn't block
      await Promise.allSettled(
        s3Keys.map(async (key) => {
          try {
            await this.storageService.deleteFile(key);
          } catch (err: any) {
            this.logger.warn(
              `Failed to delete S3 file ${key} for user ${userId}: ${err.message}`,
            );
          }
        }),
      );
    } catch (err: any) {
      // If we can't even query for files, log and continue rather than block deletion
      this.logger.error(
        `Failed to query S3 files for user ${userId}: ${err.message}`,
      );
    }
  }
}
