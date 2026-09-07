# PRD — VPS Monitoring & Provisioning Control Plane

**Versi:** 1.0
**Tanggal:** 7 September 2026
**Owner:** IT Development Manager
**Stack:** NestJS (backend), PostgreSQL, Prisma, Docker, Redis (BullMQ)

---

## 1. Latar Belakang

Saat ini monitoring infrastruktur (Prometheus/Grafana/Alertmanager) dan akses ke VPS (SSH manual, upload file manual) dilakukan terpisah dan manual per VPS. Dengan bertambahnya jumlah VPS (ERP, POS, Ecommerce, dan proyeksi penambahan ke depan), dibutuhkan satu sistem terpusat yang bisa:

- Menambahkan VPS baru (masih bersih/fresh install) dan langsung ter-provision otomatis dengan stack monitoring
- Menyediakan akses VPS (terminal, file transfer) tanpa SSH client terpisah
- Menyatukan visibility monitoring semua VPS dalam satu dashboard

## 2. Tujuan

1. Provisioning VPS baru dari kondisi bersih → siap monitoring dalam 1 klik/aksi, tanpa setup manual berulang
2. Sentralisasi akses VPS (terminal + file transfer) lewat 1 sistem berbasis web, dengan audit trail
3. Auto-registrasi target monitoring (Prometheus) setiap ada VPS baru/dihapus, tanpa edit config manual
4. Skalabel untuk penambahan VPS baru kapan saja (bukan hardcoded jumlah VPS)

## 3. Scope

**In-scope (v1):**
- CRUD data VPS + provisioning otomatis (Node Exporter, cAdvisor, firewall rule)
- Web terminal (SSH interaktif via browser)
- File upload/transfer ke VPS
- Auto-sync target Prometheus (file_sd)
- Dashboard status VPS (ringkas — detail metric tetap di Grafana)
- Role & auth untuk akses sistem
- Audit log aktivitas (provisioning, terminal command, file transfer)

**Out-of-scope (v1 — kandidat v2):**
- Multi-cloud provider auto-detect (asumsikan VPS generik Ubuntu, provider apa saja selama bisa SSH)
- Auto-scaling / orchestration (Kubernetes dsb.)
- Billing/cost tracking per VPS
- Mobile app (fokus web dashboard dulu)

## 4. User Roles

| Role | Akses |
|---|---|
| **Superadmin** | Full akses — CRUD VPS, provisioning, terminal, file transfer, kelola user, lihat semua audit log |
| **Operator/NOC** | Lihat dashboard, terminal (read-only command tertentu / dibatasi whitelist), tidak bisa provisioning/hapus VPS |
| **Viewer** | Hanya lihat dashboard status, tidak ada akses terminal/file |

## 5. Menu & Fitur

### 5.1 Dashboard (Overview)
- Ringkasan status semua VPS: online/offline, CPU/RAM/Disk (ambil dari Prometheus API)
- Jumlah alert aktif (dari Alertmanager)
- Filter by environment (production/staging) dan grup (ERP, POS, Ecommerce)
- Shortcut ke Grafana untuk detail metric

### 5.2 Manajemen VPS
- **List VPS** — tabel: nama, IP, environment, status (pending/provisioning/active/error), last seen
- **Tambah VPS** — form: nama, IP, port SSH, user, private key (upload/paste, langsung dienkripsi), environment, grup/label
- **Detail VPS** — info koneksi, log provisioning, tombol re-provision, hapus
- **Provisioning** — trigger manual/otomatis saat VPS ditambah; progress real-time (step-by-step: install Docker → setup user → deploy exporter → firewall → daftar ke Prometheus)
- **Bulk action** — tambah beberapa VPS sekaligus (import CSV: nama, IP, key)

### 5.3 Web Terminal
- Pilih VPS dari daftar → buka terminal interaktif (xterm.js) di browser
- Session terpisah per VPS, bisa multi-tab
- Command history per session (untuk audit)
- Role Operator: opsional dibatasi ke command tertentu (whitelist) — tergantung kebijakan

### 5.4 File Transfer
- Upload file ke path tertentu di VPS (SFTP)
- Download file dari VPS
- Browse direktori VPS (list file/folder di path yang diizinkan)
- Whitelist path per VPS (mencegah upload ke direktori sembarangan)
- History transfer (siapa, kapan, file apa, ke VPS mana)

