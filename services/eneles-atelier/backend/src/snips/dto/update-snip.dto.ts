import { IsString, IsOptional, IsArray, IsIn, MaxLength } from 'class-validator';

export class UpdateSnipDto {
  @IsOptional()
  @IsString()
  @MaxLength(500)
  title?: string;

  @IsOptional()
  @IsString()
  latexContent?: string;

  @IsOptional()
  @IsString()
  originalText?: string;

  @IsOptional()
  @IsIn(['pending', 'processing', 'completed', 'error'])
  status?: 'pending' | 'processing' | 'completed' | 'error';

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  tags?: string[];
}

export class UpdateSnipLatexDto {
  @IsString()
  latexContent: string;

  @IsOptional()
  @IsIn(['completed', 'error'])
  status?: 'completed' | 'error';
}
