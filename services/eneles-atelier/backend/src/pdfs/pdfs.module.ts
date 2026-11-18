import { Module } from '@nestjs/common';
import { PdfsService } from './pdfs.service';
import { PdfsController } from './pdfs.controller';
import { PdfImagesController } from './pdf-images.controller';
import { PrismaModule } from '../prisma/prisma.module';
import { StorageModule } from '../storage/storage.module';
import { UsageModule } from '../usage/usage.module';
import { AiModule } from '../ai/ai.module';

@Module({
  imports: [PrismaModule, StorageModule, UsageModule, AiModule],
  providers: [PdfsService],
  exports: [PdfsService],
  controllers: [PdfsController, PdfImagesController],
})
export class PdfsModule {}
