import { PROJECT_FILE_PATH, PROJECT_FILE_PATH_MESSAGE } from './file-path';
import {
  Matches, IsString, IsNotEmpty, IsOptional, IsBoolean, MaxLength } from 'class-validator';

export class CreateFileDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  @Matches(PROJECT_FILE_PATH, { message: PROJECT_FILE_PATH_MESSAGE })
  path: string;

  @IsOptional()
  @IsString()
  content?: string;

  @IsOptional()
  @IsString()
  filePath?: string;

  @IsOptional()
  @IsBoolean()
  isMain?: boolean;

  @IsOptional()
  @IsBoolean()
  isFolder?: boolean;
}
