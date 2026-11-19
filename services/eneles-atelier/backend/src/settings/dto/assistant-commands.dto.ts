import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';

/** One of a person's own slash commands for the assistant. */
export class AssistantCommandDto {
  /** What is typed after the slash. */
  @IsString()
  @Matches(/^[a-z][a-z0-9-]{1,23}$/, {
    message:
      'A command name is 2 to 24 lowercase letters, digits, or hyphens, starting with a letter',
  })
  name: string;

  @IsString()
  @MaxLength(120)
  description: string;

  @IsString()
  @MinLength(1)
  @MaxLength(4000)
  prompt: string;

  @IsOptional()
  @IsBoolean()
  useSelection?: boolean;
}

export class UpdateAssistantCommandsDto {
  @IsArray()
  @ArrayMaxSize(40)
  @ValidateNested({ each: true })
  @Type(() => AssistantCommandDto)
  commands: AssistantCommandDto[];
}
