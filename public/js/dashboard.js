const auth = requireAuth();
renderNavbar('dashboard');

const STATUS_LABEL = { PENDING: 'Pending', PROVISIONING: 'Provisioning', ACTIVE: 'Active', ERROR: 'Error' };
const isSuperadmin = auth.user.role === 'SUPERADMIN';
const isViewer = auth.user.role === 'VIEWER';

let currentList = [];
let refreshTimer = null;

function init() {
  // RBAC UI (kosmetik — otorisasi tetap di server)
  if (!isSuperadmin) {
    document.getElementById('btnAddVps').hidden = true;
    document.getElementById('btnBulkImport').hidden = true;
  } else {
    document.getElementById('btnBulkImport').hidden = false;
  }

  document.getElementById('btnRefresh').addEventListener('click', () => loadVps());
  document.getElementById('filterEnv').addEventListener('change', () => loadVps());
  document.getElementById('filterGroup').addEventListener('input', debounce(() => loadVps(), 350));

  document.getElementById('btnAddVps').addEventListener('click', openAddVpsModal);
  document.getElementById('closeAddVps').addEventListener('click', closeAddVpsModal);
  document.getElementById('cancelAddVps').addEventListener('click', closeAddVpsModal);
  document.getElementById('addVpsForm').addEventListener('submit', submitAddVps);

  document.getElementById('btnBulkImport').addEventListener('click', openBulkImport);
  document.getElementById('closeBulkImport').addEventListener('click', closeBulkImport);
  document.getElementById('cancelBulkImport').addEventListener('click', closeBulkImport);
  document.getElementById('submitBulkImport').addEventListener('click', submitBulkImport);

  loadVps();
  loadAlertSummary();
  refreshTimer = setInterval(() => { loadVps({ silent: true }); loadAlertSummary(); }, 15000);
}

async function loadAlertSummary() {
  try {
    const data = await apiFetch('/monitoring/alerts/summary');
    const el = document.getElementById('statAlerts');
    const sub = document.getElementById('statAlertsSub');
    if (data.configured) {
      el.textContent = data.firing;
      sub.textContent = `${data.silenced} silenced`;
      const card = el.closest('.stat-card');
      card.className = `stat-card ${data.firing > 0 ? 'stat-danger' : 'stat-success'}`;
    } else {
      el.textContent = '—';
      sub.textContent = 'Alertmanager belum terkonfigurasi';
    }
  } catch {}
}

async function loadVps({ silent = false } = {}) {
  const env = document.getElementById('filterEnv').value;
  const group = document.getElementById('filterGroup').value.trim();
  const qs = new URLSearchParams();
  if (env) qs.set('env', env);
  if (group) qs.set('group', group);

  try {
    const list = await apiFetch(`/vps${qs.toString() ? `?${qs}` : ''}`);
    currentList = list;

    // Update stat cards
    document.getElementById('statTotal').textContent = list.length;
    document.getElementById('statActive').textContent = list.filter(v => v.status === 'ACTIVE').length;
    document.getElementById('statError').textContent = list.filter(v => v.status === 'ERROR').length;

    renderTable(list);
  } catch (err) {
    if (!silent) toast(err.message, 'error');
  }
}

function renderAiAccessCell(vps) {
  if (!isSuperadmin) {
    return vps.aiAccessEnabled
      ? `<span class="badge badge-status-active"><span class="badge-dot"></span>ON</span>`
      : `<span class="badge badge-status-pending"><span class="badge-dot"></span>OFF</span>`;
  }
  return `
    <label class="switch" title="Izinkan AI Chat mengusulkan command ke VPS ini">
      <input type="checkbox" data-action="ai-access" data-id="${vps.id}" data-name="${escapeHtml(vps.name)}" ${vps.aiAccessEnabled ? 'checked' : ''} />
      <span class="switch-slider"></span>
    </label>
  `;
}

