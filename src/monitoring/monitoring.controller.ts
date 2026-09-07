import {
  Body,
  Controller,
  Get,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { Role } from '@prisma/client';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { CurrentUser, AuthUser } from '../auth/current-user.decorator';
import { MonitoringService } from './monitoring.service';

@Controller('monitoring')
@UseGuards(JwtAuthGuard, RolesGuard)
export class MonitoringController {
  constructor(private readonly monitoring: MonitoringService) {}

  /**
   * Metric CPU/RAM/Disk dari Prometheus.
   * Query param `names`: nama VPS dipisah koma.
   */
  @Get('metrics')
  getMetrics(@Query('names') names?: string) {
    const vpsNames = names
      ? names.split(',').map((n) => n.trim()).filter(Boolean)
      : [];
    return this.monitoring.getMetrics(vpsNames);
  }

  /** List alert aktif dari Alertmanager. */
  @Get('alerts')
  getAlerts(
    @Query('silenced') silenced?: string,
    @Query('inhibited') inhibited?: string,
  ) {
    return this.monitoring.getAlerts({
      silenced: silenced !== undefined ? silenced === 'true' : undefined,
      inhibited: inhibited !== undefined ? inhibited === 'true' : undefined,
    });
  }

  /** Ringkasan jumlah alert. */
  @Get('alerts/summary')
  getAlertSummary() {
    return this.monitoring.getAlertSummary();
  }

  /**
   * Silence alert via Alertmanager.
   * Body: { matchers, comment, durationHours }
   */
  @Post('alerts/silence')
  @Roles(Role.SUPERADMIN)
  silenceAlert(
    @Body()
    body: {
      matchers: { name: string; value: string; isRegex: boolean }[];
      comment: string;
      durationHours?: number;
    },
    @CurrentUser() user: AuthUser,
  ) {
    return this.monitoring.silenceAlert(
      user.id,
      user.email,
      body.matchers,
      body.comment,
      body.durationHours,
    );
  }
}
