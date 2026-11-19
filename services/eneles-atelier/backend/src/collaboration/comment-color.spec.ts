import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import {
  CreateCommentDto,
  UpdateCommentDto,
} from './collaboration.controller';
import { COMMENT_HUES } from './comments.service';

const base = { path: 'main.tex', quote: 'x', offset: 0, content: 'Note' };

async function errorsFor<T extends object>(
  cls: new () => T,
  body: Record<string, unknown>,
) {
  const errors = await validate(plainToInstance(cls, body), {
    whitelist: true,
    forbidNonWhitelisted: true,
  });
  return errors.map((e) => e.property);
}

describe('comment colors', () => {
  it('accepts every named hue on a new comment, and none at all', async () => {
    for (const color of COMMENT_HUES)
      expect(await errorsFor(CreateCommentDto, { ...base, color })).toEqual(
        [],
      );
    expect(await errorsFor(CreateCommentDto, base)).toEqual([]);
  });

  it('refuses a color that is not a named hue', async () => {
    for (const color of ['#ff0000', 'hue-amber', 'AMBER', 'red; x', 3])
      expect(await errorsFor(CreateCommentDto, { ...base, color })).toEqual([
        'color',
      ]);
  });

  it('lets an update set a hue, clear it with null, or resolve alone', async () => {
    expect(await errorsFor(UpdateCommentDto, { color: 'teal' })).toEqual([]);
    expect(await errorsFor(UpdateCommentDto, { color: null })).toEqual([]);
    expect(await errorsFor(UpdateCommentDto, { resolved: true })).toEqual([]);
    expect(await errorsFor(UpdateCommentDto, { color: 'magenta' })).toEqual([
      'color',
    ]);
  });
});
