import { Module } from '@nestjs/common';
import { PrometheusSyncService } from './prometheus-sync.service';
import { PrometheusSyncController } from './prometheus-sync.controller';
import { AlertRulesService } from './alert-rules.service';
import { AuditLogModule } from '../audit-log/audit-log.module';

@Module({
  imports: [AuditLogModule],
  providers: [PrometheusSyncService, AlertRulesService],
  controllers: [PrometheusSyncController],
  exports: [PrometheusSyncService],
})
export class PrometheusSyncModule {}
