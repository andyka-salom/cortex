/**
 * auth.js — Cortex shared auth utilities.
 * Dipakai oleh semua halaman yang butuh autentikasi.
 *
 * RBAC di UI hanya kosmetik — otorisasi sesungguhnya di guard server (CLAUDE.md #6).
 */

const AUTH_KEY = 'cortex_auth';
const API_BASE = '/api';

/** Ambil auth dari localStorage. Return null kalau tidak ada / expired. */
function getAuth() {
  try {
    const raw = localStorage.getItem(AUTH_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

/** Redirect ke login kalau belum auth. Kembalikan auth object. */
function requireAuth() {
  const auth = getAuth();
  if (!auth?.token) {
    window.location.replace('/');
    // Return dummy agar kode setelah requireAuth() tidak crash sebelum redirect
    return { token: '', user: { id: '', email: '', name: '', role: 'VIEWER' } };
  }
  return auth;
}

/** Helper fetch ke API — auto-attach Bearer token, auto-redirect 401. */
async function apiFetch(path, options = {}) {
  const auth = getAuth();
  const res = await fetch(API_BASE + path, {
    ...options,
    headers: {
      ...(options.headers || {}),
      ...(options.body && !(options.body instanceof FormData)
        ? { 'Content-Type': 'application/json' }
        : {}),
      ...(auth?.token ? { Authorization: `Bearer ${auth.token}` } : {}),
    },
  });

  if (res.status === 401) {
    localStorage.removeItem(AUTH_KEY);
    window.location.replace('/');
    throw new Error('Sesi berakhir. Silakan login ulang.');
  }

  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { data = text; }

  if (!res.ok) {
    const msg = data?.message || (Array.isArray(data?.message) ? data.message.join(', ') : null) || `HTTP ${res.status}`;
    throw new Error(Array.isArray(msg) ? msg.join(', ') : msg);
  }
  return data;
}

/** Logout: hapus localStorage + kirim ke API. */
async function logout() {
  const auth = getAuth();
  if (auth?.token) {
    try {
      await apiFetch('/auth/logout', { method: 'POST' });
    } catch {}
  }
  localStorage.removeItem(AUTH_KEY);
  window.location.replace('/');
}

/** Label role yang ramah. */
function roleLabel(role) {
  return { SUPERADMIN: 'Superadmin', OPERATOR: 'Operator', VIEWER: 'Viewer' }[role] || role;
}

/** Escape HTML untuk mencegah XSS. */
function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Format waktu relatif (mis. "3 menit lalu"). */
function timeAgo(iso) {
  if (!iso) return '—';
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'Baru saja';
  if (mins < 60) return `${mins} menit lalu`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs} jam lalu`;
  return `${Math.floor(hrs / 24)} hari lalu`;
}

/** Format bytes ke readable string. */
function formatBytes(bytes) {
  if (!bytes && bytes !== 0) return '—';
  const b = Number(bytes);
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
  if (b < 1024 * 1024 * 1024) return `${(b / 1024 / 1024).toFixed(1)} MB`;
  return `${(b / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

/** Toast notification helper. */
function toast(msg, type = 'success', duration = 3500) {
  const stack = document.getElementById('toastStack');
  if (!stack) return;
  const el = document.createElement('div');
  el.className = `toast toast-${type}`;
  el.textContent = msg;
  stack.appendChild(el);
  setTimeout(() => el.remove(), duration);
}

/** Debounce helper. */
function debounce(fn, ms) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}

/** Inject Sidebar dengan ikon modern & profil aktif. */
function renderSidebar(activePage) {
  const auth = getAuth();
  if (!auth) return;
  const isSuperadmin = auth.user.role === 'SUPERADMIN';
  const canSeeFileTransfer = auth.user.role !== 'VIEWER';

  const sidebarEl = document.getElementById('sidebar') || document.querySelector('.sidebar');
  if (sidebarEl) {
    const displayName = auth.user.name || auth.user.email || 'Admin';
    const initials = displayName.substring(0, 2).toUpperCase();

    sidebarEl.innerHTML = `
      <div class="sidebar-header">
        <div class="sidebar-brand-icon">
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/></svg>
        </div>
        <div style="line-height:1.2">
          <div class="sidebar-brand-title">Cortex <span class="sidebar-badge">v1.0</span></div>
        </div>
      </div>
      <div class="sidebar-nav">
        <div class="sidebar-group-title">Monitoring</div>
        <a href="/dashboard.html" class="sidebar-link ${activePage === 'dashboard' ? 'active' : ''}">
          <svg viewBox="0 0 24 24"><rect x="3" y="3" width="7" height="9" rx="1"/><rect x="14" y="3" width="7" height="5" rx="1"/><rect x="14" y="12" width="7" height="9" rx="1"/><rect x="3" y="16" width="7" height="5" rx="1"/></svg>
          Dashboard
        </a>
        <a href="/alerts.html" class="sidebar-link ${activePage === 'alerts' ? 'active' : ''}">
          <svg viewBox="0 0 24 24"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>
          Alerts
        </a>
        <a href="/terminal.html" class="sidebar-link ${activePage === 'terminal' ? 'active' : ''}">
          <svg viewBox="0 0 24 24"><polyline points="4 17 10 11 4 5"/><line x1="12" y1="19" x2="20" y2="19"/></svg>
          Terminal
        </a>
        ${canSeeFileTransfer ? `
          <a href="/file-transfer.html" class="sidebar-link ${activePage === 'file-transfer' ? 'active' : ''}">
            <svg viewBox="0 0 24 24"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>
            File Transfer
          </a>
        ` : ''}

        ${isSuperadmin ? `
          <div class="sidebar-group-title" style="margin-top:10px">Administrasi</div>
          <a href="/users.html" class="sidebar-link ${activePage === 'users' ? 'active' : ''}">
            <svg viewBox="0 0 24 24"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
            Users
          </a>
          <a href="/audit-log.html" class="sidebar-link ${activePage === 'audit-log' ? 'active' : ''}">
            <svg viewBox="0 0 24 24"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg>
            Audit Log
          </a>
          <a href="/settings.html" class="sidebar-link ${activePage === 'settings' ? 'active' : ''}">
            <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
            Settings
          </a>
        ` : ''}
      </div>
      <div class="sidebar-footer">
        <div class="user-card">
          <div class="user-avatar">${escapeHtml(initials)}</div>
          <div class="user-meta">
            <div class="user-name" id="userEmail" title="${escapeHtml(auth.user.email)}">${escapeHtml(displayName)}</div>
            <div class="user-role-line">
              <span class="badge badge-role-${auth.user.role.toLowerCase()}">${roleLabel(auth.user.role)}</span>
            </div>
          </div>
        </div>
        <button id="logoutBtn" class="btn btn-secondary btn-sm btn-block" style="justify-content:center;gap:6px">
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>
          Keluar
        </button>
      </div>
    `;

    const logoutBtn = document.getElementById('logoutBtn');
    if (logoutBtn) logoutBtn.addEventListener('click', logout);
    return;
  }

  // Fallback: jika halaman masih punya .navbar (sebelum diupdate)
  renderNavbarFallback(activePage);
}

/** Fallback helper navbar horizontal jika elemen .navbar dipakai */
function renderNavbarFallback(activePage) {
  const auth = getAuth();
  if (!auth) return;
  const isSuperadmin = auth.user.role === 'SUPERADMIN';
  const links = [
    { href: '/dashboard.html', label: '📊 Dashboard', key: 'dashboard' },
    { href: '/alerts.html', label: '🔔 Alerts', key: 'alerts' },
    { href: '/terminal.html', label: '💻 Terminal', key: 'terminal' },
    { href: '/file-transfer.html', label: '📁 File Transfer', key: 'file-transfer', minRole: 'OPERATOR' },
    ...(isSuperadmin ? [
      { href: '/users.html', label: '👤 Users', key: 'users' },
      { href: '/audit-log.html', label: '📋 Audit Log', key: 'audit-log' },
      { href: '/settings.html', label: '⚙️ Settings', key: 'settings' },
    ] : []),
  ];

  const canSeeFileTransfer = auth.user.role !== 'VIEWER';
  const navLinksHtml = links
    .filter(l => l.key !== 'file-transfer' || canSeeFileTransfer)
    .map(l => `<a href="${l.href}" class="nav-link${activePage === l.key ? ' active' : ''}">${l.label}</a>`)
    .join('');

  const navbar = document.querySelector('.navbar');
  if (!navbar) return;

  navbar.innerHTML = `
    <div style="display:flex;align-items:center;gap:0">
      <span class="brand">Cortex</span>
      <span class="brand-sub">Control Plane</span>
    </div>
    <nav class="nav-links">${navLinksHtml}</nav>
    <div class="nav-right">
      <span class="user-chip">
        <span id="userEmail">${escapeHtml(auth.user.email)}</span>
        <span class="badge badge-role-${auth.user.role.toLowerCase()}">${roleLabel(auth.user.role)}</span>
      </span>
      <button id="logoutBtn" class="btn-secondary btn-sm">Logout</button>
    </div>
  `;

  document.getElementById('logoutBtn')?.addEventListener('click', logout);
}

/** Backward compatibility alias */
function renderNavbar(activePage) {
  renderSidebar(activePage);
}
