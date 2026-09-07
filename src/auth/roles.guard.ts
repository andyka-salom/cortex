import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Role } from '@prisma/client';
import { ROLES_KEY } from './roles.decorator';
import { AuthUser } from './current-user.decorator';

/**
 * RBAC guard (CLAUDE.md #6): role dicek di server, bukan cuma UI.
 * Jalan setelah JwtAuthGuard (req.user sudah terisi).
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<Role[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    // Tidak ada @Roles → cukup terautentikasi.
    if (!required || required.length === 0) return true;

    const user: AuthUser | undefined = context
      .switchToHttp()
      .getRequest().user;
    if (!user) throw new ForbiddenException('Tidak terautentikasi.');

    if (!required.includes(user.role)) {
      throw new ForbiddenException(
        `Role ${user.role} tidak diizinkan mengakses resource ini.`,
      );
    }
    return true;
  }
}
