import { IsString, IsOptional, IsNotEmpty, IsObject, MaxLength } from 'class-validator';

export class CreateRevisionDto {
  @IsOptional()
  @IsString()
  @MaxLength(500)
  message?: string;
}

export class PushUndoDto {
  @IsString()
  @IsNotEmpty()
  filePath: string;

  @IsString()
  beforeContent: string;

  @IsString()
  afterContent: string;

  @IsOptional()
  @IsString()
  source?: 'user' | 'ai';
}
