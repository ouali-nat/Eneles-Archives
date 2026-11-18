import { Module } from '@nestjs/common';
import { ArxivController } from './arxiv.controller';

@Module({
  controllers: [ArxivController],
})
export class ArxivModule {}
