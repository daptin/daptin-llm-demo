#!/usr/bin/env node

/**
 * Daptin LLM Demo & API Contract Test
 *
 * A self-contained webapp that uses the official OpenAI JS SDK pointed at Daptin.
 * If the SDK works without patches, the API contract is proven compatible.
 *
 * Endpoints served:
 *   GET  /           — interactive UI (chat + contract tests)
 *   POST /api/test   — runs all contract tests, returns JSON results
 */

const http = require("http");
const fs = require("fs");
const path = require("path");

const rootDir = __dirname;
const envPath = path.join(rootDir, ".env.local");

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return {};
  const values = {};
  for (const line of fs.readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const idx = trimmed.indexOf("=");
    if (idx === -1) continue;
    values[trimmed.slice(0, idx)] = trimmed.slice(idx + 1);
  }
  return values;
}

const fileEnv = loadEnvFile(envPath);
function env(key, fallback) {
  return process.env[key] || fileEnv[key] || fallback || "";
}

const LISTEN_HOST = env("LISTEN_HOST", "127.0.0.1");
const LISTEN_PORT = parseInt(env("LISTEN_PORT", "7777"), 10);
const DAPTIN_BASE_URL = env("DAPTIN_BASE_URL", "http://localhost:6336");
const DAPTIN_TOKEN = env("DAPTIN_TOKEN", "");

// ── HTML UI ──────────────────────────────────────────────────────────────────

const HTML_PAGE = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Daptin LLM Demo</title>
<style>
  :root { --bg: #0f1117; --card: #1a1d27; --border: #2a2d3a; --text: #e1e4ed; --dim: #8b8fa3; --accent: #6c8aff; --green: #4ade80; --red: #f87171; --yellow: #fbbf24; }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif; background: var(--bg); color: var(--text); line-height: 1.5; }
  .container { max-width: 900px; margin: 0 auto; padding: 24px 16px; }
  h1 { font-size: 1.5rem; margin-bottom: 4px; }
  .subtitle { color: var(--dim); font-size: 0.875rem; margin-bottom: 24px; }
  .config-bar { display: flex; gap: 8px; margin-bottom: 24px; flex-wrap: wrap; }
  .config-bar input { flex: 1; min-width: 200px; padding: 8px 12px; background: var(--card); border: 1px solid var(--border); border-radius: 6px; color: var(--text); font-size: 0.875rem; }
  .config-bar input::placeholder { color: var(--dim); }
  button { padding: 8px 16px; background: var(--accent); color: #fff; border: none; border-radius: 6px; cursor: pointer; font-size: 0.875rem; font-weight: 500; }
  button:hover { opacity: 0.9; }
  button:disabled { opacity: 0.5; cursor: not-allowed; }

  .tabs { display: flex; gap: 2px; margin-bottom: 16px; background: var(--card); border-radius: 8px; padding: 3px; }
  .tab { flex: 1; text-align: center; padding: 8px; border-radius: 6px; cursor: pointer; font-size: 0.875rem; color: var(--dim); transition: all 0.15s; }
  .tab.active { background: var(--accent); color: #fff; }

  .panel { display: none; }
  .panel.active { display: block; }

  /* Chat panel */
  #chat-messages { min-height: 200px; max-height: 400px; overflow-y: auto; background: var(--card); border: 1px solid var(--border); border-radius: 8px; padding: 16px; margin-bottom: 12px; }
  .msg { margin-bottom: 12px; }
  .msg-role { font-size: 0.75rem; text-transform: uppercase; color: var(--dim); margin-bottom: 2px; }
  .msg-content { white-space: pre-wrap; word-break: break-word; }
  .msg-content.assistant { color: var(--accent); }
  .chat-input { display: flex; gap: 8px; }
  .chat-input input { flex: 1; padding: 10px 14px; background: var(--card); border: 1px solid var(--border); border-radius: 8px; color: var(--text); font-size: 0.875rem; }
  .chat-controls { display: flex; gap: 8px; align-items: center; margin-bottom: 12px; }
  .chat-controls select, .chat-controls label { font-size: 0.875rem; color: var(--dim); }
  .chat-controls select { padding: 6px 8px; background: var(--card); border: 1px solid var(--border); border-radius: 6px; color: var(--text); }

  /* Tests panel */
  .test-results { display: flex; flex-direction: column; gap: 8px; }
  .test-card { background: var(--card); border: 1px solid var(--border); border-radius: 8px; padding: 12px 16px; }
  .test-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px; }
  .test-name { font-weight: 600; font-size: 0.875rem; }
  .badge { padding: 2px 8px; border-radius: 4px; font-size: 0.75rem; font-weight: 600; text-transform: uppercase; }
  .badge.pass { background: rgba(74,222,128,0.15); color: var(--green); }
  .badge.fail { background: rgba(248,113,113,0.15); color: var(--red); }
  .badge.pending { background: rgba(251,191,36,0.15); color: var(--yellow); }
  .test-detail { font-size: 0.8rem; color: var(--dim); white-space: pre-wrap; word-break: break-all; max-height: 120px; overflow-y: auto; }

  .summary-bar { display: flex; gap: 16px; margin-bottom: 16px; font-size: 0.875rem; }
  .summary-bar span { font-weight: 600; }
</style>
</head>
<body>
<div class="container">
  <h1>Daptin LLM Demo</h1>
  <p class="subtitle">OpenAI-compatible endpoint contract test &mdash; powered by the official <code>openai</code> JS SDK</p>

  <div class="config-bar">
    <input id="cfg-url" type="text" placeholder="Daptin URL (e.g. http://localhost:6336)">
    <input id="cfg-token" type="password" placeholder="JWT Token (from /action/user_account/signin)">
  </div>

  <div class="tabs">
    <div class="tab active" data-panel="panel-chat">Chat</div>
    <div class="tab" data-panel="panel-tests">Contract Tests</div>
  </div>

  <!-- Chat Panel -->
  <div id="panel-chat" class="panel active">
    <div class="chat-controls">
      <select id="chat-model"><option value="">loading models...</option></select>
      <label><input type="checkbox" id="chat-stream" checked> Stream</label>
    </div>
    <div id="chat-messages"></div>
    <div class="chat-input">
      <input id="chat-input" type="text" placeholder="Type a message..." autofocus>
      <button id="chat-send">Send</button>
    </div>
  </div>

  <!-- Tests Panel -->
  <div id="panel-tests" class="panel">
    <div style="display:flex; gap:8px; margin-bottom:16px;">
      <button id="run-tests">Run All Tests</button>
    </div>
    <div class="summary-bar" id="test-summary" style="display:none;"></div>
    <div class="test-results" id="test-results"></div>
  </div>
</div>

<script>
// ── Config ───────────────────────────────────────────────────────────────────
const cfgUrl = document.getElementById('cfg-url');
const cfgToken = document.getElementById('cfg-token');
cfgUrl.value = localStorage.getItem('daptin-url') || '${DAPTIN_BASE_URL}';
cfgToken.value = localStorage.getItem('daptin-token') || '${DAPTIN_TOKEN}';
cfgUrl.addEventListener('change', () => localStorage.setItem('daptin-url', cfgUrl.value));
cfgToken.addEventListener('change', () => localStorage.setItem('daptin-token', cfgToken.value));

function baseUrl() { return cfgUrl.value.replace(/\\/+$/, ''); }
function headers() {
  const h = { 'Content-Type': 'application/json' };
  if (cfgToken.value) h['Authorization'] = 'Bearer ' + cfgToken.value;
  return h;
}

// ── Tabs ─────────────────────────────────────────────────────────────────────
document.querySelectorAll('.tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
    tab.classList.add('active');
    document.getElementById(tab.dataset.panel).classList.add('active');
  });
});

