import { agentManager } from '../core/agent-manager.js';

export function handleWS(ws, req) {
  const params = new URLSearchParams(req.url.replace(/^[^?]*/, ''));
  const agentId = params.get('agentId');

  if (!agentId) { ws.close(1008, 'agentId required'); return; }

  // Send buffered output history for reconnect
  const chunks = agentManager.getHistory(agentId);
  ws.send(JSON.stringify({ type: 'history', chunks }));

  agentManager.subscribe(agentId, ws);

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw.toString()); } catch { return; }

    switch (msg.type) {
      case 'input':
        agentManager.writeRaw(agentId, msg.data);
        break;
      case 'resize':
        agentManager.resize(agentId, msg.cols, msg.rows);
        break;
      case 'msg':
        if (msg.content) {
          agentManager.sendMessage(msg.agentId ?? agentId, msg.content);
        }
        break;
      case 'chat':
        // Stream adapter: send structured chat message
        if (msg.text) {
          agentManager.sendChat(msg.agentId ?? agentId, msg.text)
            .catch(err => ws.send(JSON.stringify({ type: 'error', error: err.message })));
        }
        break;
      case 'compact':
        agentManager.compactHistory(msg.agentId ?? agentId)
          .catch(err => ws.send(JSON.stringify({ type: 'error', error: err.message })));
        break;
      case 'get_history':
        // Return chat history for stream adapter
        ws.send(JSON.stringify({
          type: 'chat_history',
          history: agentManager.getChatHistory(msg.agentId ?? agentId),
        }));
        break;
      case 'sub': {
        const newId = msg.agentId;
        if (newId && newId !== agentId) {
          agentManager.subscribe(newId, ws);
          const hist = agentManager.getHistory(newId);
          ws.send(JSON.stringify({ type: 'history', chunks: hist, agentId: newId }));
        }
        break;
      }
    }
  });

  ws.on('close', () => {
    agentManager.unsubscribe(agentId, ws);
  });
}
