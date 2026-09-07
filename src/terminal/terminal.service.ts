import { Injectable, Logger } from '@nestjs/common';
import { NodeSSH } from 'node-ssh';
import { ClientChannel } from 'ssh2';
import { PrismaService } from '../prisma/prisma.service';
import { AuditLogService } from '../audit-log/audit-log.service';
import { SshService, SshTarget } from '../ssh/ssh.service';

interface OpenSessionParams {
  socketId: string;
  userId: string;
  vpsId: string;
  cols: number;
  rows: number;
  onData: (chunk: Buffer) => void;
  onClose: () => void;
}

interface SessionHandle {
  sessionId: string;
  userId: string;
  vpsId: string;
  ssh: NodeSSH;
  channel: ClientChannel;
  commandBuffer: string;
  commandLog: string[];
}

/**
 * Orkestrasi session terminal interaktif (PRD §5.3).
 * 1 socket WebSocket = maksimal 1 session SSH aktif, dikunci by `socketId`.
 *
 * ATURAN (CLAUDE.md #1, #3): private key hanya di-decrypt in-memory di SshService,
 * tidak pernah muncul di sini. Semua session masuk audit log (start & end) dan
 * command yang diketik dicatat di TerminalSession.commandLog (append-only per session).
 */
@Injectable()
export class TerminalService {
  private readonly logger = new Logger(TerminalService.name);
  private readonly sessions = new Map<string, SessionHandle>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly ssh: SshService,
    private readonly audit: AuditLogService,
  ) {}

  hasSession(socketId: string): boolean {
    return this.sessions.has(socketId);
  }

  async openSession(params: OpenSessionParams): Promise<void> {
    const vps = await this.prisma.vps.findUnique({
      where: { id: params.vpsId },
    });
    if (!vps) throw new Error(`VPS ${params.vpsId} tidak ditemukan.`);

    const target: SshTarget = SshService.fromVps(vps);
    const ssh = await this.ssh.openConnection(target);

    let channel: ClientChannel;
    try {
      channel = await ssh.requestShell({
        term: 'xterm-256color',
        cols: params.cols,
        rows: params.rows,
      });
    } catch (err) {
      ssh.dispose();
      throw err;
    }

    const dbSession = await this.prisma.terminalSession.create({
      data: { userId: params.userId, vpsId: params.vpsId },
    });

    const handle: SessionHandle = {
      sessionId: dbSession.id,
      userId: params.userId,
      vpsId: params.vpsId,
      ssh,
      channel,
      commandBuffer: '',
      commandLog: [],
    };
    this.sessions.set(params.socketId, handle);

    channel.on('data', (chunk: Buffer) => params.onData(chunk));
    channel.stderr.on('data', (chunk: Buffer) => params.onData(chunk));
    channel.on('close', () => {
      params.onClose();
      void this.closeSession(params.socketId, 'remote-closed');
    });

    await this.audit.record({
      userId: params.userId,
      vpsId: params.vpsId,
      action: 'TERMINAL_SESSION_START',
      detail: `Terminal session ${dbSession.id} dibuka ke VPS ${vps.name} (${vps.ipAddress}).`,
    });
    this.logger.log(
      `Terminal session ${dbSession.id} dibuka: user=${params.userId} vps=${vps.name}`,
    );
  }

  write(socketId: string, data: string): void {
    const handle = this.sessions.get(socketId);
    if (!handle) return;
    handle.channel.write(data);
    this.trackCommand(handle, data);
  }

  resize(socketId: string, cols: number, rows: number): void {
    const handle = this.sessions.get(socketId);
    if (!handle || !cols || !rows) return;
    handle.channel.setWindow(rows, cols, 0, 0);
  }

  async closeSession(socketId: string, reason: string): Promise<void> {
    const handle = this.sessions.get(socketId);
    if (!handle) return;
    this.sessions.delete(socketId);

    try {
      handle.channel.end();
    } catch {
      // channel mungkin sudah tertutup dari sisi remote — aman diabaikan.
    }
    handle.ssh.dispose();

    if (handle.commandBuffer.trim()) {
      handle.commandLog.push(handle.commandBuffer);
    }

    await this.prisma.terminalSession.update({
      where: { id: handle.sessionId },
      data: {
        endedAt: new Date(),
        commandLog: handle.commandLog.join('\n'),
      },
    });

    await this.audit.record({
      userId: handle.userId,
      vpsId: handle.vpsId,
      action: 'TERMINAL_SESSION_END',
      detail: `Terminal session ${handle.sessionId} ditutup (${reason}). ${handle.commandLog.length} command tercatat.`,
    });
    this.logger.log(`Terminal session ${handle.sessionId} ditutup: ${reason}`);
  }

  /**
   * Pecah raw keystroke jadi baris command untuk audit trail.
   * Best-effort (bukan parser VT100 penuh): skip sequence ANSI (arrow key, dll),
   * tangani backspace & Enter. Cukup untuk audit "command apa yang diketik",
   * bukan untuk merender ulang tampilan terminal.
   */
  private trackCommand(handle: SessionHandle, data: string): void {
    let i = 0;
    while (i < data.length) {
      const code = data.charCodeAt(i);

      if (code === 27) {
        // ESC — lewati CSI sequence (mis. \x1b[A untuk arrow up) sampai byte final.
        i++;
        if (data[i] === '[') {
          i++;
          while (
            i < data.length &&
            !(data.charCodeAt(i) >= 0x40 && data.charCodeAt(i) <= 0x7e)
          ) {
            i++;
          }
        }
        i++;
        continue;
      }

      const ch = data[i];
      if (ch === '\r' || ch === '\n') {
        if (handle.commandBuffer.trim()) {
          handle.commandLog.push(handle.commandBuffer);
        }
        handle.commandBuffer = '';
      } else if (code === 127 || code === 8) {
        handle.commandBuffer = handle.commandBuffer.slice(0, -1);
      } else if (code === 3) {
        // Ctrl+C — buang buffer command yang belum selesai.
        handle.commandBuffer = '';
      } else if (code >= 32) {
        handle.commandBuffer += ch;
      }
      i++;
    }
  }
}
