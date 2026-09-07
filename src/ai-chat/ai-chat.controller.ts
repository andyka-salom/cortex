import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { Role } from '@prisma/client';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { CurrentUser, AuthUser } from '../auth/current-user.decorator';
import { AiChatService } from './ai-chat.service';
import { SendMessageDto } from './dto/send-message.dto';
import { ConfirmCommandDto } from './dto/confirm-command.dto';
import { ResetSessionDto } from './dto/reset-session.dto';

/**
 * AI Chat (Fase 7) — SUPERADMIN ONLY (CLAUDE.md #6, "sesuai kemauan
 * Superadmin"): fitur ini bisa mengusulkan eksekusi command ke VPS, jadi
 * tidak dibuka untuk Operator/Viewer sama sekali di server (bukan cuma
 * disembunyikan di UI).
 */
@Controller('ai-chat')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.SUPERADMIN)
export class AiChatController {
  constructor(private readonly aiChat: AiChatService) {}

  /** Status konfigurasi (apakah ANTHROPIC_API_KEY sudah di-set) — untuk UI. */
  @Get('status')
  status() {
    return this.aiChat.getStatus();
  }

  @Post('message')
  sendMessage(@Body() dto: SendMessageDto, @CurrentUser() user: AuthUser) {
    return this.aiChat.sendMessage(user.id, dto);
  }

  /** Superadmin approve/reject command yang diusulkan AI (human-in-the-loop). */
  @Post('confirm')
  confirmCommand(@Body() dto: ConfirmCommandDto, @CurrentUser() user: AuthUser) {
    return this.aiChat.confirmCommand(user.id, dto);
  }

  @Post('reset')
  resetSession(@Body() dto: ResetSessionDto, @CurrentUser() user: AuthUser) {
    return this.aiChat.resetSession(user.id, dto.sessionId);
  }
}
