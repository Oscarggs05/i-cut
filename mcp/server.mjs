#!/usr/bin/env node
// i-cut MCP server.
//
// Claude talks MCP to this process; the i-cut editor open in a browser tab
// connects to it over a WebSocket (the "bridge"). Every tool call is forwarded
// to that tab and runs on the live project, so the user sees each edit on
// screen as it happens.
//
//   node server.mjs           stdio MCP (Claude Desktop, Claude Code) + bridge on 127.0.0.1:7333
//   node server.mjs --http    Streamable HTTP MCP at /mcp/<token> + bridge, for claude.ai
//                             custom connectors through a tunnel (and for the iPhone).

import http from 'node:http';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { WebSocketServer } from 'ws';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { TOOLS, LOCAL_TOOLS } from './tools.mjs';

const VERSION = '0.1.0';

// ── Options ──────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const flag = (name) => argv.includes(`--${name}`);
const opt = (name, def) => {
  const i = argv.indexOf(`--${name}`);
  if (i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--')) return argv[i + 1];
  return process.env[`ICUT_${name.toUpperCase().replace(/-/g, '_')}`] ?? def;
};

if (flag('help') || flag('h')) {
  console.error(`i-cut MCP ${VERSION}

  node server.mjs                    MCP por stdio (Claude Desktop / Claude Code)
  node server.mjs --http             MCP por HTTP en /mcp/<token> (conectores de claude.ai)

  --port <n>          Puerto del puente y del HTTP (7333)
  --host <ip>         Interfaz donde escuchar (127.0.0.1)
  --public-url <url>  URL pública (túnel https) para imprimir los enlaces
  --app <url>         Dirección de i-cut (https://i-cut.vercel.app)
  --origins <lista>   Orígenes extra que pueden conectar el editor, separados por comas
  --save-dir <dir>    Carpeta para los vídeos exportados`);
  process.exit(0);
}

const HTTP_MODE = flag('http');
const PORT = Number(opt('port', 7333));
const HOST = opt('host', '127.0.0.1');
const PUBLIC_URL = opt('public-url', '')?.replace(/\/+$/, '') || '';
const APP_URL = (opt('app', 'https://i-cut.vercel.app') || '').replace(/\/+$/, '');
const EXTRA_ORIGINS = (opt('origins', '') || '').split(',').map((s) => s.trim().replace(/\/+$/, '')).filter(Boolean);
const SAVE_DIR = opt('save-dir', '') || defaultSaveDir();
/** Long tools hand back a job id if they take longer than this. */
const WAIT_MS = Number(opt('wait-ms', 45000));

const log = (...a) => console.error('[i-cut-mcp]', ...a);

function defaultSaveDir() {
  const home = os.homedir();
  const movies = path.join(home, process.platform === 'darwin' ? 'Movies' : 'Videos');
  return path.join(fs.existsSync(movies) ? movies : home, 'i-cut');
}

// A secret shared by every instance on this computer: it guards /rpc and,
// in HTTP mode, the MCP URL and remote editor connections.
function loadToken() {
  if (process.env.ICUT_TOKEN) return process.env.ICUT_TOKEN;
  const file = path.join(os.homedir(), '.i-cut-mcp.json');
  try {
    const c = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (typeof c.token === 'string' && c.token.length >= 16) return c.token;
  } catch { /* first run */ }
  const token = crypto.randomBytes(18).toString('base64url');
  try { fs.writeFileSync(file, JSON.stringify({ token }, null, 2), { mode: 0o600 }); } catch (e) { log('No se pudo guardar el token:', e.message); }
  return token;
}
const TOKEN = loadToken();
const safeEq = (a, b) => typeof a === 'string' && a.length === b.length && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));

