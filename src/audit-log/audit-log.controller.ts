import { Controller, Get, Query, Res, UseGuards } from '@nestjs/common';
import { Role } from '@prisma/client';
import { Response } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { AuditLogService } from './audit-log.service';

/** Audit log read-only. Superadmin only (PRD §4 — lihat semua audit log). */
@Controller('audit-log')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.SUPERADMIN)
export class AuditLogController {
  constructor(private readonly audit: AuditLogService) {}

  @Get()
  findMany(
    @Query('userId') userId?: string,
    @Query('vpsId') vpsId?: string,
    @Query('action') action?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('take') take?: string,
    @Query('skip') skip?: string,
  ) {
    return this.audit.findMany({
      userId,
      vpsId,
      action,
      from: from ? new Date(from) : undefined,
      to: to ? new Date(to) : undefined,
      take: take ? Number(take) : undefined,
      skip: skip ? Number(skip) : undefined,
    });
  }

  /**
   * Export audit log ke CSV (PRD §5.8 — untuk audit internal).
   * Sama filter seperti GET /, tapi max 5000 rows dan output CSV.
   */
  @Get('export')
  async exportCsv(
    @Res() res: Response,
    @Query('userId') userId?: string,
    @Query('vpsId') vpsId?: string,
    @Query('action') action?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    const logs = await this.audit.findMany({
      userId,
      vpsId,
      action,
      from: from ? new Date(from) : undefined,
      to: to ? new Date(to) : undefined,
      take: 5000,
      skip: 0,
    });

    // Build CSV
    const header = 'id,userId,vpsId,action,detail,createdAt\n';
    const rows = logs
      .map((l) =>
        [
          l.id,
          l.userId ?? '',
          l.vpsId ?? '',
          l.action,
          `"${(l.detail ?? '').replace(/"/g, '""')}"`,
          l.createdAt.toISOString(),
        ].join(','),
      )
      .join('\n');

    const csv = header + rows;
    const filename = `audit-log-${new Date().toISOString().slice(0, 10)}.csv`;

    res.set({
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
    });
    res.end('\uFEFF' + csv); // BOM agar Excel buka dengan benar
  }
}
