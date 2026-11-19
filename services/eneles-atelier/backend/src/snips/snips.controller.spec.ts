import { Test } from '@nestjs/testing';
import { HttpException, HttpStatus } from '@nestjs/common';
import { SnipsController } from './snips.controller';
import { SnipsService } from './snips.service';
import { StorageService } from '../storage/storage.service';
import { UsageService } from '../usage/usage.service';
import { AiService } from '../ai/ai.service';
import { mockStorage, mockUsage, withoutThrottling } from '../test-utils';

/**
 * Every snip route must refuse to touch a snip owned by someone else, and must
 * do so with a 404 rather than a 403 so it does not confirm the id exists.
 */
describe('SnipsController tenant isolation', () => {
  let controller: SnipsController;
  let snips: { findOne: jest.Mock; update: jest.Mock; remove: jest.Mock };

  const ME = 1;
  const SOMEONE_ELSE = 2;
  const theirSnip = { id: 42, userId: SOMEONE_ELSE, imagePath: 'x', fileSize: 1 };
  const mySnip = { id: 43, userId: ME, imagePath: 'y', fileSize: 1 };

  beforeEach(async () => {
    snips = { findOne: jest.fn(), update: jest.fn(), remove: jest.fn() };

    const module = await withoutThrottling(
      Test.createTestingModule({
        controllers: [SnipsController],
        providers: [
          { provide: SnipsService, useValue: snips },
          { provide: StorageService, useValue: mockStorage() },
          { provide: UsageService, useValue: mockUsage() },
          { provide: AiService, useValue: {} },
        ],
      }),
    ).compile();

    controller = module.get(SnipsController);
  });

  it('findOne returns 404 for a snip owned by another user', async () => {
    snips.findOne.mockResolvedValue(theirSnip);
    await expect(controller.findOne(ME, '42')).rejects.toMatchObject({
      status: HttpStatus.NOT_FOUND,
    });
  });

  it('findOne returns the snip for its owner', async () => {
    snips.findOne.mockResolvedValue(mySnip);
    await expect(controller.findOne(ME, '43')).resolves.toMatchObject({ id: 43 });
  });

  it('getImageUrl returns 404 for a snip owned by another user', async () => {
    snips.findOne.mockResolvedValue(theirSnip);
    await expect(controller.getImageUrl(ME, '42')).rejects.toMatchObject({
      status: HttpStatus.NOT_FOUND,
    });
  });

  it('update returns 404 for a snip owned by another user and never writes', async () => {
    snips.findOne.mockResolvedValue(theirSnip);
    await expect(controller.update(ME, '42', { title: 'x' } as any)).rejects.toBeInstanceOf(
      HttpException,
    );
    expect(snips.update).not.toHaveBeenCalled();
  });

  it('remove returns 404 for a snip owned by another user and never deletes', async () => {
    snips.findOne.mockResolvedValue(theirSnip);
    await expect(controller.remove(ME, '42')).rejects.toMatchObject({
      status: HttpStatus.NOT_FOUND,
    });
    expect(snips.remove).not.toHaveBeenCalled();
  });

  it('findByUserId refuses to list another user\u2019s snips', async () => {
    await expect(controller.findByUserId(ME, String(SOMEONE_ELSE))).rejects.toMatchObject({
      status: HttpStatus.FORBIDDEN,
    });
  });
});
