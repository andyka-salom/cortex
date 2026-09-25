const auth = requireAuth();
if (auth.user.role === 'VIEWER') {
  document.getElementById('mainAlert').innerHTML = '<div class="alert alert-error">Role Viewer tidak punya akses File Transfer.</div>';
} else {
  renderNavbar('file-transfer');
  initFiletransfer();
}

function initFiletransfer() {
  // Ambil vpsId dari URL jika ada
  const params = new URLSearchParams(location.search);
  const paramVpsId = params.get('vpsId');
  const paramName = params.get('name');

  let currentVpsId = null;
  let currentPath = '/home';
  let selectedFile = null;
  // Root path yang diizinkan server (FILE_TRANSFER_ALLOWED_PATHS); diisi dari API.
  let allowedPaths = ['/tmp', '/home'];
  const vpsById = {};

  // Allowed paths dulu, baru daftar VPS (auto-connect butuh keduanya).
  loadAllowedPaths().then(() => loadVpsList(paramVpsId));

  document.getElementById('selectVps').addEventListener('change', function () {
    document.getElementById('btnConnect').disabled = !this.value;
    selectedFile = null;
  });

  document.getElementById('btnConnect').addEventListener('click', () => {
    currentVpsId = document.getElementById('selectVps').value;
    if (!currentVpsId) return;
    openFileManager();
  });

  document.getElementById('pathForm').addEventListener('submit', e => {
    e.preventDefault();
    if (!currentVpsId) return toast('Pilih VPS terlebih dahulu.', 'error');
    const target = normalizePath(document.getElementById('pathInput').value);
    if (!isAllowed(target)) {
      return toast(`Path "${target}" tidak diizinkan. Path yang diizinkan: ${allowedPaths.join(', ')}`, 'error', 5000);
    }
    loadDir(currentVpsId, target);
  });

  async function loadAllowedPaths() {
    try {
      const list = await apiFetch('/file-transfer/allowed-paths');
      if (Array.isArray(list) && list.length) allowedPaths = list.map(normalizePath);
    } catch (err) {
      toast('Gagal load daftar path yang diizinkan: ' + err.message, 'error');
    }
  }

  /** Tampilkan file manager & buka home user SSH (atau root pertama yang diizinkan). */
  function openFileManager() {
    document.getElementById('fileManagerWrap').hidden = false;
    document.getElementById('transferActions').hidden = false;
    renderShortcuts();
    loadDir(currentVpsId, startPathFor(vpsById[currentVpsId]));
  }

  function homePathFor(vps) {
    if (!vps || !vps.sshUser) return null;
    return vps.sshUser === 'root' ? '/root' : `/home/${vps.sshUser}`;
  }

  function startPathFor(vps) {
    const home = homePathFor(vps);
    return home && isAllowed(home) ? home : allowedPaths[0];
  }

  function renderShortcuts() {
    const home = homePathFor(vpsById[currentVpsId]);
    const items = [];
    if (home && isAllowed(home)) items.push({ label: `~ ${home}`, path: home });
    allowedPaths.forEach(p => {
      if (p !== home) items.push({ label: p, path: p });
    });
    const wrap = document.getElementById('pathShortcuts');
    wrap.innerHTML = items
      .map(i => `<button type="button" class="btn-secondary btn-sm mono" data-shortcut="${escapeHtml(i.path)}">${escapeHtml(i.label)}</button>`)
      .join('');
    wrap.querySelectorAll('[data-shortcut]').forEach(el => {
      el.addEventListener('click', () => loadDir(currentVpsId, el.dataset.shortcut));
    });
  }

  /** Normalisasi path (hapus //, ., .., trailing slash) — validasi final tetap di server. */
  function normalizePath(p) {
    const out = [];
    String(p || '').trim().split('/').forEach(seg => {
      if (!seg || seg === '.') return;
      if (seg === '..') out.pop();
      else out.push(seg);
    });
    return '/' + out.join('/');
  }

  /** Sama dengan validatePath di server: path == root atau di bawah root yang diizinkan. */
  function isAllowed(p) {
    return allowedPaths.some(a => p === a || p.startsWith(a.endsWith('/') ? a : a + '/'));
  }

  document.getElementById('btnRefreshDir').addEventListener('click', () => {
    if (currentVpsId) loadDir(currentVpsId, currentPath);
  });

  document.getElementById('btnUpload').addEventListener('click', () => {
    document.getElementById('fileInput').click();
  });

  document.getElementById('fileInput').addEventListener('change', e => {
    uploadFiles(Array.from(e.target.files));
    e.target.value = '';
  });

  document.getElementById('btnDownload').addEventListener('click', () => {
    if (!selectedFile) return toast('Pilih file terlebih dahulu.', 'error');
    downloadFile(currentVpsId, selectedFile);
  });

  document.getElementById('btnLoadLogs').addEventListener('click', () => loadTransferLogs());

  // Drag and drop
  const dropZone = document.getElementById('dropZone');
  dropZone.addEventListener('click', () => document.getElementById('fileInput').click());
  dropZone.addEventListener('dragover', e => { e.preventDefault(); dropZone.classList.add('drag-over'); });
  dropZone.addEventListener('dragleave', () => dropZone.classList.remove('drag-over'));
  dropZone.addEventListener('drop', e => {
    e.preventDefault();
    dropZone.classList.remove('drag-over');
    if (!currentVpsId) return toast('Pilih VPS dahulu.', 'error');
    uploadFiles(Array.from(e.dataTransfer.files));
  });

  async function loadVpsList(preSelectId) {
    try {
      const list = await apiFetch('/vps');
      const sel = document.getElementById('selectVps');
      list.forEach(v => { vpsById[v.id] = v; });
      sel.innerHTML = '<option value="">— Pilih VPS —</option>' +
        list.map(v => `<option value="${v.id}"${v.id === preSelectId ? ' selected' : ''}>${escapeHtml(v.name)} (${escapeHtml(v.ipAddress)})</option>`).join('');

      if (preSelectId) {
        document.getElementById('btnConnect').disabled = false;
        // Auto-connect jika dari dashboard
        currentVpsId = preSelectId;
        openFileManager();
        if (paramName) document.title = `Cortex — File Transfer: ${paramName}`;
      }
    } catch (err) {
      toast('Gagal load daftar VPS: ' + err.message, 'error');
    }
  }

  async function loadDir(vpsId, remotePath) {
    currentPath = remotePath;
    renderPathBar(remotePath);
    document.getElementById('pathInput').value = remotePath;
    document.getElementById('uploadTargetPath').textContent = remotePath;
    selectedFile = null;
    document.getElementById('btnDownload').disabled = true;

    document.getElementById('fileList').innerHTML = '<div class="empty-state"><span class="spinner"></span> Memuat...</div>';
    document.getElementById('dirList').innerHTML = '<div class="empty-state"><span class="spinner"></span></div>';

    try {
      const entries = await apiFetch(`/file-transfer/${vpsId}/list?path=${encodeURIComponent(remotePath)}`);
      renderFileList(entries);
    } catch (err) {
      document.getElementById('fileList').innerHTML = `<div class="empty-state text-danger">${escapeHtml(err.message)}</div>`;
      document.getElementById('dirList').innerHTML = '';
    }
  }

  function renderFileList(entries) {
    const dirs = entries.filter(e => e.isDir);
    const files = entries.filter(e => !e.isDir);

    // Panel kiri: .. + subdirektori
    const dirHtml = [
      // ".." hanya kalau parent masih di dalam path yang diizinkan.
      currentPath !== '/' && isAllowed(parentPath(currentPath)) ? `<div class="file-item" data-path="${escapeHtml(parentPath(currentPath))}"><span class="file-icon">⬆</span><span class="file-name">..</span></div>` : '',
      ...dirs.map(d => `<div class="file-item" data-path="${escapeHtml(currentPath.replace(/\/$/, '') + '/' + d.name)}"><span class="file-icon">📁</span><span class="file-name">${escapeHtml(d.name)}</span></div>`),
    ].join('');
    const dirList = document.getElementById('dirList');
    dirList.innerHTML = dirHtml || '<div class="empty-state">Tidak ada subdirektori.</div>';

    // Panel kanan: file
    document.getElementById('fileCount').textContent = `${files.length} file, ${dirs.length} folder`;
    const fileHtml = files.map(f => `
      <div class="file-item" data-filepath="${escapeHtml(currentPath.replace(/\/$/, '') + '/' + f.name)}">
        <span class="file-icon">📄</span>
        <span class="file-name">${escapeHtml(f.name)}</span>
        <span class="file-size">${formatBytes(f.size)}</span>
      </div>
    `).join('');
    document.getElementById('fileList').innerHTML = fileHtml || '<div class="empty-state">Tidak ada file.</div>';

    // Click direktori
    dirList.querySelectorAll('[data-path]').forEach(el => {
      el.addEventListener('click', () => loadDir(currentVpsId, el.dataset.path));
    });

    // Click file
    document.getElementById('fileList').querySelectorAll('[data-filepath]').forEach(el => {
      el.addEventListener('click', () => {
        document.querySelectorAll('.file-item.selected').forEach(s => s.classList.remove('selected'));
        el.classList.add('selected');
        selectedFile = el.dataset.filepath;
        document.getElementById('btnDownload').disabled = false;
      });
    });
  }

  function renderPathBar(remotePath) {
    // Segmen di luar path yang diizinkan (mis. "/" atau "/var") tampil tapi tidak bisa diklik.
    const segment = (p, label) => isAllowed(p)
      ? `<span class="path-segment" data-p="${escapeHtml(p)}">${escapeHtml(label)}</span>`
      : `<span class="text-muted">${escapeHtml(label)}</span>`;
    const parts = remotePath.split('/').filter(Boolean);
    let html = segment('/', '/');
    let cumulative = '';
    parts.forEach(part => {
      cumulative += '/' + part;
      html += `<span class="path-sep">/</span>${segment(cumulative, part)}`;
    });
    const bar = document.getElementById('pathBar');
    bar.innerHTML = html;
    bar.querySelectorAll('[data-p]').forEach(el => {
      el.addEventListener('click', () => loadDir(currentVpsId, el.dataset.p));
    });
  }

  function parentPath(p) {
    const parts = p.split('/').filter(Boolean);
    parts.pop();
    return parts.length ? '/' + parts.join('/') : '/';
  }

  async function uploadFiles(files) {
    if (!currentVpsId) return toast('Pilih VPS terlebih dahulu.', 'error');
    if (!files.length) return;

    for (const file of files) {
      const fd = new FormData();
      fd.append('file', file);

      try {
        toast(`Upload "${file.name}" dimulai...`, 'success', 1500);
        const res = await fetch(`/api/file-transfer/${currentVpsId}/upload?path=${encodeURIComponent(currentPath)}`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${auth.token}` },
          body: fd,
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({ message: `HTTP ${res.status}` }));
          throw new Error(err.message || `HTTP ${res.status}`);
        }
        toast(`"${file.name}" berhasil diupload.`, 'success');
      } catch (err) {
        toast(`Upload "${file.name}" gagal: ${err.message}`, 'error', 5000);
      }
    }
    loadDir(currentVpsId, currentPath);
  }

  async function downloadFile(vpsId, remotePath) {
    try {
      const token = auth.token;
      const url = `/api/file-transfer/${vpsId}/download?path=${encodeURIComponent(remotePath)}`;
      const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ message: `HTTP ${res.status}` }));
        throw new Error(err.message);
      }
      const blob = await res.blob();
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = remotePath.split('/').pop() || 'file';
      a.click();
      URL.revokeObjectURL(a.href);
      toast('Download selesai.', 'success');
    } catch (err) {
      toast(`Download gagal: ${err.message}`, 'error');
    }
  }

  async function loadTransferLogs() {
    if (!currentVpsId) return;
    const wrap = document.getElementById('transferLogsWrap');
    wrap.hidden = false;
    try {
      const logs = await apiFetch(`/file-transfer/${currentVpsId}/logs`);
      const body = document.getElementById('transferLogs');
      if (!logs.length) {
        body.innerHTML = '<tr><td colspan="5" class="empty-state">Belum ada riwayat transfer.</td></tr>';
        return;
      }
      body.innerHTML = logs.map(l => `
        <tr>
          <td class="text-muted mono">${new Date(l.createdAt).toLocaleString('id-ID')}</td>
          <td>${escapeHtml(l.user?.email || '—')}</td>
          <td><span class="badge ${l.direction === 'UPLOAD' ? 'badge-status-provisioning' : 'badge-status-active'}">${l.direction}</span></td>
          <td class="mono">${escapeHtml(l.remotePath)}</td>
          <td>${formatBytes(l.fileSize)}</td>
        </tr>
      `).join('');
    } catch (err) {
      toast('Gagal load riwayat: ' + err.message, 'error');
    }
  }
}
