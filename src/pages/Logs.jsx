import { useEffect, useRef, useState } from 'react';
import { bridge, coolify } from '../api.js';
import { Card, ErrorBox, fmtDate, useLoad } from '../ui.jsx';

function ContainerLogs() {
  const [lines, setLines] = useState(300);
  const [auto, setAuto] = useState(true);
  const [filter, setFilter] = useState('');
  const logs = useLoad(() => coolify.logs(lines), [lines], { interval: auto ? 5000 : 0 });
  const ref = useRef(null);
  const text = String(logs.data?.logs ?? (typeof logs.data === 'string' ? logs.data : '') ?? '');
  const shown = filter ? text.split('\n').filter((l) => l.toLowerCase().includes(filter.toLowerCase())).join('\n') : text;
  useEffect(() => { if (auto && ref.current) ref.current.scrollTop = ref.current.scrollHeight; }, [shown, auto]);
  return (
    <Card title="Container" actions={<>
      <input className="filter" placeholder="Filtrar…" value={filter} onChange={(e) => setFilter(e.target.value)} />
      <select value={lines} onChange={(e) => setLines(Number(e.target.value))}>{[100, 300, 1000, 2000].map((n) => <option key={n} value={n}>{n} linhas</option>)}</select>
      <label className="check"><input type="checkbox" checked={auto} onChange={(e) => setAuto(e.target.checked)} /> ao vivo</label>
    </>}>
      <ErrorBox error={logs.error} onRetry={() => logs.reload()} />
      <pre ref={ref} className="logs">{shown || (logs.loading ? 'Carregando…' : '(vazio)')}</pre>
    </Card>
  );
}

const ACTION = { send: 'Mensagem enviada', 'send-file': 'Arquivo enviado', 'schedule-add': 'Agendamento criado', 'schedule-delete': 'Agendamento removido', 'mcp-add': 'MCP adicionado', 'mcp-remove': 'MCP removido' };

function Audit() {
  const a = useLoad(() => bridge.audit(300), [], { interval: 30000 });
  return (
    <Card title="Auditoria (envios, agendamentos, MCP)">
      <ErrorBox error={a.error} />
      {a.data && !a.data.length && <p className="muted">Nada registrado.</p>}
      <div className="audit">
        {(a.data || []).map((e, i) => (
          <div key={i} className="list-row">
            <div className="grow">
              <b>{ACTION[e.action] || e.action || 'evento'}</b>{e.ok === false && <span className="danger-text"> (falhou)</span>}
              <div className="muted small">{[e.to && 'para ' + e.to.split('@')[0], e.name, e.description, e.preview && '"' + e.preview + '"', e.file, e.id && '#' + e.id].filter(Boolean).join(' · ')}</div>
            </div>
            <small className="muted">{fmtDate(e.at)}</small>
          </div>
        ))}
      </div>
    </Card>
  );
}

export default function Logs() {
  const [tab, setTab] = useState('container');
  return (
    <div className="page">
      <div className="tabs">
        <button className={tab === 'container' ? 'active' : ''} onClick={() => setTab('container')}>Container</button>
        <button className={tab === 'audit' ? 'active' : ''} onClick={() => setTab('audit')}>Auditoria</button>
      </div>
      {tab === 'container' ? <ContainerLogs /> : <Audit />}
    </div>
  );
}
