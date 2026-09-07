import { Module } from '@nestjs/common';
import { FileTransferService } from './file-transfer.service';
import { FileTransferController } from './file-transfer.controller';
import { SshModule } from '../ssh/ssh.module';
import { AuditLogModule } from '../audit-log/audit-log.module';

@Module({
  imports: [SshModule, AuditLogModule],
  providers: [FileTransferService],
  controllers: [FileTransferController],
})
export class FileTransferModule {}
