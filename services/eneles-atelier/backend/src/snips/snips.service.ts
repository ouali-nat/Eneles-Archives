import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class SnipsService {
  constructor(private prisma: PrismaService) {}

  async findAll() {
    return this.prisma.client.snip.findMany();
  }

  async findOne(id: number) {
    return this.prisma.client.snip.findUnique({
      where: { id },
      select: {
        id: true,
        userId: true,
        title: true,
        imagePath: true,
        latexContent: true,
        originalText: true,
        status: true,
        tags: true,
        fileSize: true,
        createdAt: true,
        updatedAt: true,
      },
    });
  }

  async findByUserId(userId: number) {
    return this.prisma.client.snip.findMany({
      where: { userId },
      select: {
        id: true,
        userId: true,
        title: true,
        imagePath: true,
        status: true,
        tags: true,
        fileSize: true,
        createdAt: true,
        updatedAt: true,
      },
      orderBy: { updatedAt: 'desc' },
    });
  }

  async findByUserIdPaginated(
    userId: number,
    query: { page: number; limit: number; sort: string; order: 'asc' | 'desc' },
  ) {
    const { page, limit, sort, order } = query;
    const skip = (page - 1) * limit;

    const allowedSorts = [
      'title',
      'createdAt',
      'updatedAt',
      'status',
      'fileSize',
    ];
    const sortField = allowedSorts.includes(sort) ? sort : 'updatedAt';

    const [data, total] = await Promise.all([
      this.prisma.client.snip.findMany({
        where: { userId },
        select: {
          id: true,
          userId: true,
          title: true,
          imagePath: true,
          // The list shows each snip typeset and offers its LaTeX to copy, so the text comes with it.
          latexContent: true,
          status: true,
          tags: true,
          fileSize: true,
          createdAt: true,
          updatedAt: true,
        },
        orderBy: { [sortField]: order },
        skip,
        take: limit,
      }),
      this.prisma.client.snip.count({ where: { userId } }),
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

  async create(data: {
    userId: number;
    title: string;
    imagePath: string;
    latexContent?: string;
    originalText?: string;
    status?: 'pending' | 'processing' | 'completed' | 'error';
    fileSize?: number;
  }) {
    return this.prisma.client.snip.create({
      data,
    });
  }

  async update(
    id: number,
    data: {
      title?: string;
      imagePath?: string;
      latexContent?: string;
      originalText?: string;
      status?: 'pending' | 'processing' | 'completed' | 'error';
      tags?: string[];
      fileSize?: number;
    },
  ) {
    return this.prisma.client.snip.update({
      where: { id },
      data,
    });
  }

  async updateLatexContent(
    id: number,
    latexContent: string,
    status: 'completed' | 'error' = 'completed',
  ) {
    return this.prisma.client.snip.update({
      where: { id },
      data: {
        latexContent,
        status,
      },
    });
  }

  async remove(id: number) {
    return this.prisma.client.snip.delete({
      where: { id },
    });
  }
}
