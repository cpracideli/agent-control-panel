// Navigable memory graph built from the local memory files (people, projects, facts, references).
import { useEffect, useMemo, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Minus, Plus, Maximize } from 'lucide-react';
import { api } from '../api.js';
import { ErrorBox, IconButton, useLoad } from '../ui.jsx';

const GROUPS = { person: { label: 'Pessoas', color: '#ff9f0a' }, project: { label: 'Projetos', color: '#0a84ff' }, fact: { label: 'Fatos', color: '#30d158' }, ref: { label: 'Referências', color: '#bf5af2' } };
const groupOf = (x) => (x.area === 'people' || /^contato-/.test(x.file) || x.type === 'user' ? 'person' : x.type === 'project' ? 'project' : x.type === 'reference' ? 'ref' : 'fact');
const W = 900, H = 640;

function layout(items) {
  const nodes = items.map((x, i) => ({ id: x.file, x: W / 2 + Math.cos(i * 2.4) * (80 + (i % 9) * 30), y: H / 2 + Math.sin(i * 2.4) * (80 + (i % 9) * 30), vx: 0, vy: 0, item: x, g: groupOf(x) }));
  const byName = new Map(items.map((x) => [x.name, x.file]));
  const idx = new Map(nodes.map((n, i) => [n.id, i]));
  const edges = new Set();
  for (const x of items) {
    for (const m of String(x.body || '').matchAll(/\[\[([^\]]+)\]\]/g)) { const t = byName.get(m[1].trim()); if (t && t !== x.file) edges.add([x.file, t].sort().join('|')); }
  }
  const E = [...edges].map((e) => e.split('|')).filter(([a, b]) => idx.has(a) && idx.has(b)).map(([a, b]) => [idx.get(a), idx.get(b)]);
  const deg = nodes.map(() => 0); E.forEach(([a, b]) => { deg[a]++; deg[b]++; }); nodes.forEach((n, i) => { n.deg = deg[i]; });
  // group anchors so same-kind nodes cluster
  const anchors = { person: [W * 0.25, H * 0.3], project: [W * 0.75, H * 0.3], fact: [W * 0.3, H * 0.75], ref: [W * 0.75, H * 0.75] };
  for (let it = 0; it < 300; it++) {
    const k = 1 - it / 300;
    for (let i = 0; i < nodes.length; i++) for (let j = i + 1; j < nodes.length; j++) {
      const a = nodes[i], b = nodes[j]; let dx = a.x - b.x, dy = a.y - b.y; const d2 = dx * dx + dy * dy + 0.1, d = Math.sqrt(d2);
      const f = Math.min(2600 / d2, 4); dx = (dx / d) * f; dy = (dy / d) * f; a.vx += dx; a.vy += dy; b.vx -= dx; b.vy -= dy;
    }
    for (const [i, j] of E) { const a = nodes[i], b = nodes[j]; const dx = b.x - a.x, dy = b.y - a.y, d = Math.sqrt(dx * dx + dy * dy) + 0.1; const f = (d - 90) * 0.02; a.vx += (dx / d) * f; a.vy += (dy / d) * f; b.vx -= (dx / d) * f; b.vy -= (dy / d) * f; }
    for (const n of nodes) { const [ax, ay] = anchors[n.g]; n.vx += (ax - n.x) * 0.006; n.vy += (ay - n.y) * 0.006; n.x += n.vx * 0.5 * k; n.y += n.vy * 0.5 * k; n.vx *= 0.8; n.vy *= 0.8; n.x = Math.max(30, Math.min(W - 30, n.x)); n.y = Math.max(30, Math.min(H - 30, n.y)); }
  }
  return { nodes, E };
}

