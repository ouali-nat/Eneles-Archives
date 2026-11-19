import { Transform } from 'class-transformer';
import { IsEmail, IsNotEmpty, IsOptional, IsIn } from 'class-validator';

export class InviteCollaboratorDto {
  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toLowerCase() : value))
  @IsEmail()
  @IsNotEmpty()
  email: string;

  @IsOptional()
  @IsIn(['viewer', 'editor'])
  role?: 'viewer' | 'editor' = 'viewer';
}
