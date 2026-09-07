# Cortex — VPS Monitoring & Provisioning Control Plane

Control plane terpusat untuk provisioning VPS, web terminal, file transfer, dan
auto-sync target Prometheus. Detail lengkap: [PRD](./PRD-VPS-Monitoring-Control-Plane.md).

## Status Implementasi

- ✅ **Fase 1** — VPS CRUD + provisioning otomatis (BullMQ) + auto-sync Prometheus (file_sd)
- ✅ **Fase 2** — Web terminal (xterm.js + WebSocket, SSH interaktif)
- ✅ **Fase 3** — File transfer (SFTP upload/download/browse, whitelist path, audit log)
- ✅ **Fase 4** — Dashboard overview (stat cards, alert summary) + Alertmanager (list alert, silence)
- ✅ **Fase 5** — User/role management (CRUD, soft deactivate, reset password) + audit log UI (filter, CSV export)
- ✅ **Fase 6** — Bulk import VPS (JSON) + alert threshold config dari UI (generate Prometheus rules)

## Arsitektur Fase 1

```
Client ──HTTP──> NestJS API ──> Postgres (Prisma)
                     │
                     ├─ enqueue ─> BullMQ (Redis) ─> ProvisioningProcessor ──SSH──> VPS target
                     │                                        │
                     │                                        └─> tulis file_sd JSON
                     │                                             (dibaca Prometheus)
                     └─ RBAC guard (JWT) + audit log (append-only)
```

## Setup Dev

1. Prasyarat: Node 20+, Docker, Docker Compose.
2. Copy env & isi secret:
   ```bash
   cp .env.example .env
   ```
   Generate kunci enkripsi SSH key (WAJIB, 32 byte hex) dan isi `SSH_KEY_ENC_SECRET`:
   ```bash
   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
   ```
3. Jalankan Postgres + Redis:
   ```bash
   docker compose up -d postgres redis
   ```
4. Install deps + migrasi + generate client:
   ```bash
   npm install
   npx prisma migrate dev --name init
   npm run db:seed
   ```
5. Jalankan API:
   ```bash
   npm run start:dev
   ```
   API di `http://localhost:3001/api` (lihat `PORT` di `.env`). UI (login,
   dashboard VPS, terminal) di `http://localhost:3001/` — lihat bagian [UI](#ui).

## Endpoint Fase 1

| Method | Path | Role | Fungsi |
|---|---|---|---|
| POST | `/api/auth/login` | public | Login → JWT |
| POST | `/api/auth/logout` | auth | Logout (audit) |
| GET | `/api/vps` | auth | List VPS (filter `?env=&group=`) |
| GET | `/api/vps/:id` | auth | Detail VPS + log provisioning |
| POST | `/api/vps` | Superadmin | Tambah VPS → auto-provision |
| PATCH | `/api/vps/:id` | Superadmin | Update VPS |
| DELETE | `/api/vps/:id` | Superadmin | Hapus VPS + target Prometheus |
| POST | `/api/vps/:id/reprovision` | Superadmin | Re-provision |
| POST | `/api/prometheus/resync` | Superadmin | Re-sync semua target |
| GET | `/api/audit-log` | Superadmin | Lihat audit log |
| GET | `/api/health` | public | Health check |

## Web Terminal (Fase 2)

SSH interaktif ke VPS lewat WebSocket (namespace `/terminal`, Socket.IO) —
tanpa SSH client terpisah, langsung dari browser.

- **Auth**: JWT dikirim di `handshake.auth.token` (atau query `?token=`) — bukan
  header `Authorization`, karena WS handshake browser tidak bisa set header
  custom dengan mudah. Sama token yang didapat dari `POST /api/auth/login`.
- **RBAC**: Viewer ditolak (disconnect + event `error`). Superadmin & Operator
  boleh akses (lihat Open Questions di PRD soal command whitelist Operator —
  belum diimplementasikan, saat ini akses penuh + audit).
- **Event dari client**: `start` (`{ vpsId, cols, rows }`), `input` (raw keystroke
  string), `resize` (`{ cols, rows }`).
- **Event dari server**: `ready` (auth OK), `started`, `output` (raw data dari
  shell), `closed`, `error` (`{ message }`).
- **Audit**: `TERMINAL_SESSION_START`/`TERMINAL_SESSION_END` masuk `audit_logs`;
  command yang diketik (best-effort, bukan parser shell penuh) disimpan di
  `TerminalSession.commandLog` per session (`prisma/schema.prisma`).
- UI-nya ada di halaman [`/terminal.html`](#ui) (klik tombol "Terminal" dari
  dashboard) — auto-connect pakai token dari localStorage, tidak perlu tempel
  token/UUID manual.

## UI

Static (HTML+CSS+JS polos, tanpa build step) di `public/`, disajikan langsung
oleh NestJS (`app.useStaticAssets`, lihat `src/main.ts`). Reload halaman ambil
versi terbaru dari disk — tidak perlu restart server untuk edit HTML/CSS/JS.

| Halaman | Fungsi |
|---|---|
| `/` (`index.html`) | Login. Redirect ke dashboard kalau sudah ada token valid di localStorage. |
| `/dashboard.html` | List VPS + status (auto-refresh 10s), filter env/group, tambah VPS (modal, Superadmin), re-provision & hapus (Superadmin), buka terminal. |
| `/terminal.html?vpsId=&name=` | Terminal xterm.js, auto-connect ke VPS dari query param. |

- Auth disimpan di `localStorage` (`cortex_auth`: `{ token, user }`), dikirim via
  `Authorization: Bearer` (`public/js/auth.js#apiFetch`) untuk REST dan
  `handshake.auth.token` untuk WebSocket. 401 dari API otomatis redirect ke login.
- **RBAC di UI cuma kosmetik** (sembunyikan/disable tombol yang pasti ditolak
  backend) — otorisasi sesungguhnya tetap di guard server (CLAUDE.md #6),
  sesuai perilaku yang sudah diverifikasi: Viewer lihat tombol Terminal
  ter-disable dan tidak ada tombol Tambah/Re-provision/Hapus VPS.
- Kalau nambah elemen yang di-toggle pakai attribute `hidden`: jangan kasih
  `display` di CSS pada elemen/selector yang lebih spesifik dari aturan global
  `[hidden] { display: none !important; }` di `app.css` — origin CSS author
  selalu menang atas default UA `[hidden]`, jadi tanpa `!important` di situ,
  style `display: flex`/`inline-flex` manapun akan bikin elemen "hidden" tetap
  kelihatan (bug yang sempat kejadian & sudah diperbaiki di modal & tombol
  reconnect terminal).

## Prinsip Keamanan (WAJIB — lihat CLAUDE.md)

1. SSH private key **selalu terenkripsi** (AES-256-GCM, `src/common/crypto/crypto.util.ts`). Tidak pernah plaintext/di-log/dikirim ke frontend.
2. Provisioning **idempotent** — tiap step cek kondisi sebelum eksekusi.
3. Semua aksi sensitif **masuk audit log** (append-only).
4. Prometheus target via **file_sd**, bukan edit `prometheus.yml`.
5. RBAC dicek di **guard** (server), bukan cuma UI.

## Prometheus

Pakai contoh config di [`deploy/prometheus.example.yml`](./deploy/prometheus.example.yml).
Arahkan `file_sd_configs.files` ke direktori yang sama dengan `PROMETHEUS_TARGETS_DIR`.

## Test

```bash
npm test        # unit (termasuk crypto AES-256-GCM)
```
