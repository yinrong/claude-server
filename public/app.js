// ── State ────────────────────────────────────────────────────────────────────
let ws = null;
let currentAgentId = null;
let term = null;
let fitAddon = null;
const sendQueue = [];

const WS_URL = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`;

// ── DOM ──────────────────────────────────────────────────────────────────────
const $ = id => document.getElementById(id);
const sidebar      = $('sidebar');
const agentList    = $('agent-list');
const agentLabel   = $('agent-label');
const agentBadge   = $('agent-type-badge');
const connDot      = $('conn-dot');
const termContainer = $('terminal');
const btnNew       = $('btn-new-agent');
const btnToggle    = $('btn-sidebar-toggle');
const btnAttach    = $('btn-attach');
const fileInput    = $('file-input');
const modalOverlay = $('modal-overlay');
const ctxMenu      = $('context-menu');
const keybar       = $('keybar');

// ── xterm.js ─────────────────────────────────────────────────────────────────
function initTerminal() {
  if (term) term.dispose();
  term = new Terminal({
    theme: { background: '#1e1e2e', foreground: '#cdd6f4', cursor: '#f5e0dc', selectionBackground: '#45475a' },
    fontSize: window.innerWidth < 769 ? 12 : 14,
    fontFamily: '"JetBrains Mono", "Fira Code", "Cascadia Code", "Menlo", monospace',
    scrollback: 50000,
    cursorBlink: true,
    // Enable keyboard input on ALL devices (including mobile)
    disableStdin: false,
  });
  fitAddon = new FitAddon.FitAddon();
  term.loadAddon(fitAddon);
  term.open(termContainer);
  fitAddon.fit();

  // Forward all keyboard input to PTY
  term.onData(data => queueSend({ type: 'input', data }));

  window.addEventListener('resize', doFit);
}

function doFit() {
  if (!fitAddon || !term) return;
  fitAddon.fit();
  queueSend({ type: 'resize', cols: term.cols, rows: term.rows });
}

// ── Message queue (network decoupling) ───────────────────────────────────────
function queueSend(msg) {
  if (ws?.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(msg));
  } else {
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
  ws.addEventListener('open', () => { setConn(true); flushQueue(); setTimeout(doFit, 100); });
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

// ── Virtual key bar ──────────────────────────────────────────────────────────
const KEY_MAP = {
  'enter':   '\r',
  'newline': '\n',
  'ctrl-c':  '\x03',
  'ctrl-z':  '\x1a',
  'ctrl-d':  '\x04',
  'ctrl-l':  '\x0c',
  'ctrl-a':  '\x01',
  'ctrl-e':  '\x05',
  'tab':     '\t',
  'esc':     '\x1b',
  'up':      '\x1b[A',
  'down':    '\x1b[B',
  'left':    '\x1b[D',
  'right':   '\x1b[C',
};

const keybarExtra = $('keybar-extra');

// Toggle extra keys
$('keybar-more').addEventListener('click', () => {
  keybarExtra.classList.toggle('hidden');
});

// Handle all key button clicks (both bars)
document.addEventListener('click', (e) => {
  const btn = e.target.closest('#keybar button[data-key], #keybar-extra button[data-key]');
  if (!btn) return;
  const seq = KEY_MAP[btn.dataset.key];
  if (seq) {
    queueSend({ type: 'input', data: seq });
    term?.focus();
  }
});

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
    li.innerHTML = `<div class="agent-name">${a.name}</div>
      <div class="agent-meta">${a.type === 'master' ? '<span class="master-tag">M</span> ' : ''}
      <span class="${statusClass}">${statusIcon}</span></div>`;
    li.addEventListener('click', () => { switchAgent(a.id, a); closeSidebar(); });
    li.addEventListener('contextmenu', (e) => { e.preventDefault(); showContextMenu(e, a); });
    agentList.appendChild(li);
  }
}

function switchAgent(agentId, agentData) {
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

// ── New agent modal ──────────────────────────────────────────────────────────
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
  } catch {}
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
    } catch {}
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
    } catch {}
    e.preventDefault();
  }
});

// ── Load more history ─────────────────────────────────────────────────────────
$('btn-history').addEventListener('click', async () => {
  if (!currentAgentId) return;
  try {
    const res = await fetch(`/api/agents/${currentAgentId}/history?limit=2000`);
    if (!res.ok) return;
    const { chunks } = await res.json();
    if (chunks.length) {
      term.clear();
      for (const c of chunks) term.write(c);
      term.scrollToTop();
    }
  } catch {}
});

// ── Change directory modal ────────────────────────────────────────────────────
const chdirOverlay = $('chdir-overlay');
$('btn-chdir').addEventListener('click', async () => {
  if (!currentAgentId) return alert('请先选择 Agent');
  chdirOverlay.classList.remove('hidden');
  $('chdir-path').value = '/home';
  loadChdirBrowse('/home');
  // Load recent commands
  try {
    const cmds = await (await fetch('/api/recent-commands')).json();
    const sel = $('chdir-recent');
    sel.innerHTML = '<option value="">选择最近目录…</option>';
    for (const c of cmds) {
      const opt = document.createElement('option');
      opt.value = c.cwd; opt.textContent = c.cwd;
      sel.appendChild(opt);
    }
  } catch {}
});
$('chdir-cancel').addEventListener('click', () => chdirOverlay.classList.add('hidden'));
$('chdir-recent').addEventListener('change', (e) => {
  if (e.target.value) { $('chdir-path').value = e.target.value; loadChdirBrowse(e.target.value); }
});
$('chdir-confirm').addEventListener('click', async () => {
  const cwd = $('chdir-path').value.trim();
  if (!cwd || !currentAgentId) return;
  await fetch(`/api/agents/${currentAgentId}/restart`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ cwd }),
  });
  chdirOverlay.classList.add('hidden');
  term?.clear();
});

async function loadChdirBrowse(path) {
  try {
    const res = await fetch(`/api/browse?path=${encodeURIComponent(path)}`);
    if (!res.ok) return;
    const { entries } = await res.json();
    const list = $('chdir-browse-list');
    list.innerHTML = '';
    if (path !== '/') {
      const parent = path.split('/').slice(0, -1).join('/') || '/';
      const li = document.createElement('li');
      li.textContent = '📁 ..';
      li.addEventListener('click', () => { $('chdir-path').value = parent; loadChdirBrowse(parent); });
      list.appendChild(li);
    }
    for (const e of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      const li = document.createElement('li');
      li.textContent = `📁 ${e.name}`;
      const full = path === '/' ? `/${e.name}` : `${path}/${e.name}`;
      li.addEventListener('click', () => { $('chdir-path').value = full; loadChdirBrowse(full); });
      list.appendChild(li);
    }
  } catch {}
}

// ── File browser panel ───────────────────────────────────────────────────────
const filePanel = $('file-panel');
const filePanelList = $('file-panel-list');
const filePanelContent = $('file-panel-content');
const filePanelPath = $('file-panel-path');
let currentBrowsePath = '/';

$('btn-files').addEventListener('click', () => {
  filePanel.classList.toggle('hidden');
  if (!filePanel.classList.contains('hidden')) loadFilePanel(currentBrowsePath);
});
$('file-panel-close').addEventListener('click', () => filePanel.classList.add('hidden'));

async function loadFilePanel(path) {
  currentBrowsePath = path;
  filePanelPath.textContent = path;
  filePanelContent.classList.add('hidden');
  filePanelList.classList.remove('hidden');
  filePanelList.innerHTML = '';

  try {
    const res = await fetch(`/api/browse?path=${encodeURIComponent(path)}`);
    if (!res.ok) return;
    const { entries } = await res.json();

    // Parent
    if (path !== '/') {
      const parent = path.split('/').slice(0, -1).join('/') || '/';
      const div = document.createElement('div');
      div.className = 'fp-item dir';
      div.textContent = '📁 ..';
      div.addEventListener('click', () => loadFilePanel(parent));
      filePanelList.appendChild(div);
    }

    // Also fetch files (not just dirs)
    const fullRes = await fetch(`/api/browse?path=${encodeURIComponent(path)}&files=1`);
    let allEntries = entries;
    if (fullRes.ok) {
      const full = await fullRes.json();
      allEntries = full.entries ?? entries;
    }

    for (const e of allEntries.sort((a, b) => {
      if (a.type === b.type) return a.name.localeCompare(b.name);
      return a.type === 'dir' ? -1 : 1;
    })) {
      const div = document.createElement('div');
      div.className = `fp-item ${e.type}`;
      div.textContent = `${e.type === 'dir' ? '📁' : '📄'} ${e.name}`;
      const full = path === '/' ? `/${e.name}` : `${path}/${e.name}`;
      if (e.type === 'dir') {
        div.addEventListener('click', () => loadFilePanel(full));
      } else {
        div.addEventListener('click', () => loadFileContent(full));
      }
      filePanelList.appendChild(div);
    }
  } catch {}
}

async function loadFileContent(path) {
  filePanelPath.textContent = path;
  filePanelList.classList.add('hidden');
  filePanelContent.classList.remove('hidden');
  filePanelContent.textContent = '加载中…';
  try {
    const res = await fetch(`/api/readfile?path=${encodeURIComponent(path)}`);
    if (!res.ok) { filePanelContent.textContent = `错误: ${res.status}`; return; }
    const { content } = await res.json();
    filePanelContent.textContent = content;
  } catch (e) { filePanelContent.textContent = `错误: ${e.message}`; }
}

// ── Init ──────────────────────────────────────────────────────────────────────
initTerminal();
loadAgents().then(agents => {
  if (!agents) return;
  const first = agents.find(a => a.alive) ?? agents[0];
  if (first) switchAgent(first.id, first);
});
setInterval(loadAgents, 10000);
