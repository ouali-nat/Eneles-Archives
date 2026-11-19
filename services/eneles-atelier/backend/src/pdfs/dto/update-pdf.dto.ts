import { IsString, IsOptional, IsInt, IsIn, MaxLength, Min } from 'class-validator';
import { Type } from 'class-transformer';

export class UpdatePdfDto {
  @IsOptional()
  @IsString()
  @MaxLength(500)
  title?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  pageCount?: number;

  @IsOptional()
  @IsString()
  latexContent?: string;

  @IsOptional()
  @IsIn(['pending', 'processing', 'completed', 'error'])
  status?: 'pending' | 'processing' | 'completed' | 'error';
}

export class UpdatePdfLatexDto {
  @IsString()
  latexContent: string;

  @IsOptional()
  @IsIn(['completed', 'error'])
  status?: 'completed' | 'error';
}
