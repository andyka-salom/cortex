import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Job } from 'bullmq';
import { PrismaService } from '../prisma/prisma.service';
import { SshService } from '../ssh/ssh.service';
import { AuditLogService } from '../audit-log/audit-log.service';
import { PrometheusSyncService } from '../prometheus-sync/prometheus-sync.service';
import { PROVISION_QUEUE, ProvisionJobData } from './provisioning.constants';
import { PROVISION_STEPS, ProvisionContext } from './provisioning.steps';

/**
 * BullMQ worker provisioning (PRD §6, CLAUDE.md #2).
 * Provisioning JANGAN sync/blocking — selalu lewat queue ini.
 *
 * Setiap step idempotent. Progress ditulis ke Vps.provisionLog + job.progress
 * (untuk progress real-time di UI nanti). Semua tercatat di audit log (#3).
 */
@Processor(PROVISION_QUEUE)
export class ProvisioningProcessor extends WorkerHost {
  private readonly logger = new Logger(ProvisioningProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly ssh: SshService,
    private readonly audit: AuditLogService,
    private readonly promSync: PrometheusSyncService,
    private readonly config: ConfigService,
  ) {
    super();
  }

  async process(job: Job<ProvisionJobData>): Promise<void> {
    const { vpsId, triggeredBy } = job.data;
    const vps = await this.prisma.vps.findUnique({ where: { id: vpsId } });
    if (!vps) throw new Error(`VPS ${vpsId} tidak ditemukan.`);

    const ctx: ProvisionContext = {
      vps,
      deployUser: this.config.get<string>('DEPLOY_USER') || 'deploy',
      nodeExporterPort: Number(this.config.get('NODE_EXPORTER_PORT') || 9100),
      cadvisorPort: Number(this.config.get('CADVISOR_PORT') || 8080),
    };
    const target = SshService.fromVps(vps);

    let log = `=== Provisioning mulai ${new Date().toISOString()} ===\n`;
    await this.setStatus(vpsId, 'PROVISIONING', log);
    await this.audit.record({
      userId: triggeredBy ?? null,
      vpsId,
      action: 'PROVISION_START',
      detail: `Provisioning VPS ${vps.name} (${vps.ipAddress}) dimulai.`,
    });

    const total = PROVISION_STEPS.length + 1; // +1 untuk daftar Prometheus
    try {
      for (let i = 0; i < PROVISION_STEPS.length; i++) {
        const step = PROVISION_STEPS[i];
        log += `\n[${i + 1}/${total}] ${step.label}...\n`;
        await this.setStatus(vpsId, 'PROVISIONING', log);

        const res = await this.ssh.execOrThrow(target, step.command(ctx));
        log += (res.stdout || '').trim() + '\n';
        if (res.stderr?.trim()) log += `stderr: ${res.stderr.trim()}\n`;

        await job.updateProgress(Math.round(((i + 1) / total) * 100));
        await this.setStatus(vpsId, 'PROVISIONING', log);
      }

      // Step terakhir: daftar target ke Prometheus (file_sd, #5).
      log += `\n[${total}/${total}] Daftar target Prometheus...\n`;
      await this.promSync.upsertTarget(vps);
      log += '[ok] target Prometheus tersimpan\n';

      log += `\n=== Provisioning selesai ${new Date().toISOString()} ===\n`;
      await this.setStatus(vpsId, 'ACTIVE', log, new Date());
      await job.updateProgress(100);

      await this.audit.record({
        userId: triggeredBy ?? null,
        vpsId,
        action: 'PROVISION_SUCCESS',
        detail: `VPS ${vps.name} berhasil di-provision → ACTIVE.`,
      });
    } catch (err) {
      const msg = (err as Error).message;
      log += `\n!!! ERROR: ${msg}\n`;
      await this.setStatus(vpsId, 'ERROR', log);
      await this.audit.record({
        userId: triggeredBy ?? null,
        vpsId,
        action: 'PROVISION_ERROR',
        detail: `Provisioning VPS ${vps.name} gagal: ${msg}`,
      });
      // Throw supaya BullMQ tandai job failed (bisa retry — step idempotent).
      throw err;
    }
  }

  private async setStatus(
    vpsId: string,
    status: 'PROVISIONING' | 'ACTIVE' | 'ERROR',
    provisionLog: string,
    lastSeenAt?: Date,
  ): Promise<void> {
    await this.prisma.vps.update({
      where: { id: vpsId },
      data: {
        status,
        provisionLog,
        ...(lastSeenAt ? { lastSeenAt } : {}),
      },
    });
  }
}
