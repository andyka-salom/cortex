import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, Vps } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditLogService } from '../audit-log/audit-log.service';
import { ProvisioningService } from '../provisioning/provisioning.service';
import { PrometheusSyncService } from '../prometheus-sync/prometheus-sync.service';
import { encrypt } from '../common/crypto/crypto.util';
import { CreateVpsDto } from './dto/create-vps.dto';
import { UpdateVpsDto } from './dto/update-vps.dto';
import { BulkImportVpsDto } from './dto/bulk-import-vps.dto';

/** Field aman untuk dikirim ke client — TANPA sshPrivateKeyEnc (CLAUDE.md #1). */
const SAFE_SELECT = {
  id: true,
  name: true,
  ipAddress: true,
  sshPort: true,
  sshUser: true,
  env: true,
  group: true,
  status: true,
  provisionLog: true,
  lastSeenAt: true,
  aiAccessEnabled: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.VpsSelect;

@Injectable()
export class VpsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogService,
    private readonly provisioning: ProvisioningService,
    private readonly promSync: PrometheusSyncService,
  ) {}

  async create(dto: CreateVpsDto, actorId: string) {
    const exists = await this.prisma.vps.findUnique({
      where: { name: dto.name },
    });
    if (exists) throw new ConflictException(`VPS "${dto.name}" sudah ada.`);

    // Enkripsi key SEBELUM masuk DB. dto.privateKey plaintext tidak disimpan.
    const sshPrivateKeyEnc = encrypt(dto.privateKey);

    const vps = await this.prisma.vps.create({
      data: {
        name: dto.name,
        ipAddress: dto.ipAddress,
        sshPort: dto.sshPort ?? 22,
        sshUser: dto.sshUser,
        sshPrivateKeyEnc,
        env: dto.env,
        group: dto.group,
        status: 'PENDING',
      },
      select: SAFE_SELECT,
    });

    await this.audit.record({
      userId: actorId,
      vpsId: vps.id,
      action: 'VPS_CREATE',
      detail: `VPS ${vps.name} (${vps.ipAddress}) dibuat, status PENDING.`,
    });

    // Trigger provisioning otomatis (async via queue — PRD §6).
    await this.provisioning.enqueue({ vpsId: vps.id, triggeredBy: actorId });

    return vps;
  }

  findAll(filter: { env?: string; group?: string }) {
    return this.prisma.vps.findMany({
      where: {
        env: (filter.env as any) || undefined,
        group: filter.group || undefined,
      },
      orderBy: { createdAt: 'desc' },
      select: SAFE_SELECT,
    });
  }

  async findOne(id: string) {
    const vps = await this.prisma.vps.findUnique({
      where: { id },
      select: SAFE_SELECT,
    });
    if (!vps) throw new NotFoundException(`VPS ${id} tidak ditemukan.`);
    return vps;
  }

  /** Ambil record penuh (termasuk key terenkripsi) untuk keperluan internal saja. */
  private async getRawOrThrow(id: string): Promise<Vps> {
    const vps = await this.prisma.vps.findUnique({ where: { id } });
    if (!vps) throw new NotFoundException(`VPS ${id} tidak ditemukan.`);
    return vps;
  }

  async update(id: string, dto: UpdateVpsDto, actorId: string) {
    await this.getRawOrThrow(id);

    const data: Prisma.VpsUpdateInput = {
      name: dto.name,
      ipAddress: dto.ipAddress,
      sshPort: dto.sshPort,
      sshUser: dto.sshUser,
      env: dto.env,
      group: dto.group,
    };
    // Re-encrypt hanya bila key baru dikirim.
    if (dto.privateKey) data.sshPrivateKeyEnc = encrypt(dto.privateKey);

    const vps = await this.prisma.vps.update({
      where: { id },
      data,
      select: SAFE_SELECT,
    });

    await this.audit.record({
      userId: actorId,
      vpsId: id,
      action: 'VPS_UPDATE',
      detail:
        `VPS ${vps.name} diperbarui.` +
        (dto.privateKey ? ' SSH key diganti.' : ''),
    });

    // Kalau sudah ACTIVE dan data koneksi berubah, refresh target Prometheus.
    if (vps.status === 'ACTIVE') {
      await this.promSync.upsertTarget(await this.getRawOrThrow(id));
    }
    return vps;
  }

  async remove(id: string, actorId: string) {
    const vps = await this.getRawOrThrow(id);
    await this.prisma.vps.delete({ where: { id } });
    await this.promSync.removeTarget(id); // hapus target dari Prometheus (#5)
    await this.audit.record({
      userId: actorId,
      vpsId: null, // vps sudah dihapus; simpan nama di detail
      action: 'VPS_DELETE',
      detail: `VPS ${vps.name} (${vps.ipAddress}) dihapus.`,
    });
    return { ok: true };
  }

  /**
   * Nyalakan/matikan akses AI chat ke VPS ini (Fase 7). Default OFF —
   * Superadmin harus mengizinkan eksplisit per-VPS sebelum AiChatService
   * boleh mengusulkan/menjalankan command di VPS tersebut.
   */
  async toggleAiAccess(id: string, enabled: boolean, actorId: string) {
    const vps = await this.getRawOrThrow(id);
    await this.prisma.vps.update({
      where: { id },
      data: { aiAccessEnabled: enabled },
    });
    await this.audit.record({
      userId: actorId,
      vpsId: id,
      action: 'VPS_AI_ACCESS_TOGGLE',
      detail: `Akses AI chat ke VPS ${vps.name} di-${enabled ? 'AKTIFKAN' : 'MATIKAN'}.`,
    });
    return { ok: true, aiAccessEnabled: enabled };
  }

  /** Trigger ulang provisioning (tombol re-provision, PRD §5.2). */
  async reprovision(id: string, actorId: string) {
    const vps = await this.getRawOrThrow(id);
    await this.prisma.vps.update({
      where: { id },
      data: { status: 'PENDING' },
    });
    await this.provisioning.enqueue({ vpsId: id, triggeredBy: actorId });
    await this.audit.record({
      userId: actorId,
      vpsId: id,
      action: 'VPS_REPROVISION',
      detail: `Re-provision VPS ${vps.name} dijadwalkan.`,
    });
    return { ok: true, status: 'PENDING' };
  }

  /**
   * Bulk import VPS (Fase 6 — PRD §5.2 bulk action).
   * Setiap item diproses secara sequential agar queue tidak flooding.
   * Return array hasil per item: { name, ok, error? }.
   */
  async bulkImport(
    dto: BulkImportVpsDto,
    actorId: string,
  ): Promise<{ name: string; ok: boolean; error?: string }[]> {
    const results: { name: string; ok: boolean; error?: string }[] = [];

    for (const item of dto.items) {
      try {
        await this.create(item, actorId);
        results.push({ name: item.name, ok: true });
      } catch (err) {
        results.push({
          name: item.name,
          ok: false,
          error: (err as Error).message,
        });
      }
    }

    await this.audit.record({
      userId: actorId,
      action: 'VPS_BULK_IMPORT',
      detail: `Bulk import ${dto.items.length} VPS: ${results.filter((r) => r.ok).length} berhasil, ${results.filter((r) => !r.ok).length} gagal.`,
    });

    return results;
  }
}
