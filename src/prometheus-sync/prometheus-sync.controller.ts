import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { Role } from '@prisma/client';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { CurrentUser, AuthUser } from '../auth/current-user.decorator';
import { AuditLogService } from '../audit-log/audit-log.service';
import { PrometheusSyncService } from './prometheus-sync.service';
import { AlertRulesService } from './alert-rules.service';
import { AlertThresholdDto } from './dto/alert-threshold.dto';

@Controller('prometheus')
@UseGuards(JwtAuthGuard, RolesGuard)
export class PrometheusSyncController {
  constructor(
    private readonly sync: PrometheusSyncService,
    private readonly alertRules: AlertRulesService,
    private readonly audit: AuditLogService,
  ) {}

  /** Trigger manual re-sync semua target (PRD §5.5). Superadmin only. */
  @Post('resync')
  @Roles(Role.SUPERADMIN)
  async resync(@CurrentUser() user: AuthUser) {
    const res = await this.sync.resyncAll();
    await this.audit.record({
      userId: user.id,
      action: 'PROMETHEUS_RESYNC',
      detail: `Manual re-sync target Prometheus (${res.synced} VPS).`,
    });
    return res;
  }

  // ─── Alert Threshold (Fase 6) ───────────────────────────────────────────

  /** List semua threshold yang dikonfigurasi. */
  @Get('alert-thresholds')
  @Roles(Role.SUPERADMIN)
  listThresholds(@Query('vpsId') vpsId?: string) {
    return this.alertRules.listThresholds(vpsId);
  }

  /** Set atau update threshold alert (upsert). */
  @Post('alert-thresholds')
  @Roles(Role.SUPERADMIN)
  upsertThreshold(
    @Body() dto: AlertThresholdDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.alertRules.upsertThreshold(dto, user.id);
  }

  /** Hapus satu threshold. */
  @Delete('alert-thresholds/:id')
  @Roles(Role.SUPERADMIN)
  deleteThreshold(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.alertRules.deleteThreshold(id, user.id);
  }

  /** Regenerate file alert rules Prometheus secara manual. */
  @Post('alert-thresholds/generate')
  @Roles(Role.SUPERADMIN)
  async generateRules(@CurrentUser() user: AuthUser) {
    await this.alertRules.generateRulesFile();
    await this.audit.record({
      userId: user.id,
      action: 'ALERT_RULES_GENERATED',
      detail: 'Manual generate alert rules file.',
    });
    return { ok: true };
  }
}
