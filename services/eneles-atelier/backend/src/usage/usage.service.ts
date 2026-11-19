import { Injectable, BadRequestException, HttpException, HttpStatus } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Prisma } from '../../generated/prisma';
import { formatBytes, planAllowance } from '../common/plans';

@Injectable()
export class UsageService {
  constructor(private prisma: PrismaService) {}

  /** Monthly conversion quotas for a plan (-1 = unlimited). */
  private getLimits(subscriptionType: string) {
    const plan = planAllowance(subscriptionType);
    return { snips: plan.snipsPerMonth, pdfPages: plan.pdfPagesPerMonth };
  }

  /** Bytes of PDFs and images this user has uploaded and still keeps. */
  async uploadedBytes(userId: number): Promise<number> {
    const [pdfs, snips, assets] = await Promise.all([
      this.prisma.client.pDF.aggregate({ where: { userId }, _sum: { fileSize: true } }),
      this.prisma.client.snip.aggregate({ where: { userId }, _sum: { fileSize: true } }),
      this.prisma.client.projectFile.aggregate({
        where: { project: { userId }, filePath: { not: null } },
        _sum: { size: true },
      }),
    ]);
    return (pdfs._sum.fileSize || 0) + (snips._sum.fileSize || 0) + (assets._sum.size || 0);
  }

  /**
   * Refuse an upload that would take the user past their plan's storage.
   * Uploaded PDFs and images count, and images and other binary files in
   * the user's projects; text files never do.
   */
  async assertUploadFits(userId: number, incomingBytes: number): Promise<void> {
    const user = await this.prisma.client.user.findUnique({
      where: { id: userId },
      select: { subscriptionType: true },
    });
    const limit = planAllowance(user?.subscriptionType).uploadStorageBytes;
    if (limit === -1) return;
    const used = await this.uploadedBytes(userId);
    if (used + incomingBytes > limit) {
      throw new HttpException(
        `This upload would go past the ${formatBytes(limit)} of upload storage on your plan. Delete PDFs, images, or project files you no longer need, or upgrade.`,
        HttpStatus.PAYMENT_REQUIRED,
      );
    }
  }

  /**
   * Get or create usage record for current month
   */
  async getCurrentMonthUsage(userId: number) {
    const now = new Date();
    const month = now.getMonth() + 1; // 1-12
    const year = now.getFullYear();

    let usageRecord = await this.prisma.client.usageRecord.findUnique({
      where: {
        userId_month_year: {
          userId,
          month,
          year,
        },
      },
    });

    if (!usageRecord) {
      usageRecord = await this.prisma.client.usageRecord.create({
        data: {
          userId,
          month,
          year,
          snipsUsed: 0,
          pdfPagesUsed: 0,
          conversionsUsed: 0,
        },
      });
    }

    // Get user subscription type
    const user = await this.prisma.client.user.findUnique({
      where: { id: userId },
      select: { subscriptionType: true },
    });

    const limits = this.getLimits(user?.subscriptionType || 'free');

    return {
      snipsUsed: usageRecord.snipsUsed,
      snipsLimit: limits.snips,
      pdfPagesUsed: usageRecord.pdfPagesUsed,
      pdfPagesLimit: limits.pdfPages,
      month,
      year,
    };
  }

  /**
   * Increment snip usage
   */
  async incrementSnipUsage(userId: number, count: number = 1) {
    const now = new Date();
    const month = now.getMonth() + 1;
    const year = now.getFullYear();

    // Get current usage and check limits
    const usage = await this.getCurrentMonthUsage(userId);

    if (usage.snipsLimit !== -1 && usage.snipsUsed + count > usage.snipsLimit) {
      throw new BadRequestException(
        `You have reached your monthly limit of ${usage.snipsLimit} image snips. Please upgrade your plan.`,
      );
    }

    const usageRecord = await this.prisma.client.usageRecord.upsert({
      where: {
        userId_month_year: {
          userId,
          month,
          year,
        },
      },
      update: {
        snipsUsed: {
          increment: count,
        },
      },
      create: {
        userId,
        month,
        year,
        snipsUsed: count,
      },
    });

    return usageRecord;
  }

  /**
   * Increment PDF page usage
   */
  async incrementPdfPageUsage(userId: number, count: number = 1) {
    const now = new Date();
    const month = now.getMonth() + 1;
    const year = now.getFullYear();

    // Get current usage and check limits
    const usage = await this.getCurrentMonthUsage(userId);

    if (
      usage.pdfPagesLimit !== -1 &&
      usage.pdfPagesUsed + count > usage.pdfPagesLimit
    ) {
      throw new BadRequestException(
        `You have reached your monthly limit of ${usage.pdfPagesLimit} PDF pages. Please upgrade your plan.`,
      );
    }

    const usageRecord = await this.prisma.client.usageRecord.upsert({
      where: {
        userId_month_year: {
          userId,
          month,
          year,
        },
      },
      update: {
        pdfPagesUsed: {
          increment: count,
        },
      },
      create: {
        userId,
        month,
        year,
        pdfPagesUsed: count,
      },
    });

    return usageRecord;
  }

