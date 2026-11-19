import { siteUrls } from '../common/site';
import { Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { readFileSync } from 'fs';
import { join } from 'path';
import { Prisma } from '../../generated/prisma';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../common/redis';
import { countryOf } from '../common/geo/country';
import { collabStats, eventLoopDelay, startedAt } from '../metrics/runtime';
import { RootAdmin } from './root-admin';

/**
 * What the operators' panel reads.
 *
 * The rule for everything in this file: numbers and account metadata, never what people wrote. No query here selects a project's title or files, a snip's or PDF's title, image, or LaTeX, a comment, a chat message, or a template's source. An operator can see that someone has twelve projects and how much they store, not what any of them is.
 */

const DAY = 24 * 60 * 60 * 1000;

const VERSION: string = (() => {
  try {
    return JSON.parse(
      readFileSync(join(__dirname, '..', '..', 'package.json'), 'utf8'),
    ).version;
  } catch {
    return process.env.npm_package_version || 'unknown';
  }
})();

type DayCount = { day: string; count: number };

/*
 * The columns each list can be sorted by. A request names one of these; the SQL for it comes from a fixed table below, never from the request text.
 */
export const USER_SORTS = [
  'name',
  'email',
  'plan',
  'country',
  'projects',
  'snips',
  'pdfs',
  'storage',
  'ai',
  'sessions',
  'lastActive',
  'createdAt',
] as const;
export type UserSort = (typeof USER_SORTS)[number];
export const SESSION_SORTS = [
  'state',
  'account',
  'device',
  'country',
  'ip',
  'lastActive',
  'createdAt',
] as const;
export type SessionSort = (typeof SESSION_SORTS)[number];
export const AUDIT_SORTS = [
  'createdAt',
  'action',
  'outcome',
  'account',
  'ip',
  'client',
] as const;
export type AuditSort = (typeof AUDIT_SORTS)[number];
export const PAYMENT_SORTS = [
  'createdAt',
  'account',
  'plan',
  'status',
  'amount',
] as const;
export type PaymentSort = (typeof PAYMENT_SORTS)[number];

export type SortOrder = 'asc' | 'desc';

/** `value` if it is one of `allowed`, else undefined. */
export function oneOf<T extends string>(
  allowed: readonly T[],
  value: unknown,
): T | undefined {
  return typeof value === 'string' &&
    (allowed as readonly string[]).includes(value)
    ? (value as T)
    : undefined;
}

const MONTH_KEY = (date: Date) => date.toISOString().slice(0, 7);

export interface UserListQuery {
  search?: string;
  plan?: string;
  status?: string;
  sort?: UserSort;
  order?: 'asc' | 'desc';
  page?: number;
  limit?: number;
}

const paginate = (page = 1, limit = 25, max = 100) => {
  const take = Math.min(Math.max(Math.floor(limit) || 25, 1), max);
  const current = Math.max(Math.floor(page) || 1, 1);
  return { take, current, skip: (current - 1) * take };
};

const meta = (total: number, current: number, take: number) => {
  const totalPages = Math.max(Math.ceil(total / take), 1);
  return {
    page: current,
    limit: take,
    total,
    totalPages,
    hasNext: current < totalPages,
    hasPrev: current > 1,
  };
};

const sessionFields = {
  id: true,
  userId: true,
  deviceType: true,
  browser: true,
  os: true,
  ipAddress: true,
  location: true,
  isActive: true,
  lastActive: true,
  expiresAt: true,
  createdAt: true,
} as const;

/** A session as the panel shows it: the token never leaves the server, and the country is worked out from the address when it was not stored. */
function presentSession<
  T extends {
    ipAddress: string | null;
    location: string | null;
    isActive: boolean;
    expiresAt: Date;
  },
>(s: T) {
  const { location, ...rest } = s;
  return {
    ...rest,
    country:
      location && /^[A-Z]{2}$/.test(location)
        ? location
        : countryOf(s.ipAddress),
    live: s.isActive && s.expiresAt > new Date(),
  };
}

@Injectable()
export class AdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly config: ConfigService,
    private readonly root: RootAdmin,
  ) {}

  private get db() {
    return this.prisma.client;
  }

  /** Rows created per day over the last `days` days, with the empty days filled in so a chart has no gaps. */
  private async perDay(
    table: Prisma.Sql,
    days: number,
    where: Prisma.Sql = Prisma.empty,
    value: Prisma.Sql = Prisma.sql`count(*)`,
  ): Promise<DayCount[]> {
    const since = new Date(Date.now() - (days - 1) * DAY);
    since.setUTCHours(0, 0, 0, 0);
    const rows = await this.db.$queryRaw<
      { day: Date; count: bigint | number | null }[]
    >(
      Prisma.sql`SELECT date_trunc('day', "createdAt") AS day, ${value} AS count FROM ${table} WHERE "createdAt" >= ${since} ${where} GROUP BY 1 ORDER BY 1`,
    );
    const byDay = new Map(
      rows.map((r) => [r.day.toISOString().slice(0, 10), Number(r.count ?? 0)]),
    );
    return Array.from({ length: days }, (_, i) => {
      const day = new Date(since.getTime() + i * DAY)
        .toISOString()
        .slice(0, 10);
      return { day, count: byDay.get(day) ?? 0 };
    });
  }

  /**
   * Email (Resend): what was sent and what happened to it, from the webhook's records. Totals by furthest status and by kind over `days`, three daily series, and one page of messages, newest first. Sign-in emails never have a subject here (it held the code), and any code-like number in other subjects is masked when stored.
   */
  async emails(query: {
    days: number;
    status?: string;
    kind?: string;
    search?: string;
    page?: number;
    limit?: number;
  }) {
    const since = new Date(Date.now() - (query.days - 1) * DAY);
    since.setUTCHours(0, 0, 0, 0);
    const where: Prisma.EmailMessageWhereInput = { createdAt: { gte: since } };
    if (query.status) where.status = query.status;
    if (query.kind) where.kind = query.kind;
    const search = query.search?.trim();
    if (search)
      where.OR = [
        { recipients: { has: search.toLowerCase() } },
        { subject: { contains: search, mode: 'insensitive' } },
        { resendId: search },
      ];
    const { take, current, skip } = paginate(query.page, query.limit);
    const range = { createdAt: { gte: since } };
    const [byStatus, byKind, total, rows, sent, delivered, bounced] =
      await Promise.all([
        this.db.emailMessage.groupBy({
          by: ['status'],
          where: range,
          _count: { _all: true },
        }),
        this.db.emailMessage.groupBy({
          by: ['kind'],
          where: range,
          _count: { _all: true },
        }),
        this.db.emailMessage.count({ where }),
        this.db.emailMessage.findMany({
          where,
          orderBy: { createdAt: 'desc' },
          skip,
          take,
          select: {
            id: true,
            resendId: true,
            kind: true,
            recipients: true,
            subject: true,
            status: true,
            bounceType: true,
            createdAt: true,
            deliveredAt: true,
            openedAt: true,
            clickedAt: true,
            lastEventAt: true,
          },
        }),
        this.perDay(Prisma.sql`email_messages`, query.days),
        this.perDay(
          Prisma.sql`email_messages`,
          query.days,
          Prisma.sql`AND "deliveredAt" IS NOT NULL`,
        ),
        this.perDay(
          Prisma.sql`email_messages`,
          query.days,
          Prisma.sql`AND status IN ('bounced', 'complained', 'failed')`,
        ),
      ]);
    const statusCount = Object.fromEntries(
      byStatus.map((s) => [s.status, s._count._all]),
    );
    return {
      days: query.days,
      totals: {
        all: byStatus.reduce((sum, s) => sum + s._count._all, 0),
        ...statusCount,
      },
      byKind: byKind
        .map((k) => ({ kind: k.kind, count: k._count._all }))
        .sort((a, b) => b.count - a.count),
      series: { sent, delivered, bounced },
      data: rows,
      meta: meta(total, current, take),
    };
  }

  /** One email and every event Resend reported for it, oldest first. */
  async email(id: number) {
    const message = await this.db.emailMessage.findUnique({
      where: { id },
      include: {
        events: {
          orderBy: { occurredAt: 'asc' },
          select: { id: true, type: true, occurredAt: true, detail: true },
        },
      },
    });
    if (!message) throw new NotFoundException('No such email');
    return message;
  }

  async overview(days = 30) {
    const now = Date.now();
    const ago = (n: number) => new Date(now - n * DAY);
    const liveSession = { isActive: true, expiresAt: { gt: new Date() } };
    const month = new Date().getUTCMonth() + 1;
    const year = new Date().getUTCFullYear();
    const monthStart = new Date(Date.UTC(year, month - 1, 1));

    const [
      users,
      deleted,
      suspended,
      verified,
      twoFactor,
      byPlan,
      new1,
      new7,
      new30,
      active,
      liveSessions,
      projects,
      references,
      files,
      sharedProjects,
      githubLinked,
      snips,
      pdfs,
      templates,
      apiKeys,
      pdfBytes,
      snipBytes,
      assetBytes,
      conversions,
      ai,
      subscriptions,
      revenue,
      liveSessionRows,
      signups,
      projectsPerDay,
      snipsPerDay,
      loginsPerDay,
      aiPerDay,
    ] = await Promise.all([
      this.db.user.count({ where: { accountStatus: 'active' } }),
      this.db.user.count({ where: { accountStatus: 'deleted' } }),
      this.db.user.count({ where: { accountStatus: 'suspended' } }),
      this.db.user.count({
        where: { accountStatus: 'active', verified: true },
      }),
      this.db.user.count({
        where: { accountStatus: 'active', twoFactorEnabled: true },
      }),
      this.db.user.groupBy({
        by: ['subscriptionType'],
        where: { accountStatus: 'active' },
        _count: { _all: true },
      }),
      this.db.user.count({ where: { createdAt: { gte: ago(1) } } }),
      this.db.user.count({ where: { createdAt: { gte: ago(7) } } }),
      this.db.user.count({ where: { createdAt: { gte: ago(30) } } }),
      this.db.$queryRaw<{ d1: bigint; d7: bigint; d30: bigint }[]>(
        Prisma.sql`SELECT count(DISTINCT "userId") FILTER (WHERE "lastActive" >= ${ago(1)}) AS d1, count(DISTINCT "userId") FILTER (WHERE "lastActive" >= ${ago(7)}) AS d7, count(DISTINCT "userId") FILTER (WHERE "lastActive" >= ${ago(30)}) AS d30 FROM sessions`,
      ),
      this.db.session.count({ where: liveSession }),
      this.db.project.count({ where: { referenceOfId: null } }),
      this.db.project.count({ where: { referenceOfId: { not: null } } }),
      this.db.projectFile.count({ where: { isFolder: false } }),
      this.db.project.count({
        where: { referenceOfId: null, collaborators: { some: {} } },
      }),
      this.db.projectGitHubLink.count(),
      this.db.snip.count(),
      this.db.pDF.count(),
      this.db.template.count(),
      this.db.apiKey.count(),
      this.db.pDF.aggregate({ _sum: { fileSize: true } }),
      this.db.snip.aggregate({ _sum: { fileSize: true } }),
      this.db.projectFile.aggregate({
        where: { filePath: { not: null } },
        _sum: { size: true },
      }),
      this.db.usageRecord.aggregate({
        where: { month, year },
        _sum: { snipsUsed: true, pdfPagesUsed: true },
      }),
      this.db.aiUsage.aggregate({
        where: { createdAt: { gte: monthStart } },
        _sum: { requests: true, inputTokens: true, outputTokens: true },
        _count: { _all: true },
      }),
      this.db.subscription.groupBy({ by: ['status'], _count: { _all: true } }),
      this.db.payment.aggregate({
        where: { status: 'succeeded', createdAt: { gte: ago(30) } },
        _sum: { amount: true },
        _count: { _all: true },
      }),
      // Enough to draw the breakdowns; a deployment with more live sessions than this shows a sample.
      this.db.session.findMany({
        where: liveSession,
        orderBy: { lastActive: 'desc' },
        take: 5000,
        select: {
          ipAddress: true,
          location: true,
          deviceType: true,
          browser: true,
          os: true,
        },
      }),
      this.perDay(Prisma.sql`users`, days),
      this.perDay(
        Prisma.sql`projects`,
        days,
        Prisma.sql`AND "referenceOfId" IS NULL`,
      ),
      this.perDay(Prisma.sql`snips`, days),
      this.perDay(
        Prisma.sql`audit_logs`,
        days,
        Prisma.sql`AND action = 'login.success'`,
      ),
      this.perDay(
        Prisma.sql`ai_usage`,
        days,
        Prisma.empty,
        Prisma.sql`coalesce(sum(requests), 0)`,
      ),
    ]);

    const tally = (values: (string | null)[]) => {
      const counts = new Map<string, number>();
      for (const v of values)
        counts.set(v || 'Unknown', (counts.get(v || 'Unknown') ?? 0) + 1);
      return [...counts]
        .map(([name, count]) => ({ name, count }))
        .sort((a, b) => b.count - a.count);
    };

    return {
      generatedAt: new Date().toISOString(),
      users: {
        total: users,
        deleted,
        suspended,
        verified,
        twoFactor,
        byPlan: Object.fromEntries(
          byPlan.map((p) => [p.subscriptionType, p._count._all]),
        ),
        new: { day: new1, week: new7, month: new30 },
        active: {
          day: Number(active[0]?.d1 ?? 0),
          week: Number(active[0]?.d7 ?? 0),
          month: Number(active[0]?.d30 ?? 0),
        },
      },
      sessions: {
        live: liveSessions,
        countries: tally(
          liveSessionRows.map((s) =>
            s.location && /^[A-Z]{2}$/.test(s.location)
              ? s.location
              : countryOf(s.ipAddress),
          ),
        ),
        devices: tally(liveSessionRows.map((s) => s.deviceType)),
        browsers: tally(liveSessionRows.map((s) => s.browser)),
        systems: tally(liveSessionRows.map((s) => s.os)),
      },
      content: {
        projects,
        references,
        files,
        sharedProjects,
        githubLinked,
        snips,
        pdfs,
        templates,
        apiKeys,
      },
      storage: {
        pdfBytes: pdfBytes._sum.fileSize ?? 0,
        snipBytes: snipBytes._sum.fileSize ?? 0,
        projectAssetBytes: assetBytes._sum.size ?? 0,
        totalBytes:
          (pdfBytes._sum.fileSize ?? 0) +
          (snipBytes._sum.fileSize ?? 0) +
          (assetBytes._sum.size ?? 0),
      },
      thisMonth: {
        snipConversions: conversions._sum.snipsUsed ?? 0,
        pdfPages: conversions._sum.pdfPagesUsed ?? 0,
        aiCalls: ai._count._all,
        aiRequests: ai._sum.requests ?? 0,
        aiInputTokens: ai._sum.inputTokens ?? 0,
        aiOutputTokens: ai._sum.outputTokens ?? 0,
      },
      billing: {
        subscriptions: Object.fromEntries(
          subscriptions.map((s) => [s.status, s._count._all]),
        ),
        revenue30d: {
          amount: revenue._sum.amount ?? 0,
          currency: 'usd',
          payments: revenue._count._all,
        },
      },
      series: {
        days,
        signups,
        projects: projectsPerDay,
        snips: snipsPerDay,
        logins: loginsPerDay,
        aiRequests: aiPerDay,
      },
    };
  }

  async users(query: UserListQuery) {
    const { take, current, skip } = paginate(query.page, query.limit);
    const conditions: Prisma.Sql[] = [];
    const search = query.search?.trim();
    if (search) {
      const like = `%${search.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
      conditions.push(
        Prisma.sql`(u.email ILIKE ${like} OR u.name ILIKE ${like}${/^\d+$/.test(search) ? Prisma.sql` OR u.id = ${Number(search)}` : Prisma.empty})`,
      );
    }
    if (
      query.plan &&
      ['free', 'pro', 'team', 'enterprise'].includes(query.plan)
    )
      conditions.push(Prisma.sql`u."subscriptionType"::text = ${query.plan}`);
    if (
      query.status &&
      ['active', 'deleted', 'suspended'].includes(query.status)
    )
      conditions.push(Prisma.sql`u."accountStatus"::text = ${query.status}`);
    const where = conditions.length
      ? Prisma.sql`WHERE ${Prisma.join(conditions, ' AND ')}`
      : Prisma.empty;

    // The sort column comes from a fixed list, never from the request text.
    const sortColumn: Record<UserSort, Prisma.Sql> = {
      name: Prisma.sql`lower(u.name)`,
      email: Prisma.sql`lower(u.email)`,
      plan: Prisma.sql`u."subscriptionType"`,
      country: Prisma.sql`latest.location`,
      projects: Prisma.sql`projects`,
      snips: Prisma.sql`snips`,
      pdfs: Prisma.sql`pdfs`,
      storage: Prisma.sql`"storageBytes"`,
      ai: Prisma.sql`"aiRequests30d"`,
      sessions: Prisma.sql`"liveSessions"`,
      lastActive: Prisma.sql`"lastActive"`,
      createdAt: Prisma.sql`u."createdAt"`,
    };
    const sort = USER_SORTS.includes(query.sort as UserSort)
      ? (query.sort as UserSort)
      : 'createdAt';
    const direction =
      query.order === 'asc' ? Prisma.sql`ASC` : Prisma.sql`DESC`;
    const since = new Date(Date.now() - 30 * DAY);

    type Row = {
      id: number;
      email: string;
      name: string;
      plan: string;
      status: string;
      verified: boolean;
      twoFactorEnabled: boolean;
      isAdmin: boolean;
      createdAt: Date;
      lastActive: Date | null;
      lastIp: string | null;
      lastLocation: string | null;
      projects: bigint;
      snips: bigint;
      pdfs: bigint;
      liveSessions: bigint;
      storageBytes: bigint;
      aiRequests30d: bigint;
    };
    const [rows, total] = await Promise.all([
      this.db.$queryRaw<Row[]>(Prisma.sql`
        SELECT u.id, u.email, u.name, u."subscriptionType"::text AS plan, u."accountStatus"::text AS status, u.verified, u."twoFactorEnabled", u."isAdmin", u."createdAt",
          latest."lastActive", latest."ipAddress" AS "lastIp", latest.location AS "lastLocation",
          (SELECT count(*) FROM projects p WHERE p."userId" = u.id AND p."referenceOfId" IS NULL) AS projects,
          (SELECT count(*) FROM snips s WHERE s."userId" = u.id) AS snips,
          (SELECT count(*) FROM pdfs d WHERE d."userId" = u.id) AS pdfs,
          (SELECT count(*) FROM sessions s WHERE s."userId" = u.id AND s."isActive" AND s."expiresAt" > now()) AS "liveSessions",
          (SELECT coalesce(sum(d."fileSize"), 0) FROM pdfs d WHERE d."userId" = u.id)
            + (SELECT coalesce(sum(s."fileSize"), 0) FROM snips s WHERE s."userId" = u.id)
            + (SELECT coalesce(sum(f.size), 0) FROM project_files f JOIN projects p ON p.id = f."projectId" WHERE p."userId" = u.id AND f."filePath" IS NOT NULL) AS "storageBytes",
          (SELECT coalesce(sum(a.requests), 0) FROM ai_usage a WHERE a."userId" = u.id AND a."createdAt" >= ${since}) AS "aiRequests30d"
        FROM users u
        LEFT JOIN LATERAL (SELECT s."lastActive", s."ipAddress", s.location FROM sessions s WHERE s."userId" = u.id ORDER BY s."lastActive" DESC LIMIT 1) latest ON true
        ${where}
        ORDER BY ${sortColumn[sort]} ${direction} NULLS LAST, u.id DESC
        LIMIT ${take} OFFSET ${skip}`),
      this.db.$queryRaw<{ count: bigint }[]>(
        Prisma.sql`SELECT count(*) AS count FROM users u ${where}`,
      ),
    ]);

    return {
      data: rows.map(({ lastIp, lastLocation, ...r }) => ({
        ...r,
        country:
          lastLocation && /^[A-Z]{2}$/.test(lastLocation)
            ? lastLocation
            : countryOf(lastIp),
        projects: Number(r.projects),
        snips: Number(r.snips),
        pdfs: Number(r.pdfs),
        liveSessions: Number(r.liveSessions),
        storageBytes: Number(r.storageBytes),
        aiRequests30d: Number(r.aiRequests30d),
      })),
      meta: meta(Number(total[0]?.count ?? 0), current, take),
    };
  }

  async user(id: number) {
    const user = await this.db.user.findUnique({
      where: { id },
      select: {
        id: true,
        email: true,
        name: true,
        affiliation: true,
        accountStatus: true,
        subscriptionType: true,
        verified: true,
        twoFactorEnabled: true,
        isAdmin: true,
        createdAt: true,
        updatedAt: true,
        subscription: {
          select: {
            status: true,
            stripeCurrentPeriodEnd: true,
            cancelAtPeriodEnd: true,
            createdAt: true,
          },
        },
      },
    });
    if (!user) throw new NotFoundException('No such account');

    const since = new Date(Date.now() - 30 * DAY);
    const [
      projects,
      references,
      sharedWithOthers,
      collaborations,
      files,
      snips,
      pdfs,
      templates,
      apiKeys,
      pdfBytes,
      snipBytes,
      assetBytes,
      lastProject,
      sessions,
      sessionCount,
      liveSessions,
      usage,
      aiByKind,
      aiPerDay,
      payments,
      audit,
    ] = await Promise.all([
      this.db.project.count({ where: { userId: id, referenceOfId: null } }),
      this.db.project.count({
        where: { userId: id, referenceOfId: { not: null } },
      }),
      this.db.project.count({
        where: { userId: id, referenceOfId: null, collaborators: { some: {} } },
      }),
      this.db.projectCollaborator.count({ where: { userId: id } }),
      this.db.projectFile.count({
        where: { project: { userId: id }, isFolder: false },
      }),
      this.db.snip.count({ where: { userId: id } }),
      this.db.pDF.count({ where: { userId: id } }),
      this.db.template.count({ where: { userId: id } }),
      this.db.apiKey.findMany({
        where: { userId: id },
        select: {
          id: true,
          keyPrefix: true,
          lastUsedAt: true,
          createdAt: true,
        },
        orderBy: { createdAt: 'desc' },
      }),
      this.db.pDF.aggregate({
        where: { userId: id },
        _sum: { fileSize: true, pageCount: true },
      }),
      this.db.snip.aggregate({
        where: { userId: id },
        _sum: { fileSize: true },
      }),
      this.db.projectFile.aggregate({
        where: { project: { userId: id }, filePath: { not: null } },
        _sum: { size: true },
      }),
      this.db.project.findFirst({
        where: { userId: id, referenceOfId: null },
        orderBy: { updatedAt: 'desc' },
        select: { updatedAt: true },
      }),
      this.db.session.findMany({
        where: { userId: id },
        orderBy: { lastActive: 'desc' },
        take: 50,
        select: sessionFields,
      }),
      this.db.session.count({ where: { userId: id } }),
      this.db.session.count({
        where: { userId: id, isActive: true, expiresAt: { gt: new Date() } },
      }),
      this.db.usageRecord.findMany({
        where: { userId: id },
        orderBy: [{ year: 'desc' }, { month: 'desc' }],
        take: 12,
        select: {
          month: true,
          year: true,
          snipsUsed: true,
          pdfPagesUsed: true,
        },
      }),
      this.db.aiUsage.groupBy({
        by: ['kind'],
        where: { userId: id, createdAt: { gte: since } },
        _sum: {
          requests: true,
          inputTokens: true,
          outputTokens: true,
          audioBytes: true,
        },
        _count: { _all: true },
      }),
      this.perDay(
        Prisma.sql`ai_usage`,
        30,
        Prisma.sql`AND "userId" = ${id}`,
        Prisma.sql`coalesce(sum(requests), 0)`,
      ),
      this.db.payment.findMany({
        where: { userId: id },
        orderBy: { createdAt: 'desc' },
        take: 20,
        select: {
          id: true,
          amount: true,
          currency: true,
          status: true,
          createdAt: true,
        },
      }),
      // The account's own events, and what operators did to it (viewed it, disabled it, changed its plan).
      this.db.auditLog.findMany({
        where: {
          OR: [{ userId: id }, { resource: 'user', resourceId: String(id) }],
        },
        orderBy: { createdAt: 'desc' },
        take: 50,
        select: {
          id: true,
          userId: true,
          action: true,
          outcome: true,
          ipAddress: true,
          userAgent: true,
          createdAt: true,
        },
      }),
    ]);
    const actorIds = [
      ...new Set(
        audit
          .map((a) => a.userId)
          .filter((who): who is number => who !== null && who !== id),
      ),
    ];
    const actors = actorIds.length
      ? await this.db.user.findMany({
          where: { id: { in: actorIds } },
          select: { id: true, email: true },
        })
      : [];
    const actorEmail = new Map(actors.map((a) => [a.id, a.email]));

    return {
      user: { ...user, root: this.root.isRoot(user.email) },
      counts: {
        projects,
        references,
        sharedWithOthers,
        collaborations,
        files,
        snips,
        pdfs,
        pdfPages: pdfBytes._sum.pageCount ?? 0,
        templates,
        apiKeys: apiKeys.length,
        sessions: sessionCount,
      },
      storage: {
        pdfBytes: pdfBytes._sum.fileSize ?? 0,
        snipBytes: snipBytes._sum.fileSize ?? 0,
        projectAssetBytes: assetBytes._sum.size ?? 0,
        totalBytes:
          (pdfBytes._sum.fileSize ?? 0) +
          (snipBytes._sum.fileSize ?? 0) +
          (assetBytes._sum.size ?? 0),
      },
      lastProjectActivity: lastProject?.updatedAt ?? null,
      apiKeys,
      sessions: sessions.map(presentSession),
      usage,
      ai: {
        byKind: aiByKind.map((k) => ({
          kind: k.kind,
          calls: k._count._all,
          requests: k._sum.requests ?? 0,
          inputTokens: k._sum.inputTokens ?? 0,
          outputTokens: k._sum.outputTokens ?? 0,
          audioBytes: k._sum.audioBytes ?? 0,
        })),
        perDay: aiPerDay,
      },
      payments,
      liveSessions,
      audit: audit.map((a) => ({
        ...a,
        country: countryOf(a.ipAddress),
        actor:
          a.userId !== null && a.userId !== id
            ? (actorEmail.get(a.userId) ?? `Account ${a.userId}`)
            : null,
      })),
    };
  }

  async setAdmin(id: number, isAdmin: boolean) {
    const user = await this.db.user.findUnique({
      where: { id },
      select: { id: true, accountStatus: true },
    });
    if (!user) throw new NotFoundException('No such account');
    return this.db.user.update({
      where: { id },
      data: { isAdmin },
      select: { id: true, isAdmin: true },
    });
  }

  async sessions(query: {
    live?: boolean;
    search?: string;
    sort?: SessionSort;
    order?: SortOrder;
    page?: number;
    limit?: number;
  }) {
    const { take, current, skip } = paginate(query.page, query.limit);
    const search = query.search?.trim();
    const where: Prisma.SessionWhereInput = {
      ...(query.live ? { isActive: true, expiresAt: { gt: new Date() } } : {}),
      ...(search
        ? {
            OR: [
              { ipAddress: { contains: search } },
              { user: { email: { contains: search, mode: 'insensitive' } } },
              { browser: { contains: search, mode: 'insensitive' } },
              { os: { contains: search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };
    const [rows, total] = await Promise.all([
      this.db.session.findMany({
        where,
        orderBy: this.sessionOrder(
          query.sort ?? 'lastActive',
          query.order ?? 'desc',
        ),
        skip,
        take,
        select: {
          ...sessionFields,
          user: { select: { email: true, name: true } },
        },
      }),
      this.db.session.count({ where }),
    ]);
    return { data: rows.map(presentSession), meta: meta(total, current, take) };
  }

  /** The order for the sessions list. Every entry ends on the id, so a page boundary never falls between equal rows differently on two requests. */
  private sessionOrder(
    sort: SessionSort,
    order: SortOrder,
  ): Prisma.SessionOrderByWithRelationInput[] {
    const last = { sort: order, nulls: 'last' } as const;
    const by: Record<SessionSort, Prisma.SessionOrderByWithRelationInput[]> = {
      state: [{ isActive: order }, { expiresAt: order }],
      account: [{ user: { email: order } }],
      device: [{ deviceType: order }, { browser: order }, { os: order }],
      country: [{ location: last }],
      ip: [{ ipAddress: last }],
      lastActive: [{ lastActive: order }],
      createdAt: [{ createdAt: order }],
    };
    return [...by[sort], { id: order }];
  }

  async audit(query: {
    action?: string;
    outcome?: string;
    userId?: number;
    ip?: string;
    sort?: AuditSort;
    order?: SortOrder;
    page?: number;
    limit?: number;
  }) {
    const { take, current, skip } = paginate(query.page, query.limit, 200);
    const escape = (text: string) => text.replace(/[\\%_]/g, (c) => `\\${c}`);
    const conditions: Prisma.Sql[] = [];
    if (query.action)
      conditions.push(Prisma.sql`a.action LIKE ${`${escape(query.action)}%`}`);
    if (
      query.outcome &&
      ['success', 'failure', 'blocked'].includes(query.outcome)
    )
      conditions.push(Prisma.sql`a.outcome = ${query.outcome}`);
    if (query.userId) conditions.push(Prisma.sql`a."userId" = ${query.userId}`);
    if (query.ip)
      conditions.push(
        Prisma.sql`a."ipAddress" ILIKE ${`%${escape(query.ip)}%`}`,
      );
    const where = conditions.length
      ? Prisma.sql`WHERE ${Prisma.join(conditions, ' AND ')}`
      : Prisma.empty;
    const column: Record<AuditSort, Prisma.Sql> = {
      createdAt: Prisma.sql`a."createdAt"`,
      action: Prisma.sql`a.action`,
      outcome: Prisma.sql`a.outcome`,
      account: Prisma.sql`lower(u.email)`,
      ip: Prisma.sql`a."ipAddress"`,
      client: Prisma.sql`a."userAgent"`,
    };
    const direction =
      query.order === 'asc' ? Prisma.sql`ASC` : Prisma.sql`DESC`;
    type Row = {
      id: number;
      userId: number | null;
      action: string;
      resource: string | null;
      resourceId: string | null;
      outcome: string;
      ipAddress: string | null;
      userAgent: string | null;
      createdAt: Date;
      email: string | null;
      targetEmail: string | null;
    };
    const [rows, total, actions] = await Promise.all([
      this.db.$queryRaw<Row[]>(Prisma.sql`
        SELECT a.id, a."userId", a.action, a.resource, a."resourceId", a.outcome, a."ipAddress", a."userAgent", a."createdAt", u.email, t.email AS "targetEmail"
        FROM audit_logs a
        LEFT JOIN users u ON u.id = a."userId"
        LEFT JOIN users t ON a.resource = 'user' AND t.id::text = a."resourceId"
        ${where}
        ORDER BY ${column[query.sort ?? 'createdAt']} ${direction} NULLS LAST, a.id ${direction}
        LIMIT ${take} OFFSET ${skip}`),
      this.db.$queryRaw<{ count: bigint }[]>(
        Prisma.sql`SELECT count(*) AS count FROM audit_logs a ${where}`,
      ),
      this.db.auditLog.groupBy({
        by: ['action'],
        _count: { _all: true },
        orderBy: { _count: { action: 'desc' } },
        take: 50,
      }),
    ]);
    return {
      data: rows.map(({ resourceId, targetEmail, ...r }) => ({
        ...r,
        country: countryOf(r.ipAddress),
        // The account an operator acted on, for events about an account rather than by it.
        target:
          r.resource === 'user' && resourceId && /^\d+$/.test(resourceId)
            ? { id: Number(resourceId), email: targetEmail }
            : null,
      })),
      meta: meta(Number(total[0]?.count ?? 0), current, take),
      actions: actions.map((a) => ({ action: a.action, count: a._count._all })),
    };
  }

  /** Subscriptions and money: what is being paid, by how many, and what came in each month. Amounts are in the smallest unit of the currency (cents). */
  async billing(months = 12) {
    const since = new Date(
      Date.UTC(
        new Date().getUTCFullYear(),
        new Date().getUTCMonth() - (months - 1),
        1,
      ),
    );
    const now = Date.now();
    const [byStatus, ending, plans, perMonth, last30, allTime, failed30] =
      await Promise.all([
        this.db.subscription.groupBy({
          by: ['status'],
          _count: { _all: true },
        }),
        this.db.subscription.count({
          where: { status: 'active', cancelAtPeriodEnd: true },
        }),
        this.db.user.groupBy({
          by: ['subscriptionType'],
          where: { accountStatus: 'active' },
          _count: { _all: true },
        }),
        this.db.$queryRaw<
          {
            month: string;
            currency: string;
            amount: bigint | number | null;
            payments: bigint;
          }[]
        >(
          Prisma.sql`SELECT to_char(date_trunc('month', "createdAt"), 'YYYY-MM') AS month, lower(currency) AS currency, sum(amount) AS amount, count(*) AS payments FROM payments WHERE status = 'succeeded' AND "createdAt" >= ${since} GROUP BY 1, 2 ORDER BY 1`,
        ),
        this.db.payment.aggregate({
          where: {
            status: 'succeeded',
            createdAt: { gte: new Date(now - 30 * DAY) },
          },
          _sum: { amount: true },
          _count: { _all: true },
        }),
        this.db.payment.aggregate({
          where: { status: 'succeeded' },
          _sum: { amount: true },
          _count: { _all: true },
        }),
        this.db.payment.count({
          where: {
            status: { not: 'succeeded' },
            createdAt: { gte: new Date(now - 30 * DAY) },
          },
        }),
      ]);
    // One currency is charted: the one most money came in. Others, if any, are listed beside it rather than added to it.
    const totals = new Map<string, number>();
    for (const row of perMonth)
      totals.set(
        row.currency,
        (totals.get(row.currency) ?? 0) + Number(row.amount ?? 0),
      );
    const currency = [...totals].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'usd';
    const series = Array.from({ length: months }, (_, i) => {
      const key = MONTH_KEY(
        new Date(Date.UTC(since.getUTCFullYear(), since.getUTCMonth() + i, 1)),
      );
      const row = perMonth.find(
        (r) => r.month === key && r.currency === currency,
      );
      return { day: key, count: Number(row?.amount ?? 0) };
    });
    return {
      currency,
      otherCurrencies: [...totals]
        .filter(([c]) => c !== currency)
        .map(([c, amount]) => ({ currency: c, amount })),
      subscriptions: Object.fromEntries(
        byStatus.map((s) => [s.status, s._count._all]),
      ),
      endingAtPeriodEnd: ending,
      plans: Object.fromEntries(
        plans.map((p) => [p.subscriptionType, p._count._all]),
      ),
      revenue: {
        last30: {
          amount: last30._sum.amount ?? 0,
          payments: last30._count._all,
        },
        allTime: {
          amount: allTime._sum.amount ?? 0,
          payments: allTime._count._all,
        },
        failed30,
      },
      perMonth: series,
    };
  }

  /** Every payment, newest first by default, with the account it came from. */
  async payments(query: {
    status?: string;
    search?: string;
    sort?: PaymentSort;
    order?: SortOrder;
    page?: number;
    limit?: number;
  }) {
    const { take, current, skip } = paginate(query.page, query.limit);
    const conditions: Prisma.Sql[] = [];
    if (query.status === 'succeeded')
      conditions.push(Prisma.sql`p.status = 'succeeded'`);
    else if (query.status === 'other')
      conditions.push(Prisma.sql`p.status <> 'succeeded'`);
    const search = query.search?.trim();
    if (search)
      conditions.push(
        Prisma.sql`(u.email ILIKE ${`%${search.replace(/[\\%_]/g, (c) => `\\${c}`)}%`}${/^\d+$/.test(search) ? Prisma.sql` OR u.id = ${Number(search)}` : Prisma.empty})`,
      );
    const where = conditions.length
      ? Prisma.sql`WHERE ${Prisma.join(conditions, ' AND ')}`
      : Prisma.empty;
    const column: Record<PaymentSort, Prisma.Sql> = {
      createdAt: Prisma.sql`p."createdAt"`,
      account: Prisma.sql`lower(u.email)`,
      plan: Prisma.sql`u."subscriptionType"`,
      status: Prisma.sql`p.status`,
      amount: Prisma.sql`p.amount`,
    };
    const direction =
      query.order === 'asc' ? Prisma.sql`ASC` : Prisma.sql`DESC`;
    type Row = {
      id: number;
      userId: number;
      amount: number;
      currency: string;
      status: string;
      createdAt: Date;
      email: string;
      name: string;
      plan: string;
    };
    const [rows, total] = await Promise.all([
      this.db.$queryRaw<Row[]>(Prisma.sql`
        SELECT p.id, p."userId", p.amount, p.currency, p.status, p."createdAt", u.email, u.name, u."subscriptionType"::text AS plan
        FROM payments p JOIN users u ON u.id = p."userId"
        ${where}
        ORDER BY ${column[query.sort ?? 'createdAt']} ${direction} NULLS LAST, p.id ${direction}
        LIMIT ${take} OFFSET ${skip}`),
      this.db.$queryRaw<{ count: bigint }[]>(
        Prisma.sql`SELECT count(*) AS count FROM payments p JOIN users u ON u.id = p."userId" ${where}`,
      ),
    ]);
    return {
      data: rows,
      meta: meta(Number(total[0]?.count ?? 0), current, take),
    };
  }

  /** Uploaded bytes: how much of each kind, what was added each day, and the accounts that hold the most. Sizes only; no file is opened or named. */
  async storage(days = 30) {
    const [pdfs, snips, files, pdfPerDay, snipPerDay, filePerDay, largest] =
      await Promise.all([
        this.db.pDF.aggregate({
          _sum: { fileSize: true },
          _count: { _all: true },
        }),
        this.db.snip.aggregate({
          _sum: { fileSize: true },
          _count: { _all: true },
        }),
        this.db.projectFile.aggregate({
          where: { filePath: { not: null } },
          _sum: { size: true },
          _count: { _all: true },
        }),
        this.perDay(
          Prisma.sql`pdfs`,
          days,
          Prisma.empty,
          Prisma.sql`coalesce(sum("fileSize"), 0)`,
        ),
        this.perDay(
          Prisma.sql`snips`,
          days,
          Prisma.empty,
          Prisma.sql`coalesce(sum("fileSize"), 0)`,
        ),
        this.perDay(
          Prisma.sql`project_files`,
          days,
          Prisma.sql`AND "filePath" IS NOT NULL`,
          Prisma.sql`coalesce(sum(size), 0)`,
        ),
        this.db.$queryRaw<
          {
            id: number;
            email: string;
            name: string;
            plan: string;
            status: string;
            pdfBytes: bigint;
            snipBytes: bigint;
            projectBytes: bigint;
            files: bigint;
          }[]
        >(Prisma.sql`
        SELECT u.id, u.email, u.name, u."subscriptionType"::text AS plan, u."accountStatus"::text AS status,
          coalesce(d.bytes, 0) AS "pdfBytes", coalesce(s.bytes, 0) AS "snipBytes", coalesce(f.bytes, 0) AS "projectBytes",
          coalesce(d.n, 0) + coalesce(s.n, 0) + coalesce(f.n, 0) AS files
        FROM users u
        LEFT JOIN (SELECT "userId", sum("fileSize") AS bytes, count(*) AS n FROM pdfs GROUP BY 1) d ON d."userId" = u.id
        LEFT JOIN (SELECT "userId", sum("fileSize") AS bytes, count(*) AS n FROM snips GROUP BY 1) s ON s."userId" = u.id
        LEFT JOIN (SELECT p."userId", sum(f.size) AS bytes, count(*) AS n FROM project_files f JOIN projects p ON p.id = f."projectId" WHERE f."filePath" IS NOT NULL GROUP BY 1) f ON f."userId" = u.id
        WHERE coalesce(d.bytes, 0) + coalesce(s.bytes, 0) + coalesce(f.bytes, 0) > 0
        ORDER BY coalesce(d.bytes, 0) + coalesce(s.bytes, 0) + coalesce(f.bytes, 0) DESC, u.id
        LIMIT 25`),
      ]);
    const pdfBytes = pdfs._sum.fileSize ?? 0;
    const snipBytes = snips._sum.fileSize ?? 0;
    const projectBytes = files._sum.size ?? 0;
    const added = (series: DayCount[]) =>
      series.reduce((sum, d) => sum + d.count, 0);
    return {
      days,
      totals: {
        bytes: pdfBytes + snipBytes + projectBytes,
        pdf: { bytes: pdfBytes, files: pdfs._count._all },
        snip: { bytes: snipBytes, files: snips._count._all },
        project: { bytes: projectBytes, files: files._count._all },
        addedInRange: added(pdfPerDay) + added(snipPerDay) + added(filePerDay),
      },
      series: { pdf: pdfPerDay, snip: snipPerDay, project: filePerDay },
      largest: largest.map((r) => {
        const pdf = Number(r.pdfBytes);
        const snip = Number(r.snipBytes);
        const project = Number(r.projectBytes);
        return {
          userId: r.id,
          email: r.email,
          name: r.name,
          plan: r.plan,
          status: r.status,
          pdfBytes: pdf,
          snipBytes: snip,
          projectBytes: project,
          totalBytes: pdf + snip + project,
          files: Number(r.files),
        };
      }),
    };
  }

  /** How much is being made: projects, files, snips, and PDFs, as counts. Nothing here reads a title or a file's contents. */
  async content(days = 30) {
    const [
      projects,
      archived,
      references,
      files,
      folders,
      shared,
      linked,
      collaborators,
      invitations,
      templates,
      publicTemplates,
      snips,
      pdfs,
      pdfPages,
      byAccess,
      snipStatus,
      pdfStatus,
      projectsPerDay,
      filesPerDay,
      snipsPerDay,
      pdfsPerDay,
    ] = await Promise.all([
      this.db.project.count({ where: { referenceOfId: null } }),
      this.db.project.count({ where: { referenceOfId: null, archived: true } }),
      this.db.project.count({ where: { referenceOfId: { not: null } } }),
      this.db.projectFile.count({ where: { isFolder: false } }),
      this.db.projectFile.count({ where: { isFolder: true } }),
      this.db.project.count({
        where: { referenceOfId: null, collaborators: { some: {} } },
      }),
      this.db.projectGitHubLink.count(),
      this.db.projectCollaborator.count(),
      this.db.projectInvitation.count({ where: { status: 'pending' } }),
      this.db.template.count(),
      this.db.template.count({ where: { isPublic: true } }),
      this.db.snip.count(),
      this.db.pDF.count(),
      this.db.pDF.aggregate({ _sum: { pageCount: true } }),
      this.db.project.groupBy({
        by: ['access'],
        where: { referenceOfId: null },
        _count: { _all: true },
      }),
      this.db.snip.groupBy({ by: ['status'], _count: { _all: true } }),
      this.db.pDF.groupBy({ by: ['status'], _count: { _all: true } }),
      this.perDay(
        Prisma.sql`projects`,
        days,
        Prisma.sql`AND "referenceOfId" IS NULL`,
      ),
      this.perDay(
        Prisma.sql`project_files`,
        days,
        Prisma.sql`AND "isFolder" = false`,
      ),
      this.perDay(Prisma.sql`snips`, days),
      this.perDay(Prisma.sql`pdfs`, days),
    ]);
    const tally = (
      rows: { _count: { _all: number } }[],
      key: (row: any) => string,
    ) => rows.map((r) => ({ name: key(r), count: r._count._all }));
    return {
      days,
      totals: {
        projects,
        archived,
        references,
        files,
        folders,
        shared,
        githubLinked: linked,
        collaborators,
        pendingInvitations: invitations,
        templates,
        publicTemplates,
        snips,
        pdfs,
        pdfPages: pdfPages._sum.pageCount ?? 0,
      },
      projectAccess: tally(byAccess, (r) => r.access),
      snipStatus: tally(snipStatus, (r) => r.status),
      pdfStatus: tally(pdfStatus, (r) => r.status),
      series: {
        projects: projectsPerDay,
        files: filesPerDay,
        snips: snipsPerDay,
        pdfs: pdfsPerDay,
      },
    };
  }

  async ai(days = 30) {
    const since = new Date(Date.now() - (days - 1) * DAY);
    since.setUTCHours(0, 0, 0, 0);
    const window = { createdAt: { gte: since } };
    const [
      totals,
      byKind,
      byModel,
      failures,
      top,
      requestsPerDay,
      tokensPerDay,
      usersPerDay,
    ] = await Promise.all([
      this.db.aiUsage.aggregate({
        where: window,
        _sum: {
          requests: true,
          inputTokens: true,
          outputTokens: true,
          audioBytes: true,
        },
        _count: { _all: true },
        _avg: { durationMs: true },
      }),
      this.db.aiUsage.groupBy({
        by: ['kind'],
        where: window,
        _sum: {
          requests: true,
          inputTokens: true,
          outputTokens: true,
          audioBytes: true,
        },
        _count: { _all: true },
      }),
      this.db.aiUsage.groupBy({
        by: ['provider', 'model'],
        where: window,
        _sum: { requests: true, inputTokens: true, outputTokens: true },
        _count: { _all: true },
      }),
      this.db.aiUsage.count({ where: { ...window, ok: false } }),
      this.db.aiUsage.groupBy({
        by: ['userId'],
        where: window,
        _sum: { requests: true, inputTokens: true, outputTokens: true },
        _count: { _all: true },
        orderBy: { _sum: { inputTokens: 'desc' } },
        take: 20,
      }),
      this.perDay(
        Prisma.sql`ai_usage`,
        days,
        Prisma.empty,
        Prisma.sql`coalesce(sum(requests), 0)`,
      ),
      this.perDay(
        Prisma.sql`ai_usage`,
        days,
        Prisma.empty,
        Prisma.sql`coalesce(sum("inputTokens" + "outputTokens"), 0)`,
      ),
      this.perDay(
        Prisma.sql`ai_usage`,
        days,
        Prisma.empty,
        Prisma.sql`count(DISTINCT "userId")`,
      ),
    ]);
    const people = top.length
      ? await this.db.user.findMany({
          where: { id: { in: top.map((t) => t.userId) } },
          select: { id: true, email: true, name: true, subscriptionType: true },
        })
      : [];
    const personOf = new Map(people.map((p) => [p.id, p]));
    return {
      days,
      totals: {
        calls: totals._count._all,
        failures,
        requests: totals._sum.requests ?? 0,
        inputTokens: totals._sum.inputTokens ?? 0,
        outputTokens: totals._sum.outputTokens ?? 0,
        audioBytes: totals._sum.audioBytes ?? 0,
        averageMs: Math.round(totals._avg.durationMs ?? 0),
      },
      byKind: byKind.map((k) => ({
        kind: k.kind,
        calls: k._count._all,
        requests: k._sum.requests ?? 0,
        inputTokens: k._sum.inputTokens ?? 0,
        outputTokens: k._sum.outputTokens ?? 0,
        audioBytes: k._sum.audioBytes ?? 0,
      })),
      byModel: byModel
        .map((m) => ({
          provider: m.provider,
          model: m.model,
          calls: m._count._all,
          requests: m._sum.requests ?? 0,
          inputTokens: m._sum.inputTokens ?? 0,
          outputTokens: m._sum.outputTokens ?? 0,
        }))
        .sort((a, b) => b.calls - a.calls),
      topUsers: top.map((t) => ({
        userId: t.userId,
        email: personOf.get(t.userId)?.email ?? null,
        name: personOf.get(t.userId)?.name ?? null,
        plan: personOf.get(t.userId)?.subscriptionType ?? null,
        calls: t._count._all,
        requests: t._sum.requests ?? 0,
        inputTokens: t._sum.inputTokens ?? 0,
        outputTokens: t._sum.outputTokens ?? 0,
      })),
      series: {
        requests: requestsPerDay,
        tokens: tokensPerDay,
        users: usersPerDay,
      },
    };
  }

  /** How the running system is doing right now. Each check is timed and none can hang the page. */
  async system() {
    const timed = async <T>(
      run: () => Promise<T>,
      timeoutMs = 4000,
    ): Promise<{ ok: boolean; ms: number; value?: T; error?: string }> => {
      const started = Date.now();
      try {
        const value = await Promise.race([
          run(),
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error('Timed out')), timeoutMs).unref(),
          ),
        ]);
        return { ok: true, ms: Date.now() - started, value };
      } catch (err) {
        return {
          ok: false,
          ms: Date.now() - started,
          error: err instanceof Error ? err.message : String(err),
        };
      }
    };

    const compilerUrl = this.compilerUrl();
    const [database, redis, compiler, size] = await Promise.all([
      timed(() => this.db.$queryRaw`SELECT 1`),
      timed(async () => {
        if (!this.redis.isConnected)
          throw new Error(
            'Not connected: the API is using its in-memory fallback',
          );
        const client = this.redis.getClient();
        const [info, keys] = await Promise.all([
          client.info('memory'),
          client.dbsize(),
        ]);
        const read = (name: string) =>
          Number(new RegExp(`^${name}:(\\d+)`, 'm').exec(info)?.[1] ?? 0);
        return {
          usedBytes: read('used_memory'),
          peakBytes: read('used_memory_peak'),
          maxBytes: read('maxmemory'),
          keys,
        };
      }),
      timed(async () => {
        if (!compilerUrl)
          throw new Error('Neither DOMAIN_NAME nor COMPILER_URL is set');
        const response = await fetch(`${compilerUrl}/health`, {
          signal: AbortSignal.timeout(3500),
        });
        if (!response.ok) throw new Error(`Answered ${response.status}`);
        const body = (await response.json()) as Record<string, unknown>;
        return {
          engines: body.engines ?? null,
          active: body.active ?? null,
          queued: body.queued ?? null,
          capacity: body.capacity ?? null,
        };
      }),
      timed(
        () =>
          this.db.$queryRaw<
            { bytes: bigint }[]
          >`SELECT pg_database_size(current_database()) AS bytes`,
      ),
    ]);

    const memory = process.memoryUsage();
    return {
      generatedAt: new Date().toISOString(),
      api: {
        version: VERSION,
        node: process.version,
        environment: process.env.NODE_ENV || 'development',
        startedAt: startedAt.toISOString(),
        uptimeSeconds: Math.round(process.uptime()),
        memory: {
          rssBytes: memory.rss,
          heapUsedBytes: memory.heapUsed,
          heapTotalBytes: memory.heapTotal,
        },
        eventLoop: eventLoopDelay(),
      },
      database: {
        ok: database.ok,
        ms: database.ms,
        error: database.error,
        pool: this.prisma.getPoolStats(),
        sizeBytes: size.ok ? Number(size.value?.[0]?.bytes ?? 0) : null,
      },
      redis: {
        ok: redis.ok,
        ms: redis.ms,
        error: redis.error,
        ...(redis.value ?? {}),
      },
      compiler: {
        ok: compiler.ok,
        ms: compiler.ms,
        error: compiler.error,
        ...(compiler.value ?? {}),
      },
      collaboration: collabStats(),
    };
  }

  private compilerUrl(): string | null {
    return siteUrls().compiler || null;
  }
}
