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

  // Load daftar VPS
  loadVpsList(paramVpsId);

  document.getElementById('selectVps').addEventListener('change', function () {
    document.getElementById('btnConnect').disabled = !this.value;
    selectedFile = null;
  });

  document.getElementById('btnConnect').addEventListener('click', () => {
    currentVpsId = document.getElementById('selectVps').value;
    if (!currentVpsId) return;
    currentPath = '/home';
    document.getElementById('fileManagerWrap').hidden = false;
    document.getElementById('transferActions').hidden = false;
    loadDir(currentVpsId, currentPath);
  });

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
      sel.innerHTML = '<option value="">— Pilih VPS —</option>' +
        list.map(v => `<option value="${v.id}"${v.id === preSelectId ? ' selected' : ''}>${escapeHtml(v.name)} (${escapeHtml(v.ipAddress)})</option>`).join('');

      if (preSelectId) {
        document.getElementById('btnConnect').disabled = false;
        // Auto-connect jika dari dashboard
        currentVpsId = preSelectId;
        document.getElementById('fileManagerWrap').hidden = false;
        document.getElementById('transferActions').hidden = false;
        loadDir(currentVpsId, currentPath);
        if (paramName) document.title = `Cortex — File Transfer: ${paramName}`;
      }
    } catch (err) {
      toast('Gagal load daftar VPS: ' + err.message, 'error');
    }
  }

  async function loadDir(vpsId, remotePath) {
    currentPath = remotePath;
    renderPathBar(remotePath);
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
      currentPath !== '/' ? `<div class="file-item" data-path="${escapeHtml(parentPath(currentPath))}"><span class="file-icon">⬆</span><span class="file-name">..</span></div>` : '',
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
    const parts = remotePath.split('/').filter(Boolean);
    let html = `<span class="path-segment" data-p="/">/</span>`;
    let cumulative = '';
    parts.forEach((part, i) => {
      cumulative += '/' + part;
      const p = cumulative;
      html += `<span class="path-sep">/</span><span class="path-segment" data-p="${escapeHtml(p)}">${escapeHtml(part)}</span>`;
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
