import { Module } from '@nestjs/common';
import { ProvisioningModule } from '../provisioning/provisioning.module';
import { PrometheusSyncModule } from '../prometheus-sync/prometheus-sync.module';
import { VpsService } from './vps.service';
import { VpsController } from './vps.controller';

@Module({
  imports: [ProvisioningModule, PrometheusSyncModule],
  providers: [VpsService],
  controllers: [VpsController],
  exports: [VpsService],
})
export class VpsModule {}
