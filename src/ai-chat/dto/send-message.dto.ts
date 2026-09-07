import { IsOptional, IsString, IsUUID, MaxLength, MinLength } from 'class-validator';

/** Body untuk POST /ai-chat/message. sessionId kosong = mulai session baru. */
export class SendMessageDto {
  @IsOptional()
  @IsUUID()
  sessionId?: string;

  @IsString()
  @MinLength(1)
  @MaxLength(4000)
  message: string;
}
