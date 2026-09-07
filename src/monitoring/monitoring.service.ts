import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AuditLogService } from '../audit-log/audit-log.service';

export interface VpsMetrics {
  vpsId: string;
  vpsName: string;
  cpuUsagePercent: number | null;
  memUsagePercent: number | null;
  diskUsagePercent: number | null;
  available: boolean;
}

export interface AlertInfo {
  fingerprint: string;
  status: 'firing' | 'resolved';
  labels: Record<string, string>;
  annotations: Record<string, string>;
  startsAt: string;
  endsAt: string;
  generatorURL: string;
  silenced: boolean;
}

/**
 * Monitoring Service — integrasikan Prometheus & Alertmanager.
 *
 * Jika PROMETHEUS_URL / ALERTMANAGER_URL tidak dikonfigurasi, return data kosong
 * dengan flag `configured: false` agar UI bisa tampilkan pesan yang tepat.
 */
@Injectable()
export class MonitoringService {
  private readonly logger = new Logger(MonitoringService.name);
  private readonly prometheusUrl: string | null;
  private readonly alertmanagerUrl: string | null;

  constructor(
    private readonly config: ConfigService,
    private readonly audit: AuditLogService,
  ) {
    this.prometheusUrl = this.config.get<string>('PROMETHEUS_URL') || null;
    this.alertmanagerUrl = this.config.get<string>('ALERTMANAGER_URL') || null;
  }

  /** Prometheus query helper. */
  private async promQuery(
    query: string,
  ): Promise<{ metric: Record<string, string>; value: [number, string] }[]> {
    if (!this.prometheusUrl) return [];
    try {
      const url = `${this.prometheusUrl}/api/v1/query?query=${encodeURIComponent(query)}`;
      const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
      if (!res.ok) return [];
      const json: any = await res.json();
      if (json.status !== 'success') return [];
      return json.data?.result ?? [];
    } catch (err) {
      this.logger.warn(`Prometheus query gagal: ${(err as Error).message}`);
      return [];
    }
  }

  /**
   * Ambil metric CPU/RAM/Disk per VPS.
   * Metric diidentifikasi via label `server` (nama VPS).
   */
  async getMetrics(vpsNames: string[]): Promise<VpsMetrics[]> {
    if (!this.prometheusUrl) {
      return vpsNames.map((name) => ({
        vpsId: '',
        vpsName: name,
        cpuUsagePercent: null,
        memUsagePercent: null,
        diskUsagePercent: null,
        available: false,
      }));
    }

    // CPU: 100 - avg idle%
    const cpuQuery = `100 - (avg by (server) (irate(node_cpu_seconds_total{mode="idle"}[5m])) * 100)`;
    // Memory: used% = (total - available) / total * 100
    const memQuery = `(1 - (node_memory_MemAvailable_bytes / node_memory_MemTotal_bytes)) * 100`;
    // Disk root: used%
    const diskQuery = `(1 - (node_filesystem_avail_bytes{mountpoint="/",fstype!="tmpfs"} / node_filesystem_size_bytes{mountpoint="/",fstype!="tmpfs"})) * 100`;

    const [cpuResults, memResults, diskResults] = await Promise.all([
      this.promQuery(cpuQuery),
      this.promQuery(memQuery),
      this.promQuery(diskQuery),
    ]);

    const toMap = (
      results: { metric: Record<string, string>; value: [number, string] }[],
      labelKey: string,
    ) =>
      new Map(
        results.map((r) => [r.metric[labelKey], parseFloat(r.value[1])]),
      );

    const cpuMap = toMap(cpuResults, 'server');
    const memMap = toMap(memResults, 'server');
    const diskMap = toMap(diskResults, 'instance');

    return vpsNames.map((name) => ({
      vpsId: '',
      vpsName: name,
      cpuUsagePercent: cpuMap.get(name) ?? null,
      memUsagePercent: memMap.get(name) ?? null,
      diskUsagePercent: diskMap.get(name) ?? null,
      available: cpuMap.has(name) || memMap.has(name),
    }));
  }

  /** Apakah Prometheus terkonfigurasi. */
  get prometheusConfigured(): boolean {
    return !!this.prometheusUrl;
  }

  /** Apakah Alertmanager terkonfigurasi. */
  get alertmanagerConfigured(): boolean {
    return !!this.alertmanagerUrl;
  }

  /**
   * Ambil semua alert aktif dari Alertmanager.
   */
  async getAlerts(filter?: {
    silenced?: boolean;
    inhibited?: boolean;
  }): Promise<{ configured: boolean; alerts: AlertInfo[] }> {
    if (!this.alertmanagerUrl) {
      return { configured: false, alerts: [] };
    }

    try {
      const params = new URLSearchParams();
      if (filter?.silenced !== undefined)
        params.set('silenced', String(filter.silenced));
      if (filter?.inhibited !== undefined)
        params.set('inhibited', String(filter.inhibited));

      const url = `${this.alertmanagerUrl}/api/v2/alerts${params.toString() ? '?' + params : ''}`;
      const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
      if (!res.ok) {
        this.logger.warn(`Alertmanager response ${res.status}`);
        return { configured: true, alerts: [] };
      }

      const data: any[] = await res.json();
      const alerts: AlertInfo[] = data.map((a) => ({
        fingerprint: a.fingerprint,
        status: a.status?.state ?? 'firing',
        labels: a.labels ?? {},
        annotations: a.annotations ?? {},
        startsAt: a.startsAt,
        endsAt: a.endsAt,
        generatorURL: a.generatorURL ?? '',
        silenced: a.status?.silencedBy?.length > 0,
      }));
      return { configured: true, alerts };
    } catch (err) {
      this.logger.warn(`Gagal fetch Alertmanager: ${(err as Error).message}`);
      return { configured: true, alerts: [] };
    }
  }

  /**
   * Silence alert via Alertmanager API.
   */
  async silenceAlert(
    userId: string,
    userEmail: string,
    matchers: { name: string; value: string; isRegex: boolean }[],
    comment: string,
    durationHours: number = 4,
  ): Promise<{ silenceId: string }> {
    if (!this.alertmanagerUrl) {
      throw new Error('Alertmanager tidak terkonfigurasi.');
    }

    const now = new Date();
    const endsAt = new Date(now.getTime() + durationHours * 3600_000);

    const body = {
      matchers,
      startsAt: now.toISOString(),
      endsAt: endsAt.toISOString(),
      createdBy: userEmail,
      comment,
    };

    const res = await fetch(`${this.alertmanagerUrl}/api/v2/silences`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(5000),
    });

    if (!res.ok) {
      throw new Error(`Alertmanager silence gagal: ${res.status}`);
    }

    const data: any = await res.json();
    await this.audit.record({
      userId,
      action: 'ALERT_SILENCED',
      detail: `Silence alert (${durationHours}h): ${comment}. Matchers: ${JSON.stringify(matchers)}`,
    });

    return { silenceId: data.silenceID };
  }

  /**
   * Ambil ringkasan: jumlah alert firing, resolved, silenced.
   */
  async getAlertSummary(): Promise<{
    configured: boolean;
    firing: number;
    silenced: number;
    total: number;
  }> {
    const { configured, alerts } = await this.getAlerts();
    return {
      configured,
      total: alerts.length,
      firing: alerts.filter((a) => a.status === 'firing' && !a.silenced).length,
      silenced: alerts.filter((a) => a.silenced).length,
    };
  }
}
