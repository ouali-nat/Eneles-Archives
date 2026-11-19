import { UpdateEditorSettingsDto } from './dto/update-editor-settings.dto';
import { PaginationQueryDto } from '../common/dto/pagination.dto';
import {
  Controller,
  Get,
  Query,
  Put,
  Post,
  Delete,
  Body,
  Param,
  HttpCode,
  HttpStatus,
  HttpException,
  ParseIntPipe,
} from '@nestjs/common';
import { SettingsService } from './settings.service';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { UpdateAssistantCommandsDto } from './dto/assistant-commands.dto';

@Controller('settings')
export class SettingsController {
  constructor(private readonly settingsService: SettingsService) {}

  // Appearance Settings
  @Get('appearance')
  async getAppearanceSettings(@CurrentUser() userId: number) {
    return this.settingsService.getAppearanceSettings(userId);
  }

  @Put('appearance')
  async updateAppearanceSettings(
    @CurrentUser() userId: number,
    @Body()
    body: {
      theme?: string;
    },
  ) {
    return this.settingsService.updateAppearanceSettings(userId, body);
  }

  // Notification Settings
  @Get('notifications')
  async getNotificationSettings(@CurrentUser() userId: number) {
    return this.settingsService.getNotificationSettings(userId);
  }

  @Put('notifications')
  async updateNotificationSettings(
    @CurrentUser() userId: number,
    @Body()
    body: {
      notifyLowCredits?: boolean;
      notifyCompletedJobs?: boolean;
      emailNotifications?: boolean;
      marketingEmails?: boolean;
      securityAlerts?: boolean;
    },
  ) {
    return this.settingsService.updateNotificationSettings(userId, body);
  }

  // Sessions (Active Devices)
  @Get('sessions')
  async getSessions(@CurrentUser() userId: number, @CurrentUser('sid') sessionToken: string | undefined, @Query() query: PaginationQueryDto) {
    return this.settingsService.getSessions(userId, query.page ?? 1, query.limit ?? 50, sessionToken);
  }

  @Delete('sessions/:id')
  @HttpCode(HttpStatus.OK)
  async deleteSession(
    @CurrentUser() userId: number,
    @Param('id', ParseIntPipe) sessionId: number,
  ) {
    return this.settingsService.deleteSession(sessionId, userId);
  }

  // Two-Factor Authentication
  @Get('2fa/status')
  async getTwoFactorStatus(@CurrentUser() userId: number) {
    return this.settingsService.getTwoFactorStatus(userId);
  }

  @Post('2fa/setup')
  async setupTwoFactor(@CurrentUser() userId: number) {
    return this.settingsService.setupTwoFactor(userId);
  }

  @Put('2fa/enable')
  async enableTwoFactor(
    @CurrentUser() userId: number,
    @Body() body: { secret: string; token: string },
  ) {
    return this.settingsService.enableTwoFactor(
      userId,
      body.secret,
      body.token,
    );
  }

  @Put('2fa/disable')
  async disableTwoFactor(
    @CurrentUser() userId: number,
    @Body() body: { code: string },
  ) {
    if (!body.code) {
      throw new HttpException(
        'Authentication code is required to disable 2FA',
        HttpStatus.BAD_REQUEST,
      );
    }
    try {
      return await this.settingsService.disableTwoFactor(userId, body.code);
    } catch (err: any) {
      throw new HttpException(
        err.message || 'Failed to disable 2FA',
        HttpStatus.BAD_REQUEST,
      );
    }
  }

  // ── Editor Settings ─────────────────────────────────────────

  @Get('editor')
  async getEditorSettings(@CurrentUser() userId: number) {
    return this.settingsService.getEditorSettings(userId);
  }

  @Put('editor')
  async updateEditorSettings(
    @CurrentUser() userId: number,
    @Body() body: UpdateEditorSettingsDto,
  ) {
    return this.settingsService.updateEditorSettings(userId, body);
  }

  // ── Dictionary ──────────────────────────────────────────────

  @Get('dictionary')
  async getDictionary(@CurrentUser() userId: number) {
    return this.settingsService.getDictionary(userId);
  }

  @Post('dictionary/words')
  async addWord(@CurrentUser() userId: number, @Body() body: { word: string }) {
    return this.settingsService.addWord(userId, body.word);
  }

  @Delete('dictionary/words/:word')
  @HttpCode(HttpStatus.OK)
  async removeWord(@CurrentUser() userId: number, @Param('word') word: string) {
    return this.settingsService.removeWord(userId, word);
  }

  @Put('dictionary')
  async setDictionary(
    @CurrentUser() userId: number,
    @Body() body: { words: string[] },
  ) {
    return this.settingsService.setDictionary(userId, body.words);
  }

  // ── The assistant's slash commands ─────────────────────────

  @Get('assistant-commands')
  async getAssistantCommands(@CurrentUser() userId: number) {
    return this.settingsService.getAssistantCommands(userId);
  }

  @Put('assistant-commands')
  async updateAssistantCommands(
    @CurrentUser() userId: number,
    @Body() body: UpdateAssistantCommandsDto,
  ) {
    return this.settingsService.updateAssistantCommands(userId, body.commands);
  }

  // ── Macros ─────────────────────────────────────────────────

  @Get('macros')
  async getMacros(@CurrentUser() userId: number) {
    return this.settingsService.getMacros(userId);
  }

  @Put('macros')
  async updateMacros(
    @CurrentUser() userId: number,
    @Body() body: { macros: { name: string; expansion: string }[] },
  ) {
    return this.settingsService.updateMacros(userId, body.macros);
  }

  @Put('macros/reset')
  async resetMacro(
    @CurrentUser() userId: number,
    @Body() body: { name?: string },
  ) {
    if (body.name) {
      return this.settingsService.resetMacro(userId, body.name);
    }
    return this.settingsService.resetAllMacros(userId);
  }
}