// ── Who may connect the editor ───────────────────────────────────────────
const LOCAL_ORIGIN = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/;
function originAllowed(origin) {
  if (!origin) return false;
  const o = origin.replace(/\/+$/, '');
  return o === APP_URL || LOCAL_ORIGIN.test(o) || EXTRA_ORIGINS.includes(o);
}
function corsHeaders(req) {
  const o = req.headers.origin;
  return o && originAllowed(o) ? {
    'Access-Control-Allow-Origin': o,
    'Access-Control-Allow-Methods': 'GET, POST, PUT, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Private-Network': 'true',
    Vary: 'Origin',
  } : {};
}

// ── Bridge to the editor ─────────────────────────────────────────────────
class Bridge {
  editor = null;
  info = null;
  pending = new Map();
  jobs = new Map();
  files = new Map();
  uploads = new Map();
  seq = 0;

  attach(ws, remote) {
    if (this.editor) {
      try { this.editor.close(4000, 'Otra pestaña de i-cut se ha conectado'); } catch { /* gone */ }
    }
    this.editor = ws;
    this.info = { remote, since: Date.now() };
    log('Editor conectado' + (remote ? ' (remoto)' : ''));
    ws.on('message', (raw) => {
      let m;
      try { m = JSON.parse(String(raw)); } catch { return; }
      if (m.type === 'hello') this.info = { ...this.info, ...m };
      else if (m.type === 'state') this.info = { ...this.info, ...m };
      else if (m.type === 'progress') this.pending.get(m.id)?.onProgress?.(m.message);
      else if (m.type === 'result') {
        const p = this.pending.get(m.id);
        if (!p) return;
        this.pending.delete(m.id);
        if (m.ok) p.resolve(m.result ?? {});
        else p.reject(new Error(m.error || 'Error en el editor'));
      }
    });
    const alive = setInterval(() => { try { ws.ping(); } catch { /* closed */ } }, 20000);
    ws.on('close', () => {
      clearInterval(alive);
      if (this.editor !== ws) return;
      this.editor = null;
      log('Editor desconectado');
      for (const [id, p] of this.pending) {
        p.reject(new Error('El editor se ha desconectado (se cerró o recargó la pestaña). Pide al usuario que lo vuelva a abrir y conectar.'));
        this.pending.delete(id);
      }
    });
  }

  call(tool, args, onProgress) {
    const ws = this.editor;
    if (!ws || ws.readyState !== 1) return Promise.reject(new NotConnected());
    const id = String(++this.seq);
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject, onProgress });
      ws.send(JSON.stringify({ type: 'call', id, tool, args }));
    });
  }

  /** Runs `start`; if it takes longer than WAIT_MS, keeps it as a job the caller can wait for. */
  async withJob(tool, start, onProgress) {
    const job = { id: 'job-' + crypto.randomBytes(4).toString('hex'), tool, last: '', promise: null };
    const progress = (msg) => { job.last = String(msg); onProgress?.(msg); };
    job.promise = start(progress);
    job.promise.catch(() => { /* reported through the job */ });
    const timer = new Promise((res) => setTimeout(res, WAIT_MS, 'timeout'));
    const r = await Promise.race([job.promise, timer]);
    if (r !== 'timeout') return r;
    this.jobs.set(job.id, job);
    return { text: `«${tool}» sigue en marcha en el editor${job.last ? ` (${job.last})` : ''}. Llama a wait_for_job con job_id="${job.id}" para esperar el resultado.`, data: { job_id: job.id, status: 'running' } };
  }

  async waitJob(id) {
    const job = this.jobs.get(id);
    if (!job) throw new Error(`No existe el trabajo ${id}`);
    const timer = new Promise((res) => setTimeout(res, WAIT_MS, 'timeout'));
    const r = await Promise.race([job.promise.catch((e) => ({ __error: e })), timer]);
    if (r === 'timeout') return { text: `Sigue en marcha${job.last ? `: ${job.last}` : ''}. Vuelve a llamar a wait_for_job.`, data: { job_id: id, status: 'running' } };
    this.jobs.delete(id);
    if (r && r.__error) throw r.__error;
    return r;
  }

  /** Lets the editor download a file once over HTTP. */
  offerFile(file) {
    const id = crypto.randomBytes(16).toString('hex');
    this.files.set(id, { ...file, expires: Date.now() + 30 * 60_000 });
    return `/file/${id}`;
  }

  expectUpload(target) {
    const id = crypto.randomBytes(16).toString('hex');
    this.uploads.set(id, { target, expires: Date.now() + 6 * 3600_000 });
    return { url: `/upload/${id}`, id };
  }
}

