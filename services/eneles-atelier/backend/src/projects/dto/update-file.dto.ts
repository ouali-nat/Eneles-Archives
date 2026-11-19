import { PROJECT_FILE_PATH, PROJECT_FILE_PATH_MESSAGE } from './file-path';
import {
  Matches,
  IsString,
  IsOptional,
  IsBoolean,
  IsInt,
  Min,
  MaxLength,
} from 'class-validator';
import { Type } from 'class-transformer';

export class UpdateFileDto {
  @IsOptional()
  @IsString()
  @MaxLength(500)
  @Matches(PROJECT_FILE_PATH, { message: PROJECT_FILE_PATH_MESSAGE })
  path?: string;

  @IsOptional()
  @IsString()
  content?: string;

  @IsOptional()
  @IsBoolean()
  isMain?: boolean;

  /**
   * The `version` the client last read for this file. When present, the write
   * is rejected with 409 if anyone else has saved since. Omit it to keep the
   * old last-writer-wins behaviour.
   */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  expectedVersion?: number;
}