  /**
   * Increment conversion usage (called when PDF or snip processing completes)
   */
  async incrementConversionUsage(userId: number, count: number = 1) {
    const now = new Date();
    const month = now.getMonth() + 1;
    const year = now.getFullYear();

    return this.prisma.client.usageRecord.upsert({
      where: { userId_month_year: { userId, month, year } },
      update: { conversionsUsed: { increment: count } },
      create: { userId, month, year, conversionsUsed: count },
    });
  }

  /**
   * Check if user can perform action
   */
  async canUseSnip(userId: number): Promise<boolean> {
    const usage = await this.getCurrentMonthUsage(userId);
    return usage.snipsLimit === -1 || usage.snipsUsed < usage.snipsLimit;
  }

  async canUsePdfPage(userId: number, pageCount: number = 1): Promise<boolean> {
    const usage = await this.getCurrentMonthUsage(userId);
    return (
      usage.pdfPagesLimit === -1 ||
      usage.pdfPagesUsed + pageCount <= usage.pdfPagesLimit
    );
  }

  /** Get PDF page usage for error messages */
  async getPdfPageUsage(
    userId: number,
  ): Promise<{ used: number; limit: number }> {
    const usage = await this.getCurrentMonthUsage(userId);
    return { used: usage.pdfPagesUsed, limit: usage.pdfPagesLimit };
  }

  /** Uploaded bytes by kind: PDFs, snip images, and binary files (images, fonts) in the user's own projects. Text files are not stored as uploads and never count. */
  async uploadedBytesByKind(userId: number) {
    const [pdfs, snips, assets] = await Promise.all([
      this.prisma.client.pDF.aggregate({ where: { userId }, _sum: { fileSize: true } }),
      this.prisma.client.snip.aggregate({ where: { userId }, _sum: { fileSize: true } }),
      this.prisma.client.projectFile.aggregate({
        where: { project: { userId }, filePath: { not: null } },
        _sum: { size: true },
      }),
    ]);
    return { pdfs: pdfs._sum.fileSize || 0, snips: snips._sum.fileSize || 0, projectFiles: assets._sum.size || 0 };
  }

  /** What the sidebar's plan summary shows: this month's metered conversions and the upload storage, each against the plan. */
  async getPlanSummary(userId: number) {
    const [month, user, used] = await Promise.all([
      this.getCurrentMonthUsage(userId),
      this.prisma.client.user.findUnique({ where: { id: userId }, select: { subscriptionType: true } }),
      this.uploadedBytes(userId),
    ]);
    const plan = user?.subscriptionType ?? 'free';
    return { ...month, plan, storageUsedBytes: used, storageLimitBytes: planAllowance(plan).uploadStorageBytes };
  }

