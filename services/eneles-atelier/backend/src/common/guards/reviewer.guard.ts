import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service';

/** Whether this account may approve shared templates. */
export async function isTemplateReviewer(
  config: ConfigService,
  prisma: PrismaService,
  userId: unknown,
): Promise<boolean> {
  const reviewers = (config.get<string>('REVIEWER_EMAILS') ?? '')
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  if (!reviewers.length || typeof userId !== 'number') return false;
  const user = await prisma.client.user.findUnique({
    where: { id: userId },
    select: { email: true, accountStatus: true },
  });
  return !!user && user.accountStatus === 'active' && reviewers.includes(user.email.toLowerCase());
}

/**
 * Lets through only the people listed in REVIEWER_EMAILS (comma-separated):
 * the ones who approve shared templates. Unset means nobody, so a missing
 * setting never opens the review routes.
 */
@Injectable()
export class ReviewerGuard implements CanActivate {
  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const userId = context.switchToHttp().getRequest().user?.sub;
    if (await isTemplateReviewer(this.config, this.prisma, userId)) return true;
    throw new ForbiddenException('Only template reviewers can do this');
  }
}
