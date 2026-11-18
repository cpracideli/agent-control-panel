import { useState } from 'react';
import { bridge } from '../api.js';
import { Badge, Card, ErrorBox, Field, Modal, confirmAsk, useAction, useLoad } from '../ui.jsx';

const PRESETS = [
  { name: 'playwright', label: 'Playwright (navegador)', transport: 'stdio', command: 'npx', args: '@playwright/mcp@latest --browser chromium --headless --no-sandbox' },
  { name: 'context7', label: 'Context7 (docs de libs)', transport: 'http', url: 'https://mcp.context7.com/mcp' },
  { name: 'fetch', label: 'Fetch (páginas web)', transport: 'stdio', command: 'uvx', args: 'mcp-server-fetch' },
  { name: 'filesystem', label: 'Filesystem (workspace)', transport: 'stdio', command: 'npx', args: '-y @modelcontextprotocol/server-filesystem /home/node/workspace' },
  { name: 'github', label: 'GitHub (remoto)', transport: 'http', url: 'https://api.githubcopilot.com/mcp/', headers: 'Authorization=Bearer SEU_TOKEN' },
];

// "a b 'c d'" -> ["a", "b", "c d"]
const splitArgs = (s) => (String(s).match(/"[^"]*"|'[^']*'|\S+/g) || []).map((x) => x.replace(/^["']|["']$/g, ''));
const parseKV = (s) => Object.fromEntries(String(s).split('\n').map((l) => l.trim()).filter(Boolean).map((l) => { const i = l.indexOf('='); return i < 0 ? [l, ''] : [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }));

const describe = (cfg) => (cfg.url ? cfg.url : [cfg.command, ...(cfg.args || [])].join(' '));
const transportOf = (cfg) => cfg.type || (cfg.url ? 'http' : 'stdio');

function AddMcp({ provider, initial, onClose, onDone }) {
  const [f, setF] = useState({ provider, scope: 'user', name: '', transport: 'stdio', command: '', args: '', url: '', env: '', headers: '', ...initial });
  const [busy, run] = useAction();
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const submit = async (e) => {
    e.preventDefault();
    const body = { provider: f.provider, scope: f.scope, name: f.name.trim(), transport: f.transport };
    if (f.transport === 'stdio') Object.assign(body, { command: f.command.trim(), args: splitArgs(f.args), env: parseKV(f.env) });
    else Object.assign(body, { url: f.url.trim(), headers: parseKV(f.headers) });
    const r = await run('add', () => bridge.addMcp(body), `MCP "${body.name}" adicionado. Vale a partir da próxima mensagem.`);
    if (r) { onDone(); onClose(); }
  };
  const agy = f.provider === 'antigravity';
  return (
    <Modal title="Adicionar servidor MCP" onClose={onClose} wide>
      <div className="presets">
        {PRESETS.map((p) => (
          <button key={p.name} type="button" className="ghost small" onClick={() => setF({ ...f, ...p, env: '', headers: p.headers || '' })}>{p.label}</button>
        ))}
      </div>
      <form className="stack" onSubmit={submit}>
        <div className="form-grid">
          <Field label="Provider">
            <select value={f.provider} onChange={set('provider')}><option value="claude">Claude Code</option><option value="antigravity">Antigravity</option></select>
          </Field>
          <Field label="Nome"><input required value={f.name} onChange={set('name')} placeholder="ex. playwright" pattern="[A-Za-z0-9_.\-]+" /></Field>
          <Field label="Transporte">
            <select value={f.transport} onChange={set('transport')}><option value="stdio">stdio (comando local)</option><option value="http">HTTP</option>{!agy && <option value="sse">SSE</option>}</select>
          </Field>
          {!agy && (
            <Field label="Escopo" hint="user = todas as conversas">
              <select value={f.scope} onChange={set('scope')}><option value="user">user</option><option value="local">local (workspace)</option></select>
            </Field>
          )}
        </div>
        {f.transport === 'stdio' ? (
          <>
            <div className="form-grid">
              <Field label="Comando"><input required value={f.command} onChange={set('command')} placeholder="npx" /></Field>
              <Field label="Argumentos"><input value={f.args} onChange={set('args')} placeholder="-y @pacote/mcp --flag" /></Field>
            </div>
            {!agy && <Field label="Variáveis de ambiente" hint="Uma por linha: CHAVE=valor"><textarea rows={3} className="mono" value={f.env} onChange={set('env')} /></Field>}
          </>
        ) : (
          <>
            <Field label="URL"><input required type="url" value={f.url} onChange={set('url')} placeholder="https://…/mcp" /></Field>
            {!agy && <Field label="Headers" hint="Um por linha: Nome=valor (ex. Authorization=Bearer …)"><textarea rows={2} className="mono" value={f.headers} onChange={set('headers')} /></Field>}
          </>
        )}
        {agy && <p className="muted small">No Antigravity o painel roda <code>agy mcp add -- nome comando…</code>. Se precisar de opções extras, peça ao agente pelo chat.</p>}
        <div className="row end"><button type="button" className="ghost" onClick={onClose}>Cancelar</button><button disabled={busy === 'add'}>{busy === 'add' ? 'Adicionando…' : 'Adicionar'}</button></div>
      </form>
    </Modal>
  );
}

export default function Mcp() {
  const mcp = useLoad(() => bridge.mcp(), []);
  const [status, setStatus] = useState(null);
  const [adding, setAdding] = useState(null);
  const [view, setView] = useState(null);
  const [busy, run] = useAction();

  const check = async () => {
    setStatus({ loading: true });
    const r = await run('status', () => bridge.mcpStatus());
    setStatus(r ? { output: r.output } : null);
  };
  const remove = (provider, name, scope) => confirmAsk(`Remover o MCP "${name}"?`) &&
    run('rm-' + name, () => bridge.removeMcp(provider, name, scope), 'Removido').then(() => mcp.reload(true));

  // "name: … - ✓ Connected" lines from `claude mcp list`
  const health = {};
  for (const line of String(status?.output || '').split('\n')) {
    const m = line.match(/^([^:]+):.*-\s*(.+)$/);
    if (m) health[m[1].trim()] = m[2].trim();
  }

  const c = mcp.data?.claude;
  const rows = c ? [...Object.entries(c.user).map(([n, cfg]) => ({ n, cfg, scope: 'user' })), ...Object.entries(c.local).map(([n, cfg]) => ({ n, cfg, scope: 'local' })), ...Object.entries(c.project).map(([n, cfg]) => ({ n, cfg, scope: 'project' }))] : [];
  const agy = mcp.data?.antigravity;

  return (
    <div className="page">
      <ErrorBox error={mcp.error} onRetry={() => mcp.reload()} />
      <Card title="Claude Code" actions={<>
        <button className="ghost small" disabled={busy === 'status'} onClick={check}>{busy === 'status' ? 'Testando…' : 'Testar conexões'}</button>
        <button className="small" onClick={() => setAdding('claude')}>+ Adicionar</button>
      </>}>
        {mcp.loading && !c && <p className="muted">Carregando…</p>}
        {c && !rows.length && <p className="muted">Nenhum servidor MCP configurado.</p>}
        {rows.map(({ n, cfg, scope }) => {
          const h = health[n];
          return (
            <div key={scope + n} className="list-row">
              <div className="grow">
                <b>{n}</b> <Badge>{transportOf(cfg)}</Badge> <Badge kind="muted">{scope}</Badge>
                {h && <> <Badge kind={/connected|✓/i.test(h) ? 'ok' : 'err'}>{h}</Badge></>}
                <div className="muted small mono ellipsis">{describe(cfg)}</div>
              </div>
              <div className="row">
                <button className="ghost small" onClick={() => setView({ n, cfg })}>Ver</button>
                {scope !== 'project' && <button className="ghost small danger-text" disabled={busy === 'rm-' + n} onClick={() => remove('claude', n, scope)}>Remover</button>}
              </div>
            </div>
          );
        })}
        {status?.output && <details className="tools" open><summary>Saída de claude mcp list</summary><pre>{status.output}</pre></details>}
      </Card>

      <Card title="Antigravity" actions={agy?.installed && <button className="small" onClick={() => setAdding('antigravity')}>+ Adicionar</button>}>
        {agy && !agy.installed && <p className="muted">agy não está instalado no container.</p>}
        {agy?.installed && (
          <>
            <pre>{agy.list || '(agy mcp list não retornou nada)'}</pre>
            {agy.config && <details className="tools"><summary>Config: {agy.configPath}</summary><pre>{JSON.stringify(agy.config, null, 2)}</pre></details>}
            <RemoveAgy onRemove={(n) => remove('antigravity', n)} />
          </>
        )}
      </Card>

      <p className="muted small">MCPs novos valem a partir da próxima mensagem (cada mensagem abre um processo novo do agente). Você também pode pedir no chat: "instale o MCP do …".</p>

      {adding && <AddMcp provider={adding} onClose={() => setAdding(null)} onDone={() => mcp.reload(true)} />}
      {view && <Modal title={view.n} onClose={() => setView(null)}><pre>{JSON.stringify(view.cfg, null, 2)}</pre></Modal>}
    </div>
  );
}

function RemoveAgy({ onRemove }) {
  const [n, setN] = useState('');
  return (
    <form className="row" onSubmit={(e) => { e.preventDefault(); if (n.trim()) onRemove(n.trim()); }}>
      <input value={n} onChange={(e) => setN(e.target.value)} placeholder="nome do MCP para remover" />
      <button className="ghost danger-text" disabled={!n.trim()}>Remover</button>
    </form>
  );
}
