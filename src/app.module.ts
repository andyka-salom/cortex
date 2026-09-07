import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { BullModule } from '@nestjs/bullmq';
import { PrismaModule } from './prisma/prisma.module';
import { AuditLogModule } from './audit-log/audit-log.module';
import { AuthModule } from './auth/auth.module';
import { SshModule } from './ssh/ssh.module';
import { PrometheusSyncModule } from './prometheus-sync/prometheus-sync.module';
import { ProvisioningModule } from './provisioning/provisioning.module';
import { TerminalModule } from './terminal/terminal.module';
import { VpsModule } from './vps/vps.module';
import { FileTransferModule } from './file-transfer/file-transfer.module';
import { MonitoringModule } from './monitoring/monitoring.module';
import { UserModule } from './user/user.module';
import { AppController } from './app.controller';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    // Koneksi Redis untuk BullMQ (queue provisioning).
    BullModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        connection: {
          host: config.get<string>('REDIS_HOST') || 'localhost',
          port: Number(config.get('REDIS_PORT') || 6379),
        },
      }),
    }),
    PrismaModule,
    AuditLogModule,
    AuthModule,
    SshModule,
    PrometheusSyncModule,
    ProvisioningModule,
    TerminalModule,
    VpsModule,
    FileTransferModule,
    MonitoringModule,
    UserModule,
  ],
  controllers: [AppController],
})
export class AppModule {}
