import { Module } from '@nestjs/common';
import { TikzController } from './tikz.controller';
import { TikzComponentsController } from './tikz-components.controller';
import { StorageModule } from '../storage/storage.module';
import { TikzPreviewCache } from './tikz-preview.cache';
import { TikzThrottlerGuard } from './tikz-throttler.guard';

@Module({
  imports: [StorageModule],
  controllers: [TikzController, TikzComponentsController],
  providers: [TikzPreviewCache, TikzThrottlerGuard],
})
export class TikzModule {}
