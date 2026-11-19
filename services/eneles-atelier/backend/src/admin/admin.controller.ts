import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  HttpException,
  Param,
  ParseIntPipe,
  Post,
  Put,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { AuditService } from '../audit/audit.service';
import { PlatformAiService } from '../ai/platform-ai.service';
import { EMAIL_STATUSES } from '../email/email-events';
import { AdminActionsService, type Actor } from './admin-actions.service';
import { AdminGuard } from './admin.guard';
import {
  AUDIT_SORTS,
  AdminService,
  PAYMENT_SORTS,
  SESSION_SORTS,
  USER_SORTS,
  oneOf,
} from './admin.service';

type AdminRequest = Request & { admin: Actor };

const int = (value: unknown, fallback: number, min: number, max: number) => {
  const n = Number(value);
  return Number.isFinite(n)
    ? Math.min(Math.max(Math.floor(n), min), max)
    : fallback;
};

/**
 * The operators' panel. Every route needs a signed-in session (an API key is refused for `/admin` by the global guard) and passes `AdminGuard`.
 *
 * Opening one person's account, and every change made to one, is written to the audit log with the operator who did it, so "who looked at this account?" and "who disabled it?" always have an answer. A change that was refused is logged too, as blocked. Who may make which change is set out in `AdminActionsService`.
 */
@UseGuards(AdminGuard)
@Controller('admin')
export class AdminController {
  constructor(
    private readonly admin: AdminService,
    private readonly actions: AdminActionsService,
    private readonly audit: AuditService,
    private readonly platformAi: PlatformAiService,
  ) {}

  /** Runs one change to account `id` and writes it to the audit log, as done or as refused. */
  private async change<T>(
    request: AdminRequest,
    id: number,
    action: string,
    run: () => Promise<T>,
    details?: (result: T) => Record<string, unknown>,
  ): Promise<T> {
    const entry = {
      userId: request.admin.id,
      action,
      resource: 'user',
      resourceId: String(id),
      ipAddress: request.ip,
      userAgent: request.headers['user-agent'],
    };
    try {
      const result = await run();
      void this.audit.log({ ...entry, metadata: details?.(result) });
      return result;
    } catch (err) {
      if (err instanceof HttpException && err.getStatus() < 500)
        void this.audit.log({
          ...entry,
          outcome: 'blocked',
          metadata: { reason: err.message },
        });
      throw err;
    }
  }

  /** Who is signed in, if they are an operator. The panel calls this first. */
  @Get('me')
  me(@Req() request: AdminRequest) {
    return request.admin;
  }

  @Get('overview')
  overview(@Query('days') days?: string) {
    return this.admin.overview(int(days, 30, 7, 365));
  }

  @Get('users')
  users(
    @Query('search') search?: string,
    @Query('plan') plan?: string,
    @Query('status') status?: string,
    @Query('sort') sort?: string,
    @Query('order') order?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.admin.users({
      search: search?.slice(0, 120),
      plan,
      status,
      sort: oneOf(USER_SORTS, sort),
      order: order === 'asc' ? 'asc' : 'desc',
      page: int(page, 1, 1, 1_000_000),
      limit: int(limit, 25, 1, 100),
    });
  }

  @Get('users/:id')
  async user(
    @Param('id', ParseIntPipe) id: number,
    @Req() request: AdminRequest,
  ) {
    const result = await this.admin.user(id);
    void this.audit.log({
      userId: request.admin.id,
      action: 'admin.user.view',
      resource: 'user',
      resourceId: String(id),
      ipAddress: request.ip,
      userAgent: request.headers['user-agent'],
    });
    return result;
  }

  /** Give or take the administrator flag. Only the root account may, and never for itself: its access comes from the environment, not the flag. */
  @Put('users/:id/admin')
  async setAdmin(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: { isAdmin?: unknown },
    @Req() request: AdminRequest,
  ) {
    if (!request.admin.root)
      throw new ForbiddenException(
        'Only the root administrator can change who is an administrator',
      );
    if (id === request.admin.id)
      throw new ForbiddenException(
        'The root administrator is always an administrator',
      );
    const isAdmin = body?.isAdmin === true;
    const result = await this.admin.setAdmin(id, isAdmin);
    void this.audit.log({
      userId: request.admin.id,
      action: isAdmin ? 'admin.grant' : 'admin.revoke',
      resource: 'user',
      resourceId: String(id),
      ipAddress: request.ip,
      userAgent: request.headers['user-agent'],
    });
    return result;
  }

  /** Disable (`suspended`) or enable (`active`) an account. A disabled account cannot sign in, and its sessions end at once. */
  @Put('users/:id/status')
  setStatus(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: { status?: unknown },
    @Req() request: AdminRequest,
  ) {
    const suspended = body?.status === 'suspended';
    if (!suspended && body?.status !== 'active')
      throw new HttpException(
        'The status must be "active" or "suspended".',
        400,
      );
    return this.change(
      request,
      id,
      suspended ? 'admin.user.suspend' : 'admin.user.enable',
      () => this.actions.setStatus(request.admin, id, suspended),
      (r) => ({ sessionsEnded: r.sessionsEnded }),
    );
  }

  @Post('users/:id/sign-out')
  signOut(@Param('id', ParseIntPipe) id: number, @Req() request: AdminRequest) {
    return this.change(
      request,
      id,
      'admin.user.sign_out',
      () => this.actions.signOutEverywhere(request.admin, id),
      (r) => ({ sessionsEnded: r.sessionsEnded }),
    );
  }

  @Post('users/:id/verify')
  verify(@Param('id', ParseIntPipe) id: number, @Req() request: AdminRequest) {
    return this.change(request, id, 'admin.user.verify', () =>
      this.actions.markVerified(request.admin, id),
    );
  }

