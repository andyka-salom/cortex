const auth = requireAuth();
if (auth.user.role !== 'SUPERADMIN') {
  document.body.innerHTML = '<div class="center-page"><div class="alert alert-error">Halaman ini hanya untuk Superadmin.</div></div>';
} else {
  renderNavbar('ai-chat');
  initAiChat();
}

function initAiChat() {
  let sessionId = null;
  let pendingCard = null; // { id, vpsId, vpsName, command, reason }
  let busy = false;

  const messagesEl = document.getElementById('chatMessages');
  const inputEl = document.getElementById('chatInput');
  const sendBtn = document.getElementById('btnSend');

  checkStatus();

  document.getElementById('btnNewChat').addEventListener('click', newChat);
  sendBtn.addEventListener('click', send);
  inputEl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  });

  async function checkStatus() {
    try {
      const status = await apiFetch('/ai-chat/status');
      document.getElementById('notConfiguredAlert').hidden = !!status.configured;
      if (!status.configured) {
        inputEl.disabled = true;
        sendBtn.disabled = true;
      }
    } catch (err) {
      toast(err.message, 'error');
    }

    try {
      const vpsList = await apiFetch('/vps');
      const eligible = vpsList.filter((v) => v.aiAccessEnabled && v.status === 'ACTIVE');
      document.getElementById('noVpsAlert').hidden = eligible.length > 0;
    } catch {}
  }

  function clearEmptyHint() {
    const hint = document.getElementById('emptyHint');
    if (hint) hint.remove();
  }

  function appendBubble(role, text) {
    clearEmptyHint();
    const row = document.createElement('div');
    row.className = `chat-bubble-row ${role}`;
    const bubble = document.createElement('div');
    bubble.className = `chat-bubble ${role}`;
    bubble.textContent = text;
    row.appendChild(bubble);
    messagesEl.appendChild(row);
    scrollToBottom();
    return bubble;
  }

  function appendSystemNote(text) {
    clearEmptyHint();
    const row = document.createElement('div');
    row.className = 'chat-bubble-row system';
    row.innerHTML = `<div class="chat-bubble system">${escapeHtml(text)}</div>`;
    messagesEl.appendChild(row);
    scrollToBottom();
  }

  function scrollToBottom() {
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  function renderPendingCard(pending) {
    clearEmptyHint();
    pendingCard = pending;
    const wrap = document.createElement('div');
    wrap.className = 'chat-bubble-row assistant';
    wrap.style.width = '100%';
    wrap.innerHTML = `
      <div class="pending-card" id="pendingCard-${pending.id}">
        <h4>⚠️ AI usul jalankan command — perlu konfirmasi Anda</h4>
        <div class="pending-row"><strong>VPS:</strong> ${escapeHtml(pending.vpsName)}</div>
        <div class="pending-row"><strong>Alasan AI:</strong> ${escapeHtml(pending.reason)}</div>
        <pre>${escapeHtml(pending.command)}</pre>
        <div class="pending-actions">
          <button class="btn-danger btn-sm" data-act="reject">Tolak</button>
          <button class="btn-primary btn-sm" data-act="approve">✓ Jalankan</button>
        </div>
      </div>
    `;
    messagesEl.appendChild(wrap);
    scrollToBottom();

    wrap.querySelector('[data-act="approve"]').addEventListener('click', () => resolvePending(true, wrap));
    wrap.querySelector('[data-act="reject"]').addEventListener('click', () => resolvePending(false, wrap));
  }

  function setBusy(v) {
    busy = v;
    sendBtn.disabled = v;
    inputEl.disabled = v;
  }

  async function send() {
    const message = inputEl.value.trim();
    if (!message || busy) return;
    if (pendingCard) {
      toast('Selesaikan konfirmasi command yang tertunda dulu.', 'error');
      return;
    }

    appendBubble('user', message);
    inputEl.value = '';
    setBusy(true);
    const thinkingBubble = appendBubble('assistant', 'Me mikir...');

    try {
      const res = await apiFetch('/ai-chat/message', {
        method: 'POST',
        body: JSON.stringify({ sessionId: sessionId || undefined, message }),
      });
      sessionId = res.sessionId;
      thinkingBubble.textContent = res.reply || '(AI diam saja, tidak ada balasan teks)';
      if (res.pending) renderPendingCard(res.pending);
    } catch (err) {
      thinkingBubble.remove();
      appendSystemNote(`Gagal: ${err.message}`);
    } finally {
      setBusy(false);
      inputEl.focus();
    }
  }

  async function resolvePending(approve, cardEl) {
    if (!pendingCard) return;
    const pending = pendingCard;
    pendingCard = null;
    cardEl.querySelectorAll('button').forEach((b) => (b.disabled = true));
    setBusy(true);

    appendSystemNote(approve ? `Menjalankan command di ${pending.vpsName}...` : 'Command ditolak.');
    const thinkingBubble = approve ? appendBubble('assistant', 'Me kerja...') : appendBubble('assistant', 'Me mikir...');

    try {
      const res = await apiFetch('/ai-chat/confirm', {
        method: 'POST',
        body: JSON.stringify({ sessionId, pendingId: pending.id, approve }),
      });
      thinkingBubble.textContent = res.reply || '(AI diam saja, tidak ada balasan teks)';
      if (res.pending) renderPendingCard(res.pending);
    } catch (err) {
      thinkingBubble.remove();
      appendSystemNote(`Gagal: ${err.message}`);
    } finally {
      setBusy(false);
    }
  }

  async function newChat() {
    if (busy) return;
    if (sessionId) {
      try { await apiFetch('/ai-chat/reset', { method: 'POST', body: JSON.stringify({ sessionId }) }); } catch {}
    }
    sessionId = null;
    pendingCard = null;
    messagesEl.innerHTML = '<div class="empty-chat-hint" id="emptyHint">Mulai obrolan — misal: <em>"cek disk usage semua VPS yang aktif"</em> atau <em>"kenapa VPS erp-01 down?"</em></div>';
    checkStatus();
  }
}
