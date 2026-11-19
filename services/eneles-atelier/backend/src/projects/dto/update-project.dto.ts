import { Transform } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
  ValidateIf,
} from 'class-validator';

export class UpdateProjectDto {
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  title?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @IsString({ each: true })
  @MaxLength(50, { each: true })
  tags?: string[];

  @IsOptional()
  @IsString()
  @MaxLength(32)
  color?: string;

  @IsOptional()
  @IsBoolean()
  archived?: boolean;

  /** Link sharing: private, or anyone signed in with the link can view or edit. Owner only. */
  @IsOptional()
  @IsIn(['private', 'view', 'edit'])
  access?: 'private' | 'view' | 'edit';

  /** The assistant's proposal awaiting review, or null once it is resolved. */
  @IsOptional()
  @ValidateIf((o: UpdateProjectDto) => o.pendingAiDiff !== null)
  @IsObject()
  pendingAiDiff?: {
    edits: Array<{ path: string; oldContent: string; newContent: string; created?: boolean; deleted?: boolean }>;
    message?: string;
  } | null;
}
