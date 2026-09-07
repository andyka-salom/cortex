import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { SshModule } from '../ssh/ssh.module';
import { PrometheusSyncModule } from '../prometheus-sync/prometheus-sync.module';
import { PROVISION_QUEUE } from './provisioning.constants';
import { ProvisioningService } from './provisioning.service';
import { ProvisioningProcessor } from './provisioning.processor';

@Module({
  imports: [
    BullModule.registerQueue({ name: PROVISION_QUEUE }),
    SshModule,
    PrometheusSyncModule,
  ],
  providers: [ProvisioningService, ProvisioningProcessor],
  exports: [ProvisioningService],
})
export class ProvisioningModule {}
