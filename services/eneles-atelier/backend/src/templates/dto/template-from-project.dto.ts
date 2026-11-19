import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import { TEMPLATE_LIMITS } from './template-fields';

/** Save a project's text files as a template. */
export class TemplateFromProjectDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  name: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;

  @IsOptional()
  @IsString()
  @MaxLength(TEMPLATE_LIMITS.category)
  category?: string;

  /** Asks to share it; other people see it once a reviewer approves it. */
  @IsOptional()
  @IsBoolean()
  isPublic?: boolean;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(TEMPLATE_LIMITS.tags)
  @IsString({ each: true })
  @MaxLength(TEMPLATE_LIMITS.tag, { each: true })
  tags?: string[];
}

/** Start a project from a template. */
export class UseTemplateDto {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  title?: string;
}
