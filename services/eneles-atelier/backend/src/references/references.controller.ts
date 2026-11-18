import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { ReferencesService } from './references.service';

@Controller('references')
@UseGuards(ThrottlerGuard)
export class ReferencesController {
  constructor(private readonly references: ReferencesService) {}

  /** GET /references/lookup?id=10.1093/comjnl/27.2.97 or ?id=1706.03762: a BibTeX entry. */
  @Get('lookup')
  @Throttle({ default: { ttl: 60000, limit: 30 } })
  lookup(@Query('id') id = '') {
    return this.references.lookup(String(id).slice(0, 300));
  }
}
