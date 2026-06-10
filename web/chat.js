// ── State ────────────────────────────────────────────────────────────────────
let ws = null;
let currentAgentId = null;
let isStreaming = false;
const sendQueue = [];

const WS_URL = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`;

// ── DOM ──────────────────────────────────────────────────────────────────────
const $ = id => document.getElementById(id);
const sidebar    = $('sidebar');
const agentList  = $('agent-list');
const agentLabel = $('agent-label');
const statusBadge = $('status-badge');
const connDot    = $('conn-dot');
const chatMsgs   = $('chat-messages');
const streamInd  = $('streaming-indicator');
const input      = $('input');
const btnSend    = $('btn-send');
const modalBg    = $('modal-bg');

// ── WebSocket ────────────────────────────────────────────────────────────────
function connect(agentId) {
  if (ws) { ws.onclose = null; ws.close(); }
  currentAgentId = agentId;
  ws = new WebSocket(`${WS_URL}?agentId=${agentId}`);

  ws.addEventListener('open', () => {
    connDot.className = 'dot on';
    flushQueue();
    // Request chat history
    queueSend({ type: 'get_history', agentId });
  });

  ws.addEventListener('close', () => {
    connDot.className = 'dot off';
    setTimeout(() => { if (currentAgentId === agentId) connect(agentId); }, 3000);
  });

  ws.addEventListener('message', e => {
    try { handleMsg(JSON.parse(e.data)); } catch {}
  });
}

function queueSend(msg) {
  if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
  else sendQueue.push(msg);
}

function flushQueue() {
  while (sendQueue.length && ws?.readyState === WebSocket.OPEN)
    ws.send(JSON.stringify(sendQueue.shift()));
}

// ── Message handling ─────────────────────────────────────────────────────────
let streamBubble = null;
let streamText = '';

function handleMsg(msg) {
  switch (msg.type) {
    case 'chat_history':
      console.log('[chat] received chat_history, turns:', msg.history?.length);
      renderHistory(msg.history ?? []);
      break;
    case 'history':
      // PTY history — ignore in chat mode
      break;
    case 'user_msg':
      appendMsg('user', msg.text);
      break;
    case 'stream_text':
      if (!streamBubble) startStreamBubble();
      streamText += msg.text;
      streamBubble.textContent = streamText;
      scrollBottom();
      break;
    case 'tool_start':
      appendTool(`⚡ ${msg.name}…`);
      break;
    case 'tool_done':
      appendTool(`✓ ${msg.name}(${summarizeInput(msg.input)})`);
      break;
    case 'assistant_done':
      finalizeStream(msg.text);
      break;
    case 'status':
      updateStatus(msg);
      break;
    case 'compacted':
      appendSystem(`📦 历史已压缩`);
      break;
    case 'error':
      appendSystem(`❌ ${msg.error}`);
      setStreaming(false);
      break;
  }
}

function renderHistory(history) {
  chatMsgs.innerHTML = '';
  console.log('[chat] renderHistory called with', history.length, 'turns');
  for (const msg of history) {
    const text = msg.content?.filter(c => c.type === 'text').map(c => c.text).join('\n') ?? '';
    console.log(`[chat]   render: role=${msg.role} text="${text.slice(0, 30)}"`);
    if (text) appendMsg(msg.role, text);
    const tools = msg.content?.filter(c => c.type === 'tool_use') ?? [];
    for (const t of tools) appendTool(`✓ ${t.name}`);
  }
  scrollBottom();
}

function appendMsg(role, text) {
  const div = document.createElement('div');
  div.className = `msg ${role}`;
  div.textContent = text;
  chatMsgs.appendChild(div);
  scrollBottom();
}

function appendTool(text) {
  const div = document.createElement('div');
  div.className = 'msg tool';
  div.innerHTML = `<span class="tool-name">${text}</span>`;
  chatMsgs.appendChild(div);
  scrollBottom();
}

function appendSystem(text) {
  const div = document.createElement('div');
  div.className = 'msg tool';
  div.textContent = text;
  chatMsgs.appendChild(div);
  scrollBottom();
}

function startStreamBubble() {
  streamBubble = document.createElement('div');
  streamBubble.className = 'msg assistant';
  chatMsgs.appendChild(streamBubble);
  streamText = '';
  setStreaming(true);
}

function finalizeStream(fullText) {
  if (streamBubble) {
    streamBubble.textContent = fullText || streamText;
    streamBubble = null;
    streamText = '';
  } else if (fullText) {
    appendMsg('assistant', fullText);
  }
  setStreaming(false);
}

function setStreaming(on) {
  isStreaming = on;
  streamInd.classList.toggle('hidden', !on);
  btnSend.disabled = on;
}

function scrollBottom() {
  const chat = $('chat');
  chat.scrollTop = chat.scrollHeight;
}

function summarizeInput(input) {
  if (!input) return '';
  const s = JSON.stringify(input);
  return s.length > 40 ? s.slice(0, 37) + '…' : s;
}

function updateStatus(msg) {
  if (msg.waitingForInput) {
    statusBadge.textContent = '⏳ 等待输入';
    statusBadge.style.color = '#f9e2af';
  } else {
    statusBadge.textContent = '';
  }
  loadAgents();
}

// ── Send message ─────────────────────────────────────────────────────────────
function send() {
  const text = input.value.trim();
  if (!text || isStreaming || !currentAgentId) return;
  // Don't append user msg here — server will broadcast user_msg back
  queueSend({ type: 'chat', agentId: currentAgentId, text });
  input.value = '';
  input.style.height = 'auto';
  setStreaming(true);
  scrollBottom();
}

btnSend.addEventListener('click', send);
input.addEventListener('keydown', e => {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
});
input.addEventListener('input', () => {
  input.style.height = 'auto';
  input.style.height = Math.min(input.scrollHeight, 150) + 'px';
});

// ── Agent list ───────────────────────────────────────────────────────────────
let allAgents = [];

async function loadAgents() {
  try { allAgents = await (await fetch('/api/agents')).json(); } catch { return; }
  renderAgents();
}

function renderAgents() {
  agentList.innerHTML = '';
  for (const a of allAgents) {
    const li = document.createElement('li');
    li.dataset.id = a.id;
    if (a.id === currentAgentId) li.classList.add('active');
    const st = !a.alive ? '○' : a.waitingForInput ? '⏳' : '●';
    const cls = !a.alive ? '' : a.waitingForInput ? 'wait' : 'on';
    li.innerHTML = `<div>${a.name}</div><div class="li-status"><span class="${cls}">${st}</span> ${a.adapter_type}</div>`;
    li.addEventListener('click', () => switchAgent(a));
    agentList.appendChild(li);
  }
}

function switchAgent(agent) {
  agentLabel.textContent = agent.name;
  chatMsgs.innerHTML = '';
  streamBubble = null;
  setStreaming(false);
  connect(agent.id);
}

// ── Compact ──────────────────────────────────────────────────────────────────
$('btn-compact').addEventListener('click', () => {
  if (currentAgentId) queueSend({ type: 'compact', agentId: currentAgentId });
});

// ── Modal ────────────────────────────────────────────────────────────────────
$('btn-new-agent').addEventListener('click', () => { modalBg.classList.remove('hidden'); $('m-name').focus(); });
$('m-cancel').addEventListener('click', () => modalBg.classList.add('hidden'));
$('m-ok').addEventListener('click', async () => {
  const name = $('m-name').value.trim();
  if (!name) return;
  const res = await fetch('/api/agents', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name, type: $('m-type').value,
      adapterType: 'claude-code-stream',
      config: { cwd: $('m-cwd').value || '/home' },
    }),
  });
  const agent = await res.json();
  modalBg.classList.add('hidden');
  await loadAgents();
  switchAgent(agent);
});

// ── Init ──────────────────────────────────────────────────────────────────────
loadAgents().then(() => {
  const first = allAgents.find(a => a.alive && a.adapter_type === 'claude-code-stream') ?? allAgents[0];
  if (first) switchAgent(first);
});
setInterval(loadAgents, 10000);