class NotConnected extends Error {
  constructor() {
    super('El editor i-cut no está conectado. ' + connectHelp());
  }
}

const bridge = new Bridge();

function bridgeUrl() {
  if (PUBLIC_URL) return PUBLIC_URL.replace(/^http/, 'ws') + `/bridge?token=${TOKEN}`;
  return `ws://localhost:${PORT}/bridge`;
}
function editorLink() {
  return `${APP_URL}/#claude=${encodeURIComponent(bridgeUrl())}`;
}
function connectHelp() {
  return `Pide al usuario que abra ${editorLink()} (o abra i-cut, pulse el botón «Claude» y luego «Conectar» con la dirección ${bridgeUrl()}). Cuando esté conectado, vuelve a intentarlo.`;
}

// ── Tool execution ───────────────────────────────────────────────────────
const MIME = {
  '.mp4': 'video/mp4', '.m4v': 'video/mp4', '.mov': 'video/quicktime', '.webm': 'video/webm', '.mkv': 'video/x-matroska',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.gif': 'image/gif', '.webp': 'image/webp', '.heic': 'image/heic', '.avif': 'image/avif',
  '.mp3': 'audio/mpeg', '.m4a': 'audio/mp4', '.aac': 'audio/aac', '.wav': 'audio/wav', '.ogg': 'audio/ogg', '.opus': 'audio/ogg', '.flac': 'audio/flac',
};
const mimeOf = (name) => MIME[path.extname(name).toLowerCase()] ?? 'application/octet-stream';
const expandHome = (p) => (p.startsWith('~') ? path.join(os.homedir(), p.slice(1)) : p);

async function prepareImport(args) {
  const a = { ...args };
  if (a.path) {
    const p = path.resolve(expandHome(a.path));
    const st = await fsp.stat(p).catch(() => null);
    if (!st || !st.isFile()) throw new Error(`No existe el archivo ${p} en el ordenador donde corre el servidor MCP.`);
    const name = a.filename || path.basename(p);
    a.__file = { url: bridge.offerFile({ path: p, name, mime: mimeOf(name), size: st.size }), name, mime: mimeOf(name), size: st.size };
  } else if (a.url) {
    const res = await fetch(a.url);
    if (!res.ok || !res.body) throw new Error(`No se pudo descargar ${a.url} (HTTP ${res.status})`);
    const urlName = decodeURIComponent(new URL(a.url).pathname.split('/').pop() || 'archivo');
    const ctype = (res.headers.get('content-type') || '').split(';')[0];
    let name = a.filename || urlName;
    if (!path.extname(name)) name += Object.entries(MIME).find(([, m]) => m === ctype)?.[0] ?? '';
    const tmp = path.join(os.tmpdir(), `i-cut-${crypto.randomBytes(6).toString('hex')}${path.extname(name)}`);
    await pipeline(Readable.fromWeb(res.body), fs.createWriteStream(tmp));
    const size = (await fsp.stat(tmp)).size;
    const mime = ctype && ctype !== 'application/octet-stream' ? ctype : mimeOf(name);
    a.__file = { url: bridge.offerFile({ path: tmp, name, mime, size, temp: true }), name, mime, size };
  } else if (a.base64) {
    if (!a.filename) throw new Error('Con base64 hace falta filename (con extensión).');
    const buf = Buffer.from(a.base64, 'base64');
    a.__file = { url: bridge.offerFile({ buffer: buf, name: a.filename, mime: mimeOf(a.filename), size: buf.length }), name: a.filename, mime: mimeOf(a.filename), size: buf.length };
  } else {
    throw new Error('Indica path, url o base64. Si el archivo está en el móvil o el ordenador del usuario, usa request_files_from_user.');
  }
  delete a.base64;
  return a;
}

