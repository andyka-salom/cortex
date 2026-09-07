const auth = requireAuth();
if (auth.user.role !== 'SUPERADMIN') {
  document.getElementById('mainAlert').innerHTML = '<div class="alert alert-error">Halaman ini hanya untuk Superadmin.</div>';
} else {
  renderNavbar('users');
  initUsers();
}

function initUsers() {
  let allUsers = [];
  let editingUserId = null;
  let resetPwdUserId = null;

  document.getElementById('filterSearch').addEventListener('input', debounce(() => renderFiltered(allUsers), 250));
  document.getElementById('btnAddUser').addEventListener('click', () => openUserModal(null));
  document.getElementById('closeUserModal').addEventListener('click', closeUserModal);
  document.getElementById('cancelUserModal').addEventListener('click', closeUserModal);
  document.getElementById('userForm').addEventListener('submit', submitUserForm);
  document.getElementById('closeResetPwd').addEventListener('click', closeResetPwd);
  document.getElementById('cancelResetPwd').addEventListener('click', closeResetPwd);
  document.getElementById('submitResetPwd').addEventListener('click', doResetPwd);

  loadUsers();

  async function loadUsers() {
    try {
      allUsers = await apiFetch('/users');
      renderFiltered(allUsers);
    } catch (err) {
      document.getElementById('mainAlert').innerHTML = `<div class="alert alert-error">${escapeHtml(err.message)}</div>`;
    }
  }

  function renderFiltered(users) {
    const search = document.getElementById('filterSearch').value.toLowerCase();
    const filtered = search
      ? users.filter(u => u.name.toLowerCase().includes(search) || u.email.toLowerCase().includes(search))
      : users;
    renderTable(filtered);
  }

  function renderTable(users) {
    const body = document.getElementById('userTableBody');
    if (!users.length) {
      body.innerHTML = '<tr><td colspan="6" class="empty-state">Tidak ada user.</td></tr>';
      return;
    }

    const currentUserId = auth.user.id;

    body.innerHTML = users.map(u => {
      const isSelf = u.id === currentUserId;
      const statusBadge = u.isActive
        ? '<span class="badge badge-status-active"><span class="badge-dot"></span>Aktif</span>'
        : '<span class="badge badge-status-error"><span class="badge-dot"></span>Nonaktif</span>';

      const toggleBtn = isSelf
        ? '<button class="btn-xs btn-secondary" disabled title="Tidak bisa ubah akun sendiri">Nonaktifkan</button>'
        : u.isActive
          ? `<button class="btn-xs btn-danger" data-action="deactivate" data-id="${u.id}" data-name="${escapeHtml(u.name)}">Nonaktifkan</button>`
          : `<button class="btn-xs btn-success" data-action="activate" data-id="${u.id}" data-name="${escapeHtml(u.name)}">Aktifkan</button>`;

      return `
        <tr>
          <td><strong>${escapeHtml(u.name)}</strong></td>
          <td class="text-muted">${escapeHtml(u.email)}</td>
          <td><span class="badge badge-role-${u.role.toLowerCase()}">${escapeHtml(u.role)}</span></td>
          <td>${statusBadge}</td>
          <td class="text-muted">${new Date(u.createdAt).toLocaleDateString('id-ID')}</td>
          <td>
            <div class="row-actions">
              <button class="btn-secondary btn-xs" data-action="edit" data-id="${u.id}">Edit</button>
              <button class="btn-secondary btn-xs" data-action="reset-pwd" data-id="${u.id}" data-email="${escapeHtml(u.email)}">Reset Pwd</button>
              ${toggleBtn}
            </div>
          </td>
        </tr>
      `;
    }).join('');

    body.querySelectorAll('[data-action="edit"]').forEach(btn => {
      btn.addEventListener('click', () => {
        const u = allUsers.find(u => u.id === btn.dataset.id);
        if (u) openUserModal(u);
      });
    });

    body.querySelectorAll('[data-action="reset-pwd"]').forEach(btn => {
      btn.addEventListener('click', () => openResetPwd(btn.dataset.id, btn.dataset.email));
    });

    body.querySelectorAll('[data-action="deactivate"]').forEach(btn => {
      btn.addEventListener('click', () => toggleUser(btn.dataset.id, btn.dataset.name, false));
    });

    body.querySelectorAll('[data-action="activate"]').forEach(btn => {
      btn.addEventListener('click', () => toggleUser(btn.dataset.id, btn.dataset.name, true));
    });
  }

  // ── Modal: Add/Edit User ────────────────────────────────────────────────

  function openUserModal(user) {
    editingUserId = user ? user.id : null;
    document.getElementById('userModalTitle').textContent = user ? 'Edit User' : 'Tambah User';
    document.getElementById('userModalAlert').innerHTML = '';
    document.getElementById('inputName').value = user?.name || '';
    document.getElementById('inputEmail').value = user?.email || '';
    document.getElementById('inputPassword').value = '';
    document.getElementById('inputRole').value = user?.role || 'VIEWER';

    // Password wajib saat create, opsional saat edit
    const pwdInput = document.getElementById('inputPassword');
    pwdInput.required = !user;
    pwdInput.placeholder = user ? '(kosongkan jika tidak diubah — gunakan Reset Pwd)' : 'Min. 8 karakter';

    document.getElementById('userModalOverlay').hidden = false;
  }

  function closeUserModal() {
    document.getElementById('userModalOverlay').hidden = true;
    editingUserId = null;
  }

  async function submitUserForm(e) {
    e.preventDefault();
    const btn = document.getElementById('submitUserBtn');
    const alertBox = document.getElementById('userModalAlert');
    alertBox.innerHTML = '';
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner"></span> Menyimpan...';

    const name = document.getElementById('inputName').value.trim();
    const email = document.getElementById('inputEmail').value.trim();
    const password = document.getElementById('inputPassword').value;
    const role = document.getElementById('inputRole').value;

    try {
      if (editingUserId) {
        const body = { name, email, role };
        await apiFetch(`/users/${editingUserId}`, { method: 'PATCH', body: JSON.stringify(body) });
        toast(`User "${name}" diperbarui.`, 'success');
      } else {
        await apiFetch('/users', { method: 'POST', body: JSON.stringify({ name, email, password, role }) });
        toast(`User "${name}" dibuat.`, 'success');
      }
      closeUserModal();
      loadUsers();
    } catch (err) {
      alertBox.innerHTML = `<div class="alert alert-error">${escapeHtml(err.message)}</div>`;
    } finally {
      btn.disabled = false;
      btn.textContent = 'Simpan';
    }
  }

  // ── Modal: Reset Password ───────────────────────────────────────────────

  function openResetPwd(userId, email) {
    resetPwdUserId = userId;
    document.getElementById('resetPwdEmail').textContent = email;
    document.getElementById('newPassword').value = '';
    document.getElementById('resetPwdAlert').innerHTML = '';
    document.getElementById('resetPwdOverlay').hidden = false;
  }

  function closeResetPwd() {
    document.getElementById('resetPwdOverlay').hidden = true;
    resetPwdUserId = null;
  }

  async function doResetPwd() {
    if (!resetPwdUserId) return;
    const password = document.getElementById('newPassword').value;
    const alertBox = document.getElementById('resetPwdAlert');
    const btn = document.getElementById('submitResetPwd');
    alertBox.innerHTML = '';

    if (!password || password.length < 8) {
      alertBox.innerHTML = '<div class="alert alert-error">Password minimal 8 karakter.</div>';
      return;
    }

    btn.disabled = true;
    btn.innerHTML = '<span class="spinner"></span>';
    try {
      await apiFetch(`/users/${resetPwdUserId}/reset-password`, {
        method: 'POST',
        body: JSON.stringify({ password }),
      });
      toast('Password berhasil di-reset.', 'success');
      closeResetPwd();
    } catch (err) {
      alertBox.innerHTML = `<div class="alert alert-error">${escapeHtml(err.message)}</div>`;
    } finally {
      btn.disabled = false;
      btn.textContent = 'Reset';
    }
  }

  // ── Toggle aktif/nonaktif ───────────────────────────────────────────────

  async function toggleUser(id, name, activate) {
    const action = activate ? 'mengaktifkan' : 'menonaktifkan';
    if (!confirm(`${activate ? 'Aktifkan' : 'Nonaktifkan'} user "${name}"?`)) return;
    try {
      if (activate) {
        await apiFetch(`/users/${id}/activate`, { method: 'POST' });
      } else {
        await apiFetch(`/users/${id}`, { method: 'DELETE' });
      }
      toast(`User "${name}" berhasil di-${action}.`, 'success');
      loadUsers();
    } catch (err) {
      toast(err.message, 'error');
    }
  }
}
