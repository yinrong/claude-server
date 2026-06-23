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
const btnAttach    = $('btn-attach');
const fileInput    = $('file-input');
const modalOverlay = $('modal-overlay');
const ctxMenu      = $('context-menu');

// ── xterm.js ─────────────────────────────────────────────────────────────────
function initTerminal() {
  if (term) term.dispose();
  term = new Terminal({
    theme: { background: '#1e1e2e', foreground: '#cdd6f4', cursor: '#f5e0dc', selectionBackground: '#45475a' },
    fontSize: 14,
    fontFamily: '"JetBrains Mono", "Fira Code", "Cascadia Code", "Menlo", monospace',
    scrollback: 50000,
    cursorBlink: true,
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
      // PTY idle → auto-scan generated files for current agent
      if (msg.waitingForInput && msg.agentId) {
        triggerFileScan(msg.agentId);
      }
      break;
    case 'file_created':
      if (msg.files) renderGenPanel(msg.files);
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
    li.innerHTML = `<div class="agent-name">${a.name}</div>
      <div class="agent-meta">${a.type === 'master' ? '<span class="master-tag">M</span> ' : ''}
      <span class="${statusClass}">${statusIcon}</span></div>`;
    li.addEventListener('click', () => { switchAgent(a.id, a); });
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
  // Reset generated files panel for new agent
  genPanelList.innerHTML = '<div class="gf-empty">暂无生成文件</div>';
  genFooter.classList.add('hidden');
  triggerFileScan(agentId);
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

// ── Model list helpers ────────────────────────────────────────────────────────
async function loadModels() {
  try {
    const res = await fetch('/api/models');
    if (!res.ok) return;
    const models = await res.json();
    const select = $('modal-model');
    const prev = select.value;
    select.innerHTML = '';
    // blank option (no model specified)
    const blank = document.createElement('option');
    blank.value = '';
    blank.textContent = '（默认）';
    select.appendChild(blank);
    for (const m of models) {
      const opt = document.createElement('option');
      opt.value = m.name;
      opt.textContent = m.name;
      select.appendChild(opt);
    }
    // restore previous selection if still valid
    if (prev && [...select.options].some(o => o.value === prev)) select.value = prev;
  } catch {}
}

$('modal-model-refresh').addEventListener('click', async () => {
  const btn = $('modal-model-refresh');
  btn.disabled = true;
  btn.textContent = '⏳';
  try {
    await fetch('/api/models/refresh', { method: 'POST' });
    await loadModels();
  } finally {
    btn.disabled = false;
    btn.textContent = '🔄';
  }
});

// ── New agent modal ──────────────────────────────────────────────────────────
btnNew.addEventListener('click', async () => {
  $('modal-name').value = '';
  $('modal-cwd').value = '/home';
  modalOverlay.classList.remove('hidden');
  $('modal-name').focus();
  loadBrowse('/home');
  await loadModels();
});
$('modal-cancel').addEventListener('click', () => modalOverlay.classList.add('hidden'));
document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && !modalOverlay.classList.contains('hidden'))
    modalOverlay.classList.add('hidden');
});