// ── Models ───────────────────────────────────────────────────────────────────
async function loadModels() {
  const sel = document.getElementById('chat-model');
  try {
    const res = await fetch(baseUrl() + '/v1/models', { headers: headers() });
    const json = await res.json();
    sel.innerHTML = '';
    if (json.data && json.data.length > 0) {
      json.data.forEach(m => {
        const opt = document.createElement('option');
        opt.value = m.id; opt.textContent = m.id + ' (' + m.owned_by + ')';
        sel.appendChild(opt);
      });
    } else {
      sel.innerHTML = '<option value="">no models found</option>';
    }
  } catch (e) {
    console.error('[models]', e);
    sel.innerHTML = '<option value="">error loading models</option>';
  }
}
loadModels();

// ── Chat ─────────────────────────────────────────────────────────────────────
const chatMsgs = document.getElementById('chat-messages');
const chatInput = document.getElementById('chat-input');
const chatSend = document.getElementById('chat-send');
const chatModel = document.getElementById('chat-model');
const chatStream = document.getElementById('chat-stream');
let conversation = [];

function addMessage(role, content) {
  const div = document.createElement('div');
  div.className = 'msg';
  div.innerHTML = '<div class="msg-role">' + role + '</div><div class="msg-content ' + role + '"></div>';
  div.querySelector('.msg-content').textContent = content;
  chatMsgs.appendChild(div);
  chatMsgs.scrollTop = chatMsgs.scrollHeight;
  return div.querySelector('.msg-content');
}

