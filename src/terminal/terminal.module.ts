import { Module } from '@nestjs/common';
import { AuditLogModule } from '../audit-log/audit-log.module';
import { AuthModule } from '../auth/auth.module';
import { PrismaModule } from '../prisma/prisma.module';
import { SshModule } from '../ssh/ssh.module';
import { TerminalGateway } from './terminal.gateway';
import { TerminalService } from './terminal.service';

@Module({
  imports: [PrismaModule, AuditLogModule, SshModule, AuthModule],
  providers: [TerminalGateway, TerminalService],
})
export class TerminalModule {}
