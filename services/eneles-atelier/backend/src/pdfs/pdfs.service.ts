import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class PdfsService {
  constructor(private prisma: PrismaService) {}

  async findAll() {
    return this.prisma.client.pDF.findMany();
  }

  async findOne(id: number) {
    return this.prisma.client.pDF.findUnique({
      where: { id },
    });
  }

  async findByUserId(userId: number) {
    return this.prisma.client.pDF.findMany({
      where: { userId },
      select: {
        id: true,
        userId: true,
        title: true,
        filePath: true,
        fileSize: true,
        pageCount: true,
        status: true,
        tags: true,
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

    // Validate sort field is allowed
    const allowedSorts = [
      'title',
      'createdAt',
      'updatedAt',
      'status',
      'fileSize',
      'pageCount',
    ];
    const sortField = allowedSorts.includes(sort) ? sort : 'updatedAt';

    const [data, total] = await Promise.all([
      this.prisma.client.pDF.findMany({
        where: { userId },
        select: {
          id: true,
          userId: true,
          title: true,
          filePath: true,
          fileSize: true,
          pageCount: true,
          status: true,
          tags: true,
          createdAt: true,
          updatedAt: true,
        },
        orderBy: { [sortField]: order },
        skip,
        take: limit,
      }),
      this.prisma.client.pDF.count({ where: { userId } }),
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
    filePath: string;
    fileSize?: number;
    pageCount?: number;
    latexContent?: string;
    status?: 'pending' | 'processing' | 'completed' | 'error';
  }) {
    return this.prisma.client.pDF.create({
      data,
    });
  }

  async update(
    id: number,
    data: {
      title?: string;
      filePath?: string;
      pageCount?: number;
      latexContent?: string;
      status?: 'pending' | 'processing' | 'completed' | 'error';
      tags?: string[];
    },
  ) {
    return this.prisma.client.pDF.update({
      where: { id },
      data,
    });
  }

  async updateLatexContent(
    id: number,
    latexContent: string,
    status: 'completed' | 'error' = 'completed',
    pageCount?: number,
  ) {
    return this.prisma.client.pDF.update({
      where: { id },
      data: {
        latexContent,
        status,
        ...(pageCount != null && { pageCount }),
      },
    });
  }

  async remove(id: number) {
    return this.prisma.client.pDF.delete({
      where: { id },
    });
  }
}