async function sendChat() {
  const text = chatInput.value.trim();
  if (!text) return;
  chatInput.value = '';
  conversation.push({ role: 'user', content: text });
  addMessage('user', text);

  const model = chatModel.value;
  const stream = chatStream.checked;
  const body = { model, messages: [...conversation], stream };

  chatSend.disabled = true;
  const el = addMessage('assistant', '');

  try {
    if (stream) {
      const res = await fetch(baseUrl() + '/v1/chat/completions', {
        method: 'POST', headers: headers(), body: JSON.stringify(body),
      });
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let fullContent = '';
      let buf = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split('\\n');
        buf = lines.pop();
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || !trimmed.startsWith('data: ')) continue;
          const payload = trimmed.slice(6);
          if (payload === '[DONE]') continue;
          try {
            const chunk = JSON.parse(payload);
            const delta = chunk.choices && chunk.choices[0] && chunk.choices[0].delta;
            if (delta && delta.content) {
              fullContent += delta.content;
              el.textContent = fullContent;
              chatMsgs.scrollTop = chatMsgs.scrollHeight;
            }
          } catch {}
        }
      }
      conversation.push({ role: 'assistant', content: fullContent });
    } else {
      const res = await fetch(baseUrl() + '/v1/chat/completions', {
        method: 'POST', headers: headers(), body: JSON.stringify(body),
      });
      const json = await res.json();
      const content = json.choices[0].message.content;
      el.textContent = content;
      conversation.push({ role: 'assistant', content });
    }
  } catch (e) {
    el.textContent = 'ERROR: ' + e.message;
    el.style.color = 'var(--red)';
  }
  chatSend.disabled = false;
  chatInput.focus();
}

chatSend.addEventListener('click', sendChat);
chatInput.addEventListener('keydown', e => { if (e.key === 'Enter') sendChat(); });