export default function MemoryGraph() {
  const data = useLoad(() => api('GET', '/bridge/memory/local'), [], { cacheKey: 'mem:local' });
  const items = data.data?.items || [];
  const { nodes, E } = useMemo(() => layout(items), [items]);
  const [sel, setSel] = useState(null);
  const [off, setOff] = useState({ x: 0, y: 0, k: 1 });
  const [hide, setHide] = useState({});
  const drag = useRef(null);
  useEffect(() => { setSel(null); }, [items.length]);
  const node = nodes.find((n) => n.id === sel);
  const neigh = useMemo(() => { const s = new Set(); if (sel) E.forEach(([a, b]) => { if (nodes[a].id === sel) s.add(nodes[b].id); if (nodes[b].id === sel) s.add(nodes[a].id); }); return s; }, [E, nodes, sel]);
  const zoom = (m) => setOff((o) => ({ ...o, k: Math.max(0.5, Math.min(3, o.k * m)) }));

  return (
    <div className="mg">
      <ErrorBox error={data.error} onRetry={() => data.reload()} />
      <div className="mg-legend">
        {Object.entries(GROUPS).map(([k, g]) => <button key={k} className={'chip' + (hide[k] ? ' off' : '')} style={{ '--c': g.color }} onClick={() => setHide({ ...hide, [k]: !hide[k] })}><i />{g.label} ({nodes.filter((n) => n.g === k).length})</button>)}
        <span className="grow" />
        <IconButton icon={Minus} label="Reduzir" onClick={() => zoom(0.8)} /><IconButton icon={Plus} label="Ampliar" onClick={() => zoom(1.25)} /><IconButton icon={Maximize} label="Centralizar" onClick={() => setOff({ x: 0, y: 0, k: 1 })} />
      </div>
      <div className="mg-wrap">
        <svg className="mg-svg" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Grafo de memória"
          onPointerDown={(e) => { drag.current = { x: e.clientX, y: e.clientY, ox: off.x, oy: off.y }; }}
          onPointerMove={(e) => { const d = drag.current; if (d) setOff((o) => ({ ...o, x: d.ox + (e.clientX - d.x) * (W / e.currentTarget.clientWidth), y: d.oy + (e.clientY - d.y) * (W / e.currentTarget.clientWidth) })); }}
          onPointerUp={() => { drag.current = null; }} onPointerLeave={() => { drag.current = null; }}
          onWheel={(e) => zoom(e.deltaY < 0 ? 1.1 : 0.9)}>
          <g transform={`translate(${off.x} ${off.y}) translate(${W / 2} ${H / 2}) scale(${off.k}) translate(${-W / 2} ${-H / 2})`}>
            {E.map(([a, b], i) => { const A = nodes[a], B = nodes[b]; if (hide[A.g] || hide[B.g]) return null; const hot = sel && (A.id === sel || B.id === sel); return <line key={i} x1={A.x} y1={A.y} x2={B.x} y2={B.y} className={'mg-edge' + (hot ? ' hot' : '')} />; })}
            {nodes.map((n) => hide[n.g] ? null : (
              <g key={n.id} className={'mg-node' + (n.id === sel ? ' sel' : neigh.has(n.id) ? ' nb' : sel ? ' dim' : '')} transform={`translate(${n.x} ${n.y})`} tabIndex={0} role="button" aria-label={n.item.name}
                onClick={(e) => { e.stopPropagation(); setSel(n.id); }} onKeyDown={(e) => { if (e.key === 'Enter') setSel(n.id); }} onPointerDown={(e) => e.stopPropagation()}>
                <circle r={7 + Math.min(10, n.deg * 2)} fill={GROUPS[n.g].color} />
                <text y={-12 - Math.min(10, n.deg * 2)} textAnchor="middle">{n.item.name.length > 22 ? n.item.name.slice(0, 21) + '…' : n.item.name}</text>
              </g>
            ))}
          </g>
        </svg>
        {!items.length && !data.error && <p className="muted small" style={{ padding: 16 }}>Carregando memórias…</p>}
      </div>
      {node && (
        <div className="mg-detail">
          <div className="row between"><b>{node.item.name}</b><span className="chip" style={{ '--c': GROUPS[node.g].color }}><i />{GROUPS[node.g].label}</span></div>
          <div className="muted small">{node.item.description}</div>
          {neigh.size > 0 && <div className="row wrap" style={{ gap: 6 }}>{[...neigh].map((id) => <button key={id} className="chip" onClick={() => setSel(id)}>{nodes.find((n) => n.id === id)?.item.name}</button>)}</div>}
          <div className="md"><ReactMarkdown remarkPlugins={[remarkGfm]}>{node.item.body || ''}</ReactMarkdown></div>
        </div>
      )}
      <p className="muted small">{nodes.length} memórias · {E.length} ligações. Toque num nó para ver o conteúdo; arraste para mover e role para ampliar.</p>
    </div>
  );
}
