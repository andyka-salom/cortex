import { IsBoolean } from 'class-validator';

/** Body untuk PATCH /vps/:id/ai-access (Fase 7 — toggle akses AI chat per VPS). */
export class ToggleAiAccessDto {
  @IsBoolean()
  enabled: boolean;
}
