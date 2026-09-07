import { Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  WebSocketGateway,
} from '@nestjs/websockets';
import { Role } from '@prisma/client';
import { Socket } from 'socket.io';
import { PrismaService } from '../prisma/prisma.service';
import { TerminalService } from './terminal.service';

interface SocketUser {
  id: string;
  email: string;
  role: Role;
}

interface StartPayload {
  vpsId: string;
  cols?: number;
  rows?: number;
}

interface ResizePayload {
  cols: number;
  rows: number;
}

/**
 * WebSocket gateway untuk web terminal (PRD §5.3).
 *
 * Auth: JWT dikirim via handshake (`auth.token` atau query `?token=`) karena
 * WS handshake browser tidak bisa set header Authorization custom dengan mudah
 * (beda dari REST yang pakai JwtAuthGuard biasa).
 *
 * RBAC (CLAUDE.md #6): dicek manual di sini (bukan RolesGuard HTTP) — Viewer
 * ditolak sesuai tabel role PRD §4 ("Viewer: tidak ada akses terminal/file").
 */
@WebSocketGateway({
  namespace: '/terminal',
  cors: { origin: '*' },
})
export class TerminalGateway
  implements OnGatewayConnection, OnGatewayDisconnect
{
  private readonly logger = new Logger(TerminalGateway.name);
  private readonly users = new Map<string, SocketUser>();

  constructor(
    private readonly jwt: JwtService,
    private readonly prisma: PrismaService,
    private readonly terminal: TerminalService,
  ) {}

  async handleConnection(client: Socket): Promise<void> {
    try {
      const token =
        (client.handshake.auth?.token as string | undefined) ||
        (client.handshake.query?.token as string | undefined);
      if (!token) throw new Error('Token tidak ada.');

      const payload = await this.jwt.verifyAsync<{ sub: string }>(token);
      const user = await this.prisma.user.findUnique({
        where: { id: payload.sub },
      });
      if (!user || !user.isActive) throw new Error('User tidak aktif.');
      if (user.role === 'VIEWER') {
        throw new Error('Role Viewer tidak punya akses terminal.');
      }

      this.users.set(client.id, {
        id: user.id,
        email: user.email,
        role: user.role,
      });
      client.emit('ready');
    } catch (err) {
      client.emit('error', { message: (err as Error).message });
      client.disconnect(true);
    }
  }

  async handleDisconnect(client: Socket): Promise<void> {
    this.users.delete(client.id);
    await this.terminal.closeSession(client.id, 'disconnect');
  }

  @SubscribeMessage('start')
  async onStart(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: StartPayload,
  ): Promise<void> {
    const user = this.users.get(client.id);
    if (!user) {
      client.emit('error', { message: 'Tidak terautentikasi.' });
      client.disconnect(true);
      return;
    }
    if (!body?.vpsId) {
      client.emit('error', { message: 'vpsId wajib diisi.' });
      return;
    }
    if (this.terminal.hasSession(client.id)) {
      client.emit('error', { message: 'Session sudah aktif di koneksi ini.' });
      return;
    }

    try {
      await this.terminal.openSession({
        socketId: client.id,
        userId: user.id,
        vpsId: body.vpsId,
        cols: body.cols || 80,
        rows: body.rows || 24,
        onData: (chunk) => client.emit('output', chunk.toString('utf8')),
        onClose: () => client.emit('closed'),
      });
      client.emit('started');
    } catch (err) {
      this.logger.warn(`Gagal buka terminal: ${(err as Error).message}`);
      client.emit('error', {
        message: `Gagal konek ke VPS: ${(err as Error).message}`,
      });
    }
  }

  @SubscribeMessage('input')
  onInput(@ConnectedSocket() client: Socket, @MessageBody() data: string): void {
    if (!this.users.has(client.id)) return;
    this.terminal.write(client.id, data);
  }

  @SubscribeMessage('resize')
  onResize(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: ResizePayload,
  ): void {
    if (!this.users.has(client.id) || !body) return;
    this.terminal.resize(client.id, body.cols, body.rows);
  }
}
