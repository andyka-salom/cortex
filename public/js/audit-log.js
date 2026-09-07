const auth = requireAuth();
if (auth.user.role !== 'SUPERADMIN') {
  document.getElementById('mainAlert').innerHTML = '<div class="alert alert-error">Halaman ini hanya untuk Superadmin.</div>';
} else {
  renderNavbar('audit-log');
  initAuditLog();
}

function initAuditLog() {
  const PAGE_SIZE = 100;
  let currentSkip = 0;
  let totalLoaded = 0;

  document.getElementById('btnFilter').addEventListener('click', () => { currentSkip = 0; loadLogs(); });
  document.getElementById('btnReset').addEventListener('click', resetFilters);
  document.getElementById('btnExport').addEventListener('click', exportCsv);

  // Load on enter
  ['filterUserId','filterVpsId','filterFrom','filterTo'].forEach(id => {
    document.getElementById(id).addEventListener('keydown', e => { if (e.key === 'Enter') loadLogs(); });
  });
  document.getElementById('filterAction').addEventListener('change', () => { currentSkip = 0; loadLogs(); });

  // Initial load
  loadLogs();

  function getFilterParams() {
    const qs = new URLSearchParams();
    const uid = document.getElementById('filterUserId').value.trim();
    const vid = document.getElementById('filterVpsId').value.trim();
    const action = document.getElementById('filterAction').value;
    const from = document.getElementById('filterFrom').value;
    const to = document.getElementById('filterTo').value;
    if (uid) qs.set('userId', uid);
    if (vid) qs.set('vpsId', vid);
    if (action) qs.set('action', action);
    if (from) qs.set('from', from);
    if (to) qs.set('to', to + 'T23:59:59');
    return qs;
  }

  async function loadLogs() {
    const qs = getFilterParams();
    qs.set('take', PAGE_SIZE);
    qs.set('skip', currentSkip);

    const body = document.getElementById('logTableBody');
    body.innerHTML = '<tr><td colspan="5" class="empty-state"><span class="spinner"></span> Memuat...</td></tr>';

    try {
      const logs = await apiFetch(`/audit-log?${qs}`);
      totalLoaded = logs.length;
      renderTable(logs);
      renderPagination(logs.length);
    } catch (err) {
      document.getElementById('mainAlert').innerHTML = `<div class="alert alert-error">${escapeHtml(err.message)}</div>`;
    }
  }

  function renderTable(logs) {
    const body = document.getElementById('logTableBody');
    if (!logs.length) {
      body.innerHTML = '<tr><td colspan="5" class="empty-state">Tidak ada log yang sesuai filter.</td></tr>';
      return;
    }

    // Action color mapping
    const actionColor = {
      LOGIN: 'badge-status-active', LOGOUT: 'badge-silenced',
      VPS_CREATE: 'badge-status-provisioning', VPS_DELETE: 'badge-firing', VPS_REPROVISION: 'badge-status-provisioning',
      PROVISION_START: 'badge-status-provisioning', PROVISION_DONE: 'badge-resolved', PROVISION_ERROR: 'badge-firing',
      TERMINAL_SESSION_START: 'badge-status-active', FILE_UPLOAD: 'badge-status-active', FILE_DOWNLOAD: 'badge-status-active',
      USER_CREATE: 'badge-status-active', USER_DEACTIVATE: 'badge-firing', USER_PASSWORD_RESET: 'badge-status-provisioning',
      ALERT_SILENCED: 'badge-silenced',
    };

    body.innerHTML = logs.map(l => {
      const colorClass = actionColor[l.action] || '';
      return `
        <tr>
          <td class="mono text-muted">${new Date(l.createdAt).toLocaleString('id-ID')}</td>
          <td class="text-muted" style="font-size:12px">${escapeHtml(l.userId || '—')}</td>
          <td class="text-muted" style="font-size:12px">${escapeHtml(l.vpsId || '—')}</td>
          <td><span class="badge ${colorClass}" style="text-transform:none;font-size:10px">${escapeHtml(l.action)}</span></td>
          <td style="white-space:normal;max-width:400px;font-size:12px">${escapeHtml(l.detail)}</td>
        </tr>
      `;
    }).join('');
  }

  function renderPagination(count) {
    const pg = document.getElementById('pagination');
    const hasPrev = currentSkip > 0;
    const hasNext = count === PAGE_SIZE;

    pg.innerHTML = `
      ${hasPrev ? `<button class="btn-secondary btn-sm" id="btnPrev">← Sebelumnya</button>` : ''}
      <span class="text-muted" style="font-size:12px">Baris ${currentSkip + 1}–${currentSkip + count}</span>
      ${hasNext ? `<button class="btn-secondary btn-sm" id="btnNext">Berikutnya →</button>` : ''}
    `;

    if (hasPrev) document.getElementById('btnPrev').addEventListener('click', () => { currentSkip -= PAGE_SIZE; loadLogs(); });
    if (hasNext) document.getElementById('btnNext').addEventListener('click', () => { currentSkip += PAGE_SIZE; loadLogs(); });
  }

  function resetFilters() {
    document.getElementById('filterUserId').value = '';
    document.getElementById('filterVpsId').value = '';
    document.getElementById('filterAction').value = '';
    document.getElementById('filterFrom').value = '';
    document.getElementById('filterTo').value = '';
    currentSkip = 0;
    loadLogs();
  }

  async function exportCsv() {
    const qs = getFilterParams();
    const url = `/api/audit-log/export?${qs}`;
    const btn = document.getElementById('btnExport');
    btn.disabled = true;
    btn.textContent = 'Mengexport...';
    try {
      const res = await fetch(url, { headers: { Authorization: `Bearer ${auth.token}` } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = await res.blob();
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `audit-log-${new Date().toISOString().slice(0,10)}.csv`;
      a.click();
      URL.revokeObjectURL(a.href);
      toast('Export CSV selesai.', 'success');
    } catch (err) {
      toast('Export gagal: ' + err.message, 'error');
    } finally {
      btn.disabled = false;
      btn.textContent = '⬇ Export CSV';
    }
  }
}
