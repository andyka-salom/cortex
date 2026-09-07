const auth = requireAuth();
if (typeof renderSidebar === 'function') renderSidebar('terminal');
else if (typeof renderNavbarFallback === 'function') renderNavbarFallback('terminal');

const params = new URLSearchParams(window.location.search);
let vpsId = params.get('vpsId');
let vpsName = params.get('name') || vpsId;

const vpsNameLabel = document.getElementById('vpsNameLabel');
const selectVps = document.getElementById('selectVps');
const btnConnect = document.getElementById('btnConnect');

if (!vpsId) {
  // Mode standalone: load list VPS
  vpsNameLabel.style.display = 'none';
  selectVps.style.display = 'inline-block';
  btnConnect.style.display = 'inline-flex';
  
  loadVpsList();
  
  selectVps.addEventListener('change', () => {
    btnConnect.disabled = !selectVps.value;
  });
  
  btnConnect.addEventListener('click', () => {
    vpsId = selectVps.value;
    vpsName = selectVps.options[selectVps.selectedIndex].text;
    
    // Hide selector, show label
    selectVps.style.display = 'none';
    btnConnect.style.display = 'none';
    vpsNameLabel.style.display = 'inline-block';
    vpsNameLabel.textContent = vpsName;
    
    connect();
  });
} else {
  vpsNameLabel.textContent = vpsName || 'VPS';
  // Auto connect if vpsId is present in URL
  setTimeout(connect, 100);
}

async function loadVpsList() {
  try {
    const list = await apiFetch('/vps');
    const activeList = list.filter(v => v.status === 'ACTIVE');
    if (activeList.length === 0) {
      toast('Tidak ada VPS yang berstatus ACTIVE.', 'error');
      return;
    }
    
    activeList.forEach(v => {
      const opt = document.createElement('option');
      opt.value = v.id;
      opt.textContent = `${v.name} (${v.ipAddress})`;
      selectVps.appendChild(opt);
    });
  } catch (err) {
    toast(err.message, 'error');
  }
}

const term = new Terminal({
  cursorBlink: true,
  fontSize: 13,
  fontFamily: '"SFMono-Regular", Consolas, Menlo, monospace',
  theme: {
    background: '#0b0f19',
    foreground: '#e4e7ec',
    cursor: '#3b82f6',
  },
});
const fitAddon = new FitAddon.FitAddon();
term.loadAddon(fitAddon);
term.open(document.getElementById('termContainer'));
fitAddon.fit();

let socket = null;

function setStatus(state, text) {
  const pill = document.getElementById('statusPill');
  pill.className = `status-pill status-${state}`;
  document.getElementById('statusText').textContent = text;
  document.getElementById('btnReconnect').hidden = state !== 'disconnected';
}

function connect() {
  if (!vpsId) return;
  setStatus('connecting', 'connecting');
  term.reset();

  socket = io('/terminal', {
    auth: { token: auth.token },
    transports: ['websocket'],
  });

  socket.on('ready', () => {
    const { cols, rows } = term;
    socket.emit('start', { vpsId, cols, rows });
  });

  socket.on('started', () => {
    setStatus('connected', 'connected');
    term.focus();
  });

  socket.on('output', (data) => term.write(data));

  socket.on('error', (payload) => {
    toast(payload?.message || 'Terjadi error di terminal.', 'error');
    setStatus('disconnected', 'error');
  });

  socket.on('closed', () => {
    term.writeln('\r\n\x1b[90m[session ditutup oleh remote]\x1b[0m');
    setStatus('disconnected', 'closed');
  });

  socket.on('disconnect', () => {
    setStatus('disconnected', 'terputus');
  });

  socket.on('connect_error', (err) => {
    toast(`Gagal konek: ${err.message}`, 'error');
    setStatus('disconnected', 'gagal konek');
  });
}

term.onData((data) => {
  if (socket && socket.connected) socket.emit('input', data);
});

document.getElementById('btnReconnect').addEventListener('click', () => {
  if (socket) socket.disconnect();
  connect();
});

function doResize() {
  fitAddon.fit();
  if (socket && socket.connected) {
    const { cols, rows } = term;
    socket.emit('resize', { cols, rows });
  }
}

window.addEventListener('resize', doResize);
new ResizeObserver(doResize).observe(document.getElementById('termContainer'));

window.addEventListener('beforeunload', () => {
  if (socket) socket.disconnect();
});
