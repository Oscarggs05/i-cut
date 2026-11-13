// On-screen side of the Claude connection: the button and panel to connect,
// the pill that shows what Claude is doing right now, the card that asks the
// user to pick files and the card with a video Claude exported.

import { useState } from 'react';
import { pickFiles } from '../store/actions';
import { DEFAULT_URL, connect, disconnect, useClaude, type Status } from './bridge';
import { Icon } from '../ui/icons';
import './claude.css';

const STATUS_TEXT: Record<Status, string> = {
  off: 'Sin conectar',
  connecting: 'Conectando…',
  connected: 'Conectado',
  error: 'Sin conexión',
};

/** Claude's mark: a small asterisk-like spark. */
function Spark({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <path fill="currentColor" d="M12 2.5l1.6 6.1 5.6-3-3 5.6 6.1 1.6-6.1 1.6 3 5.6-5.6-3L12 21.5l-1.6-6.1-5.6 3 3-5.6L1.7 11.2l6.1-1.6-3-5.6 5.6 3z" />
    </svg>
  );
}

export function ClaudeButton({ compact }: { compact?: boolean }) {
  const status = useClaude((s) => s.status);
  return (
    <button className={`claude-btn ${status}${compact ? ' compact' : ''}`} title={`Claude · ${STATUS_TEXT[status]}`} aria-label={`Claude, ${STATUS_TEXT[status]}`}
      onClick={() => useClaude.setState({ panel: true })}>
      <Spark size={compact ? 16 : 18} />
      {!compact && <span>Claude</span>}
      <i className="dot" />
    </button>
  );
}

function ClaudePanel() {
  const { status, url, error, activity } = useClaude();
  const [draft, setDraft] = useState(url);
  const close = () => useClaude.setState({ panel: false });
  const on = status === 'connected' || status === 'connecting' || (status === 'error' && !!error && error.includes('Reintentando'));
  return (
    <div className="modal-back" onClick={close}>
      <div className="modal claude-panel" onClick={(e) => e.stopPropagation()}>
        <div className="claude-head">
          <h3><Spark size={20} /> Claude</h3>
          <button className="icon-btn" aria-label="Cerrar" onClick={close}><Icon name="close" /></button>
        </div>
        <div className={`claude-status ${status}`}><i className="dot" />{STATUS_TEXT[status]}{status === 'connected' && ' · lo que haga Claude se verá aquí en directo'}</div>
        {error && <p className="hint" style={{ color: status === 'off' ? undefined : 'var(--danger)' }}>{error}</p>}

        <div className="hint">Dirección del servidor</div>
        <input className="text-input claude-url" value={draft} spellCheck={false} autoCapitalize="off" autoCorrect="off"
          onChange={(e) => setDraft(e.target.value)} placeholder={DEFAULT_URL} />
        <div className="btn-row">
          {on
            ? <button className="btn" onClick={disconnect}>Desconectar</button>
            : <button className="btn primary" onClick={() => connect(draft)}><Spark />Conectar</button>}
        </div>

        {activity.length > 0 && (
          <>
            <div className="hint" style={{ marginTop: 16 }}>Lo último que ha hecho Claude</div>
            <ul className="claude-log">
              {activity.slice(0, 25).map((a) => (
                <li key={a.id} className={a.state}>
                  <span className="ic">{a.state === 'running' ? <span className="spinner" /> : a.state === 'done' ? '✓' : '!'}</span>
                  <span className="lb">{a.label}{a.detail && <small>{a.detail}</small>}</span>
                  <time>{new Date(a.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</time>
                </li>
              ))}
            </ul>
          </>
        )}

        <details className="claude-help">
          <summary>¿Cómo conecto Claude?</summary>
          <ol>
            <li>En tu ordenador, añade el servidor MCP de i-cut a Claude Desktop o Claude Code (está explicado en <code>mcp/README.md</code> del repositorio).</li>
            <li>Abre i-cut en ese mismo ordenador y pulsa <b>Conectar</b> con la dirección <code>{DEFAULT_URL}</code>.</li>
            <li>Pídele a Claude lo que quieras: «añade subtítulos», «quita los silencios», «haz un collage»… Verás cada cambio en directo y podrás deshacerlo.</li>
          </ol>
          <p>Para el iPhone o claude.ai, arranca el servidor con <code>--http</code> y un túnel https; te dará un enlace que conecta el editor solo.</p>
        </details>
      </div>
    </div>
  );
}

/** Shows what Claude is doing right now, over everything else. */
function ActivityPill() {
  const current = useClaude((s) => s.current);
  if (!current) return null;
  return (
    <div className={`claude-pill ${current.state}`} role="status" aria-live="polite" onClick={() => useClaude.setState({ panel: true })}>
      <Spark size={15} />
      <span className="who">Claude</span>
      <span className="what">{current.state === 'error' ? `No pudo: ${current.label.toLowerCase()}` : current.label}{current.detail ? ` · ${current.detail}` : ''}</span>
    </div>
  );
}

function FileRequestCard() {
  const req = useClaude((s) => s.fileRequest);
  if (!req) return null;
  const choose = async () => {
    const files = await pickFiles(req.accept, req.multiple);
    if (files.length) req.resolve(files);
  };
  return (
    <div className="modal-back claude-front">
      <div className="modal center">
        <h3><Spark size={20} /> Claude te pide archivos</h3>
        <p className="hint" style={{ color: 'var(--text)', fontSize: 15 }}>{req.message}</p>
        <button className="btn primary block" onClick={() => void choose()}><Icon name="plus" size={18} />Elegir {req.multiple ? 'archivos' : 'un archivo'}</button>
        <button className="btn block" style={{ marginTop: 8 }} onClick={() => req.resolve([])}>Ahora no</button>
      </div>
    </div>
  );
}

function ExportedCard() {
  const v = useClaude((s) => s.exported);
  if (!v) return null;
  const close = () => { URL.revokeObjectURL(v.url); useClaude.setState({ exported: null }); };
  const download = () => {
    const a = document.createElement('a');
    a.href = v.url;
    a.download = v.name;
    document.body.appendChild(a);
    a.click();
    a.remove();
  };
  const share = async () => {
    const file = new File([v.blob], v.name, { type: v.mime });
    const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
    if (nav.share && nav.canShare?.({ files: [file] })) {
      try { await nav.share({ files: [file], title: v.name }); } catch { /* cancelled */ }
    } else download();
  };
  return (
    <div className="modal-back claude-front" onClick={close}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3><Spark size={20} /> Claude ha exportado el vídeo</h3>
        <video className="result-video" src={v.url} controls playsInline loop />
        <p className="hint">{v.width}×{v.height} · {(v.blob.size / 1e6).toFixed(1)} MB</p>
        <button className="btn primary block" onClick={() => void share()}><Icon name="share" size={18} />Guardar en Fotos / Compartir</button>
        <div className="btn-row">
          <button className="btn" onClick={download}><Icon name="download" size={18} />Descargar</button>
          <button className="btn" onClick={close}>Cerrar</button>
        </div>
      </div>
    </div>
  );
}

export function ClaudeLayer() {
  const panel = useClaude((s) => s.panel);
  return (
    <>
      <ActivityPill />
      {panel && <ClaudePanel />}
      <FileRequestCard />
      <ExportedCard />
    </>
  );
}
