import { useState } from 'react';
import { coolify } from '../api.js';
import { Card, ErrorBox, confirmAsk, useAction, useLoad } from '../ui.jsx';

const SECRET = /TOKEN|KEY|SECRET|PASSWORD|PASS/i;

function EnvRow({ e, onSaved }) {
  const [val, setVal] = useState(e.value || '');
  const [show, setShow] = useState(!SECRET.test(e.key));
  const [busy, run] = useAction();
  const dirty = val !== (e.value || '');
  return (
    <div className="env-row">
      <div className="mono env-key" title={e.key}>{e.key}</div>
      <input className="mono" type={show ? 'text' : 'password'} value={val} onChange={(x) => setVal(x.target.value)} />
      <div className="row">
        <button className="ghost small" onClick={() => setShow(!show)}>{show ? 'Ocultar' : 'Ver'}</button>
        <button className="small" disabled={!dirty || !!busy} onClick={() => run('s', () => coolify.setEnv(e.key, val), e.key + ' salvo').then((r) => r !== undefined && onSaved())}>Salvar</button>
        <button className="ghost small danger-text" disabled={!!busy} onClick={() => confirmAsk('Remover ' + e.key + '?') && run('d', () => coolify.deleteEnv(e.uuid), 'Removido').then(onSaved)}>✕</button>
      </div>
    </div>
  );
}

export default function Envs() {
  const envs = useLoad(() => coolify.envs(), []);
  const [filter, setFilter] = useState('');
  const [k, setK] = useState('');
  const [v, setV] = useState('');
  const [busy, run] = useAction();
  const list = (envs.data || []).filter((e) => e.key.toLowerCase().includes(filter.toLowerCase())).sort((a, b) => a.key.localeCompare(b.key));
  return (
    <div className="page">
      <Card title="Variáveis do agente" actions={<>
        <input className="filter" placeholder="Filtrar…" value={filter} onChange={(e) => setFilter(e.target.value)} />
        <button className="warn small" disabled={!!busy} onClick={() => confirmAsk('Reiniciar o agente para aplicar as variáveis?') && run('r', coolify.restart, 'Reinício solicitado')}>Aplicar (reiniciar)</button>
      </>}>
        <ErrorBox error={envs.error} onRetry={() => envs.reload()} />
        {envs.loading && !envs.data && <p className="muted">Carregando…</p>}
        {list.map((e) => <EnvRow key={e.uuid + (e.value || '')} e={e} onSaved={() => envs.reload(true)} />)}
      </Card>
      <Card title="Nova variável">
        <form className="env-row" onSubmit={(e) => { e.preventDefault(); run('add', () => coolify.addEnv(k.trim(), v), k + ' adicionada').then((r) => { if (r !== undefined) { setK(''); setV(''); envs.reload(true); } }); }}>
          <input className="mono" placeholder="NOME_DA_VARIAVEL" value={k} onChange={(e) => setK(e.target.value.toUpperCase())} />
          <input className="mono" placeholder="valor" value={v} onChange={(e) => setV(e.target.value)} />
          <button disabled={!k.trim() || busy === 'add'}>Adicionar</button>
        </form>
      </Card>
    </div>
  );
}
