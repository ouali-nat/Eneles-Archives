import { Controller, Get } from '@nestjs/common';
import { UsageService } from './usage.service';
import { CurrentUser } from '../common/decorators/current-user.decorator';

@Controller('usage')
export class UsageController {
  constructor(private readonly usageService: UsageService) {}

  @Get('current')
  async getCurrentUsage(@CurrentUser() userId: number) {
    return this.usageService.getPlanSummary(userId);
  }

  @Get('statistics')
  async getStatistics(@CurrentUser() userId: number) {
    return this.usageService.getStatistics(userId);
  }
}
