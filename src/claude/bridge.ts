// Connection to the i-cut MCP server (mcp/server.mjs). The server forwards
// Claude's tool calls here over a WebSocket; they run on the live editor, so
// the user watches every change happen on screen.

import { create } from 'zustand';
import { useEditor } from '../store/editor';
import { COMMANDS, CommandError, type CommandResult } from './commands';

export type Status = 'off' | 'connecting' | 'connected' | 'error';

export interface Activity {
  id: number;
  label: string;
  state: 'running' | 'done' | 'error';
  detail?: string;
  at: number;
}

/** A request from Claude for the user to pick files (needs a tap). */
export interface FileRequest {
  message: string;
  accept: string;
  multiple: boolean;
  resolve: (files: File[]) => void;
}

/** A video Claude exported, offered to the user to save or share. */
export interface ExportedVideo {
  url: string;
  blob: Blob;
  name: string;
  mime: string;
  width: number;
  height: number;
}

interface ClaudeState {
  status: Status;
  url: string;
  error: string;
  panel: boolean;
  activity: Activity[];
  /** The step Claude is running now (or just finished), for the on-screen pill. */
  current: Activity | null;
  fileRequest: FileRequest | null;
  exported: ExportedVideo | null;
}

const KEY = 'i-cut:claude';
export const DEFAULT_URL = 'ws://localhost:7333/bridge';

function saved(): { url: string; auto: boolean } {
  try {
    const s = JSON.parse(localStorage.getItem(KEY) ?? '');
    if (s && typeof s.url === 'string') return { url: s.url, auto: !!s.auto };
  } catch { /* defaults */ }
  return { url: DEFAULT_URL, auto: false };
}
function save(url: string, auto: boolean) {
  try { localStorage.setItem(KEY, JSON.stringify({ url, auto })); } catch { /* private mode */ }
}

export const useClaude = create<ClaudeState>(() => ({
  status: 'off',
  url: saved().url,
  error: '',
  panel: false,
  activity: [],
  current: null,
  fileRequest: null,
  exported: null,
}));

const C = () => useClaude.getState();

let ws: WebSocket | null = null;
let wanted = false;
let retry = 0;
let retryTimer = 0;
let seq = 0;
let clearTimer = 0;

/** Base http(s) address of the server, for file transfers. */
export function serverBase(): string {
  try {
    const u = new URL(C().url);
    u.protocol = u.protocol === 'wss:' ? 'https:' : 'http:';
    return u.origin;
  } catch {
    return 'http://localhost:7333';
  }
}


export function connect(url = C().url) {
  url = url.trim() || DEFAULT_URL;
  if (!/^wss?:\/\//.test(url)) url = 'ws://' + url;
  if (!/\/bridge(\?|$)/.test(url)) url = url.replace(/\/?(\?|$)/, '/bridge$1');
  wanted = true;
  save(url, true);
  useClaude.setState({ url, error: '' });
  open();
}

export function disconnect() {
  wanted = false;
  save(C().url, false);
  clearTimeout(retryTimer);
  ws?.close();
  ws = null;
  useClaude.setState({ status: 'off', error: '' });
}

function open() {
  clearTimeout(retryTimer);
  ws?.close();
  useClaude.setState({ status: 'connecting' });
  let sock: WebSocket;
  try {
    sock = new WebSocket(C().url);
  } catch (e) {
    useClaude.setState({ status: 'error', error: (e as Error).message });
    return;
  }
  ws = sock;
  sock.onopen = () => {
    retry = 0;
    useClaude.setState({ status: 'connected', error: '' });
    sock.send(JSON.stringify({ type: 'hello', app: 'i-cut', version: '0.1.0', tools: Object.keys(COMMANDS), ua: navigator.userAgent, ...screenState() }));
  };
  sock.onmessage = (e) => {
    let m: { type: string; id: string; tool: string; args: Record<string, unknown> };
    try { m = JSON.parse(String(e.data)); } catch { return; }
    if (m.type === 'call') void run(sock, m.id, m.tool, m.args ?? {});
  };
  sock.onclose = (e) => {
    if (ws !== sock) return;
    ws = null;
    if (e.code === 4000) {
      // Another tab took over.
      wanted = false;
      useClaude.setState({ status: 'off', error: 'Se ha conectado otra pestaña de i-cut.' });
      return;
    }
    if (!wanted) { useClaude.setState({ status: 'off' }); return; }
    const was = C().status;
    useClaude.setState({
      status: 'error',
      error: was === 'connected' ? 'Se perdió la conexión. Reintentando…' : 'No se encuentra el servidor de Claude. ¿Está en marcha? Reintentando…',
    });
    retry = Math.min(retry + 1, 6);
    retryTimer = window.setTimeout(open, 1000 * Math.min(30, 2 ** retry));
  };
}

function screenState() {
  const p = useEditor.getState().project;
  return { screen: p ? 'editor' : 'home', project: p?.name ?? null };
}

// Tell the server which project is open (shown by connection_status).
let lastScreen = '';
useEditor.subscribe((s) => {
  const key = s.project ? `${s.project.id}:${s.project.name}` : '';
  if (key === lastScreen) return;
  lastScreen = key;
  if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'state', ...screenState() }));
});

function log(a: Activity) {
  const list = [a, ...C().activity.filter((x) => x.id !== a.id)].slice(0, 60);
  useClaude.setState({ activity: list, current: a });
  clearTimeout(clearTimer);
  if (a.state !== 'running') clearTimer = window.setTimeout(() => { if (C().current?.id === a.id) useClaude.setState({ current: null }); }, a.state === 'error' ? 6000 : 2500);
}

async function run(sock: WebSocket, id: string, tool: string, args: Record<string, unknown>) {
  const cmd = COMMANDS[tool];
  const reply = (msg: object) => { if (sock.readyState === WebSocket.OPEN) sock.send(JSON.stringify({ id, ...msg })); };
  if (!cmd) { reply({ type: 'result', ok: false, error: `Esta versión de i-cut no tiene la herramienta «${tool}». Recarga la página.` }); return; }
  let label = tool;
  try { label = cmd.label(args); } catch { /* keep the tool name */ }
  const act: Activity = { id: ++seq, label, state: 'running', at: Date.now() };
  log(act);
  try {
    const result: CommandResult = (await cmd.run(args, {
      progress: (message) => { reply({ type: 'progress', message }); log({ ...act, detail: message }); },
    })) ?? {};
    log({ ...act, state: 'done', detail: undefined });
    reply({ type: 'result', ok: true, result });
  } catch (e) {
    const msg = e instanceof CommandError ? e.message : (e as Error)?.message || String(e);
    if (!(e instanceof CommandError)) console.error(e);
    log({ ...act, state: 'error', detail: msg });
    reply({ type: 'result', ok: false, error: msg });
  }
}

/** Starts the connection saved from last time, or the one in the link (#claude=ws://…). */
export function initClaude() {
  const m = location.hash.match(/[#&]claude=([^&]+)/);
  if (m) {
    const url = decodeURIComponent(m[1]);
    history.replaceState(null, '', location.pathname + location.search);
    connect(url);
    return;
  }
  const s = saved();
  if (s.auto) { wanted = true; open(); }
}