function exportTarget(saveTo, ext = 'mp4') {
  if (saveTo === 'none') return null;
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
  let target = saveTo ? path.resolve(expandHome(saveTo)) : SAVE_DIR;
  const isDir = !path.extname(target) || (fs.existsSync(target) && fs.statSync(target).isDirectory());
  if (isDir) target = path.join(target, `i-cut-${stamp}.${ext}`);
  return target;
}

function toContent(r) {
  const content = [];
  let text = r?.text ?? '';
  if (r?.data !== undefined) text += (text ? '\n\n' : '') + JSON.stringify(r.data, null, 1);
  if (text) content.push({ type: 'text', text });
  for (const img of r?.images ?? []) {
    if (img.label) content.push({ type: 'text', text: img.label });
    content.push({ type: 'image', data: img.data, mimeType: img.mime || 'image/jpeg' });
  }
  if (!content.length) content.push({ type: 'text', text: 'Hecho.' });
  return content;
}

async function runLocal(name, args) {
  if (name === 'connection_status') {
    if (bridge.editor) {
      const i = bridge.info || {};
      return {
        text: `El editor i-cut está conectado${i.project ? ` con el proyecto «${i.project}» abierto` : ' en la lista de proyectos'}. Todo lo que hagas se verá en directo en su pantalla.`,
        data: { connected: true, screen: i.screen, project: i.project ?? null, editor_version: i.version, user_agent: i.ua },
      };
    }
    return { text: `El editor no está conectado. ${connectHelp()}`, data: { connected: false, link: editorLink(), bridge: bridgeUrl() } };
  }
  if (name === 'wait_for_job') return bridge.waitJob(String(args.job_id || ''));
  throw new Error(`Herramienta desconocida: ${name}`);
}

/** Runs one tool in this process (the one that owns the bridge). */
async function runTool(name, args, onProgress) {
  args = args ?? {};
  if (!TOOLS.some((t) => t.name === name)) throw new Error(`Herramienta desconocida: ${name}`);
  if (LOCAL_TOOLS.has(name)) return runLocal(name, args);
  if (!bridge.editor) throw new NotConnected();
  let save = null;
  if (name === 'import_media') args = await prepareImport(args);
  if (name === 'export_video') {
    const target = exportTarget(args.save_to);
    if (target) { save = target; args = { ...args, __upload: bridge.expectUpload(target).url }; }
  }
  const start = (progress) => bridge.call(name, args, progress).then((r) => {
    if (save && r?.data?.saved) r.text = (r.text || '') + `\nCopia guardada en ${save}`;
    return r;
  });
  // Long jobs (and a stuck quick edit) hand back a job id instead of hanging the chat.
  return bridge.withJob(name, start, onProgress);
}

