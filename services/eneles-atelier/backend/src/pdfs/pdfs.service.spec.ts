import { Test } from '@nestjs/testing';
import { PdfsService } from './pdfs.service';
import { PrismaService } from '../prisma/prisma.service';
import { mockPrisma } from '../test-utils';

describe('PdfsService', () => {
  let service: PdfsService;
  let prisma: ReturnType<typeof mockPrisma>;

  beforeEach(async () => {
    prisma = mockPrisma();
    const module = await Test.createTestingModule({
      providers: [PdfsService, { provide: PrismaService, useValue: prisma }],
    }).compile();
    service = module.get(PdfsService);
  });

  it('findOne looks up by primary key only, leaving ownership to the controller', async () => {
    prisma.client.pDF.findUnique.mockResolvedValue({ id: 1, userId: 9 });
    const result = await service.findOne(1);
    expect(result).toMatchObject({ id: 1 });
  });
});
