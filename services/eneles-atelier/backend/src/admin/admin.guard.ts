import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { RootAdmin } from './root-admin';

/**
 * Lets through only administrators: accounts whose `isAdmin` flag is on, and the root account (ADMIN_EMAIL).
 *
 * - The flag is off for everyone by default. Only the root account can turn it on from the panel; it can also be set by hand in the database. No route lets an account change its own.
 * - The global guard has already required a signed-in session; API keys are refused for `/admin` there.
 * - The account must be active and verified. The flag is read from the database on every request, so taking it away takes effect at once.
 */
@Injectable()
export class AdminGuard implements CanActivate {
  constructor(
    private readonly prisma: PrismaService,
    private readonly root: RootAdmin,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const userId = request.user?.sub;
    if (typeof userId !== 'number')
      throw new ForbiddenException('This account is not an administrator');
    const user = await this.prisma.client.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        name: true,
        accountStatus: true,
        verified: true,
        isAdmin: true,
      },
    });
    const root = this.root.isRoot(user?.email);
    if (
      !user ||
      user.accountStatus !== 'active' ||
      !user.verified ||
      !(user.isAdmin || root)
    ) {
      throw new ForbiddenException('This account is not an administrator');
    }
    request.admin = { id: user.id, email: user.email, name: user.name, root };
    return true;
  }
}
