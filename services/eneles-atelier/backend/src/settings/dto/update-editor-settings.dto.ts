import { IsBoolean, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

/** Editor preferences a person may change. Anything else in the body is stripped. */
export class UpdateEditorSettingsDto {
  @IsOptional() @IsBoolean() autoComplete?: boolean;
  @IsOptional() @IsBoolean() autoCloseBrackets?: boolean;
  @IsOptional() @IsBoolean() codeCheck?: boolean;
  @IsOptional() @IsString() @MaxLength(16) spellcheckLang?: string;
  @IsOptional() @IsString() @MaxLength(40) theme?: string;
  @IsOptional() @IsString() @MaxLength(40) editorTheme?: string;
  @IsOptional() @IsString() @MaxLength(40) pdfTheme?: string;
  @IsOptional() @IsInt() @Min(8) @Max(40) fontSize?: number;
  @IsOptional() @IsString() @MaxLength(80) fontFamily?: string;
  @IsOptional() @IsString() @MaxLength(16) lineHeight?: string;
}
