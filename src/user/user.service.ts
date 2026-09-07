import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../prisma/prisma.service';
import { AuditLogService } from '../audit-log/audit-log.service';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';

/** Kolom yang aman dikirim ke frontend (tanpa passwordHash). */
const userSafeSelect = {
  id: true,
  name: true,
  email: true,
  role: true,
  isActive: true,
  createdAt: true,
  updatedAt: true,
};

@Injectable()
export class UserService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogService,
  ) {}

  async findAll() {
    return this.prisma.user.findMany({
      select: {
        ...userSafeSelect,
        _count: {
          select: { auditLogs: true, terminalSessions: true },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findOne(id: string) {
    const user = await this.prisma.user.findUnique({
      where: { id },
      select: userSafeSelect,
    });
    if (!user) throw new NotFoundException(`User ${id} tidak ditemukan.`);
    return user;
  }

  async create(dto: CreateUserDto, actorId: string) {
    const exists = await this.prisma.user.findUnique({
      where: { email: dto.email },
    });
    if (exists) {
      throw new ConflictException(`Email ${dto.email} sudah terdaftar.`);
    }

    const passwordHash = await bcrypt.hash(dto.password, 12);
    const user = await this.prisma.user.create({
      data: {
        name: dto.name,
        email: dto.email,
        passwordHash,
        role: dto.role,
        isActive: true,
      },
      select: userSafeSelect,
    });

    await this.audit.record({
      userId: actorId,
      action: 'USER_CREATE',
      detail: `User baru dibuat: ${user.email} (role: ${user.role})`,
    });

    return user;
  }

  async update(id: string, dto: UpdateUserDto, actorId: string) {
    await this.getOrThrow(id);

    // Cek email duplikat jika diubah
    if (dto.email) {
      const dup = await this.prisma.user.findFirst({
        where: { email: dto.email, NOT: { id } },
      });
      if (dup) throw new ConflictException(`Email ${dto.email} sudah digunakan.`);
    }

    const updated = await this.prisma.user.update({
      where: { id },
      data: {
        name: dto.name,
        email: dto.email,
        role: dto.role,
        isActive: dto.isActive,
      },
      select: userSafeSelect,
    });

    await this.audit.record({
      userId: actorId,
      action: 'USER_UPDATE',
      detail: `User ${updated.email} diupdate: ${JSON.stringify(dto)}`,
    });

    return updated;
  }

  async resetPassword(id: string, newPassword: string, actorId: string) {
    const user = await this.getOrThrow(id);
    const passwordHash = await bcrypt.hash(newPassword, 12);
    await this.prisma.user.update({
      where: { id },
      data: { passwordHash },
    });

    await this.audit.record({
      userId: actorId,
      action: 'USER_PASSWORD_RESET',
      detail: `Password user ${user.email} di-reset.`,
    });

    return { ok: true };
  }

  /**
   * Nonaktifkan user (soft delete — bukan hapus).
   * Tidak boleh nonaktifkan diri sendiri.
   */
  async deactivate(id: string, actorId: string) {
    if (id === actorId) {
      throw new ForbiddenException('Tidak bisa menonaktifkan akun sendiri.');
    }
    const user = await this.getOrThrow(id);
    await this.prisma.user.update({
      where: { id },
      data: { isActive: false },
    });

    await this.audit.record({
      userId: actorId,
      action: 'USER_DEACTIVATE',
      detail: `User ${user.email} dinonaktifkan.`,
    });

    return { ok: true };
  }

  /** Aktifkan kembali user yang dinonaktifkan. */
  async activate(id: string, actorId: string) {
    const user = await this.getOrThrow(id);
    await this.prisma.user.update({
      where: { id },
      data: { isActive: true },
    });

    await this.audit.record({
      userId: actorId,
      action: 'USER_ACTIVATE',
      detail: `User ${user.email} diaktifkan kembali.`,
    });

    return { ok: true };
  }

  private async getOrThrow(id: string) {
    const user = await this.prisma.user.findUnique({ where: { id } });
    if (!user) throw new NotFoundException(`User ${id} tidak ditemukan.`);
    return user;
  }
}
