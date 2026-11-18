import { Transform } from 'class-transformer';
import {
  IsIn,
  IsOptional,
  IsString,
  Length,
  ValidateIf,
} from 'class-validator';

export const COMPILE_ENGINES = [
  'pdflatex',
  'xelatex',
  'lualatex',
  'latex',
] as const;

const trim = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

/** The public `POST /compile`: either LaTeX source to compile on its own, or a project to compile as it is saved (docs/pages/api/compilation.mdx). */
export class CompileDto {
  @ValidateIf((o: CompileDto) => o.project_uid === undefined)
  @IsString({
    message:
      'Send "source" (LaTeX to compile) or "project_uid" (a project of yours).',
  })
  @Length(1, 2_000_000, {
    message: 'The source must be between 1 character and 2 MB.',
  })
  source?: string;

  @ValidateIf((o: CompileDto) => o.source === undefined)
  @Transform(trim)
  @IsString({
    message:
      'Send "source" (LaTeX to compile) or "project_uid" (a project of yours).',
  })
  @Length(1, 64)
  project_uid?: string;

  @IsOptional()
  @IsIn(COMPILE_ENGINES, {
    message: 'The engine is pdflatex, xelatex, lualatex, or latex.',
  })
  engine?: (typeof COMPILE_ENGINES)[number];
}
