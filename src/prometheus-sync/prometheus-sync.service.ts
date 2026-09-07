import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Vps } from '@prisma/client';
import { promises as fs } from 'fs';
import * as path from 'path';
import { PrismaService } from '../prisma/prisma.service';

/** Satu target group format Prometheus file_sd_configs. */
interface FileSdGroup {
  targets: string[];
  labels: Record<string, string>;
}

/**
 * Auto-sync target Prometheus via file_sd (CLAUDE.md #5, PRD §5.5).
 *
 * ATURAN:
 *  - JANGAN edit prometheus.yml langsung. Tulis file JSON per-VPS ke targets dir,
 *    Prometheus auto-reload (file_sd refresh_interval).
 *  - Label WAJIB: env + server (CLAUDE.md #7) supaya Grafana bisa filter.
 *
 * prometheus.yml sisi Prometheus harus punya:
 *   scrape_configs:
 *     - job_name: 'node'
 *       file_sd_configs:
 *         - files: ['/etc/prometheus/targets/*.json']
 */
@Injectable()
export class PrometheusSyncService {
  private readonly logger = new Logger(PrometheusSyncService.name);
  private readonly targetsDir: string;
  private readonly nodeExporterPort: number;
  private readonly cadvisorPort: number;

  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
  ) {
    this.targetsDir =
      this.config.get<string>('PROMETHEUS_TARGETS_DIR') ||
      './data/prometheus/targets';
    this.nodeExporterPort = Number(
      this.config.get('NODE_EXPORTER_PORT') || 9100,
    );
    this.cadvisorPort = Number(this.config.get('CADVISOR_PORT') || 8080);
  }

  private fileFor(vpsId: string): string {
    return path.join(this.targetsDir, `${vpsId}.json`);
  }

  private async ensureDir(): Promise<void> {
    await fs.mkdir(this.targetsDir, { recursive: true });
  }

  private buildGroups(vps: Vps): FileSdGroup[] {
    const baseLabels = {
      // Label WAJIB (CLAUDE.md #7). env di-lowercase agar konsisten di Grafana.
      env: vps.env.toLowerCase(),
      server: vps.name,
      group: vps.group,
      vps_id: vps.id,
    };
    return [
      {
        targets: [`${vps.ipAddress}:${this.nodeExporterPort}`],
        labels: { ...baseLabels, job: 'node' },
      },
      {
        targets: [`${vps.ipAddress}:${this.cadvisorPort}`],
        labels: { ...baseLabels, job: 'cadvisor' },
      },
    ];
  }

  /** Tulis / update file target untuk satu VPS. */
  async upsertTarget(vps: Vps): Promise<void> {
    await this.ensureDir();
    const groups = this.buildGroups(vps);
    const tmp = this.fileFor(vps.id) + '.tmp';
    // Tulis atomik: write tmp lalu rename, hindari Prometheus baca file setengah jadi.
    await fs.writeFile(tmp, JSON.stringify(groups, null, 2), 'utf8');
    await fs.rename(tmp, this.fileFor(vps.id));
    this.logger.log(`Prometheus target di-sync untuk VPS ${vps.name}.`);
  }

  /** Hapus file target saat VPS dihapus. */
  async removeTarget(vpsId: string): Promise<void> {
    try {
      await fs.unlink(this.fileFor(vpsId));
      this.logger.log(`Prometheus target dihapus untuk VPS ${vpsId}.`);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
      // Sudah tidak ada → aman diabaikan (idempotent).
    }
  }

  /** Regenerasi semua file target dari DB (manual re-sync, PRD §5.5). */
  async resyncAll(): Promise<{ synced: number }> {
    await this.ensureDir();
    // Hanya VPS ACTIVE yang layak di-scrape.
    const list = await this.prisma.vps.findMany({
      where: { status: 'ACTIVE' },
    });

    // Bersihkan file lama yang tidak lagi punya VPS ACTIVE.
    const valid = new Set(list.map((v) => `${v.id}.json`));
    const existing = await fs.readdir(this.targetsDir).catch(() => []);
    await Promise.all(
      existing
        .filter((f) => f.endsWith('.json') && !valid.has(f))
        .map((f) => fs.unlink(path.join(this.targetsDir, f)).catch(() => {})),
    );

    for (const vps of list) await this.upsertTarget(vps);
    return { synced: list.length };
  }
}
