// ── State ────────────────────────────────────────────────────────────────────
let ws = null;
let currentAgentId = null;
let term = null;
let fitAddon = null;
const isMobile = () => window.innerWidth < 769;
const sendQueue = []; // Messages queued when WS is disconnected

const WS_URL = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`;

// ── DOM ──────────────────────────────────────────────────────────────────────
const $ = id => document.getElementById(id);
const sidebar      = $('sidebar');
const agentList    = $('agent-list');
const agentLabel   = $('agent-label');
const agentBadge   = $('agent-type-badge');
const connDot      = $('conn-dot');
const termContainer = $('terminal');
const msgInput     = $('msg-input');
const btnSend      = $('btn-send');
const btnNew       = $('btn-new-agent');
const btnToggle    = $('btn-sidebar-toggle');
const btnAttach    = $('btn-attach');
const fileInput    = $('file-input');
const modalOverlay = $('modal-overlay');
const ctxMenu      = $('context-menu');

// ── xterm.js ─────────────────────────────────────────────────────────────────
function initTerminal() {
  if (term) term.dispose();
  const mobile = isMobile();
  term = new Terminal({
    theme: { background: '#1e1e2e', foreground: '#cdd6f4', cursor: '#f5e0dc', selectionBackground: '#45475a' },
    fontSize: mobile ? 12 : 14,
    fontFamily: '"JetBrains Mono", "Fira Code", "Cascadia Code", "Menlo", monospace',
    scrollback: 50000,
    cursorBlink: true,
    // Mobile: disable xterm's built-in keyboard capture — input goes through bottom textarea only
    disableStdin: mobile,
  });
  fitAddon = new FitAddon.FitAddon();
  term.loadAddon(fitAddon);
  term.open(termContainer);
  fitAddon.fit();

  // Desktop: forward xterm keyboard input to PTY
  if (!mobile) {
    term.onData(data => queueSend({ type: 'input', data }));
  }

  window.addEventListener('resize', doFit);
}

function doFit() {
  if (!fitAddon || !term) return;
  fitAddon.fit();
  queueSend({ type: 'resize', cols: term.cols, rows: term.rows });
}

// ── Message queue (network decoupling) ───────────────────────────────────────
// UI operations never block. Messages queue when WS is down, flush on reconnect.
function queueSend(msg) {
  if (ws?.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(msg));
  } else {
    // Queue non-resize messages (resize can be stale)
    if (msg.type !== 'resize') sendQueue.push(msg);
  }
}

function flushQueue() {
  while (sendQueue.length > 0 && ws?.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(sendQueue.shift()));
  }
}

// ── WebSocket ────────────────────────────────────────────────────────────────
function connect(agentId) {
  if (ws) { ws.onclose = null; ws.close(); }
  currentAgentId = agentId;
  ws = new WebSocket(`${WS_URL}?agentId=${agentId}`);
  ws.addEventListener('open', () => {
    setConn(true);
    flushQueue();
    setTimeout(doFit, 100);
  });
  ws.addEventListener('close', () => {
    setConn(false);
    setTimeout(() => { if (currentAgentId === agentId) connect(agentId); }, 3000);
  });
  ws.addEventListener('message', e => {
    let msg; try { msg = JSON.parse(e.data); } catch { return; }
    handleMsg(msg);
  });
}

function setConn(ok) { connDot.className = `status-dot ${ok ? 'connected' : 'disconnected'}`; }

function handleMsg(msg) {
  switch (msg.type) {
    case 'history':
      if (msg.chunks?.length) for (const c of msg.chunks) term.write(c);
      break;
    case 'output':
      term.write(msg.data);
      break;
    case 'exit':
      term.writeln('\r\n\x1b[33m[进程已退出]\x1b[0m');
      break;
    case 'status':
      loadAgents();
      break;
  }
}

// ── Agent management ─────────────────────────────────────────────────────────
let allAgents = [];

async function loadAgents() {
  try { allAgents = await (await fetch('/api/agents')).json(); } catch { return; }
  renderAgentList(allAgents);
  return allAgents;
}

function renderAgentList(agents) {
  agentList.innerHTML = '';
  for (const a of agents) {
    const li = document.createElement('li');
    li.dataset.id = a.id;
    if (a.id === currentAgentId) li.classList.add('active');

    const statusIcon = !a.alive ? '○' : a.waitingForInput ? '⏳' : '●';
    const statusClass = !a.alive ? '' : a.waitingForInput ? 'waiting' : 'alive';
    const statusText = !a.alive ? '停止' : a.waitingForInput ? '等待输入' : '运行中';

    li.innerHTML = `<div class="agent-name">${a.name}</div>
      <div class="agent-meta">${a.type === 'master' ? '<span class="master-tag">M</span> ' : ''}
      <span class="${statusClass}" title="${statusText}">${statusIcon}</span></div>`;
    li.addEventListener('click', () => { switchAgent(a.id, a); closeSidebar(); });
    li.addEventListener('contextmenu', (e) => { e.preventDefault(); showContextMenu(e, a); });
    agentList.appendChild(li);
  }
}

function switchAgent(agentId, agentData) {
  // Immediate UI update (no network dependency)
  for (const li of agentList.querySelectorAll('li'))
    li.classList.toggle('active', li.dataset.id === agentId);
  agentLabel.textContent = agentData?.name ?? agentId.slice(0, 8);
  agentBadge.textContent = agentData?.type?.toUpperCase() ?? '';
  agentBadge.className = `badge ${agentData?.type ?? 'worker'}`;
  if (!term) initTerminal(); else term.clear();
  connect(agentId);
}

// ── Right-click context menu ─────────────────────────────────────────────────
let ctxAgentId = null;

function showContextMenu(e, agent) {
  ctxAgentId = agent.id;
  ctxMenu.style.left = e.clientX + 'px';
  ctxMenu.style.top = e.clientY + 'px';
  ctxMenu.classList.remove('hidden');
  $('ctx-agent-name').textContent = agent.name;
}

document.addEventListener('click', () => ctxMenu.classList.add('hidden'));

$('ctx-delete').addEventListener('click', async () => {
  if (!ctxAgentId) return;
  if (!confirm(`确定删除 Agent "${$('ctx-agent-name').textContent}"？`)) return;
  await fetch(`/api/agents/${ctxAgentId}`, { method: 'DELETE' });
  ctxMenu.classList.add('hidden');
  if (currentAgentId === ctxAgentId) { currentAgentId = null; term?.clear(); }
  await loadAgents();
});

// ── Sidebar toggle (mobile) ──────────────────────────────────────────────────
function closeSidebar() { sidebar.classList.remove('open'); }
btnToggle.addEventListener('click', () => sidebar.classList.toggle('open'));

// ── Input bar ────────────────────────────────────────────────────────────────
function sendInput() {
  const text = msgInput.value;
  if (!text) return;
  queueSend({ type: 'input', data: text + '\n' });
  msgInput.value = '';
  msgInput.style.height = 'auto';
  // Mobile: keep focus on the input bar (don't steal to xterm)
  // Desktop: optionally refocus terminal
  if (!isMobile()) term.focus();
}
btnSend.addEventListener('click', sendInput);
msgInput.addEventListener('keydown', e => {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendInput(); }
});
msgInput.addEventListener('input', () => {
  msgInput.style.height = 'auto';
  msgInput.style.height = Math.min(msgInput.scrollHeight, 120) + 'px';
});

// ── New agent modal (click blank does NOT close) ─────────────────────────────
btnNew.addEventListener('click', () => {
  $('modal-name').value = '';
  $('modal-cwd').value = '/home';
  modalOverlay.classList.remove('hidden');
  $('modal-name').focus();
  loadBrowse('/home');
});
$('modal-cancel').addEventListener('click', () => modalOverlay.classList.add('hidden'));
document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && !modalOverlay.classList.contains('hidden'))
    modalOverlay.classList.add('hidden');
});

$('modal-confirm').addEventListener('click', async () => {
  const name = $('modal-name').value.trim();
  if (!name) return;
  const res = await fetch('/api/agents', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, type: $('modal-type').value, adapterType: $('modal-adapter').value,
      config: { cwd: $('modal-cwd').value || '/tmp' } }),
  });
  const agent = await res.json();
  modalOverlay.classList.add('hidden');
  await loadAgents();
  switchAgent(agent.id, agent);
});

// ── Directory browser in modal ───────────────────────────────────────────────
async function loadBrowse(path) {
  try {
    const res = await fetch(`/api/browse?path=${encodeURIComponent(path)}`);
    if (!res.ok) return;
    const { entries } = await res.json();
    const list = $('browse-list');
    list.innerHTML = '';

    if (path !== '/') {
      const parent = path.split('/').slice(0, -1).join('/') || '/';
      const li = document.createElement('li');
      li.textContent = '📁 ..';
      li.addEventListener('click', () => { $('modal-cwd').value = parent; loadBrowse(parent); });
      list.appendChild(li);
    }

    for (const e of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      const li = document.createElement('li');
      li.textContent = `📁 ${e.name}`;
      const full = path === '/' ? `/${e.name}` : `${path}/${e.name}`;
      li.addEventListener('click', () => { $('modal-cwd').value = full; loadBrowse(full); });
      list.appendChild(li);
    }
  } catch { /* network error — non-blocking */ }
}
$('modal-cwd').addEventListener('change', () => loadBrowse($('modal-cwd').value));

// ── File attach ───────────────────────────────────────────────────────────────
btnAttach.addEventListener('click', () => fileInput.click());
fileInput.addEventListener('change', async () => {
  for (const file of fileInput.files) {
    const dataUrl = await new Promise(r => { const fr = new FileReader(); fr.onload = e => r(e.target.result); fr.readAsDataURL(file); });
    try {
      const res = await fetch('/api/files', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ data: dataUrl, name: file.name }) });
      const { path } = await res.json();
      queueSend({ type: 'input', data: path + '\n' });
    } catch { /* queue for retry if needed */ }
  }
  fileInput.value = '';
});

// ── Image paste ───────────────────────────────────────────────────────────────
document.addEventListener('paste', async (e) => {
  if (!currentAgentId) return;
  for (const item of e.clipboardData.items) {
    if (!item.type.startsWith('image/')) continue;
    const file = item.getAsFile();
    const dataUrl = await new Promise(r => { const fr = new FileReader(); fr.onload = ev => r(ev.target.result); fr.readAsDataURL(file); });
    try {
      const res = await fetch('/api/files', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ data: dataUrl, name: 'paste.png' }) });
      const { path } = await res.json();
      queueSend({ type: 'input', data: path + '\n' });
    } catch { /* non-blocking */ }
    e.preventDefault();
  }
});

// ── Init ──────────────────────────────────────────────────────────────────────
initTerminal();
loadAgents().then(agents => {
  if (!agents) return;
  const first = agents.find(a => a.alive) ?? agents[0];
  if (first) switchAgent(first.id, first);
});
setInterval(loadAgents, 10000);