function renderTable(list) {
  const body = document.getElementById('vpsTableBody');
  if (!list.length) {
    body.innerHTML = `<tr><td colspan="8" class="empty-state">Belum ada VPS terdaftar.</td></tr>`;
    return;
  }

  body.innerHTML = list.map((vps) => {
    const statusKey = vps.status.toLowerCase();
    const envKey = vps.env.toLowerCase();

    const terminalBtn = isViewer
      ? `<button class="btn-secondary btn-sm" disabled title="Role Viewer tidak punya akses terminal">Terminal</button>`
      : `<button class="btn-secondary btn-sm" data-action="terminal" data-id="${vps.id}" data-name="${escapeHtml(vps.name)}">Terminal</button>`;

    const fileBtn = isViewer
      ? ''
      : `<button class="btn-secondary btn-sm" data-action="file" data-id="${vps.id}" data-name="${escapeHtml(vps.name)}">📁 Files</button>`;

    const adminBtns = isSuperadmin ? `
      <button class="btn-secondary btn-sm" data-action="reprovision" data-id="${vps.id}">Re-provision</button>
      <button class="btn-danger btn-sm" data-action="delete" data-id="${vps.id}" data-name="${escapeHtml(vps.name)}">Hapus</button>
    ` : '';

    return `
      <tr>
        <td><strong>${escapeHtml(vps.name)}</strong></td>
        <td class="mono">${escapeHtml(vps.ipAddress)}:${vps.sshPort}</td>
        <td><span class="badge badge-env-${envKey}">${vps.env}</span></td>
        <td>${escapeHtml(vps.group)}</td>
        <td><span class="badge badge-status-${statusKey}"><span class="badge-dot"></span>${STATUS_LABEL[vps.status] || vps.status}</span></td>
        <td>${renderAiAccessCell(vps)}</td>
        <td class="text-muted">${timeAgo(vps.lastSeenAt)}</td>
        <td>
          <div class="row-actions">
            ${terminalBtn}
            ${fileBtn}
            ${adminBtns}
          </div>
        </td>
      </tr>
    `;
  }).join('');

  body.querySelectorAll('[data-action="terminal"]').forEach(btn => {
    btn.addEventListener('click', () => {
      window.location.href = `/terminal.html?vpsId=${encodeURIComponent(btn.dataset.id)}&name=${encodeURIComponent(btn.dataset.name)}`;
    });
  });

  body.querySelectorAll('[data-action="file"]').forEach(btn => {
    btn.addEventListener('click', () => {
      window.location.href = `/file-transfer.html?vpsId=${encodeURIComponent(btn.dataset.id)}&name=${encodeURIComponent(btn.dataset.name)}`;
    });
  });

  body.querySelectorAll('[data-action="reprovision"]').forEach(btn => {
    btn.addEventListener('click', () => reprovision(btn.dataset.id, btn));
  });

  body.querySelectorAll('[data-action="delete"]').forEach(btn => {
    btn.addEventListener('click', () => deleteVps(btn.dataset.id, btn.dataset.name));
  });

  body.querySelectorAll('[data-action="ai-access"]').forEach(input => {
    input.addEventListener('change', () => toggleAiAccess(input));
  });
}

async function toggleAiAccess(input) {
  const enabled = input.checked;
  input.disabled = true;
  try {
    await apiFetch(`/vps/${input.dataset.id}/ai-access`, {
      method: 'PATCH',
      body: JSON.stringify({ enabled }),
    });
    toast(`Akses AI ke "${input.dataset.name}" di-${enabled ? 'aktifkan' : 'matikan'}.`, 'success');
  } catch (err) {
    input.checked = !enabled;
    toast(err.message, 'error');
  } finally {
    input.disabled = false;
  }
}

async function reprovision(id, btn) {
  btn.disabled = true;
  try {
    await apiFetch(`/vps/${id}/reprovision`, { method: 'POST' });
    toast('Re-provision dijadwalkan.', 'success');
    loadVps({ silent: true });
  } catch (err) {
    toast(err.message, 'error');
    btn.disabled = false;
  }
}

async function deleteVps(id, name) {
  if (!confirm(`Hapus VPS "${name}"? Tindakan ini tidak bisa dibatalkan.`)) return;
  try {
    await apiFetch(`/vps/${id}`, { method: 'DELETE' });
    toast(`VPS "${name}" dihapus.`, 'success');
    loadVps({ silent: true });
  } catch (err) {
    toast(err.message, 'error');
  }
}

