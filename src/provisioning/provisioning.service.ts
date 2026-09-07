import { InjectQueue } from '@nestjs/bullmq';
import { Injectable } from '@nestjs/common';
import { Queue } from 'bullmq';
import {
  PROVISION_JOB,
  PROVISION_QUEUE,
  ProvisionJobData,
} from './provisioning.constants';

/**
 * Enqueue job provisioning ke BullMQ (JANGAN jalankan sync — CLAUDE.md).
 * Dipakai VpsService saat VPS dibuat / re-provision.
 */
@Injectable()
export class ProvisioningService {
  constructor(
    @InjectQueue(PROVISION_QUEUE) private readonly queue: Queue,
  ) {}

  async enqueue(data: ProvisionJobData) {
    return this.queue.add(PROVISION_JOB, data, {
      attempts: 3, // step idempotent → aman retry
      backoff: { type: 'exponential', delay: 5000 },
      removeOnComplete: 100,
      removeOnFail: 500,
    });
  }
}