### 5.5 Monitoring Config
- Lihat status sync Prometheus target (VPS mana yang berhasil/gagal terdaftar)
- Trigger manual re-sync target
- Konfigurasi threshold alert dasar (CPU/RAM/Disk) per VPS/grup — generate ke Prometheus rules
- Setting channel notifikasi (Telegram bot token, chat ID)

### 5.6 Alert & Notifikasi
- List alert aktif & histori (ambil dari Alertmanager API)
- Acknowledge/silence alert dari UI
- Log siapa yang acknowledge

### 5.7 Manajemen User & Role
- CRUD user sistem
- Assign role (Superadmin/Operator/Viewer)
- Reset password, aktivasi/nonaktifkan user

### 5.8 Audit Log
- Log semua aksi sensitif: provisioning, terminal command per session, file transfer, perubahan konfigurasi VPS, login/logout
- Filter by user, VPS, tanggal, jenis aksi
- Export log (CSV) untuk keperluan audit internal

### 5.9 Settings
- Konfigurasi global: default SSH user, path monitoring default, interval health check
- Manajemen encryption key rotation (untuk SSH private key)
- Integrasi (Telegram bot, SMTP kalau nanti nambah channel email)

## 6. Alur Utama (Happy Path)

```
1. Superadmin tambah VPS baru (IP + SSH key VPS yang masih bersih)
2. Sistem trigger job provisioning (BullMQ queue)
3. Progress real-time ditampilkan: install Docker → user setup →
   deploy Node Exporter + cAdvisor → setup firewall → daftar ke Prometheus
4. Status VPS berubah jadi "active"
5. VPS otomatis muncul di Dashboard & Grafana (via label env/server)
6. User bisa akses terminal / upload file ke VPS tersebut kapan saja
7. Alert otomatis jalan begitu Node Exporter aktif (rules generik sudah ada)
```

## 7. Non-Functional Requirements

| Aspek | Requirement |
|---|---|
| **Keamanan** | SSH private key dienkripsi at-rest (AES-256-GCM), tidak pernah di-log/expose ke frontend; RBAC per menu; audit log immutable (append-only) |
| **Reliabilitas** | Provisioning job idempotent (bisa di-retry tanpa efek samping — cek dulu sebelum install ulang) |
| **Skalabilitas** | Tidak ada limit hardcoded jumlah VPS; Prometheus target via file_sd (auto-reload) |
| **Observability sistem sendiri** | Control plane app ini juga di-monitor (bukan cuma VPS target) — kalau app ini down, notif terpisah |
| **Auditability** | Semua akses terminal & file transfer tercatat dengan timestamp + user |

## 8. Data Model Ringkas

```
Vps (id, name, ipAddress, sshPort, sshUser, sshPrivateKey[encrypted],
     env, group, status, provisionLog, createdAt)

User (id, name, email, passwordHash, role, isActive)

AuditLog (id, userId, vpsId, action, detail, createdAt)

FileTransferLog (id, userId, vpsId, direction[upload/download],
                  remotePath, fileSize, createdAt)

TerminalSession (id, userId, vpsId, startedAt, endedAt, commandLog[text])
```

## 9. Fase Implementasi

| Fase | Fitur |
|---|---|
| **Fase 1** | VPS CRUD + provisioning otomatis + auto-sync Prometheus target |
| **Fase 2** | Web terminal (xterm.js + WebSocket) |
| **Fase 3** | File transfer (upload/download/browse) |
| **Fase 4** | Dashboard overview + integrasi Alertmanager (list/ack alert) |
| **Fase 5** | User & role management + audit log lengkap |
| **Fase 6** | Bulk import VPS, alert threshold config dari UI |

## 10. Metrik Keberhasilan

- Waktu provisioning VPS baru (bersih → active, siap monitoring) < 5 menit
- 0 insiden akibat SSH key ter-expose/plaintext
- 100% aksi sensitif (terminal, file transfer) tercatat di audit log
- Semua VPS yang ditambahkan otomatis muncul di Grafana tanpa edit config manual

## 11. Open Questions

- Command whitelist untuk role Operator di terminal — perlu didefinisikan atau full akses dengan audit saja?
- Retensi audit log — berapa lama disimpan, perlu archiving?
- Apakah butuh approval flow (mis. provisioning VPS production perlu approval Superadmin lain)?
