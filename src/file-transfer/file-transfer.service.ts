import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Client, SFTPWrapper, FileEntry } from 'ssh2';
import { PrismaService } from '../prisma/prisma.service';
import { AuditLogService } from '../audit-log/audit-log.service';
import { decrypt } from '../common/crypto/crypto.util';
import * as path from 'path';

export interface RemoteFileEntry {
  name: string;
  longname: string;
  isDir: boolean;
  size: number;
  modifiedAt: Date;
  permissions: string;
}

/**
 * SFTP File Transfer Service (PRD §5.4, CLAUDE.md #4).
 *
 * ATURAN KEAMANAN:
 * 1. Path remote wajib whitelist (validasi di validatePath).
 * 2. SSH private key TIDAK pernah di-log.
 * 3. Semua operasi dicatat ke FileTransferLog + AuditLog.
 */
@Injectable()
export class FileTransferService {
  private readonly logger = new Logger(FileTransferService.name);
  private readonly allowedPaths: string[];

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogService,
    private readonly config: ConfigService,
  ) {
    // Default: /tmp dan /home. Set FILE_TRANSFER_ALLOWED_PATHS di .env untuk override.
    const raw =
      this.config.get<string>('FILE_TRANSFER_ALLOWED_PATHS') || '/tmp,/home,/var/www,/opt';
    this.allowedPaths = raw.split(',').map((p) => p.trim());
  }

  /** Daftar root path yang diizinkan — dipakai UI untuk pintasan & navigasi. */
  getAllowedPaths(): string[] {
    return [...this.allowedPaths];
  }

  /**
   * Validasi remote path terhadap whitelist (CLAUDE.md #4).
   * Throw BadRequestException jika tidak diizinkan.
   */
  private validatePath(remotePath: string): void {
    // Normalize untuk mencegah path traversal (/../)
    const normalized = path.posix.normalize('/' + remotePath).replace(/\\/g, '/');
    const allowed = this.allowedPaths.some(
      (allowed) =>
        normalized === allowed ||
        normalized.startsWith(allowed.endsWith('/') ? allowed : allowed + '/'),
    );
    if (!allowed) {
      throw new BadRequestException(
        `Path "${remotePath}" tidak diizinkan. Path yang diizinkan: ${this.allowedPaths.join(', ')}`,
      );
    }
  }

  /** Buka koneksi SFTP ke VPS (ssh2 Client). Caller wajib close. */
  private openSftp(
    host: string,
    port: number,
    username: string,
    privateKeyEnc: string,
  ): Promise<{ client: Client; sftp: SFTPWrapper }> {
    return new Promise((resolve, reject) => {
      const client = new Client();
      client.on('ready', () => {
        client.sftp((err, sftp) => {
          if (err) {
            client.end();
            return reject(err);
          }
          resolve({ client, sftp });
        });
      });
      client.on('error', reject);

      const privateKey = decrypt(privateKeyEnc); // in-memory only — JANGAN LOG
      client.connect({
        host,
        port,
        username,
        privateKey,
        readyTimeout: 20_000,
      });
    });
  }

  /** Ambil VPS dari DB, throw NotFoundException kalau tidak ada. */
  private async getVps(vpsId: string) {
    const vps = await this.prisma.vps.findUnique({ where: { id: vpsId } });
    if (!vps) throw new NotFoundException(`VPS ${vpsId} tidak ditemukan.`);
    return vps;
  }

  /**
   * List isi direktori remote.
   */
  async listDir(vpsId: string, remotePath: string): Promise<RemoteFileEntry[]> {
    this.validatePath(remotePath);
    const vps = await this.getVps(vpsId);

    const { client, sftp } = await this.openSftp(
      vps.ipAddress,
      vps.sshPort,
      vps.sshUser,
      vps.sshPrivateKeyEnc,
    );

    return new Promise<RemoteFileEntry[]>((resolve, reject) => {
      sftp.readdir(remotePath, (err, list) => {
        client.end();
        if (err) {
          return reject(
            new BadRequestException(`Gagal list direktori: ${err.message}`),
          );
        }
        const entries: RemoteFileEntry[] = (list as FileEntry[]).map((f) => ({
          name: f.filename,
          longname: f.longname,
          isDir: (f.attrs.mode & 0o040000) !== 0,
          size: f.attrs.size ?? 0,
          modifiedAt: new Date((f.attrs.mtime ?? 0) * 1000),
          permissions: (f.attrs.mode ?? 0).toString(8).slice(-4),
        }));
        // Sort: direktori duluan, lalu file, alphabetical
        entries.sort((a, b) => {
          if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
          return a.name.localeCompare(b.name);
        });
        resolve(entries);
      });
    });
  }

  /**
   * Upload file ke VPS.
   * @param fileBuffer - Buffer konten file
   * @param fileName   - Nama file yang akan disimpan
   * @param remotePath - Path direktori tujuan di VPS
   */
  async upload(
    vpsId: string,
    userId: string,
    fileBuffer: Buffer,
    fileName: string,
    remotePath: string,
  ): Promise<{ ok: boolean; fullPath: string }> {
    this.validatePath(remotePath);
    const vps = await this.getVps(vpsId);

    const fullRemotePath = path.posix.join(remotePath, path.basename(fileName));
    const { client, sftp } = await this.openSftp(
      vps.ipAddress,
      vps.sshPort,
      vps.sshUser,
      vps.sshPrivateKeyEnc,
    );

    await new Promise<void>((resolve, reject) => {
      sftp.writeFile(fullRemotePath, fileBuffer, (err) => {
        client.end();
        if (err) return reject(new BadRequestException(`Upload gagal: ${err.message}`));
        resolve();
      });
    });

    // Catat ke FileTransferLog + AuditLog
    await this.prisma.fileTransferLog.create({
      data: {
        userId,
        vpsId,
        direction: 'UPLOAD',
        remotePath: fullRemotePath,
        fileSize: BigInt(fileBuffer.length),
      },
    });
    await this.audit.record({
      userId,
      vpsId,
      action: 'FILE_UPLOAD',
      detail: `Upload file ke ${vps.name}:${fullRemotePath} (${fileBuffer.length} bytes)`,
    });

    this.logger.log(`Upload ${fullRemotePath} ke VPS ${vps.name} berhasil.`);
    return { ok: true, fullPath: fullRemotePath };
  }

  /**
   * Download file dari VPS. Mengembalikan Buffer konten file.
   */
  async download(
    vpsId: string,
    userId: string,
    remotePath: string,
  ): Promise<{ buffer: Buffer; fileName: string }> {
    this.validatePath(remotePath);
    const vps = await this.getVps(vpsId);

    const { client, sftp } = await this.openSftp(
      vps.ipAddress,
      vps.sshPort,
      vps.sshUser,
      vps.sshPrivateKeyEnc,
    );

    const buffer = await new Promise<Buffer>((resolve, reject) => {
      sftp.readFile(remotePath, (err, data) => {
        client.end();
        if (err) return reject(new BadRequestException(`Download gagal: ${err.message}`));
        resolve(data as Buffer);
      });
    });

    const fileSize = buffer.length;
    await this.prisma.fileTransferLog.create({
      data: {
        userId,
        vpsId,
        direction: 'DOWNLOAD',
        remotePath,
        fileSize: BigInt(fileSize),
      },
    });
    await this.audit.record({
      userId,
      vpsId,
      action: 'FILE_DOWNLOAD',
      detail: `Download file dari ${vps.name}:${remotePath} (${fileSize} bytes)`,
    });

    this.logger.log(`Download ${remotePath} dari VPS ${vps.name} berhasil.`);
    return { buffer, fileName: path.basename(remotePath) };
  }

  /**
   * List riwayat transfer file (filter by vpsId atau userId).
   */
  async listTransferLogs(filter: {
    vpsId?: string;
    userId?: string;
    take?: number;
    skip?: number;
  }) {
    const { vpsId, userId, take = 50, skip = 0 } = filter;
    return this.prisma.fileTransferLog.findMany({
      where: {
        vpsId: vpsId || undefined,
        userId: userId || undefined,
      },
      orderBy: { createdAt: 'desc' },
      take: Math.min(take, 200),
      skip,
      include: {
        user: { select: { id: true, name: true, email: true } },
        vps: { select: { id: true, name: true } },
      },
    });
  }
}
