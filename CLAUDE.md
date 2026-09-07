# CLAUDE.md

Panduan konteks untuk Claude Code saat bekerja di repo ini.

## Ringkasan Proyek

VPS Monitoring & Provisioning Control Plane — sistem terpusat untuk:
- Provisioning otomatis VPS baru (fresh install → siap monitoring)
- Web terminal (SSH interaktif via browser) ke semua VPS terdaftar
- File transfer (upload/download) ke VPS
- Auto-sync target Prometheus tiap ada VPS baru/dihapus
- Dashboard status semua VPS (ERP, POS, Ecommerce, dst.)

Detail requirement lengkap ada di `PRD-VPS-Monitoring-Control-Plane.md` di root repo — baca dulu sebelum mengerjakan fitur baru untuk memastikan sesuai scope per fase.

## Tech Stack

- **Backend:** NestJS (TypeScript)
- **ORM/DB:** Prisma + PostgreSQL
- **Queue:** BullMQ + Redis (untuk job provisioning — jangan jalankan provisioning secara sync/blocking)
- **SSH:** `ssh2` / `node-ssh`
- **Real-time terminal:** `@nestjs/websockets` (Socket.IO) + `xterm.js` di frontend
- **Container:** Docker + Docker Compose
- **CI/CD:** GitHub Actions

## Struktur Modul

```
src/
├── vps/              # CRUD data VPS, status lifecycle
├── ssh/              # exec command & shell interaktif ke VPS target
├── terminal/         # WebSocket gateway untuk web terminal
├── provisioning/      # BullMQ processor — install Docker, Node Exporter, cAdvisor, firewall
├── file-transfer/     # SFTP upload/download
├── prometheus-sync/   # generate file_sd JSON otomatis
├── auth/              # login, RBAC (Superadmin/Operator/Viewer)
└── audit-log/         # log semua aksi sensitif
```

## Prinsip & Aturan Kerja

1. **Jangan pernah simpan SSH private key plaintext.** Selalu lewat `crypto.util.ts` (AES-256-GCM) sebelum masuk DB, dan decrypt hanya saat dipakai di memory — jangan log hasil decrypt.
2. **Provisioning harus idempotent.** Setiap step di `provisioning.processor.ts` harus aman dijalankan ulang (cek kondisi sebelum eksekusi, mis. `id deploy || adduser ...`).
3. **Semua aksi sensitif wajib masuk audit log**: provisioning, command terminal per session, file transfer, perubahan konfigurasi VPS, login/logout. Jangan tambah endpoint baru yang bypass ini.
4. **Path file transfer harus whitelist**, tidak boleh terima path bebas dari client — validasi di `file-transfer.service.ts` sebelum SFTP `fastPut`/`get`.
5. **Prometheus target sync via file_sd**, bukan edit `prometheus.yml` langsung — tulis ke `/etc/prometheus/targets/*.json`, biarkan Prometheus auto-reload (`refresh_interval`).
6. **RBAC per role**: Superadmin (full), Operator/NOC (terminal terbatas, tidak bisa provisioning/hapus VPS), Viewer (read-only dashboard). Cek role di guard, bukan di level UI saja.
7. **Environment label konsisten**: setiap VPS/container harus punya label `env: production|staging` dan `server: <nama>` — dipakai Grafana untuk filter, jangan skip saat provisioning.

## Commands

```bash
npm run start:dev        # dev server dengan watch mode
npm run build
npm run test              # unit test
npm run test:e2e
npx prisma migrate dev    # jalankan migration
npx prisma studio         # inspect DB
```

## Yang Perlu Dikonfirmasi ke User Sebelum Mengubah

- Command whitelist untuk role Operator di terminal (belum final — lihat Open Questions di PRD)
- Kebijakan retensi audit log
- Approval flow untuk provisioning VPS production (belum diputuskan apakah perlu approval Superadmin lain)

Jangan asumsikan keputusan di atas sudah final — tanyakan ke user kalau implementasi menyentuh area ini.
