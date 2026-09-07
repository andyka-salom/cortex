import { Vps } from '@prisma/client';

/**
 * Definisi step provisioning. SEMUA command WAJIB idempotent (CLAUDE.md #2):
 * cek kondisi dulu sebelum eksekusi, aman dijalankan ulang tanpa efek samping.
 *
 * Asumsi target: Ubuntu generik, akses SSH sebagai user dengan sudo NOPASSWD
 * (atau root). Command dibungkus `sudo -n` bila perlu privilege.
 */

export interface ProvisionStep {
  key: string;
  label: string;
  /** Hasilkan shell command untuk step ini, berbasis data VPS + env port. */
  command: (ctx: ProvisionContext) => string;
}

export interface ProvisionContext {
  vps: Vps;
  deployUser: string;
  nodeExporterPort: number;
  cadvisorPort: number;
}

export const PROVISION_STEPS: ProvisionStep[] = [
  {
    key: 'install-docker',
    label: 'Install Docker',
    // Idempotent: skip kalau docker sudah ada.
    command: () =>
      [
        'if command -v docker >/dev/null 2>&1; then',
        '  echo "[skip] docker sudah terpasang";',
        'else',
        '  curl -fsSL https://get.docker.com | sudo -n sh;',
        '  sudo -n systemctl enable --now docker;',
        'fi',
      ].join(' '),
  },
  {
    key: 'setup-user',
    label: 'Setup deploy user',
    // Idempotent: `id <user> || adduser` (persis pola CLAUDE.md #2).
    command: (ctx) =>
      [
        `id ${ctx.deployUser} >/dev/null 2>&1 ||`,
        `sudo -n useradd -m -s /bin/bash ${ctx.deployUser};`,
        // Tambah ke grup docker (idempotent: usermod -aG aman diulang).
        `sudo -n usermod -aG docker ${ctx.deployUser};`,
        `echo "[ok] user ${ctx.deployUser} siap"`,
      ].join(' '),
  },
  {
    key: 'deploy-node-exporter',
    label: 'Deploy Node Exporter',
    // Idempotent: jalan container hanya bila belum ada. Label env/server WAJIB (#7).
    command: (ctx) =>
      [
        'if sudo -n docker ps -a --format "{{.Names}}" | grep -qx node-exporter; then',
        '  echo "[skip] node-exporter sudah ada";',
        'else',
        '  sudo -n docker run -d --name node-exporter --restart unless-stopped',
        `    --net host --pid host`,
        `    --label env=${ctx.vps.env.toLowerCase()} --label server=${ctx.vps.name}`,
        '    -v /:/host:ro,rslave',
        '    quay.io/prometheus/node-exporter:latest',
        `    --path.rootfs=/host --web.listen-address=:${ctx.nodeExporterPort};`,
        'fi',
      ].join(' '),
  },
  {
    key: 'deploy-cadvisor',
    label: 'Deploy cAdvisor',
    command: (ctx) =>
      [
        'if sudo -n docker ps -a --format "{{.Names}}" | grep -qx cadvisor; then',
        '  echo "[skip] cadvisor sudah ada";',
        'else',
        '  sudo -n docker run -d --name cadvisor --restart unless-stopped',
        `    -p ${ctx.cadvisorPort}:8080`,
        `    --label env=${ctx.vps.env.toLowerCase()} --label server=${ctx.vps.name}`,
        '    -v /:/rootfs:ro -v /var/run:/var/run:ro -v /sys:/sys:ro',
        '    -v /var/lib/docker/:/var/lib/docker:ro -v /dev/disk/:/dev/disk:ro',
        '    gcr.io/cadvisor/cadvisor:latest;',
        'fi',
      ].join(' '),
  },
  {
    key: 'setup-firewall',
    label: 'Setup firewall (ufw)',
    // Idempotent: `ufw allow` aman diulang. Buka SSH + port exporter.
    command: (ctx) =>
      [
        'if command -v ufw >/dev/null 2>&1; then',
        '  sudo -n ufw allow OpenSSH || sudo -n ufw allow 22/tcp;',
        `  sudo -n ufw allow ${ctx.nodeExporterPort}/tcp;`,
        `  sudo -n ufw allow ${ctx.cadvisorPort}/tcp;`,
        '  echo "[ok] firewall rules diterapkan";',
        'else',
        '  echo "[skip] ufw tidak terpasang";',
        'fi',
      ].join(' '),
  },
];
