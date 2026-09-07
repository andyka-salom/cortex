import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export interface AuditEntry {
  userId?: string | null;
  vpsId?: string | null;
  action: string;
  detail: string;
}

/**
 * Audit log APPEND-ONLY (CLAUDE.md #3, PRD §7 immutable).
 * Semua aksi sensitif wajib lewat sini. Tidak ada update/delete.
 *
 * PENTING: detail JANGAN pernah berisi SSH private key / hasil decrypt / password.
 */
@Injectable()
export class AuditLogService {
  private readonly logger = new Logger(AuditLogService.name);

  constructor(private readonly prisma: PrismaService) {}

  async record(entry: AuditEntry): Promise<void> {
    try {
      await this.prisma.auditLog.create({
        data: {
          userId: entry.userId ?? null,
          vpsId: entry.vpsId ?? null,
          action: entry.action,
          detail: entry.detail,
        },
      });
    } catch (err) {
      // Audit gagal tidak boleh menelan aksi utama, tapi wajib terlihat di log app.
      this.logger.error(
        `Gagal menulis audit log (action=${entry.action}): ${
          (err as Error).message
        }`,
      );
    }
  }

  async findMany(filter: {
    userId?: string;
    vpsId?: string;
    action?: string;
    from?: Date;
    to?: Date;
    take?: number;
    skip?: number;
  }) {
    const { userId, vpsId, action, from, to, take = 100, skip = 0 } = filter;
    return this.prisma.auditLog.findMany({
      where: {
        userId: userId || undefined,
        vpsId: vpsId || undefined,
        action: action || undefined,
        createdAt:
          from || to
            ? { gte: from || undefined, lte: to || undefined }
            : undefined,
      },
      orderBy: { createdAt: 'desc' },
      take: Math.min(take, 500),
      skip,
    });
  }
}
