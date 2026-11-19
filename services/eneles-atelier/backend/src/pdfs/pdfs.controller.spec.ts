import { Test } from '@nestjs/testing';
import { HttpStatus } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PdfsController } from './pdfs.controller';
import { PdfsService } from './pdfs.service';
import { StorageService } from '../storage/storage.service';
import { UsageService } from '../usage/usage.service';
import { AiService } from '../ai/ai.service';
import {
  mockConfig,
  mockStorage,
  mockUsage,
  withoutThrottling,
} from '../test-utils';

describe('PdfsController tenant isolation', () => {
  let controller: PdfsController;
  let pdfs: { findOne: jest.Mock; update: jest.Mock; remove: jest.Mock };

  const ME = 1;
  const SOMEONE_ELSE = 2;
  const theirPdf = { id: 7, userId: SOMEONE_ELSE, filePath: 'p' };
  const myPdf = { id: 8, userId: ME, filePath: 'q' };

  beforeEach(async () => {
    pdfs = { findOne: jest.fn(), update: jest.fn(), remove: jest.fn() };

    const module = await withoutThrottling(
      Test.createTestingModule({
        controllers: [PdfsController],
        providers: [
          { provide: PdfsService, useValue: pdfs },
          { provide: StorageService, useValue: mockStorage() },
          { provide: UsageService, useValue: mockUsage() },
          { provide: AiService, useValue: {} },
          { provide: ConfigService, useValue: mockConfig() },
        ],
      }),
    ).compile();

    controller = module.get(PdfsController);
  });

  it('findOne returns 404 for a PDF owned by another user', async () => {
    pdfs.findOne.mockResolvedValue(theirPdf);
    await expect(controller.findOne(ME, '7')).rejects.toMatchObject({
      status: HttpStatus.NOT_FOUND,
    });
  });

  it('findOne returns the PDF for its owner', async () => {
    pdfs.findOne.mockResolvedValue(myPdf);
    await expect(controller.findOne(ME, '8')).resolves.toMatchObject({ id: 8 });
  });

  it('getPreviewUrl returns 404 for a PDF owned by another user', async () => {
    pdfs.findOne.mockResolvedValue(theirPdf);
    await expect(controller.getPreviewUrl(ME, '7')).rejects.toMatchObject({
      status: HttpStatus.NOT_FOUND,
    });
  });

  it('update returns 404 for a PDF owned by another user and never writes', async () => {
    pdfs.findOne.mockResolvedValue(theirPdf);
    await expect(
      controller.update(ME, '7', { title: 'x' } as any),
    ).rejects.toMatchObject({ status: HttpStatus.NOT_FOUND });
    expect(pdfs.update).not.toHaveBeenCalled();
  });

  it('findByUserId refuses to list another user\u2019s PDFs', async () => {
    await expect(
      controller.findByUserId(ME, String(SOMEONE_ELSE)),
    ).rejects.toMatchObject({ status: HttpStatus.FORBIDDEN });
  });
});
