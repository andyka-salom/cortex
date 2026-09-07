import { IsBoolean, IsUUID } from 'class-validator';

/** Body untuk POST /ai-chat/confirm — Superadmin menyetujui/menolak command yang diusulkan AI. */
export class ConfirmCommandDto {
  @IsUUID()
  sessionId: string;

  @IsUUID()
  pendingId: string;

  @IsBoolean()
  approve: boolean;
}
