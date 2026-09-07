import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as fs from 'fs/promises';
import * as path from 'path';
import { PrismaService } from '../prisma/prisma.service';
import { AuditLogService } from '../audit-log/audit-log.service';
import { AlertThresholdDto } from './dto/alert-threshold.dto';

/**
 * Alert Rules Service (Fase 6 — PRD §5.5).
 *
 * Generate file Prometheus rules (`alerts.rules.yml`) berdasarkan threshold
 * yang dikonfigurasi dari UI. File ditulis ke PROMETHEUS_TARGETS_DIR agar
 * Prometheus auto-reload rules (tidak perlu restart).
 */
@Injectable()
export class AlertRulesService {
  private readonly logger = new Logger(AlertRulesService.name);
  private readonly targetsDir: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogService,
    private readonly config: ConfigService,
  ) {
    this.targetsDir =
      this.config.get<string>('PROMETHEUS_TARGETS_DIR') ||
      path.join(process.cwd(), 'data', 'prometheus');
  }

  /**
   * Upsert threshold untuk satu VPS (atau global jika vpsId null).
   *
   * CATATAN: tidak pakai `prisma.upsert()` dengan selector compound unique
   * `vpsId_metricType` — Prisma menolak `null` sebagai bagian dari compound
   * unique lookup ("Argument vpsId must not be null"), padahal threshold
   * global (vpsId null) adalah kasus utama fitur ini. Jadi upsert manual:
   * cari dulu (vpsId bisa null, `findFirst` mendukungnya), baru create/update.
   */
  async upsertThreshold(dto: AlertThresholdDto, actorId: string) {
    const vpsId = dto.vpsId ?? null;
    const existing = await this.prisma.alertThreshold.findFirst({
      where: { vpsId, metricType: dto.metricType },
    });

    const threshold = existing
      ? await this.prisma.alertThreshold.update({
          where: { id: existing.id },
          data: {
            threshold: dto.threshold,
            durationMin: dto.durationMin ?? 5,
          },
        })
      : await this.prisma.alertThreshold.create({
          data: {
            vpsId,
            metricType: dto.metricType,
            threshold: dto.threshold,
            durationMin: dto.durationMin ?? 5,
          },
        });

    await this.audit.record({
      userId: actorId,
      action: 'ALERT_THRESHOLD_SET',
      detail: `Threshold ${dto.metricType.toUpperCase()} set ke ${dto.threshold}% (${dto.durationMin ?? 5}m) untuk ${dto.vpsId ?? 'global'}`,
    });

    // Regenerate rules file
    await this.generateRulesFile();
    return threshold;
  }

  /** List semua threshold yang dikonfigurasi. */
  async listThresholds(vpsId?: string) {
    return this.prisma.alertThreshold.findMany({
      where: vpsId ? { OR: [{ vpsId }, { vpsId: null }] } : undefined,
      orderBy: [{ vpsId: 'asc' }, { metricType: 'asc' }],
      include: { vps: { select: { name: true } } },
    });
  }

  /** Delete threshold. */
  async deleteThreshold(id: string, actorId: string) {
    const t = await this.prisma.alertThreshold.findUnique({ where: { id } });
    if (!t) return { ok: false };
    await this.prisma.alertThreshold.delete({ where: { id } });
    await this.audit.record({
      userId: actorId,
      action: 'ALERT_THRESHOLD_DELETE',
      detail: `Threshold ${t.metricType} (${t.vpsId ?? 'global'}) dihapus.`,
    });
    await this.generateRulesFile();
    return { ok: true };
  }

  /**
   * Generate Prometheus rules YAML dari semua threshold di DB.
   * Ditulis ke `${PROMETHEUS_TARGETS_DIR}/alert_rules.yml`.
   */
  async generateRulesFile(): Promise<void> {
    const thresholds = await this.prisma.alertThreshold.findMany({
      include: { vps: { select: { name: true } } },
    });

    const groups = this.buildRuleGroups(thresholds);
    const yaml = this.renderYaml(groups);

    const rulesPath = path.join(this.targetsDir, 'alert_rules.yml');
    try {
      await fs.mkdir(this.targetsDir, { recursive: true });
      await fs.writeFile(rulesPath, yaml, 'utf-8');
      this.logger.log(`Alert rules ditulis ke ${rulesPath} (${thresholds.length} threshold).`);
    } catch (err) {
      this.logger.error(`Gagal tulis alert rules: ${(err as Error).message}`);
    }
  }

  private buildRuleGroups(
    thresholds: Array<{
      id: string;
      vpsId: string | null;
      metricType: string;
      threshold: number;
      durationMin: number;
      vps: { name: string } | null;
    }>,
  ) {
    const rules: string[] = [];

    for (const t of thresholds) {
      const serverLabel = t.vps ? `server="${t.vps.name}"` : '';
      const labelFilter = serverLabel ? `{${serverLabel}}` : '';
      const dur = `${t.durationMin}m`;
      const alertName = `${t.metricType.charAt(0).toUpperCase()}${t.metricType.slice(1)}High${t.vps ? '_' + t.vps.name.replace(/[^a-zA-Z0-9_]/g, '_') : '_Global'}`;
      const summary = t.vps
        ? `${t.metricType.toUpperCase()} tinggi di ${t.vps.name}`
        : `${t.metricType.toUpperCase()} tinggi (global)`;

      let exprLine = '';
      if (t.metricType === 'cpu') {
        exprLine = `100 - (avg by (server) (irate(node_cpu_seconds_total${labelFilter}{mode="idle"}[5m])) * 100) > ${t.threshold}`;
      } else if (t.metricType === 'ram') {
        exprLine = `(1 - (node_memory_MemAvailable_bytes${labelFilter} / node_memory_MemTotal_bytes${labelFilter})) * 100 > ${t.threshold}`;
      } else if (t.metricType === 'disk') {
        exprLine = `(1 - (node_filesystem_avail_bytes${labelFilter}{mountpoint="/"} / node_filesystem_size_bytes${labelFilter}{mountpoint="/"})) * 100 > ${t.threshold}`;
      }

      rules.push(
        `    - alert: ${alertName}\n` +
          `      expr: ${exprLine}\n` +
          `      for: ${dur}\n` +
          `      labels:\n` +
          `        severity: warning\n` +
          (t.vps ? `        server: "${t.vps.name}"\n` : '') +
          `      annotations:\n` +
          `        summary: "${summary} (>{{$value | printf "%.1f"}}%)"\n`,
      );
    }

    return rules;
  }

  private renderYaml(rules: string[]): string {
    if (rules.length === 0) {
      return `# Alert rules generated by Cortex — tidak ada threshold dikonfigurasi.\ngroups: []\n`;
    }
    return (
      `# Alert rules generated by Cortex (jangan edit manual — akan di-overwrite).\n` +
      `# Terakhir update: ${new Date().toISOString()}\n` +
      `groups:\n` +
      `  - name: cortex_generated\n` +
      `    rules:\n` +
      rules.join('\n')
    );
  }
}
