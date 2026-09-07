const auth = requireAuth();
renderNavbar('alerts');

const isSuperadmin = auth.user.role === 'SUPERADMIN';

let allAlerts = [];
let silenceTarget = null; // { matchers, fingerprint, alertName }

function init() {
  document.getElementById('btnRefresh').addEventListener('click', loadAlerts);
  document.getElementById('filterStatus').addEventListener('change', renderFiltered);
  document.getElementById('filterSearch').addEventListener('input', debounce(renderFiltered, 250));

  document.getElementById('closeSilence').addEventListener('click', closeSilenceModal);
  document.getElementById('cancelSilence').addEventListener('click', closeSilenceModal);
  document.getElementById('submitSilence').addEventListener('click', submitSilence);

  loadAlerts();
  setInterval(() => loadAlerts(true), 30000);
}

async function loadAlerts(silent = false) {
  try {
    const data = await apiFetch('/monitoring/alerts');

    if (!data.configured) {
      document.getElementById('mainAlert').innerHTML = `
        <div class="alert alert-info">
          Alertmanager belum terkonfigurasi. Set <code>ALERTMANAGER_URL</code> di <code>.env</code> untuk mengaktifkan integrasi.
        </div>`;
      document.getElementById('alertTableBody').innerHTML = '<tr><td colspan="6" class="empty-state">Alertmanager belum terkonfigurasi.</td></tr>';
      ['statFiring','statSilenced','statTotal'].forEach(id => document.getElementById(id).textContent = '—');
      return;
    }

    document.getElementById('mainAlert').innerHTML = '';
    allAlerts = data.alerts;

    // Stat cards
    const firing = allAlerts.filter(a => a.status === 'firing' && !a.silenced).length;
    const silenced = allAlerts.filter(a => a.silenced).length;
    document.getElementById('statFiring').textContent = firing;
    document.getElementById('statSilenced').textContent = silenced;
    document.getElementById('statTotal').textContent = allAlerts.length;

    const firingCard = document.getElementById('statFiring').closest('.stat-card');
    firingCard.className = `stat-card ${firing > 0 ? 'stat-danger' : 'stat-success'}`;

    renderFiltered();
  } catch (err) {
    if (!silent) toast(err.message, 'error');
  }
}

function renderFiltered() {
  const statusFilter = document.getElementById('filterStatus').value;
  const search = document.getElementById('filterSearch').value.toLowerCase();

  let filtered = allAlerts;
  if (statusFilter === 'firing') filtered = filtered.filter(a => a.status === 'firing' && !a.silenced);
  else if (statusFilter === 'resolved') filtered = filtered.filter(a => a.status === 'resolved');
  else if (statusFilter === 'silenced') filtered = filtered.filter(a => a.silenced);

  if (search) {
    filtered = filtered.filter(a =>
      JSON.stringify(a.labels).toLowerCase().includes(search) ||
      JSON.stringify(a.annotations).toLowerCase().includes(search)
    );
  }

  renderTable(filtered);
}

function renderTable(alerts) {
  const body = document.getElementById('alertTableBody');
  if (!alerts.length) {
    body.innerHTML = '<tr><td colspan="6" class="empty-state">Tidak ada alert yang sesuai filter.</td></tr>';
    return;
  }

  body.innerHTML = alerts.map(a => {
    const alertName = a.labels.alertname || '(tanpa nama)';
    const severity = a.labels.severity || '—';
    const server = a.labels.server || a.labels.instance || '—';
    const statusBadge = a.silenced
      ? '<span class="badge badge-silenced">Silenced</span>'
      : a.status === 'firing'
        ? '<span class="badge badge-firing"><span class="badge-dot" style="background:var(--danger);animation:pulse 1.4s infinite"></span>Firing</span>'
        : '<span class="badge badge-resolved">Resolved</span>';

    const severityClass = severity === 'critical' ? 'text-danger' : severity === 'warning' ? 'text-warning' : 'text-muted';

    const labelTags = Object.entries(a.labels)
      .filter(([k]) => !['alertname', 'severity'].includes(k))
      .map(([k, v]) => `<span class="tag">${escapeHtml(k)}=${escapeHtml(v)}</span>`)
      .join(' ');

    const silenceBtn = isSuperadmin && a.status === 'firing' && !a.silenced
      ? `<button class="btn-secondary btn-xs" data-fingerprint="${escapeHtml(a.fingerprint)}" data-name="${escapeHtml(alertName)}">Silence</button>`
      : '';

    return `
      <tr>
        <td><strong>${escapeHtml(alertName)}</strong><div class="text-muted" style="font-size:11px;margin-top:2px">${escapeHtml(a.annotations.summary || a.annotations.description || '')}</div></td>
        <td><span class="${severityClass}">${escapeHtml(severity)}</span></td>
        <td style="white-space:normal;max-width:200px">${labelTags || '<span class="text-muted">—</span>'}</td>
        <td class="mono text-muted">${new Date(a.startsAt).toLocaleString('id-ID')}</td>
        <td>${statusBadge}</td>
        <td><div class="row-actions">${silenceBtn}</div></td>
      </tr>
    `;
  }).join('');

  body.querySelectorAll('[data-fingerprint]').forEach(btn => {
    btn.addEventListener('click', () => openSilenceModal(btn.dataset.fingerprint, btn.dataset.name, alerts));
  });
}

function openSilenceModal(fingerprint, alertName, alerts) {
  const alert = alerts.find(a => a.fingerprint === fingerprint);
  if (!alert) return;

  // Build matchers dari labels alert
  silenceTarget = {
    fingerprint,
    alertName,
    matchers: Object.entries(alert.labels).map(([k, v]) => ({ name: k, value: v, isRegex: false })),
  };

  document.getElementById('silenceAlert').innerHTML = '';
  document.getElementById('silenceComment').value = '';
  document.getElementById('silenceDuration').value = '4';
  document.getElementById('silenceMatchersInfo').textContent =
    `Matchers: ${Object.entries(alert.labels).map(([k,v]) => `${k}="${v}"`).join(', ')}`;
  document.getElementById('silenceOverlay').hidden = false;
}

function closeSilenceModal() {
  document.getElementById('silenceOverlay').hidden = true;
  silenceTarget = null;
}

async function submitSilence() {
  if (!silenceTarget) return;
  const comment = document.getElementById('silenceComment').value.trim();
  if (!comment) {
    document.getElementById('silenceAlert').innerHTML = '<div class="alert alert-error">Komentar wajib diisi.</div>';
    return;
  }
  const durationHours = Number(document.getElementById('silenceDuration').value) || 4;
  const btn = document.getElementById('submitSilence');
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span> Menyimpan...';

  try {
    await apiFetch('/monitoring/alerts/silence', {
      method: 'POST',
      body: JSON.stringify({
        matchers: silenceTarget.matchers,
        comment,
        durationHours,
      }),
    });
    toast(`Alert "${silenceTarget.alertName}" di-silence selama ${durationHours} jam.`, 'success');
    closeSilenceModal();
    loadAlerts();
  } catch (err) {
    document.getElementById('silenceAlert').innerHTML = `<div class="alert alert-error">${escapeHtml(err.message)}</div>`;
  } finally {
    btn.disabled = false;
    btn.textContent = 'Silence';
  }
}

init();