$('modal-confirm').addEventListener('click', async () => {
  const name = $('modal-name').value.trim();
  if (!name) return;
  const model = $('modal-model').value;
  const config = { cwd: $('modal-cwd').value || '/tmp' };
  if (model) config.model = model;
  const res = await fetch('/api/agents', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, type: $('modal-type').value, adapterType: $('modal-adapter').value,
      config }),
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
  btnDownload.classList.add('hidden');
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

let currentFilePath = null;
const btnDownload = $('file-panel-download');

async function loadFileContent(path) {
  currentFilePath = path;
  filePanelPath.textContent = path;
  filePanelList.classList.add('hidden');
  filePanelContent.classList.remove('hidden');
  btnDownload.classList.remove('hidden');
  filePanelContent.textContent = '加载中…';
  try {
    const res = await fetch(`/api/readfile?path=${encodeURIComponent(path)}`);
    if (!res.ok) { filePanelContent.textContent = `错误: ${res.status}`; return; }
    const { content } = await res.json();
    filePanelContent.textContent = content;
  } catch (e) { filePanelContent.textContent = `错误: ${e.message}`; }
}

btnDownload.addEventListener('click', () => {
  if (!currentFilePath) return;
  window.open(`/api/download?path=${encodeURIComponent(currentFilePath)}`, '_blank');
});

// ── Generated files panel ────────────────────────────────────────────────────
const genPanel = document.getElementById('gen-panel');
const genPanelList = document.getElementById('gen-panel-list');
const genFooter = document.getElementById('gen-panel-footer');
const genSelectedCount = document.getElementById('gen-selected-count');
let genFiles = [];

document.getElementById('btn-generated').addEventListener('click', () => {
  genPanel.classList.toggle('hidden');
  if (!genPanel.classList.contains('hidden') && currentAgentId) {
    triggerFileScan(currentAgentId);
  }
});
document.getElementById('gen-panel-close').addEventListener('click', () => genPanel.classList.add('hidden'));
document.getElementById('gen-refresh').addEventListener('click', () => {
  if (currentAgentId) triggerFileScan(currentAgentId);
});

async function triggerFileScan(agentId) {
  try {
    const res = await fetch(`/api/agents/${agentId}/files`);
    if (!res.ok) return;
    const { files } = await res.json();
    genFiles = files ?? [];
    renderGenPanel(genFiles);
  } catch {}
}

function fmtSize(b) {
  if (b < 1024) return b + ' B';
  if (b < 1048576) return (b / 1024).toFixed(1) + ' KB';
  return (b / 1048576).toFixed(1) + ' MB';
}

function fmtTime(ms) {
  const d = new Date(ms);
  return d.toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function renderGenPanel(files) {
  genFiles = files;
  genPanelList.innerHTML = '';
  if (!files.length) {
    genPanelList.innerHTML = '<div class="gf-empty">暂无生成文件</div>';
    genFooter.classList.add('hidden');
    return;
  }
  for (const f of files) {
    const row = document.createElement('div');
    row.className = 'gf-item';
    row.dataset.path = f.path;
    row.innerHTML = `
      <input type="checkbox" data-path="${f.path}" />
      <span class="gf-name" title="${f.path}">${f.name}</span>
      <span class="gf-meta">${fmtSize(f.size)}<br/>${fmtTime(f.mtime)}</span>
      <a class="gf-dl" href="${f.download_url}" download="${f.name}" title="下载">⬇</a>
    `;
    row.querySelector('input[type=checkbox]').addEventListener('change', updateGenFooter);
    // Click on row (not checkbox/link) toggles checkbox
    row.addEventListener('click', (e) => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'A') return;
      const cb = row.querySelector('input[type=checkbox]');
      cb.checked = !cb.checked;
      updateGenFooter();
    });
    genPanelList.appendChild(row);
  }
  updateGenFooter();
}

function updateGenFooter() {
  const checked = genPanelList.querySelectorAll('input[type=checkbox]:checked');
  if (checked.length > 0) {
    genFooter.classList.remove('hidden');
    genSelectedCount.textContent = `已选 ${checked.length} 个`;
  } else {
    genFooter.classList.add('hidden');
  }
}

document.getElementById('gen-zip-btn').addEventListener('click', async () => {
  const checked = [...genPanelList.querySelectorAll('input[type=checkbox]:checked')];
  if (!checked.length || !currentAgentId) return;
  const paths = checked.map(cb => cb.dataset.path);
  try {
    const res = await fetch(`/api/agents/${currentAgentId}/zip`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ paths }),
    });
    if (!res.ok) { alert('打包失败'); return; }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'files.zip';
    a.click();
    URL.revokeObjectURL(url);
  } catch (e) { alert('打包失败: ' + e.message); }
});

// ── Init ──────────────────────────────────────────────────────────────────────
initTerminal();
loadAgents().then(agents => {
  if (!agents) return;
  const first = agents.find(a => a.alive) ?? agents[0];
  if (first) switchAgent(first.id, first);
});
setInterval(loadAgents, 10000);