  @Delete('users/:id/two-factor')
  twoFactorOff(
    @Param('id', ParseIntPipe) id: number,
    @Req() request: AdminRequest,
  ) {
    return this.change(request, id, 'admin.user.two_factor_off', () =>
      this.actions.disableTwoFactor(request.admin, id),
    );
  }

  /** The plan on the account, as a courtesy. Stripe is not told. */
  @Put('users/:id/plan')
  setPlan(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: { plan?: unknown },
    @Req() request: AdminRequest,
  ) {
    return this.change(
      request,
      id,
      'admin.user.plan',
      () => this.actions.setPlan(request.admin, id, body?.plan),
      (r) => ({ from: r.from, to: r.to }),
    );
  }

  /** Root only. */
  @Put('users/:id/email')
  changeEmail(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: { email?: unknown },
    @Req() request: AdminRequest,
  ) {
    return this.change(
      request,
      id,
      'admin.user.email',
      () => this.actions.changeEmail(request.admin, id, body?.email),
      (r) => ({ from: r.from, to: r.to, sessionsEnded: r.sessionsEnded }),
    );
  }

  /** Root only. The body must repeat the account's email address. */
  @Delete('users/:id')
  remove(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: { confirmEmail?: unknown },
    @Req() request: AdminRequest,
  ) {
    return this.change(
      request,
      id,
      'admin.user.delete',
      () => this.actions.remove(request.admin, id, body?.confirmEmail),
      (r) => ({ sessionsEnded: r.sessionsEnded }),
    );
  }

  @Get('sessions')
  sessions(
    @Query('live') live?: string,
    @Query('search') search?: string,
    @Query('sort') sort?: string,
    @Query('order') order?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.admin.sessions({
      live: live === '1' || live === 'true',
      search: search?.slice(0, 120),
      sort: oneOf(SESSION_SORTS, sort),
      order: order === 'asc' ? 'asc' : 'desc',
      page: int(page, 1, 1, 1_000_000),
      limit: int(limit, 50, 1, 100),
    });
  }

  @Get('audit')
  auditLog(
    @Query('action') action?: string,
    @Query('outcome') outcome?: string,
    @Query('userId') userId?: string,
    @Query('ip') ip?: string,
    @Query('sort') sort?: string,
    @Query('order') order?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.admin.audit({
      sort: oneOf(AUDIT_SORTS, sort),
      order: order === 'asc' ? 'asc' : 'desc',
      action: action?.slice(0, 60),
      outcome,
      userId: userId && /^\d+$/.test(userId) ? Number(userId) : undefined,
      ip: ip?.slice(0, 60),
      page: int(page, 1, 1, 1_000_000),
      limit: int(limit, 50, 1, 200),
    });
  }

  @Get('billing')
  billing(@Query('months') months?: string) {
    return this.admin.billing(int(months, 12, 3, 36));
  }

  @Get('payments')
  payments(
    @Query('status') status?: string,
    @Query('search') search?: string,
    @Query('sort') sort?: string,
    @Query('order') order?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.admin.payments({
      status: status === 'succeeded' || status === 'other' ? status : undefined,
      search: search?.slice(0, 120),
      sort: oneOf(PAYMENT_SORTS, sort),
      order: order === 'asc' ? 'asc' : 'desc',
      page: int(page, 1, 1, 1_000_000),
      limit: int(limit, 25, 1, 100),
    });
  }

  @Get('storage')
  storage(@Query('days') days?: string) {
    return this.admin.storage(int(days, 30, 7, 365));
  }

  @Get('content')
  content(@Query('days') days?: string) {
    return this.admin.content(int(days, 30, 7, 365));
  }

  @Get('ai')
  ai(@Query('days') days?: string) {
    return this.admin.ai(int(days, 30, 7, 365));
  }

  @Get('emails')
  emails(
    @Query('days') days?: string,
    @Query('status') status?: string,
    @Query('kind') kind?: string,
    @Query('search') search?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.admin.emails({
      days: int(days, 30, 7, 365),
      status: status && EMAIL_STATUSES.includes(status) ? status : undefined,
      kind: kind?.slice(0, 40) || undefined,
      search: search?.slice(0, 200),
      page: int(page, 1, 1, 1_000_000),
      limit: int(limit, 50, 1, 100),
    });
  }

  @Get('emails/:id')
  email(@Param('id', ParseIntPipe) id: number) {
    return this.admin.email(id);
  }

  @Get('system')
  system() {
    return this.admin.system();
  }

  /** Platform AI: whether subscribers may use the platform's own model keys. Any operator can read it. */
  @Get('platform-ai')
  platformAiState() {
    return this.platformAi.state();
  }

  /** Root only: turns Platform AI on or off. Written to the audit log. */
  @Put('platform-ai')
  async setPlatformAi(
    @Req() request: AdminRequest,
    @Body() body: { enabled?: unknown },
  ) {
    const entry = {
      userId: request.admin.id,
      action: 'platform_ai.update',
      resource: 'platform',
      resourceId: 'platform_ai',
      ipAddress: request.ip,
      userAgent: request.headers['user-agent'],
    };
    if (!request.admin.root) {
      void this.audit.log({
        ...entry,
        outcome: 'blocked',
        metadata: { reason: 'not root' },
      });
      throw new ForbiddenException(
        'Only the root administrator can turn Platform AI on or off',
      );
    }
    if (typeof body?.enabled !== 'boolean')
      throw new HttpException(
        'Send { enabled: true } or { enabled: false }',
        400,
      );
    const state = await this.platformAi.setEnabled(
      body.enabled,
      request.admin.id,
    );
    void this.audit.log({ ...entry, metadata: { enabled: body.enabled } });
    return state;
  }
}
