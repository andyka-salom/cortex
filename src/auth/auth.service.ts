import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../prisma/prisma.service';
import { AuditLogService } from '../audit-log/audit-log.service';

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly audit: AuditLogService,
  ) {}

  async login(email: string, password: string) {
    const user = await this.prisma.user.findUnique({ where: { email } });
    // Pesan error seragam agar tidak bocorkan apakah email terdaftar.
    const invalid = () =>
      new UnauthorizedException('Email atau password salah.');

    if (!user || !user.isActive) throw invalid();

    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) throw invalid();

    const token = await this.jwt.signAsync({
      sub: user.id,
      email: user.email,
      role: user.role,
    });

    await this.audit.record({
      userId: user.id,
      action: 'LOGIN',
      detail: `User ${user.email} login.`,
    });

    return {
      accessToken: token,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
      },
    };
  }

  async logout(userId: string, email: string) {
    // Stateless JWT: logout hanya dicatat di audit (token di-drop di client).
    await this.audit.record({
      userId,
      action: 'LOGOUT',
      detail: `User ${email} logout.`,
    });
    return { ok: true };
  }
}
