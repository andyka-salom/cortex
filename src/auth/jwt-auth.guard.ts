import { Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

/** Guard autentikasi JWT. Terapkan sebelum RolesGuard. */
@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {}