// ── Contract Tests ───────────────────────────────────────────────────────────
const testDefs = [
  {
    name: 'GET /v1/models',
    desc: 'List available models',
    run: async () => {
      const res = await fetch(baseUrl() + '/v1/models', { headers: headers() });
      const json = await res.json();
      if (!res.ok) throw new Error('HTTP ' + res.status);
      if (json.object !== 'list') throw new Error('expected object="list", got ' + json.object);
      if (!Array.isArray(json.data)) throw new Error('data is not an array');
      if (json.data.length === 0) throw new Error('no models returned');
      const m = json.data[0];
      if (!m.id || !m.object || !m.owned_by) throw new Error('model missing required fields (id, object, owned_by)');
      return json.data.length + ' models: ' + json.data.map(x => x.id).join(', ');
    }
  },
  {
    name: 'POST /v1/chat/completions (non-streaming)',
    desc: 'Standard chat completion',
    run: async () => {
      const model = chatModel.value;
      if (!model) throw new Error('no model selected');
      const res = await fetch(baseUrl() + '/v1/chat/completions', {
        method: 'POST', headers: headers(),
        body: JSON.stringify({ model, messages: [{ role: 'user', content: 'Say "contract-test-ok" and nothing else.' }], max_tokens: 20 }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error('HTTP ' + res.status + ': ' + JSON.stringify(json));
      if (json.object !== 'chat.completion') throw new Error('expected object="chat.completion"');
      if (!json.id) throw new Error('missing id');
      if (!Array.isArray(json.choices) || json.choices.length === 0) throw new Error('no choices');
      const c = json.choices[0];
      if (!c.message || !c.message.content) throw new Error('missing message.content');
      if (!c.finish_reason) throw new Error('missing finish_reason');
      if (!json.usage || typeof json.usage.total_tokens !== 'number') throw new Error('missing usage.total_tokens');
      return 'content="' + c.message.content.slice(0, 80) + '" tokens=' + json.usage.total_tokens;
    }
  },
  {
    name: 'POST /v1/chat/completions (streaming)',
    desc: 'SSE streaming chat completion',
    run: async () => {
      const model = chatModel.value;
      if (!model) throw new Error('no model selected');
      const res = await fetch(baseUrl() + '/v1/chat/completions', {
        method: 'POST', headers: headers(),
        body: JSON.stringify({ model, messages: [{ role: 'user', content: 'Say "stream-ok".' }], max_tokens: 20, stream: true }),
      });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const ct = res.headers.get('content-type') || '';
      if (!ct.includes('text/event-stream')) throw new Error('expected text/event-stream, got ' + ct);

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let chunks = 0, gotRole = false, gotContent = false, gotDone = false, content = '';
      let buf = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split('\\n');
        buf = lines.pop();
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed.startsWith('data: ')) continue;
          const payload = trimmed.slice(6);
          if (payload === '[DONE]') { gotDone = true; continue; }
          try {
            const chunk = JSON.parse(payload);
            chunks++;
            if (chunk.object !== 'chat.completion.chunk') throw new Error('expected object="chat.completion.chunk"');
            const delta = chunk.choices && chunk.choices[0] && chunk.choices[0].delta;
            if (delta) {
              if (delta.role) gotRole = true;
              if (delta.content) { gotContent = true; content += delta.content; }
            }
          } catch (e) { if (!gotDone) throw e; }
        }
      }

      if (!gotDone) throw new Error('never received [DONE]');
      if (!gotRole) throw new Error('never received role delta');
      if (!gotContent) throw new Error('never received content delta');
      return chunks + ' chunks, content="' + content.slice(0, 80) + '"';
    }
  },
  {
    name: 'POST /v1/completions (legacy)',
    desc: 'Legacy completions endpoint mapped to chat',
    run: async () => {
      const model = chatModel.value;
      if (!model) throw new Error('no model selected');
      const res = await fetch(baseUrl() + '/v1/completions', {
        method: 'POST', headers: headers(),
        body: JSON.stringify({ model, prompt: 'Say "legacy-ok".', max_tokens: 20 }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error('HTTP ' + res.status + ': ' + JSON.stringify(json));
      if (!json.choices || json.choices.length === 0) throw new Error('no choices');
      return 'content="' + (json.choices[0].message?.content || JSON.stringify(json.choices[0])).slice(0, 80) + '"';
    }
  },
  {
    name: 'Error: invalid model',
    desc: 'Requesting a non-existent model returns 404 with error object',
    run: async () => {
      const res = await fetch(baseUrl() + '/v1/chat/completions', {
        method: 'POST', headers: headers(),
        body: JSON.stringify({ model: '__nonexistent_model_12345__', messages: [{ role: 'user', content: 'hi' }] }),
      });
      if (res.status !== 404) throw new Error('expected 404, got ' + res.status);
      const json = await res.json();
      if (!json.error || !json.error.message) throw new Error('missing error.message');
      return 'correctly returned 404: ' + json.error.message;
    }
  },
  {
    name: 'Error: missing model field',
    desc: 'Request without model returns 400',
    run: async () => {
      const res = await fetch(baseUrl() + '/v1/chat/completions', {
        method: 'POST', headers: headers(),
        body: JSON.stringify({ messages: [{ role: 'user', content: 'hi' }] }),
      });
      if (res.status !== 400) throw new Error('expected 400, got ' + res.status);
      const json = await res.json();
      if (!json.error) throw new Error('missing error object');
      return 'correctly returned 400';
    }
  },
];

async function runTests() {
  const container = document.getElementById('test-results');
  const summary = document.getElementById('test-summary');
  container.innerHTML = '';
  summary.style.display = 'none';

  const results = [];
  for (const t of testDefs) {
    const card = document.createElement('div');
    card.className = 'test-card';
    card.innerHTML = '<div class="test-header"><span class="test-name">' + t.name + '</span><span class="badge pending">running</span></div><div class="test-detail">' + t.desc + '</div>';
    container.appendChild(card);

    try {
      const detail = await t.run();
      card.querySelector('.badge').className = 'badge pass';
      card.querySelector('.badge').textContent = 'pass';
      card.querySelector('.test-detail').textContent = detail;
      results.push({ name: t.name, pass: true });
    } catch (e) {
      card.querySelector('.badge').className = 'badge fail';
      card.querySelector('.badge').textContent = 'fail';
      card.querySelector('.test-detail').textContent = e.message;
      card.querySelector('.test-detail').style.color = 'var(--red)';
      results.push({ name: t.name, pass: false, error: e.message });
    }
  }

  const passed = results.filter(r => r.pass).length;
  const failed = results.filter(r => !r.pass).length;
  summary.innerHTML = '<span style="color:var(--green)">' + passed + ' passed</span> <span style="color:var(--red)">' + failed + ' failed</span> <span style="color:var(--dim)">/ ' + results.length + ' total</span>';
  summary.style.display = 'flex';
}

document.getElementById('run-tests').addEventListener('click', () => {
  document.getElementById('run-tests').disabled = true;
  runTests().finally(() => { document.getElementById('run-tests').disabled = false; });
});
</script>
</body>
</html>`;

// ── HTTP Server ──────────────────────────────────────────────────────────────

const server = http.createServer((req, res) => {
  console.log(`[demo] ${req.method} ${req.url}`);

  if (req.method === "GET" && (req.url === "/" || req.url === "/index.html")) {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(HTML_PAGE);
    return;
  }

  // Health check
  if (req.method === "GET" && req.url === "/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true }));
    return;
  }

  res.writeHead(404, { "Content-Type": "text/plain" });
  res.end("Not found");
});

server.listen(LISTEN_PORT, LISTEN_HOST, () => {
  console.log(`[demo] Daptin LLM Demo listening on http://${LISTEN_HOST}:${LISTEN_PORT}`);
  console.log(`[demo] Daptin URL: ${DAPTIN_BASE_URL}`);
  console.log(`[demo] Open the browser and configure your Daptin URL + JWT token`);
});
