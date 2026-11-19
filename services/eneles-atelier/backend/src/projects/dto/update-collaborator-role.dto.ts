import { IsNotEmpty, IsIn } from 'class-validator';

export class UpdateCollaboratorRoleDto {
  @IsNotEmpty()
  @IsIn(['viewer', 'editor'])
  role: 'viewer' | 'editor';
}
