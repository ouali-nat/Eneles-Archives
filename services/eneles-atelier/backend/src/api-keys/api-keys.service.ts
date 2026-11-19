import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import * as crypto from 'crypto';

@Injectable()
export class ApiKeysService {
  constructor(private prisma: PrismaService) {}

  // Generate a random API key
  private generateApiKey(): string {
    const randomBytes = crypto.randomBytes(32);
    return `txr_${randomBytes.toString('hex')}`;
  }

  // Hash an API key using SHA-256
  private hashApiKey(key: string): string {
    return crypto.createHash('sha256').update(key).digest('hex');
  }

  // Create a new API key
  async createApiKey(userId: number, name: string) {
    const apiKey = this.generateApiKey();
    const keyHash = this.hashApiKey(apiKey);
    const keyPrefix = apiKey.substring(0, 12); // Show first 12 chars

    const record = await this.prisma.client.apiKey.create({
      data: {
        userId,
        name,
        keyHash,
        keyPrefix,
      },
    });

    // Return the full key ONLY on creation (user must save it)
    return {
      id: record.id,
      name: record.name,
      keyPrefix: record.keyPrefix,
      apiKey, // Full key - only shown once
      createdAt: record.createdAt,
      lastUsedAt: record.lastUsedAt,
    };
  }

  // Get all API keys for a user (without the actual key)
  async getUserApiKeys(userId: number) {
    const keys = await this.prisma.client.apiKey.findMany({
      where: { userId },
      select: {
        id: true,
        name: true,
        keyPrefix: true,
        lastUsedAt: true,
        createdAt: true,
        updatedAt: true,
      },
      orderBy: { createdAt: 'desc' },
    });

    return keys;
  }

  // Get all API keys for a user with pagination
  async getUserApiKeysPaginated(
    userId: number,
    query: { page: number; limit: number; sort: string; order: 'asc' | 'desc' },
  ) {
    const { page, limit, sort, order } = query;
    const skip = (page - 1) * limit;

    const allowedSorts = ['name', 'createdAt', 'updatedAt', 'lastUsedAt'];
    const sortField = allowedSorts.includes(sort) ? sort : 'createdAt';

    const [data, total] = await Promise.all([
      this.prisma.client.apiKey.findMany({
        where: { userId },
        select: {
          id: true,
          name: true,
          keyPrefix: true,
          lastUsedAt: true,
          createdAt: true,
          updatedAt: true,
        },
        orderBy: { [sortField]: order },
        skip,
        take: limit,
      }),
      this.prisma.client.apiKey.count({ where: { userId } }),
    ]);

    const totalPages = Math.ceil(total / limit);
    return {
      data,
      meta: {
        page,
        limit,
        total,
        totalPages,
        hasNext: page < totalPages,
        hasPrev: page > 1,
      },
    };
  }

  // Validate an API key and return user info
  async validateApiKey(apiKey: string) {
    const keyHash = this.hashApiKey(apiKey);
    const record = await this.prisma.client.apiKey.findUnique({
      where: { keyHash },
      include: { user: true },
    });

    if (!record) {
      return null;
    }

    // A key outlives its owner only in the database. If the account was
    // deleted, the key is dead too: otherwise deleting an account would leave
    // every integration it had created still able to authenticate as it.
    if ((record.user as any)?.accountStatus === 'deleted') {
      return null;
    }

    // Update lastUsedAt
    await this.prisma.client.apiKey.update({
      where: { id: record.id },
      data: { lastUsedAt: new Date() },
    });

    return record.user;
  }

  // Update API key name
  async updateApiKeyName(userId: number, keyId: number, name: string) {
    const key = await this.prisma.client.apiKey.findFirst({
      where: { id: keyId, userId },
    });

    if (!key) {
      throw new NotFoundException('API key not found');
    }

    return this.prisma.client.apiKey.update({
      where: { id: keyId },
      data: { name },
    });
  }

  // Delete an API key
  async deleteApiKey(userId: number, keyId: number) {
    const key = await this.prisma.client.apiKey.findFirst({
      where: { id: keyId, userId },
    });

    if (!key) {
      throw new NotFoundException('API key not found');
    }

    await this.prisma.client.apiKey.delete({
      where: { id: keyId },
    });

    return { message: 'API key deleted successfully' };
  }
}
