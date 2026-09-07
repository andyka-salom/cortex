import {
  Controller,
  Get,
  Post,
  Query,
  Param,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Role } from '@prisma/client';
import { Response } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { CurrentUser, AuthUser } from '../auth/current-user.decorator';
import { FileTransferService } from './file-transfer.service';

/**
 * File Transfer endpoints (PRD §5.4).
 * Viewer tidak punya akses (RBAC: Operator+).
 */
@Controller('file-transfer')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.OPERATOR, Role.SUPERADMIN)
export class FileTransferController {
  constructor(private readonly fileTransfer: FileTransferService) {}

  /** List isi direktori remote VPS. */
  @Get(':vpsId/list')
  listDir(
    @Param('vpsId') vpsId: string,
    @Query('path') remotePath: string = '/home',
  ) {
    return this.fileTransfer.listDir(vpsId, remotePath);
  }

  /**
   * Upload file ke VPS.
   * multipart/form-data: field "file" (file), field "path" (remote directory).
   */
  @Post(':vpsId/upload')
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: 100 * 1024 * 1024 }, // max 100 MB
    }),
  )
  async upload(
    @Param('vpsId') vpsId: string,
    @UploadedFile() file: Express.Multer.File,
    @Query('path') remotePath: string = '/tmp',
    @CurrentUser() user: AuthUser,
  ) {
    return this.fileTransfer.upload(
      vpsId,
      user.id,
      file.buffer,
      file.originalname,
      remotePath,
    );
  }

  /**
   * Download file dari VPS.
   * Path file remote di query param `path`.
   */
  @Get(':vpsId/download')
  async download(
    @Param('vpsId') vpsId: string,
    @Query('path') remotePath: string,
    @CurrentUser() user: AuthUser,
    @Res() res: Response,
  ) {
    const { buffer, fileName } = await this.fileTransfer.download(
      vpsId,
      user.id,
      remotePath,
    );
    res.set({
      'Content-Type': 'application/octet-stream',
      'Content-Disposition': `attachment; filename="${encodeURIComponent(fileName)}"`,
      'Content-Length': buffer.length,
    });
    res.end(buffer);
  }

  /** Riwayat transfer file per VPS. */
  @Get(':vpsId/logs')
  transferLogs(
    @Param('vpsId') vpsId: string,
    @Query('take') take?: string,
    @Query('skip') skip?: string,
  ) {
    return this.fileTransfer.listTransferLogs({
      vpsId,
      take: take ? Number(take) : undefined,
      skip: skip ? Number(skip) : undefined,
    });
  }
}
