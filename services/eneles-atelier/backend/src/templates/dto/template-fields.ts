import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { PROJECT_FILE_PATH, PROJECT_FILE_PATH_MESSAGE } from '../../projects/dto/file-path';

/** One extra file a template carries besides its main .tex source. */
export class TemplateFileDto {
  @IsString()
  @MaxLength(300)
  @Matches(PROJECT_FILE_PATH, { message: PROJECT_FILE_PATH_MESSAGE })
  path: string;

  @IsString()
  @MaxLength(1_000_000)
  content: string;
}

/** Shared bounds for the parts of a template other people may see. */
export const TEMPLATE_LIMITS = {
  content: 1_000_000,
  files: 100,
  category: 50,
  tags: 20,
  tag: 50,
} as const;

export class ReportTemplateDto {
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}

export class ReviewTemplateDto {
  @IsIn(['approve', 'reject'])
  decision: 'approve' | 'reject';

  /** Shown to the author, so say what to change. */
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  note?: string;
}

/** Re-exported so the create and update DTOs validate files the same way. */
export const templateFilesRules = [
  IsOptional(),
  IsArray(),
  ArrayMaxSize(TEMPLATE_LIMITS.files),
  ValidateNested({ each: true }),
  Type(() => TemplateFileDto),
];
