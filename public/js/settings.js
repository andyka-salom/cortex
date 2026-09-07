const auth = requireAuth();
if (auth.user.role !== 'SUPERADMIN') {
  document.getElementById('mainAlert').innerHTML = '<div class="alert alert-error">Halaman ini hanya untuk Superadmin.</div>';
} else {
  renderNavbar('settings');
  initSettings();
}

function initSettings() {
  loadVpsList();
  loadThresholds();

  document.getElementById('thresholdForm').addEventListener('submit', submitThreshold);
  document.getElementById('btnGenerateRules').addEventListener('click', generateRules);
  document.getElementById('btnResync').addEventListener('click', resyncPrometheus);

  async function loadVpsList() {
    try {
      const list = await apiFetch('/vps');
      const sel = document.getElementById('thVpsId');
      const opts = list.map(v => `<option value="${v.id}">${escapeHtml(v.name)}</option>`).join('');
      sel.innerHTML = '<option value="">— Global (semua VPS) —</option>' + opts;
    } catch {}
  }

  async function loadThresholds() {
    try {
      const list = await apiFetch('/prometheus/alert-thresholds');
      renderThresholdTable(list);
    } catch (err) {
      document.getElementById('mainAlert').innerHTML = `<div class="alert alert-error">${escapeHtml(err.message)}</div>`;
    }
  }

  function renderThresholdTable(thresholds) {
    const body = document.getElementById('thresholdTable');
    if (!thresholds.length) {
      body.innerHTML = '<tr><td colspan="5" class="empty-state">Belum ada threshold dikonfigurasi.</td></tr>';
      return;
    }

    const metricIcon = { cpu: '🖥️', ram: '💾', disk: '💿' };

    body.innerHTML = thresholds.map(t => {
      const scope = t.vps ? `<strong>${escapeHtml(t.vps.name)}</strong>` : '<span class="tag">Global</span>';
      const pct = t.threshold;
      const barClass = pct >= 90 ? 'bar-danger' : pct >= 70 ? 'bar-warn' : '';
      return `
        <tr>
          <td>${scope}</td>
          <td>${metricIcon[t.metricType] || ''} ${t.metricType.toUpperCase()}</td>
          <td>
            <div style="display:flex;align-items:center;gap:8px">
              <div class="progress-bar-wrap" style="width:80px"><div class="progress-bar ${barClass}" style="width:${pct}%"></div></div>
              <span style="font-size:12px;font-weight:600">${pct}%</span>
            </div>
          </td>
          <td class="text-muted">${t.durationMin} menit</td>
          <td>
            <div class="row-actions">
              <button class="btn-danger btn-xs" data-id="${t.id}">Hapus</button>
            </div>
          </td>
        </tr>
      `;
    }).join('');

    body.querySelectorAll('[data-id]').forEach(btn => {
      btn.addEventListener('click', () => deleteThreshold(btn.dataset.id));
    });
  }

  async function submitThreshold(e) {
    e.preventDefault();
    const alertBox = document.getElementById('thresholdAlert');
    alertBox.innerHTML = '';
    const btn = e.target.querySelector('[type="submit"]');
    btn.disabled = true;

    const vpsId = document.getElementById('thVpsId').value || null;
    const metricType = document.getElementById('thMetric').value;
    const threshold = Number(document.getElementById('thThreshold').value);
    const durationMin = Number(document.getElementById('thDuration').value);

    if (!threshold || threshold < 1 || threshold > 100) {
      alertBox.innerHTML = '<div class="alert alert-error">Threshold harus 1–100.</div>';
      btn.disabled = false;
      return;
    }

    try {
      await apiFetch('/prometheus/alert-thresholds', {
        method: 'POST',
        body: JSON.stringify({ vpsId, metricType, threshold, durationMin }),
      });
      toast('Threshold disimpan dan rules file diregenerasi.', 'success');
      loadThresholds();
    } catch (err) {
      alertBox.innerHTML = `<div class="alert alert-error">${escapeHtml(err.message)}</div>`;
    } finally {
      btn.disabled = false;
    }
  }

  async function deleteThreshold(id) {
    if (!confirm('Hapus threshold ini?')) return;
    try {
      await apiFetch(`/prometheus/alert-thresholds/${id}`, { method: 'DELETE' });
      toast('Threshold dihapus.', 'success');
      loadThresholds();
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  async function generateRules() {
    const btn = document.getElementById('btnGenerateRules');
    btn.disabled = true;
    btn.textContent = 'Generating...';
    try {
      await apiFetch('/prometheus/alert-thresholds/generate', { method: 'POST' });
      toast('Alert rules file berhasil digenerate.', 'success');
    } catch (err) {
      toast('Gagal: ' + err.message, 'error');
    } finally {
      btn.disabled = false;
      btn.textContent = '↻ Generate Rules File';
    }
  }

  async function resyncPrometheus() {
    const btn = document.getElementById('btnResync');
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner"></span> Re-sync...';
    try {
      const res = await apiFetch('/prometheus/resync', { method: 'POST' });
      toast(`Re-sync selesai: ${res.synced} VPS.`, 'success');
    } catch (err) {
      toast('Re-sync gagal: ' + err.message, 'error');
    } finally {
      btn.disabled = false;
      btn.textContent = '↻ Re-sync Sekarang';
    }
  }
}
