import { Module } from '@nestjs/common';
import { CompileController } from './compile.controller';
import { StorageModule } from '../storage/storage.module';

@Module({
  imports: [StorageModule],
  controllers: [CompileController],
})
export class CompileModule {}