  /**
   * One person's statistics, from what the database records and nothing estimated: this month's metered conversions against the plan, twelve months of conversions and new projects, thirty days of AI requests, stored uploads by kind, the files in their projects by type, and how they collaborate. Months are calendar months in the server's time zone, as the usage records count them; days are UTC.
   */
  async getStatistics(userId: number) {
    const user = await this.prisma.client.user.findUnique({
      where: { id: userId },
      select: { createdAt: true, subscriptionType: true },
    });
    if (!user) throw new BadRequestException('User not found');

    const db = this.prisma.client;
    const now = new Date();
    const plan = planAllowance(user.subscriptionType);

    // Twelve calendar months, oldest first, ending with this one.
    const months = Array.from({ length: 12 }, (_, i) => {
      const date = new Date(now.getFullYear(), now.getMonth() - 11 + i, 1);
      return { month: date.getMonth() + 1, year: date.getFullYear() };
    });
    const monthKey = (year: number, month: number) => `${year}-${String(month).padStart(2, '0')}`;
    const firstMonth = new Date(months[0].year, months[0].month - 1, 1);

    // Thirty UTC days, oldest first, ending today.
    const DAY = 86_400_000;
    const since = new Date(now.getTime() - 29 * DAY);
    since.setUTCHours(0, 0, 0, 0);

    const ownProject = { userId, referenceOfId: null };

    const [
      records,
      projectRows,
      aiRows,
      projects,
      sharedWithYou,
      snips,
      pdfs,
      pdfPages,
      files,
      bytes,
      aiTotals,
      collaborators,
      sharedProjects,
      comments,
    ] = await Promise.all([
      db.usageRecord.findMany({ where: { userId }, select: { month: true, year: true, snipsUsed: true, pdfPagesUsed: true } }),
      db.$queryRaw<{ month: string; count: bigint }[]>(
        Prisma.sql`SELECT to_char("createdAt", 'YYYY-MM') AS month, count(*) AS count FROM projects WHERE "userId" = ${userId} AND "referenceOfId" IS NULL AND "createdAt" >= ${firstMonth} GROUP BY 1`,
      ),
      db.$queryRaw<{ day: string; count: bigint | number | null }[]>(
        Prisma.sql`SELECT to_char("createdAt", 'YYYY-MM-DD') AS day, sum(requests) AS count FROM ai_usage WHERE "userId" = ${userId} AND "createdAt" >= ${since} GROUP BY 1`,
      ),
      db.project.count({ where: ownProject }),
      db.projectCollaborator.count({ where: { userId, project: { userId: { not: userId } } } }),
      db.snip.count({ where: { userId } }),
      db.pDF.count({ where: { userId } }),
      db.pDF.aggregate({ where: { userId }, _sum: { pageCount: true } }),
      db.projectFile.findMany({ where: { project: ownProject, isFolder: false }, select: { path: true } }),
      this.uploadedBytesByKind(userId),
      db.aiUsage.aggregate({ where: { userId, createdAt: { gte: since } }, _sum: { requests: true, inputTokens: true, outputTokens: true } }),
      db.projectCollaborator.findMany({ where: { project: { userId }, userId: { not: userId } }, select: { userId: true }, distinct: ['userId'] }),
      db.project.count({ where: { userId, collaborators: { some: { userId: { not: userId } } } } }),
      db.commentMessage.count({ where: { authorId: userId } }),
    ]);

    const byMonth = new Map(records.map((r) => [monthKey(r.year, r.month), r]));
    const projectsByMonth = new Map(projectRows.map((r) => [r.month, Number(r.count)]));
    const monthly = months.map(({ month, year }) => {
      const key = monthKey(year, month);
      return {
        month: key,
        snips: byMonth.get(key)?.snipsUsed ?? 0,
        pdfPages: byMonth.get(key)?.pdfPagesUsed ?? 0,
        projects: projectsByMonth.get(key) ?? 0,
      };
    });

    const aiByDay = new Map(aiRows.map((r) => [r.day, Number(r.count ?? 0)]));
    const aiDaily = Array.from({ length: 30 }, (_, i) => {
      const day = new Date(since.getTime() + i * DAY).toISOString().slice(0, 10);
      return { day, count: aiByDay.get(day) ?? 0 };
    });

    // Files in the user's own projects by what they are, from the extension.
    const kinds: Record<string, number> = {};
    const kindOf = (path: string) => {
      const ext = path.toLowerCase().split('.').pop() ?? '';
      if (ext === 'tex') return 'tex';
      if (ext === 'bib') return 'bib';
      if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'pdf', 'eps'].includes(ext)) return 'figure';
      if (['sty', 'cls', 'bst', 'def'].includes(ext)) return 'style';
      return 'other';
    };
    for (const file of files) {
      const kind = kindOf(file.path);
      kinds[kind] = (kinds[kind] ?? 0) + 1;
    }

    const current = byMonth.get(monthKey(now.getFullYear(), now.getMonth() + 1));
    const nextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1);

    return {
      account: { createdAt: user.createdAt, plan: user.subscriptionType, aiAssistant: plan.aiAssistant },
      totals: {
        projects,
        sharedWithYou,
        files: files.length,
        snips,
        pdfs,
        pdfPages: pdfPages._sum.pageCount ?? 0,
        snipsConverted: records.reduce((sum, r) => sum + r.snipsUsed, 0),
        pdfPagesConverted: records.reduce((sum, r) => sum + r.pdfPagesUsed, 0),
      },
      currentMonth: {
        snipsUsed: current?.snipsUsed ?? 0,
        snipsLimit: plan.snipsPerMonth,
        pdfPagesUsed: current?.pdfPagesUsed ?? 0,
        pdfPagesLimit: plan.pdfPagesPerMonth,
        resetsOn: nextMonth.toISOString(),
      },
      storage: {
        usedBytes: bytes.pdfs + bytes.snips + bytes.projectFiles,
        limitBytes: plan.uploadStorageBytes,
        byKind: bytes,
      },
      monthly,
      ai: {
        daily: aiDaily,
        requests: aiTotals._sum.requests ?? 0,
        tokens: (aiTotals._sum.inputTokens ?? 0) + (aiTotals._sum.outputTokens ?? 0),
      },
      filesByKind: kinds,
      collaboration: {
        people: collaborators.length,
        sharedProjects,
        sharedWithYou,
        comments,
      },
    };
  }
}
