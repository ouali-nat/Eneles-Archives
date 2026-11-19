import { Test } from '@nestjs/testing';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { PrismaService } from './prisma/prisma.service';
import { mockPrisma } from './test-utils';

describe('AppController', () => {
  let controller: AppController;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      controllers: [AppController],
      providers: [AppService, { provide: PrismaService, useValue: mockPrisma() }],
    }).compile();
    controller = module.get(AppController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
