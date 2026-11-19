import {
  IsString,
  IsOptional,
  IsBoolean,
  IsIn,
  IsInt,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

/**
 * A project's compile and editor settings. Every field the Settings dialog can change must be listed here: the validation pipe drops anything that is not, which is how "LaTeX" as an engine and the tab size used to vanish without an error.
 */
export class UpdateProjectSettingsDto {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  mainDocument?: string;

  @IsOptional()
  @IsIn(['pdflatex', 'xelatex', 'lualatex', 'latex', 'latexmk'])
  compiler?: string;

  @IsOptional()
  @IsString()
  texLiveVersion?: string;

  @IsOptional()
  @IsIn(['normal', 'draft', 'fast'])
  compileMode?: string;

  @IsOptional()
  @IsBoolean()
  stopOnFirstError?: boolean;

  @IsOptional()
  @IsBoolean()
  autoCompile?: boolean;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(8)
  tabSize?: number;

  @IsOptional()
  @IsBoolean()
  macrosEnabled?: boolean;

  @IsOptional()
  @IsBoolean()
  snippetsEnabled?: boolean;
}
