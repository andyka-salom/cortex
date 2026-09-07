export const PROVISION_QUEUE = 'provisioning';
export const PROVISION_JOB = 'provision-vps';

export interface ProvisionJobData {
  vpsId: string;
  /** userId pemicu (untuk audit log). Null jika sistem/otomatis. */
  triggeredBy?: string | null;
}
