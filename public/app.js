// ── State ────────────────────────────────────────────────────────────────────
let ws = null;
let currentAgentId = null;
let term = null;
let fitAddon = null;

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

// ── xterm.js ─────────────────────────────────────────────────────────────────
function initTerminal() {
  if (term) term.dispose();
  const isMobile = window.innerWidth < 769;
  term = new Terminal({
    theme: { background: '#1e1e2e', foreground: '#cdd6f4', cursor: '#f5e0dc', selectionBackground: '#45475a' },
    fontSize: isMobile ? 12 : 14,
    fontFamily: '"JetBrains Mono", "Fira Code", "Cascadia Code", "Menlo", monospace',
    scrollback: 50000,
    cursorBlink: true,
  });
  fitAddon = new FitAddon.FitAddon();
  term.loadAddon(fitAddon);
  term.open(termContainer);
  fitAddon.fit();

  term.onData(data => sendWs({ type: 'input', data }));

  window.addEventListener('resize', doFit);
  // Initial resize will happen on WS open
}

function doFit() {
  if (!fitAddon || !term) return;
  fitAddon.fit();
  sendWs({ type: 'resize', cols: term.cols, rows: term.rows });
}

// ── WebSocket ────────────────────────────────────────────────────────────────
function connect(agentId) {
  if (ws) { ws.onclose = null; ws.close(); }
  currentAgentId = agentId;
  ws = new WebSocket(`${WS_URL}?agentId=${agentId}`);

  ws.addEventListener('open', () => {
    setConn(true);
    // Send actual viewport size to server → PTY resize
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

function sendWs(msg) { if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg)); }
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
  }
}

// ── Agent management ─────────────────────────────────────────────────────────
let allAgents = [];

async function loadAgents() {
  allAgents = await (await fetch('/api/agents')).json();
  renderAgentList(allAgents);
  return allAgents;
}

function renderAgentList(agents) {
  agentList.innerHTML = '';
  for (const a of agents) {
    const li = document.createElement('li');
    li.dataset.id = a.id;
    if (a.id === currentAgentId) li.classList.add('active');
    li.innerHTML = `<div class="agent-name">${a.name}</div>
      <div class="agent-meta">${a.type === 'master' ? '<span class="master-tag">M</span> ' : ''}
      <span class="${a.alive ? 'alive' : ''}">${a.alive ? '●' : '○'}</span></div>`;
    li.addEventListener('click', () => { switchAgent(a.id, a); closeSidebar(); });
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

// ── Sidebar toggle (mobile) ──────────────────────────────────────────────────
function closeSidebar() { sidebar.classList.remove('open'); }
btnToggle.addEventListener('click', () => sidebar.classList.toggle('open'));
document.addEventListener('click', (e) => {
  if (sidebar.classList.contains('open') && !sidebar.contains(e.target) && e.target !== btnToggle)
    closeSidebar();
});

// ── Input bar — send text to PTY ─────────────────────────────────────────────
function sendInput() {
  const text = msgInput.value;
  if (!text) return;
  sendWs({ type: 'input', data: text + '\n' });
  msgInput.value = '';
  msgInput.style.height = 'auto';
  term.focus();
}

btnSend.addEventListener('click', sendInput);
msgInput.addEventListener('keydown', e => {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendInput(); }
});
// Auto-grow textarea
msgInput.addEventListener('input', () => {
  msgInput.style.height = 'auto';
  msgInput.style.height = Math.min(msgInput.scrollHeight, 120) + 'px';
});

// ── New agent modal ───────────────────────────────────────────────────────────
btnNew.addEventListener('click', () => { modalOverlay.classList.remove('hidden'); $('modal-name').focus(); });
$('modal-cancel').addEventListener('click', () => modalOverlay.classList.add('hidden'));
modalOverlay.addEventListener('click', e => { if (e.target === modalOverlay) modalOverlay.classList.add('hidden'); });
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

// ── File attach ───────────────────────────────────────────────────────────────
btnAttach.addEventListener('click', () => fileInput.click());
fileInput.addEventListener('change', async () => {
  for (const file of fileInput.files) {
    const dataUrl = await new Promise(r => { const fr = new FileReader(); fr.onload = e => r(e.target.result); fr.readAsDataURL(file); });
    const res = await fetch('/api/files', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ data: dataUrl, name: file.name }) });
    const { path } = await res.json();
    sendWs({ type: 'input', data: path + '\n' });
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
    const res = await fetch('/api/files', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ data: dataUrl, name: 'paste.png' }) });
    const { path } = await res.json();
    sendWs({ type: 'input', data: path + '\n' });
    e.preventDefault();
  }
});

// ── Init ──────────────────────────────────────────────────────────────────────
initTerminal();
loadAgents().then(agents => {
  const first = agents.find(a => a.alive) ?? agents[0];
  if (first) switchAgent(first.id, first);
});
setInterval(loadAgents, 15000);