// A second stdio instance (Claude Desktop sometimes starts more than one)
// can't open the port; it forwards calls to the instance that has it.
let forward = null;
async function forwardTool(name, args) {
  const res = await fetch(`http://127.0.0.1:${PORT}/rpc`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` },
    body: JSON.stringify({ name, args }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || body.error) throw new Error(body.error || `HTTP ${res.status}`);
  return body.result;
}

const INSTRUCTIONS = `This server controls i-cut, a video editor (CapCut-style) running in the user's browser or iPhone. Every tool acts on the live editor tab, so the user watches each change on screen as you make it.
Workflow: call get_project (or connection_status if the editor is not connected), plan the edit, apply changes step by step, and use get_frame / get_frames to look at the result. All times are timeline seconds. Every edit can be undone by the user (and with the undo tool).
To bring in media use import_media with a local path or URL, or request_files_from_user when the files are on the user's device. Long jobs (export, captions, silences, reverse, stabilize) may return a job id: then call wait_for_job.
The user speaks Spanish; texts and captions you add should normally be in Spanish.`;

function makeServer() {
  const server = new Server({ name: 'i-cut', version: VERSION }, { capabilities: { tools: {} }, instructions: INSTRUCTIONS });
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: TOOLS.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })),
  }));
  server.setRequestHandler(CallToolRequestSchema, async (req, extra) => {
    const { name, arguments: args } = req.params;
    const token = req.params._meta?.progressToken;
    let n = 0;
    const onProgress = token === undefined ? undefined : (message) => {
      extra.sendNotification({ method: 'notifications/progress', params: { progressToken: token, progress: ++n, message: String(message) } }).catch(() => {});
    };
    try {
      const r = forward ? await forwardTool(name, args) : await runTool(name, args, onProgress);
      return { content: toContent(r) };
    } catch (e) {
      return { content: [{ type: 'text', text: e?.message || String(e) }], isError: true };
    }
  });
  return server;
}

// ── HTTP server: bridge, file transfer, /rpc and (optionally) MCP ─────────
async function readBody(req, limit = 50e6) {
  const chunks = [];
  let size = 0;
  for await (const c of req) {
    size += c.length;
    if (size > limit) throw new Error('Cuerpo demasiado grande');
    chunks.push(c);
  }
  return Buffer.concat(chunks);
}

function send(res, status, body, headers = {}) {
  const isJson = typeof body !== 'string';
  res.writeHead(status, { 'Content-Type': isJson ? 'application/json' : 'text/plain; charset=utf-8', ...headers });
  res.end(isJson ? JSON.stringify(body) : body);
}

function statusPage() {
  const connected = !!bridge.editor;
  return `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>i-cut MCP</title>
<body style="font:16px system-ui;max-width:640px;margin:40px auto;padding:0 16px;background:#111;color:#eee">
<h1>i-cut MCP</h1>
<p>Editor: <b>${connected ? 'conectado ✅' : 'sin conectar'}</b></p>
${connected ? '' : `<p><a style="color:#7cf" href="${editorLink()}">Abrir i-cut y conectarlo</a></p>`}
<p style="color:#999">Puente: ${bridgeUrl().replace(TOKEN, '•••')}</p></body>`;
}

const httpServer = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const cors = corsHeaders(req);
  try {
    if (req.method === 'OPTIONS') { res.writeHead(204, cors); res.end(); return; }

    if (url.pathname === '/' && req.method === 'GET') { send(res, 200, statusPage(), { 'Content-Type': 'text/html; charset=utf-8' }); return; }
    if (url.pathname === '/status') { send(res, 200, { app: 'i-cut-mcp', version: VERSION, editor: !!bridge.editor }, cors); return; }

    const file = url.pathname.match(/^\/file\/([0-9a-f]{32})$/);
    if (file && req.method === 'GET') {
      const f = bridge.files.get(file[1]);
      if (!f || f.expires < Date.now()) { send(res, 404, 'No encontrado', cors); return; }
      res.writeHead(200, { ...cors, 'Content-Type': f.mime, 'Content-Length': f.size, 'Cache-Control': 'no-store' });
      if (f.buffer) res.end(f.buffer);
      else await pipeline(fs.createReadStream(f.path), res);
      bridge.files.delete(file[1]);
      if (f.temp) fsp.unlink(f.path).catch(() => {});
      return;
    }

    const up = url.pathname.match(/^\/upload\/([0-9a-f]{32})$/);
    if (up && (req.method === 'PUT' || req.method === 'POST')) {
      const u = bridge.uploads.get(up[1]);
      if (!u || u.expires < Date.now()) { send(res, 404, 'No encontrado', cors); return; }
      bridge.uploads.delete(up[1]);
      await fsp.mkdir(path.dirname(u.target), { recursive: true });
      await pipeline(req, fs.createWriteStream(u.target));
      log('Vídeo guardado en', u.target);
      send(res, 200, { saved: u.target }, cors);
      return;
    }

    if (url.pathname === '/rpc' && req.method === 'POST') {
      if (!safeEq((req.headers.authorization || '').replace(/^Bearer /, ''), TOKEN)) { send(res, 401, { error: 'Token incorrecto' }); return; }
      const { name, args } = JSON.parse((await readBody(req)).toString('utf8'));
      try { send(res, 200, { result: await runTool(name, args) }); } catch (e) { send(res, 200, { error: e.message }); }
      return;
    }

    const mcp = url.pathname.match(/^\/mcp\/([^/]+)\/?$/);
    if (mcp && HTTP_MODE) {
      if (!safeEq(mcp[1], TOKEN)) { send(res, 401, 'Token incorrecto'); return; }
      // Stateless: a fresh server and transport per request.
      const server = makeServer();
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: false });
      res.on('close', () => { void transport.close(); void server.close(); });
      await server.connect(transport);
      const body = req.method === 'POST' ? JSON.parse((await readBody(req)).toString('utf8') || 'null') : undefined;
      await transport.handleRequest(req, res, body);
      return;
    }

    send(res, 404, 'No encontrado');
  } catch (e) {
    log('Error HTTP:', e?.message);
    if (!res.headersSent) send(res, 500, String(e?.message || e), cors);
    else res.destroy();
  }
});

const wss = new WebSocketServer({ noServer: true, maxPayload: 64e6 });
httpServer.on('upgrade', (req, socket, head) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname !== '/bridge') { socket.destroy(); return; }
  const origin = req.headers.origin;
  const tokenOk = safeEq(url.searchParams.get('token') || '', TOKEN);
  const fromLoopback = ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress) && !req.headers['x-forwarded-for'] && !req.headers['cf-connecting-ip'];
  // Only the i-cut app may connect, and from outside this computer only with the token.
  const needToken = !fromLoopback || (HTTP_MODE && !!PUBLIC_URL);
  if (!originAllowed(origin) || (needToken && !tokenOk)) {
    log('Conexión rechazada desde', origin || 'origen desconocido');
    socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
    socket.destroy();
    return;
  }
  wss.handleUpgrade(req, socket, head, (ws) => bridge.attach(ws, !fromLoopback));
});

// Expired files and uploads.
setInterval(() => {
  const now = Date.now();
  for (const [id, f] of bridge.files) if (f.expires < now) { bridge.files.delete(id); if (f.temp) fsp.unlink(f.path).catch(() => {}); }
  for (const [id, u] of bridge.uploads) if (u.expires < now) bridge.uploads.delete(id);
}, 60_000).unref();

function listen() {
  return new Promise((resolve, reject) => {
    httpServer.once('error', reject);
    httpServer.listen(PORT, HOST, () => { httpServer.off('error', reject); resolve(); });
  });
}

async function main() {
  try {
    await listen();
    log(`Puente listo en ws://${HOST}:${PORT}/bridge`);
  } catch (e) {
    if (e.code !== 'EADDRINUSE' || HTTP_MODE) throw e;
    // Another instance owns the bridge: forward to it if it is ours.
    const ok = await fetch(`http://127.0.0.1:${PORT}/status`).then((r) => r.json()).then((j) => j.app === 'i-cut-mcp').catch(() => false);
    if (!ok) throw new Error(`El puerto ${PORT} está ocupado por otro programa. Usa --port.`);
    forward = true;
    log(`Otra instancia ya usa el puerto ${PORT}; reenviando las llamadas a ella.`);
  }

  if (HTTP_MODE) {
    const base = PUBLIC_URL || `http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT}`;
    console.error(`
i-cut MCP ${VERSION} (HTTP)

  URL del conector MCP para Claude:
    ${base}/mcp/${TOKEN}

  Abre el editor con este enlace para conectarlo:
    ${editorLink()}
${PUBLIC_URL ? '' : `
  Para usarlo desde claude.ai o el iPhone, publica el puerto con un túnel https, por ejemplo:
    cloudflared tunnel --url http://localhost:${PORT}
  y vuelve a arrancar con --public-url https://<tu-tunel>.trycloudflare.com
`}`);
    return;
  }

  const server = makeServer();
  await server.connect(new StdioServerTransport());
  log('MCP por stdio listo. Abre', editorLink(), 'para conectar el editor.');
}

main().catch((e) => { log(e?.message || e); process.exit(1); });
