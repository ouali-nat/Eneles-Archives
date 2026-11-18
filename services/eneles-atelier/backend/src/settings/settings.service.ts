import { BadRequestException, Injectable, NotFoundException, Inject, forwardRef } from '@nestjs/common';
import { AuthService } from '../auth/auth.service';
import { PrismaService } from '../prisma/prisma.service';
import * as speakeasy from 'speakeasy';

@Injectable()
export class SettingsService {
  constructor(
    private prisma: PrismaService,
    @Inject(forwardRef(() => AuthService)) private authService: AuthService,
  ) {}

  // Appearance Settings
  // Settings array format: [theme]
  async getAppearanceSettings(userId: number) {
    const user = await this.prisma.client.user.findUnique({
      where: { id: userId },
      select: { settings: true },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    const settings = user.settings as any[];
    return {
      theme: settings[0] || 'system',
    };
  }

  async updateAppearanceSettings(
    userId: number,
    data: {
      theme?: string;
    },
  ) {
    const current = await this.getAppearanceSettings(userId);

    const newSettings = [data.theme !== undefined ? data.theme : current.theme];

    await this.prisma.client.user.update({
      where: { id: userId },
      data: { settings: newSettings },
    });

    return {
      theme: newSettings[0],
    };
  }

  // Notification Settings
  // notificationSettings array format: [notifyLowCredits, notifyCompletedJobs, emailNotifications, marketingEmails, securityAlerts]
  async getNotificationSettings(userId: number) {
    const user = await this.prisma.client.user.findUnique({
      where: { id: userId },
      select: { notificationSettings: true },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    const settings = user.notificationSettings as any[];
    return {
      notifyLowCredits: settings[0] ?? true,
      notifyCompletedJobs: settings[1] ?? true,
      emailNotifications: settings[2] ?? true,
      marketingEmails: settings[3] ?? false,
      securityAlerts: settings[4] ?? true,
    };
  }

  async updateNotificationSettings(
    userId: number,
    data: {
      notifyLowCredits?: boolean;
      notifyCompletedJobs?: boolean;
      emailNotifications?: boolean;
      marketingEmails?: boolean;
      securityAlerts?: boolean;
    },
  ) {
    const current = await this.getNotificationSettings(userId);

    const newSettings = [
      data.notifyLowCredits !== undefined
        ? data.notifyLowCredits
        : current.notifyLowCredits,
      data.notifyCompletedJobs !== undefined
        ? data.notifyCompletedJobs
        : current.notifyCompletedJobs,
      data.emailNotifications !== undefined
        ? data.emailNotifications
        : current.emailNotifications,
      data.marketingEmails !== undefined
        ? data.marketingEmails
        : current.marketingEmails,
      data.securityAlerts !== undefined
        ? data.securityAlerts
        : current.securityAlerts,
    ];

    await this.prisma.client.user.update({
      where: { id: userId },
      data: { notificationSettings: newSettings },
    });

    return {
      notifyLowCredits: newSettings[0],
      notifyCompletedJobs: newSettings[1],
      emailNotifications: newSettings[2],
      marketingEmails: newSettings[3],
      securityAlerts: newSettings[4],
    };
  }

  // Sessions (Active Devices)
  /**
   * The user's sessions, most recently active first, in the paginated shape
   * every list endpoint returns. The session token never leaves the server.
   */
  async getSessions(userId: number, page = 1, limit = 50, currentToken?: string) {
    const take = Math.min(Math.max(limit, 1), 100);
    const skip = (Math.max(page, 1) - 1) * take;
    // Signed-in devices only: a session that was signed out or has expired is not a device anyone can still use.
    const where = { userId, isActive: true, expiresAt: { gt: new Date() } };
    const [rows, total] = await Promise.all([
      this.prisma.client.session.findMany({
        where,
        orderBy: { lastActive: 'desc' },
        skip,
        take,
        select: {
          id: true,
          deviceType: true,
          browser: true,
          os: true,
          ipAddress: true,
          location: true,
          isActive: true,
          lastActive: true,
          expiresAt: true,
          createdAt: true,
          token: true,
        },
      }),
      this.prisma.client.session.count({ where }),
    ]);
    const totalPages = Math.ceil(total / take);
    const current = Math.max(page, 1);
    return {
      // The token is read only to say which row is the one asking; it is dropped here.
      data: rows.map(({ token, ...session }) => ({ ...session, current: !!currentToken && token === currentToken })),
      meta: { page: current, limit: take, total, totalPages, hasNext: current < totalPages, hasPrev: current > 1 },
    };
  }

  async createSession(
    userId: number,
    data: {
      deviceType: string;
      browser: string;
      os: string;
      ipAddress?: string;
      location?: string;
    },
  ) {
    const { randomBytes } = await import('crypto');
    const token = randomBytes(48).toString('hex');
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 7);

    return this.prisma.client.session.create({
      data: {
        userId,
        token,
        expiresAt,
        ...data,
      },
    });
  }

  async updateSessionActivity(sessionId: number) {
    return this.prisma.client.session.update({
      where: { id: sessionId },
      data: { lastActive: new Date() },
    });
  }

  async deleteSession(sessionId: number, userId: number) {
    const session = await this.prisma.client.session.findFirst({
      where: { id: sessionId, userId },
    });

    if (!session) {
      throw new NotFoundException('Session not found');
    }

    await this.prisma.client.session.delete({
      where: { id: sessionId },
    });
    // Validation caches a session for a minute; without this the signed-out device would keep working until that ran out.
    await this.authService.forgetSession(session.token);

    return { message: 'Session deleted successfully' };
  }

  // Two-Factor Authentication
  async getTwoFactorStatus(userId: number) {
    const user = await this.prisma.client.user.findUnique({
      where: { id: userId },
      select: { twoFactorEnabled: true },
    });

    return { enabled: user?.twoFactorEnabled || false };
  }

  async setupTwoFactor(userId: number) {
    const user = await this.prisma.client.user.findUnique({
      where: { id: userId },
    });
    if (!user) throw new NotFoundException('User not found');

    const secret = speakeasy.generateSecret({
      length: 20,
      name: `Eneles (${user.email})`,
      issuer: 'Eneles',
    });

    return { secret: secret.base32, otpauthUrl: secret.otpauth_url };
  }

  async enableTwoFactor(userId: number, secret: string, token: string) {
    const verified = speakeasy.totp.verify({
      secret: secret,
      encoding: 'base32',
      token: token,
      window: 1, // Allow 30sec window
    });

    if (!verified) {
      throw new Error('Invalid authentication code');
    }

    await this.prisma.client.user.update({
      where: { id: userId },
      data: {
        twoFactorEnabled: true,
        twoFactorSecret: secret,
      },
    });

    return { message: '2FA enabled successfully' };
  }

  async disableTwoFactor(userId: number, code: string) {
    // Require current TOTP code to disable 2FA
    const user = await this.prisma.client.user.findUnique({
      where: { id: userId },
    });
    if (!user || !user.twoFactorEnabled || !user.twoFactorSecret) {
      throw new Error('2FA is not enabled');
    }

    const verified = speakeasy.totp.verify({
      secret: user.twoFactorSecret,
      encoding: 'base32',
      token: code,
      window: 1,
    });

    if (!verified) {
      throw new Error('Invalid authentication code');
    }

    await this.prisma.client.user.update({
      where: { id: userId },
      data: {
        twoFactorEnabled: false,
        twoFactorSecret: null,
      },
    });

    return { message: '2FA disabled successfully' };
  }

  // ── Editor Settings (per-user) ────────────────────────────────

  async getEditorSettings(userId: number) {
    const settings = await this.prisma.client.editorSettings.findUnique({
      where: { userId },
    });

    if (!settings) {
      return {
        autoComplete: true,
        autoCloseBrackets: true,
        codeCheck: true,
        spellcheckLang: 'en',
        theme: 'dark',
        editorTheme: 'thry',
        pdfTheme: 'light',
        fontSize: 16,
        fontFamily: 'Consolas',
        lineHeight: 'normal',
      };
    }

    return settings;
  }

  async updateEditorSettings(
    userId: number,
    data: {
      autoComplete?: boolean;
      autoCloseBrackets?: boolean;
      codeCheck?: boolean;
      spellcheckLang?: string;
      theme?: string;
      editorTheme?: string;
      pdfTheme?: string;
      fontSize?: number;
      fontFamily?: string;
      lineHeight?: string;
    },
  ) {
    // Only these fields are ever written, whatever the caller passed.
    const allowed = [
      'autoComplete', 'autoCloseBrackets', 'codeCheck', 'spellcheckLang', 'theme',
      'editorTheme', 'pdfTheme', 'fontSize', 'fontFamily', 'lineHeight',
    ] as const;
    const fields = Object.fromEntries(
      allowed.filter((k) => data[k] !== undefined).map((k) => [k, data[k]]),
    );
    return this.prisma.client.editorSettings.upsert({
      where: { userId },
      create: { userId, ...fields },
      update: fields,
    });
  }

  // ── Project Settings (per-project) ────────────────────────────

  async getProjectSettings(projectId: number) {
    const settings = await this.prisma.client.projectSettings.findUnique({
      where: { projectId },
    });

    if (!settings) {
      return {
        mainDocument: 'main.tex',
        compiler: 'pdflatex',
        texLiveVersion: '2024',
        compileMode: 'normal',
        stopOnFirstError: false,
        autoCompile: false,
        tabSize: 4,
        macrosEnabled: true,
        snippetsEnabled: true,
      };
    }

    return settings;
  }

  async updateProjectSettings(
    projectId: number,
    data: {
      mainDocument?: string;
      compiler?: string;
      texLiveVersion?: string;
      compileMode?: string;
      stopOnFirstError?: boolean;
      autoCompile?: boolean;
      tabSize?: number;
      macrosEnabled?: boolean;
      snippetsEnabled?: boolean;
    },
  ) {
    return this.prisma.client.projectSettings.upsert({
      where: { projectId },
      create: { projectId, ...data },
      update: data,
    });
  }

  // ── Dictionary (per-user) ─────────────────────────────────────

  async getDictionary(userId: number) {
    const dict = await this.prisma.client.userDictionary.findUnique({
      where: { userId },
    });
    return dict || { words: [] as string[], updatedAt: new Date() };
  }

  async addWord(userId: number, word: string) {
    const normalized = word.toLowerCase().trim();
    const dict = await this.prisma.client.userDictionary.upsert({
      where: { userId },
      create: { userId, words: [normalized] },
      update: {},
    });

    if (!dict.words.includes(normalized)) {
      return this.prisma.client.userDictionary.update({
        where: { userId },
        data: { words: { push: normalized } },
      });
    }

    return dict;
  }

  async removeWord(userId: number, word: string) {
    const dict = await this.prisma.client.userDictionary.findUnique({
      where: { userId },
    });
    if (!dict) return { words: [] as string[], updatedAt: new Date() };

    const filtered = dict.words.filter((w) => w !== word.toLowerCase().trim());
    return this.prisma.client.userDictionary.update({
      where: { userId },
      data: { words: filtered },
    });
  }

  async setDictionary(userId: number, words: string[]) {
    return this.prisma.client.userDictionary.upsert({
      where: { userId },
      create: { userId, words: words.map((w) => w.toLowerCase().trim()) },
      update: { words: words.map((w) => w.toLowerCase().trim()) },
    });
  }

  // ── Macros (per-user overrides of universal defaults) ─────────

  static readonly DEFAULT_MACROS: Record<string, string> = {
    // Blackboard bold letters
    R: '\\mathbb{R}',
    N: '\\mathbb{N}',
    Z: '\\mathbb{Z}',
    Q: '\\mathbb{Q}',
    C: '\\mathbb{C}',
    F: '\\mathbb{F}',
    P: '\\mathbb{P}',
    E: '\\mathbb{E}',
    // Calligraphic
    cA: '\\mathcal{A}',
    cB: '\\mathcal{B}',
    cC: '\\mathcal{C}',
    cD: '\\mathcal{D}',
    cF: '\\mathcal{F}',
    cG: '\\mathcal{G}',
    cH: '\\mathcal{H}',
    cL: '\\mathcal{L}',
    cM: '\\mathcal{M}',
    cN: '\\mathcal{N}',
    cO: '\\mathcal{O}',
    cP: '\\mathcal{P}',
    cS: '\\mathcal{S}',
    cT: '\\mathcal{T}',
    // Common operators / symbols
    eps: '\\varepsilon',
    vphi: '\\varphi',
    lam: '\\lambda',
    Lam: '\\Lambda',
    sig: '\\sigma',
    Sig: '\\Sigma',
    om: '\\omega',
    Om: '\\Omega',
    del: '\\partial',
    inf: '\\infty',
    emptyset: '\\varnothing',
    // Arrows
    ra: '\\rightarrow',
    la: '\\leftarrow',
    Ra: '\\Rightarrow',
    La: '\\Leftarrow',
    lra: '\\leftrightarrow',
    Lra: '\\Leftrightarrow',
    xra: '\\xrightarrow',
    xla: '\\xleftarrow',
    // Common environments / shortcuts
    norm: '\\left\\| #1 \\right\\|',
    abs: '\\left| #1 \\right|',
    inner: '\\left\\langle #1, #2 \\right\\rangle',
    floor: '\\left\\lfloor #1 \\right\\rfloor',
    ceil: '\\left\\lceil #1 \\right\\rceil',
    set: '\\left\\{ #1 \\right\\}',
    // Text shortcuts
    tif: '\\text{if }',
    tand: '\\text{ and }',
    tor: '\\text{ or }',
    tst: '\\text{s.t. }',
    twrt: '\\text{w.r.t. }',
    // Decorations
    ol: '\\overline{#1}',
    ul: '\\underline{#1}',
    hat: '\\widehat{#1}',
    tilde: '\\widetilde{#1}',
    bar: '\\overline{#1}',
    vec: '\\mathbf{#1}',
    bvec: '\\boldsymbol{#1}',
    // Physics
    bra: '\\langle #1 |',
    ket: '| #1 \\rangle',
    braket: '\\langle #1 | #2 \\rangle',
    mel: '\\langle #1 | #2 | #3 \\rangle',
    dv: '\\frac{d #1}{d #2}',
    pdv: '\\frac{\\partial #1}{\\partial #2}',
    dd: '\\,\\mathrm{d}',
    hbar: '\\hbar',
    dag: '\\dagger',
    cross: '\\times',
    grad: '\\nabla',
    div: '\\nabla \\cdot',
    curl: '\\nabla \\times',
    lap: '\\nabla^2',
    avg: '\\langle #1 \\rangle',
    comm: '\\left[ #1, #2 \\right]',
    acomm: '\\left\\{ #1, #2 \\right\\}',
    // Computer Science
    bigO: '\\mathcal{O}(#1)',
    bigT: '\\Theta(#1)',
    bigOm: '\\Omega(#1)',
    poly: '\\mathrm{poly}(#1)',
    polylog: '\\mathrm{polylog}(#1)',
    NP: '\\mathbf{NP}',
    PP: '\\mathbf{P}',
    PSPACE: '\\mathbf{PSPACE}',
    BPP: '\\mathbf{BPP}',
    EXP: '\\mathbf{EXP}',
    log: '\\log',
    lg: '\\lg',
    ln: '\\ln',
    argmin: '\\operatorname{arg\\,min}',
    argmax: '\\operatorname{arg\\,max}',
    Pr: '\\Pr',
    Var: '\\operatorname{Var}',
    Cov: '\\operatorname{Cov}',
    Exp: '\\mathbb{E}',
    // More Greek
    al: '\\alpha',
    be: '\\beta',
    ga: '\\gamma',
    Ga: '\\Gamma',
    de: '\\delta',
    De: '\\Delta',
    th: '\\theta',
    Th: '\\Theta',
    ka: '\\kappa',
    mu: '\\mu',
    nu: '\\nu',
    pi: '\\pi',
    Pi: '\\Pi',
    rho: '\\rho',
    tau: '\\tau',
    xi: '\\xi',
    Xi: '\\Xi',
    ze: '\\zeta',
    phi: '\\phi',
    Phi: '\\Phi',
    chi: '\\chi',
    psi: '\\psi',
    Psi: '\\Psi',
    // Sums / Products / Integrals
    Sum: '\\sum_{#1}^{#2}',
    Prod: '\\prod_{#1}^{#2}',
    Int: '\\int_{#1}^{#2}',
    Lim: '\\lim_{#1}',
    Sup: '\\sup_{#1}',
    Infimum: '\\inf_{#1}',
    Max: '\\max_{#1}',
    Min: '\\min_{#1}',
  };

  // ── The assistant's slash commands (per-user) ─────────────────

  /** Names the assistant's own commands use; a person's command cannot take one. Kept in step with the frontend's built-in list. */
  static readonly RESERVED_COMMANDS = new Set([
    'fix',
    'explain',
    'improve',
    'cite',
    'table',
    'clear',
    'summarize',
    'proofread',
    'shorten',
    'translate',
    'abstract',
    'equation',
    'review',
    'help',
  ]);

  async getAssistantCommands(userId: number) {
    return this.prisma.client.assistantCommand.findMany({
      where: { userId },
      orderBy: [{ position: 'asc' }, { id: 'asc' }],
      select: { name: true, description: true, prompt: true, useSelection: true },
    });
  }

  /** Replaces the person's list with the one given, in its order. */
  async updateAssistantCommands(
    userId: number,
    commands: {
      name: string;
      description: string;
      prompt: string;
      useSelection?: boolean;
    }[],
  ) {
    const seen = new Set<string>();
    for (const command of commands) {
      if (SettingsService.RESERVED_COMMANDS.has(command.name))
        throw new BadRequestException(
          `/${command.name} is one of the assistant's own commands. Choose another name.`,
        );
      if (seen.has(command.name))
        throw new BadRequestException(
          `There are two commands named /${command.name}.`,
        );
      seen.add(command.name);
    }
    await this.prisma.client.$transaction([
      this.prisma.client.assistantCommand.deleteMany({ where: { userId } }),
      this.prisma.client.assistantCommand.createMany({
        data: commands.map((command, position) => ({
          userId,
          name: command.name,
          description: command.description.trim(),
          prompt: command.prompt.trim(),
          useSelection: command.useSelection ?? true,
          position,
        })),
      }),
    ]);
    return this.getAssistantCommands(userId);
  }

  async getMacros(userId: number) {
    const overrides = await this.prisma.client.userMacro.findMany({
      where: { userId },
    });

    const overrideMap = new Map(overrides.map((o) => [o.name, o.expansion]));
    const defaults = SettingsService.DEFAULT_MACROS;
    const result: { name: string; expansion: string; isCustom: boolean }[] = [];

    // Merge defaults with overrides
    for (const [name, defaultExpansion] of Object.entries(defaults)) {
      if (overrideMap.has(name)) {
        result.push({
          name,
          expansion: overrideMap.get(name)!,
          isCustom: true,
        });
        overrideMap.delete(name);
      } else {
        result.push({ name, expansion: defaultExpansion, isCustom: false });
      }
    }

    // Any user-added macros not in defaults
    for (const entry of overrideMap.entries()) {
      result.push({ name: entry[0], expansion: entry[1], isCustom: true });
    }

    return result;
  }

  async updateMacros(
    userId: number,
    macros: { name: string; expansion: string }[],
  ) {
    const defaults = SettingsService.DEFAULT_MACROS;

    for (const macro of macros) {
      const isDefault = defaults[macro.name] === macro.expansion;
      if (isDefault) {
        // If it matches the default, delete any override
        await this.prisma.client.userMacro.deleteMany({
          where: { userId, name: macro.name },
        });
      } else {
        // Upsert the override
        await this.prisma.client.userMacro.upsert({
          where: { userId_name: { userId, name: macro.name } },
          create: { userId, name: macro.name, expansion: macro.expansion },
          update: { expansion: macro.expansion },
        });
      }
    }

    return this.getMacros(userId);
  }

  async resetMacro(userId: number, name: string) {
    await this.prisma.client.userMacro.deleteMany({
      where: { userId, name },
    });
    return this.getMacros(userId);
  }

  async resetAllMacros(userId: number) {
    await this.prisma.client.userMacro.deleteMany({
      where: { userId },
    });
    return this.getMacros(userId);
  }
}
