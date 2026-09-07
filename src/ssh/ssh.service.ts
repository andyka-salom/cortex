import { Injectable, Logger } from '@nestjs/common';
import { NodeSSH, Config as NodeSSHConfig } from 'node-ssh';
import { Vps } from '@prisma/client';
import { decrypt } from '../common/crypto/crypto.util';

export interface SshExecResult {
  stdout: string;
  stderr: string;
  code: number | null;
}

export interface SshTarget {
  host: string;
  port: number;
  username: string;
  /** SSH private key TERENKRIPSI (dari DB). Di-decrypt hanya di dalam service ini. */
  privateKeyEnc: string;
}

/**
 * Layer eksekusi SSH ke VPS target.
 *
 * ATURAN (CLAUDE.md #1): private key di-decrypt hanya di memory saat konek,
 * TIDAK PERNAH di-log. Jangan tambahkan logging yang mencetak `privateKey`.
 */
@Injectable()
export class SshService {
  private readonly logger = new Logger(SshService.name);

  static fromVps(vps: Vps): SshTarget {
    return {
      host: vps.ipAddress,
      port: vps.sshPort,
      username: vps.sshUser,
      privateKeyEnc: vps.sshPrivateKeyEnc,
    };
  }

  /** Buka koneksi baru. Caller wajib memanggil dispose() (lihat withConnection). */
  private async connect(target: SshTarget): Promise<NodeSSH> {
    const ssh = new NodeSSH();
    const config: NodeSSHConfig = {
      host: target.host,
      port: target.port,
      username: target.username,
      privateKey: decrypt(target.privateKeyEnc), // in-memory only
      readyTimeout: 20_000,
    };
    await ssh.connect(config);
    return ssh;
  }

  /**
   * Buka koneksi untuk dipakai interaktif (web terminal — PRD §5.3).
   * Berbeda dari withConnection: koneksi TIDAK auto-close, caller (TerminalService)
   * yang bertanggung jawab memanggil ssh.dispose() saat session berakhir.
   */
  async openConnection(target: SshTarget): Promise<NodeSSH> {
    return this.connect(target);
  }

  /**
   * Jalankan fn dengan koneksi SSH yang otomatis ditutup.
   * Pola ini memastikan koneksi (dan key di memory) tidak menggantung.
   */
  async withConnection<T>(
    target: SshTarget,
    fn: (ssh: NodeSSH) => Promise<T>,
  ): Promise<T> {
    const ssh = await this.connect(target);
    try {
      return await fn(ssh);
    } finally {
      ssh.dispose();
    }
  }

  /** Eksekusi satu command (via bash -lc). Tidak throw pada non-zero exit. */
  async exec(
    target: SshTarget,
    command: string,
  ): Promise<SshExecResult> {
    return this.withConnection(target, async (ssh) => {
      const res = await ssh.execCommand(command);
      return { stdout: res.stdout, stderr: res.stderr, code: res.code };
    });
  }

  /** Eksekusi command dan throw kalau exit code != 0. */
  async execOrThrow(
    target: SshTarget,
    command: string,
  ): Promise<SshExecResult> {
    const res = await this.exec(target, command);
    if (res.code !== 0) {
      throw new Error(
        `Command gagal (exit ${res.code}): ${command}\n${res.stderr}`,
      );
    }
    return res;
  }

  /** Tes konektivitas dasar (dipakai health check / sebelum provisioning). */
  async ping(target: SshTarget): Promise<boolean> {
    try {
      const res = await this.exec(target, 'echo cortex-ok');
      return res.code === 0 && res.stdout.includes('cortex-ok');
    } catch (err) {
      this.logger.warn(
        `SSH ping gagal ke ${target.host}: ${(err as Error).message}`,
      );
      return false;
    }
  }
}