// ── Modal: Tambah VPS ──────────────────────────────────────────────────────

function openAddVpsModal() {
  document.getElementById('addVpsForm').reset();
  document.getElementById('vpsPort').value = 22;
  document.getElementById('addVpsAlert').innerHTML = '';
  document.getElementById('addVpsOverlay').hidden = false;
}

function closeAddVpsModal() { document.getElementById('addVpsOverlay').hidden = true; }

async function submitAddVps(e) {
  e.preventDefault();
  const alertBox = document.getElementById('addVpsAlert');
  const submitBtn = document.getElementById('submitAddVps');
  alertBox.innerHTML = '';
  submitBtn.disabled = true;
  submitBtn.innerHTML = '<span class="spinner"></span> Menyimpan...';

  const payload = {
    name: document.getElementById('vpsName').value.trim(),
    ipAddress: document.getElementById('vpsIp').value.trim(),
    sshPort: Number(document.getElementById('vpsPort').value) || 22,
    sshUser: document.getElementById('vpsUser').value.trim(),
    env: document.getElementById('vpsEnv').value,
    group: document.getElementById('vpsGroup').value.trim(),
    privateKey: document.getElementById('vpsKey').value,
  };

  try {
    await apiFetch('/vps', { method: 'POST', body: JSON.stringify(payload) });
    toast(`VPS "${payload.name}" ditambahkan, provisioning dimulai.`, 'success');
    closeAddVpsModal();
    loadVps({ silent: true });
  } catch (err) {
    alertBox.innerHTML = `<div class="alert alert-error">${escapeHtml(err.message)}</div>`;
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = 'Simpan & Provision';
  }
}

// ── Modal: Bulk Import ─────────────────────────────────────────────────────

function openBulkImport() {
  document.getElementById('bulkJson').value = '';
  document.getElementById('bulkImportAlert').innerHTML = '';
  document.getElementById('bulkResultWrap').hidden = true;
  document.getElementById('bulkImportOverlay').hidden = false;
}

function closeBulkImport() { document.getElementById('bulkImportOverlay').hidden = true; }

async function submitBulkImport() {
  const alertBox = document.getElementById('bulkImportAlert');
  const btn = document.getElementById('submitBulkImport');
  alertBox.innerHTML = '';

  let items;
  try {
    items = JSON.parse(document.getElementById('bulkJson').value);
    if (!Array.isArray(items) || items.length === 0) throw new Error('Harus berupa array JSON yang tidak kosong.');
  } catch (err) {
    alertBox.innerHTML = `<div class="alert alert-error">JSON tidak valid: ${escapeHtml(err.message)}</div>`;
    return;
  }

  btn.disabled = true;
  btn.innerHTML = `<span class="spinner"></span> Mengimport ${items.length} VPS...`;

  try {
    const results = await apiFetch('/vps/bulk-import', { method: 'POST', body: JSON.stringify({ items }) });
    const ok = results.filter(r => r.ok).length;
    const fail = results.filter(r => !r.ok).length;

    document.getElementById('bulkResultWrap').hidden = false;
    document.getElementById('bulkResults').innerHTML = `
      <div class="alert ${fail === 0 ? 'alert-success' : 'alert-error'}">
        ${ok} berhasil, ${fail} gagal dari ${results.length} VPS.
      </div>
      <div class="table-wrap"><table>
        <thead><tr><th>Nama</th><th>Status</th><th>Keterangan</th></tr></thead>
        <tbody>
          ${results.map(r => `
            <tr>
              <td>${escapeHtml(r.name)}</td>
              <td><span class="badge ${r.ok ? 'badge-resolved' : 'badge-firing'}">${r.ok ? 'OK' : 'GAGAL'}</span></td>
              <td class="text-muted">${escapeHtml(r.error || '—')}</td>
            </tr>
          `).join('')}
        </tbody>
      </table></div>
    `;
    if (ok > 0) loadVps({ silent: true });
  } catch (err) {
    alertBox.innerHTML = `<div class="alert alert-error">${escapeHtml(err.message)}</div>`;
  } finally {
    btn.disabled = false;
    btn.textContent = 'Import';
  }
}

init();
