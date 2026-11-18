import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import { applyDecorators } from '@nestjs/common';
import { TEMPLATE_LIMITS, TemplateFileDto, templateFilesRules } from './template-fields';

export class CreateTemplateDto {
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

  @IsString()
  @IsNotEmpty()
  @MaxLength(TEMPLATE_LIMITS.content)
  content: string;

  @applyDecorators(...templateFilesRules)
  files?: TemplateFileDto[];

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
