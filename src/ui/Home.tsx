import { useEffect, useState } from 'react';
import type { Project } from '../types';
import { deleteProject, listProjects, loadCover, saveCover, saveProject, storageEstimate } from '../store/db';
import { formatTime, newProject, projectDuration, uid } from '../engine/timeline';
import { Icon } from './icons';

interface Props { onOpen: (p: Project, files?: File[]) => void; onPick: () => Promise<File[]> }

const isStandalone = () =>
  window.matchMedia?.('(display-mode: standalone)').matches || (navigator as unknown as { standalone?: boolean }).standalone === true;
const isIOS = () => /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

function fmtBytes(n: number) {
  if (n > 1e9) return (n / 1e9).toFixed(1) + ' GB';
  return Math.round(n / 1e6) + ' MB';
}

export function Home({ onOpen, onPick }: Props) {
  const [projects, setProjects] = useState<Project[] | null>(null);
  const [covers, setCovers] = useState<Record<string, string>>({});
  const [menu, setMenu] = useState<Project | null>(null);
  const [usage, setUsage] = useState<string>('');

  const refresh = async () => {
    const list = await listProjects();
    setProjects(list);
    const c: Record<string, string> = {};
    for (const p of list) {
      const b = await loadCover(p.id);
      if (b) c[p.id] = URL.createObjectURL(b);
    }
    setCovers((old) => { Object.values(old).forEach(URL.revokeObjectURL); return c; });
    const e = await storageEstimate();
    if (e) setUsage(`${fmtBytes(e.usage)} usados`);
  };

  useEffect(() => { void refresh(); }, []);

  const create = async () => {
    const files = await onPick();
    if (!files.length) return;
    const n = (projects?.length ?? 0) + 1;
    const p = newProject(`Proyecto ${n}`);
    await saveProject(p);
    onOpen(p, files);
  };

  const rename = async (p: Project) => {
    setMenu(null);
    const name = prompt('Nombre del proyecto', p.name);
    if (!name) return;
    await saveProject({ ...p, name, updatedAt: Date.now() });
    void refresh();
  };

  const duplicate = async (p: Project) => {
    setMenu(null);
    const copy = { ...structuredClone(p), id: uid(), name: p.name + ' (copia)', updatedAt: Date.now(), createdAt: Date.now() };
    await saveProject(copy);
    const cover = await loadCover(p.id);
    if (cover) await saveCover(copy.id, cover);
    void refresh();
  };

  const remove = async (p: Project) => {
    setMenu(null);
    if (!confirm(`¿Eliminar "${p.name}"? No se puede deshacer.`)) return;
    await deleteProject(p);
    void refresh();
  };

  return (
    <div className="home">
      <div className="home-head">
        <div className="logo"><span className="mark">✂</span>i-cut</div>
      </div>
      <button className="new-btn" onClick={create}>
        <span className="plus">+</span>Nuevo proyecto
      </button>

      <div className="home-section">
        <h2>Proyectos</h2>
        <span>{usage}</span>
      </div>
      {projects && !projects.length && (
        <div className="empty">Aún no tienes proyectos.<br />Pulsa «Nuevo proyecto» y elige vídeos o fotos de tu carrete.</div>
      )}
      <div className="projects">
        {projects?.map((p) => (
          <div key={p.id} className="proj">
            <button style={{ width: '100%', textAlign: 'left' }} onClick={() => onOpen(p)}>
              <div className="cover" style={covers[p.id] ? { backgroundImage: `url(${covers[p.id]})` } : undefined}>
                {!covers[p.id] && <Icon name="video" size={34} />}
              </div>
              <div className="meta">
                <div className="name">{p.name}</div>
                <div className="sub">{formatTime(projectDuration(p))} · {new Date(p.updatedAt).toLocaleDateString()}</div>
              </div>
            </button>
            <button className="more" aria-label="Opciones" onClick={() => setMenu(p)}><Icon name="more" size={20} /></button>
          </div>
        ))}
      </div>

      {isIOS() && !isStandalone() && (
        <div className="install-tip">
          <b>Instálala como app:</b> pulsa <b>Compartir</b> en Safari y luego <b>«Añadir a pantalla de inicio»</b>.
          Se abrirá a pantalla completa y tus proyectos quedarán guardados de forma permanente en el iPhone.
        </div>
      )}
      <div className="install-tip">
        Todo se procesa en tu iPhone: nada se sube a internet, sin marcas de agua, sin cuenta y sin pagos.
      </div>

      {menu && (
        <div className="menu" onClick={() => setMenu(null)}>
          <div onClick={(e) => e.stopPropagation()}>
            <div className="title">{menu.name}</div>
            <button onClick={() => rename(menu)}>Renombrar</button>
            <button onClick={() => duplicate(menu)}>Duplicar</button>
            <button className="danger" onClick={() => remove(menu)}>Eliminar</button>
            <button onClick={() => setMenu(null)}>Cancelar</button>
          </div>
        </div>
      )}
    </div>
  );
}
