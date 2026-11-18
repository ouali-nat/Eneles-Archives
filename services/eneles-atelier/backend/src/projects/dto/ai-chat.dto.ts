import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

/** Every request goes to a paid model, so each part is bounded. */
export const AI_LIMITS = {
  message: 10_000,
  files: 200,
  path: 512,
  fileContent: 500_000,
  /** Sum of all file contents in one request. */
  totalContent: 1_800_000,
  /** Earlier turns sent with a question; the server trims them further to fit the model's context. */
  turns: 40,
  turnContent: 20_000,
  context: 20_000,
} as const;

export class AiChatFileDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(AI_LIMITS.path)
  path: string;

  @IsString()
  @MaxLength(AI_LIMITS.fileContent)
  content: string;
}

export class AiChatTurnDto {
  @IsIn(['user', 'assistant'])
  role: 'user' | 'assistant';

  @IsString()
  @MaxLength(AI_LIMITS.turnContent)
  content: string;
}

export class AiChatContextDto {
  /** Errors from the last compile, as the log panel shows them. */
  @IsOptional()
  @IsString()
  @MaxLength(AI_LIMITS.context)
  compileErrors?: string;

  /** Text the author has selected in the active file. */
  @IsOptional()
  @IsString()
  @MaxLength(AI_LIMITS.context)
  selection?: string;
}

export class AiChatDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(AI_LIMITS.message)
  message: string;

  @IsArray()
  @ArrayMaxSize(AI_LIMITS.files)
  @ValidateNested({ each: true })
  @Type(() => AiChatFileDto)
  files: AiChatFileDto[];

  @IsOptional()
  @IsString()
  @MaxLength(AI_LIMITS.path)
  activeFilePath?: string;

  /** The project's tab size: how many spaces the assistant indents by. */
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(8)
  tabSize?: number;

  /** Earlier turns of this conversation, oldest first. */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(AI_LIMITS.turns)
  @ValidateNested({ each: true })
  @Type(() => AiChatTurnDto)
  history?: AiChatTurnDto[];

  @IsOptional()
  @ValidateNested()
  @Type(() => AiChatContextDto)
  context?: AiChatContextDto;

  /** Which provider answers: one the person has a key for, "platform", or "local" (development only). Absent, the account's default. */
  @IsOptional()
  @IsString()
  @MaxLength(40)
  provider?: string;

  /** The model to use with that provider. Absent, the account's default or the provider's suggested model. */
  @IsOptional()
  @IsString()
  @MaxLength(200)
  model?: string;
}
