import { IsOptional, IsUUID } from 'class-validator';

export class ResetSessionDto {
  @IsOptional()
  @IsUUID()
  sessionId?: string;
}
