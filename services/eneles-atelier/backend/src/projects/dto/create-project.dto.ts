import { Transform } from 'class-transformer';
import {
  IsString,
  IsNotEmpty,
  IsOptional,
  Matches,
  MaxLength,
} from 'class-validator';

export class CreateProjectDto {
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  title: string;

  @IsOptional()
  @IsString()
  templateContent?: string;

  /** The uid of the project this one is a reference paper for. The caller needs edit access to it. */
  @IsOptional()
  @IsString()
  @MaxLength(64)
  referenceOf?: string;

  /** The arXiv identifier the reference was imported from. */
  @IsOptional()
  @IsString()
  @Matches(/^(?:\d{4}\.\d{4,5}|[a-z-]+(?:\.[A-Z]{2})?\/\d{7})(?:v\d{1,3})?$/, {
    message: 'Not a valid arXiv identifier.',
  })
  arxivId?: string;
}
