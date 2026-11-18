import { Test } from '@nestjs/testing';
import { SnipsService } from './snips.service';
import { PrismaService } from '../prisma/prisma.service';
import { mockPrisma } from '../test-utils';

describe('SnipsService', () => {
  let service: SnipsService;
  let prisma: ReturnType<typeof mockPrisma>;

  beforeEach(async () => {
    prisma = mockPrisma();
    const module = await Test.createTestingModule({
      providers: [SnipsService, { provide: PrismaService, useValue: prisma }],
    }).compile();
    service = module.get(SnipsService);
  });

  it('findOne looks up by primary key only, leaving ownership to the controller', async () => {
    prisma.client.snip.findUnique.mockResolvedValue({ id: 1, userId: 9 });
    const result = await service.findOne(1);
    expect(result).toMatchObject({ id: 1 });
    expect(prisma.client.snip.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 1 } }),
    );
  });
});
