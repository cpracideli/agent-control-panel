import { useState } from 'react';
import { Activity, ExternalLink, Eye, KeyRound, Link2, Plug, Plus, Search, Server, Trash2 } from 'lucide-react';
import { bridge } from '../api.js';
import { useT } from '../i18n.jsx';
import { Badge, Btn, Card, ErrorBox, Field, IconButton, Modal, Skeleton, useAction, useConfirm, useLoad, useToast } from '../ui.jsx';
import { AddButton, Disclosure, HeaderActions, ListGroup, ListRow, useIsMobile } from '../native.jsx';

function ConnectorsCard() {
  const toast = useToast();
  const conn = useLoad(() => bridge.connectors(), []);
  const [apiKey, setApiKey] = useState('');
  const [entityId, setEntityId] = useState('default');
  const [q, setQ] = useState('');
  const [apps, setApps] = useState(null);
  const [busy, run] = useAction();

  const setup = async (e) => {
    e.preventDefault();
    const r = await run('setup', () => bridge.composioSetup({ apiKey: apiKey.trim(), entityId: entityId.trim() || 'default' }), 'Composio salvo no cofre criptografado');
    if (r) { setApiKey(''); conn.reload(true); }
  };
  const loadApps = async () => {
    const r = await run('apps', () => bridge.composioApps(q.trim()));
    if (r) setApps(r);
  };
  const connectApp = async (slug) => {
    const r = await run('c-' + slug, () => bridge.composioConnect({ toolkit: slug }));
    const url = r?.redirect_url || r?.redirectUrl || r?.connectionStatus?.redirectUrl;
    if (url) { window.open(url, '_blank', 'noopener'); toast('Finalize a autorização OAuth na aba aberta'); }
    else if (r) toast('Conexão iniciada');
  };

  const c = conn.data?.composio;
  const oauths = conn.data?.oauthConnections || [];
  return (
    <Card title="Apps & Conectores OAuth (Composio 225+ apps)" icon={Link2} actions={
      <Badge kind={c?.configured ? 'ok' : 'muted'}>{c?.configured ? 'Composio ativo' : 'Não configurado'}</Badge>
    }>
      <p className="muted small" style={{ marginTop: 0 }}>
        Conecte 225+ apps via OAuth em 1 clique usando Composio (Gmail, Calendar, Notion, Slack, GitHub, Linear, Drive…). A chave fica protegida no Cofre AES-256-GCM.
      </p>
      <form className="form-grid" onSubmit={setup} style={{ marginBottom: 10 }}>
        <Field label="Composio API Key"><input type="password" value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder={c?.configured ? '•••• salva no cofre (vazio mantém)' : 'ak_...'} /></Field>
        <Field label="Entity / User ID"><input value={entityId} onChange={(e) => setEntityId(e.target.value)} placeholder="default" /></Field>
        <div className="row" style={{ alignItems: 'flex-end' }}>
          <Btn icon={KeyRound} className="small" disabled={busy === 'setup' || (!apiKey.trim() && !c?.configured)}>Salvar Composio</Btn>
        </div>
      </form>
      {c?.configured && (
        <div className="stack" style={{ marginTop: 8 }}>
          <div className="row wrap">
            <label className="search grow"><Search size={14} /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar app no Composio (ex.: gmail, notion, slack, linear)..." /></label>
            <Btn icon={Search} className="ghost small" disabled={busy === 'apps'} onClick={loadApps}>Listar apps</Btn>
          </div>
          {apps && (
            <div className="bot-grid">
              {(apps.toolkits || []).slice(0, 12).map((tk) => {
                const slug = tk.slug || tk.key || tk.name;
                return (
                  <div key={slug} className="bot-card">
                    <b>{tk.name || slug}</b>
                    <div className="muted small ellipsis-2">{tk.meta?.description || tk.description || slug}</div>
                    <Btn icon={ExternalLink} className="ghost small block" disabled={busy === 'c-' + slug} onClick={() => connectApp(slug)}>Conectar OAuth</Btn>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
      {oauths.length > 0 && (
        <div className="stack" style={{ marginTop: 10 }}>
          <b className="small muted">Conexões OAuth no Cofre ({oauths.length})</b>
          {oauths.map((s) => (
            <div key={s.name} className="list-row">
              <div className="grow"><b>{s.label}</b><div className="muted small">{s.note}</div></div>
              <Badge kind="ok">AES-GCM</Badge>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

const PRESETS = [
  { name: 'playwright', transport: 'stdio', command: 'npx', args: '@playwright/mcp@latest --browser chromium --headless --no-sandbox' },
  { name: 'context7', transport: 'http', url: 'https://mcp.context7.com/mcp' },
  { name: 'fetch', transport: 'stdio', command: 'uvx', args: 'mcp-server-fetch' },
  { name: 'filesystem', transport: 'stdio', command: 'npx', args: '-y @modelcontextprotocol/server-filesystem /home/node/workspace' },
  { name: 'github', transport: 'http', url: 'https://api.githubcopilot.com/mcp/', headers: 'Authorization=Bearer YOUR_TOKEN' },
];

// "a b 'c d'" -> ["a", "b", "c d"]
const splitArgs = (s) => (String(s).match(/"[^"]*"|'[^']*'|\S+/g) || []).map((x) => x.replace(/^["']|["']$/g, ''));
const parseKV = (s) => Object.fromEntries(String(s).split('\n').map((l) => l.trim()).filter(Boolean).map((l) => { const i = l.indexOf('='); return i < 0 ? [l, ''] : [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }));
const describe = (cfg) => {
  if (!cfg) return '';
  if (Array.isArray(cfg.command)) return cfg.command.join(' ');
  if (cfg.command) return [cfg.command, ...(cfg.args || [])].join(' ');
  return cfg.serverUrl || cfg.url || '';
};
const transportOf = (cfg) => {
  if (!cfg) return 'stdio';
  if (cfg.type === 'local') return 'stdio';
  if (cfg.type === 'remote') return 'http';
  if (cfg.type) return cfg.type;
  return (cfg.serverUrl || cfg.url) ? 'http' : 'stdio';
};
const isDisabled = (cfg) => Boolean(cfg && (cfg.disabled === true || cfg.enabled === false));
const SUPPORTS_SSE = new Set(['claude', 'copilot']);

function AddMcp({ provider, providersMeta, onClose, onDone }) {
  const t = useT();
  const [f, setF] = useState({ provider, scope: 'user', name: '', transport: 'stdio', command: '', args: '', url: '', env: '', headers: '' });
  const [busy, run] = useAction();
  const set = (k) => (e) => {
    const val = e.target.value;
    if (k === 'provider') {
      setF((cur) => ({ ...cur, provider: val, transport: !SUPPORTS_SSE.has(val) && cur.transport === 'sse' ? 'http' : cur.transport }));
    } else {
      setF((cur) => ({ ...cur, [k]: val }));
    }
  };
  const isClaude = f.provider === 'claude';
  const canSse = SUPPORTS_SSE.has(f.provider);
  const submit = async (e) => {
    e.preventDefault();
    const body = { provider: f.provider, name: f.name.trim(), transport: f.transport };
    if (isClaude) body.scope = f.scope;
    if (f.transport === 'stdio') Object.assign(body, { command: f.command.trim(), args: splitArgs(f.args), env: parseKV(f.env) });
    else Object.assign(body, { url: f.url.trim(), headers: parseKV(f.headers) });
    const r = await run('add', () => bridge.addMcp(body), t('mcp.added', { n: body.name }));
    if (r) { onDone(); onClose(); }
  };
  const providerNote = f.provider === 'antigravity' ? t('mcp.agyNote')
    : f.provider === 'copilot' ? t('mcp.copilotNote')
      : f.provider === 'opencode' ? t('mcp.opencodeNote') : '';
  return (
    <Modal title={t('mcp.addTitle')} onClose={onClose} wide>
      <div className="presets">
        {PRESETS.map((p) => <button key={p.name} type="button" className="ghost small" onClick={() => setF({ ...f, ...p, env: '', headers: p.headers || '' })}>{t('mcp.p.' + p.name)}</button>)}
      </div>
      <form className="stack" onSubmit={submit}>
        <div className="form-grid">
          <Field label={t('mcp.provider')}>
            <select value={f.provider} onChange={set('provider')}>
              <option value="claude">Claude Code</option>
              <option value="antigravity" disabled={providersMeta?.antigravity?.installed === false}>Antigravity</option>
              {providersMeta?.copilot !== undefined && (
                <option value="copilot" disabled={providersMeta.copilot?.installed === false}>GitHub Copilot</option>
              )}
              {providersMeta?.opencode !== undefined && (
                <option value="opencode" disabled={providersMeta.opencode?.installed === false}>OpenCode</option>
              )}
            </select>
          </Field>
          <Field label={t('mcp.name')}><input required value={f.name} onChange={set('name')} placeholder="playwright" pattern="[A-Za-z0-9_.\-]+" /></Field>
          <Field label={t('mcp.transport')}>
            <select value={f.transport} onChange={set('transport')}>
              <option value="stdio">{t('mcp.stdio')}</option>
              <option value="http">HTTP</option>
              {canSse && <option value="sse">SSE</option>}
            </select>
          </Field>
          {isClaude && (
            <Field label={t('mcp.scope')} hint={t('mcp.scopeHint')}>
              <select value={f.scope} onChange={set('scope')}><option value="user">user</option><option value="local">{t('mcp.local')}</option></select>
            </Field>
          )}
        </div>
        {f.transport === 'stdio' ? (
          <>
            <div className="form-grid">
              <Field label={t('mcp.command')}><input required className="mono" value={f.command} onChange={set('command')} placeholder="npx" /></Field>
              <Field label={t('mcp.args')}><input className="mono" value={f.args} onChange={set('args')} placeholder="-y @scope/mcp --flag" /></Field>
            </div>
            <Field label={t('mcp.env')} hint={t('mcp.envHint')}><textarea rows={3} className="mono" value={f.env} onChange={set('env')} /></Field>
          </>
        ) : (
          <>
            <Field label="URL"><input required type="url" className="mono" value={f.url} onChange={set('url')} placeholder="https://…/mcp" /></Field>
            <Field label={t('mcp.headers')} hint={t('mcp.headersHint')}><textarea rows={2} className="mono" value={f.headers} onChange={set('headers')} /></Field>
          </>
        )}
        {providerNote && <p className="muted small">{providerNote}</p>}
        <div className="row end">
          <button type="button" className="ghost" onClick={onClose}>{t('common.cancel')}</button>
          <Btn icon={Plus} disabled={busy === 'add'}>{busy === 'add' ? t('mcp.adding') : t('common.add')}</Btn>
        </div>
      </form>
    </Modal>
  );
}

export default function Mcp() {
  const t = useT();
  const confirm = useConfirm();
  const mcp = useLoad(() => bridge.mcp(), [], { cacheKey: '/bridge/mcp' });
  const [status, setStatus] = useState(null);
  const [provStatus, setProvStatus] = useState({});
  const [adding, setAdding] = useState(null);
  const [view, setView] = useState(null);
  const [busy, run] = useAction();
  const mobile = useIsMobile();

  const check = async () => { const r = await run('status', () => bridge.mcpStatus()); setStatus(r ? { output: r.output } : null); };
  const checkProvider = async (prov) => {
    const r = await run(prov + '-status', () => bridge.mcpStatus(prov));
    setProvStatus((cur) => ({ ...cur, [prov]: r || null }));
  };
  const remove = async (provider, name, scope) => (await confirm(t('mcp.removeConfirm', { n: name }))) &&
    run('rm-' + provider + '-' + name, () => bridge.removeMcp(provider, name, scope), t('common.removed')).then(() => mcp.reload(true));

  // "name: … - ✓ Connected" lines from `claude mcp list`
  const health = {};
  for (const line of String(status?.output || '').split('\n')) {
    const m = line.match(/^([^:]+):.*-\s*(.+)$/);
    if (m) health[m[1].trim()] = m[2].replace(/[✓✗]\s*/g, '').trim();
  }
  const c = mcp.data?.claude;
  const rows = c ? ['user', 'local', 'project'].flatMap((scope) => Object.entries(c[scope]).map(([n, cfg]) => ({ n, cfg, scope }))) : [];
  const provHealth = (prov, n) => {
    const r = provStatus[prov]?.servers?.[n];
    return r && (r.disabled ? 'Disabled' : r.ok ? 'Connected' : String(r.status || '').replace(/^✗\s*/, ''));
  };

  const extraProviders = [
    { id: 'antigravity', title: 'Antigravity', data: mcp.data?.antigravity, missingKey: 'mcp.agyMissing', emptyText: (d) => d?.list || t('mcp.agyEmpty'), extraScopeKey: null },
    mcp.data?.copilot !== undefined && { id: 'copilot', title: 'GitHub Copilot', data: mcp.data.copilot, missingKey: 'mcp.copilotMissing', emptyText: () => t('mcp.none'), extraScopeKey: 'workspace' },
    mcp.data?.opencode !== undefined && { id: 'opencode', title: 'OpenCode', data: mcp.data.opencode, missingKey: 'mcp.opencodeMissing', emptyText: () => t('mcp.none'), extraScopeKey: 'project' },
  ].filter(Boolean);

  const entriesFor = (p) => {
    const list = Object.entries(p.data?.servers || {}).map(([n, cfg]) => ({ n, cfg, scope: 'user', removable: true }));
    if (p.extraScopeKey && p.data?.[p.extraScopeKey]) {
      for (const [n, cfg] of Object.entries(p.data[p.extraScopeKey])) {
        if (!p.data?.servers?.[n]) list.push({ n, cfg, scope: p.extraScopeKey, removable: false });
      }
    }
    return list;
  };

  if (mobile) {
    const claudeRows = rows.map(({ n, cfg, scope }) => {
      const h = health[n];
      return (
        <ListRow key={scope + n} leading={<span className="row-ic ic-mcp"><Server size={18} /></span>} title={n}
          badges={<>{h ? <Badge kind={/connected/i.test(h) ? 'ok' : 'err'}>{h}</Badge> : <Badge kind="muted">{scope}</Badge>}</>}
          subtitle={<span className="mono">{transportOf(cfg)} · {describe(cfg)}</span>}
          onOpen={() => setView({ n, cfg })}
          swipe={scope !== 'project' ? [{ icon: Trash2, label: t('common.remove'), kind: 'danger', disabled: busy === 'rm-claude-' + n, onClick: () => remove('claude', n, scope) }] : []} />
      );
    });
    const testRow = (key, fn) => (
      <div className="group nlist-tools">
        <button type="button" className="group-row press" disabled={busy === key} onClick={fn}>
          <span className="row-ic ic-plain"><Activity size={17} /></span><span className="grow">{busy === key ? t('mcp.testing') : t('mcp.test')}</span>
        </button>
      </div>
    );
    return (
      <div className="page page-list">
        <HeaderActions>
          <AddButton label={t('common.add')} items={[
            { icon: Plug, label: 'Claude Code', onClick: () => setAdding('claude') },
            ...extraProviders.filter((p) => p.data?.installed).map((p) => ({ icon: Plug, label: p.title, onClick: () => setAdding(p.id) })),
          ]} />
        </HeaderActions>
        <ErrorBox error={mcp.error} onRetry={() => mcp.reload()} />
        {mcp.loading && !c && <Skeleton rows={3} />}
        <ListGroup title="Claude Code">{c && !rows.length ? <p className="muted nlist-empty">{t('mcp.none')}</p> : claudeRows}</ListGroup>
        {testRow('status', check)}
        {status?.output && <Disclosure className="tools" open summary={t('mcp.listOutput')}><pre>{status.output}</pre></Disclosure>}

        {extraProviders.map((p) => {
          const d = p.data;
          const pRows = entriesFor(p);
          const st = provStatus[p.id];
          return (
            <div key={p.id}>
              <ListGroup title={p.title}>
                {d && !d.installed
                  ? <p className="muted nlist-empty">{t(p.missingKey)}</p>
                  : d?.installed && !pRows.length
                    ? (p.id === 'antigravity' ? <pre className="nlist-empty">{p.emptyText(d)}</pre> : <p className="muted nlist-empty">{p.emptyText(d)}</p>)
                    : pRows.map(({ n, cfg, scope, removable }) => {
                      const h = provHealth(p.id, n);
                      return (
                        <ListRow key={p.id + scope + n} leading={<span className="row-ic ic-mcp"><Server size={18} /></span>} title={n}
                          badges={<>
                            {h ? <Badge kind={/connected/i.test(h) ? 'ok' : /disabled/i.test(h) ? 'muted' : 'err'}>{h}</Badge> : isDisabled(cfg) && <Badge kind="muted">disabled</Badge>}
                            {!removable && <Badge kind="muted">{scope}</Badge>}
                          </>}
                          subtitle={<span className="mono">{transportOf(cfg)} · {describe(cfg)}</span>}
                          onOpen={() => setView({ n, cfg })}
                          swipe={removable ? [{ icon: Trash2, label: t('common.remove'), kind: 'danger', disabled: busy === 'rm-' + p.id + '-' + n, onClick: () => remove(p.id, n) }] : []} />
                      );
                    })}
              </ListGroup>
              {d?.installed && testRow(p.id + '-status', () => checkProvider(p.id))}
              {st?.output && <Disclosure className="tools" open summary={t('mcp.statusOutput')}><pre>{st.output}</pre></Disclosure>}
              {d?.config && <Disclosure className="tools" summary={t('mcp.config', { p: d.configPath })}><pre>{JSON.stringify(d.config, null, 2)}</pre></Disclosure>}
            </div>
          );
        })}

        <ConnectorsCard />

        <p className="muted small">{t('mcp.note')}</p>
        {adding && <AddMcp provider={adding} providersMeta={mcp.data} onClose={() => setAdding(null)} onDone={() => mcp.reload(true)} />}
        {view && <Modal title={view.n} onClose={() => setView(null)}><pre>{JSON.stringify(view.cfg, null, 2)}</pre></Modal>}
      </div>
    );
  }

  return (
    <div className="page">
      <ErrorBox error={mcp.error} onRetry={() => mcp.reload()} />
      <Card title="Claude Code" icon={Plug} actions={<>
        <Btn icon={Activity} className="ghost small" disabled={busy === 'status'} onClick={check}>{busy === 'status' ? t('mcp.testing') : t('mcp.test')}</Btn>
        <Btn icon={Plus} className="small" onClick={() => setAdding('claude')}>{t('common.add')}</Btn>
      </>}>
        {mcp.loading && !c && <Skeleton rows={3} />}
        {c && !rows.length && <p className="muted">{t('mcp.none')}</p>}
        {rows.map(({ n, cfg, scope }) => {
          const h = health[n];
          return (
            <div key={scope + n} className="list-row">
              <div className="grow">
                <div className="row wrap"><b className="with-ic"><Server size={14} />{n}</b><Badge>{transportOf(cfg)}</Badge><Badge kind="muted">{scope}</Badge>
                  {h && <Badge kind={/connected/i.test(h) ? 'ok' : 'err'}>{h}</Badge>}</div>
                <div className="muted small mono ellipsis">{describe(cfg)}</div>
              </div>
              <div className="row">
                <IconButton icon={Eye} label={t('common.view')} onClick={() => setView({ n, cfg })} />
                {scope !== 'project' && <IconButton icon={Trash2} className="ghost danger-text" label={t('common.remove')} disabled={busy === 'rm-claude-' + n} onClick={() => remove('claude', n, scope)} />}
              </div>
            </div>
          );
        })}
        {status?.output && <Disclosure className="tools" open summary={t('mcp.listOutput')}><pre>{status.output}</pre></Disclosure>}
      </Card>

      {extraProviders.map((p) => {
        const d = p.data;
        const pRows = entriesFor(p);
        const st = provStatus[p.id];
        const statusKey = p.id + '-status';
        return (
          <Card key={p.id} title={p.title} icon={Plug} actions={d?.installed && <>
            <Btn icon={Activity} className="ghost small" disabled={busy === statusKey} onClick={() => checkProvider(p.id)}>{busy === statusKey ? t('mcp.testing') : t('mcp.test')}</Btn>
            <Btn icon={Plus} className="small" onClick={() => setAdding(p.id)}>{t('common.add')}</Btn>
          </>}>
            {d && !d.installed && <p className="muted">{t(p.missingKey)}</p>}
            {d?.installed && !pRows.length && (p.id === 'antigravity' ? <pre>{p.emptyText(d)}</pre> : <p className="muted">{p.emptyText(d)}</p>)}
            {pRows.map(({ n, cfg, scope, removable }) => {
              const h = provHealth(p.id, n);
              return (
                <div key={p.id + scope + n} className="list-row">
                  <div className="grow">
                    <div className="row wrap">
                      <b className="with-ic"><Server size={14} />{n}</b>
                      <Badge>{transportOf(cfg)}</Badge>
                      {!removable && <Badge kind="muted">{scope}</Badge>}
                      {isDisabled(cfg) && !h && <Badge kind="muted">disabled</Badge>}
                      {h && <Badge kind={/connected/i.test(h) ? 'ok' : /disabled/i.test(h) ? 'muted' : 'err'}>{h}</Badge>}
                    </div>
                    <div className="muted small mono ellipsis">{describe(cfg)}</div>
                  </div>
                  <div className="row">
                    <IconButton icon={Eye} label={t('common.view')} onClick={() => setView({ n, cfg })} />
                    {removable && <IconButton icon={Trash2} className="ghost danger-text" label={t('common.remove')} disabled={busy === 'rm-' + p.id + '-' + n} onClick={() => remove(p.id, n)} />}
                  </div>
                </div>
              );
            })}
            {st?.output && <Disclosure className="tools" open summary={t('mcp.statusOutput')}><pre>{st.output}</pre></Disclosure>}
            {d?.config && <Disclosure className="tools" summary={t('mcp.config', { p: d.configPath })}><pre>{JSON.stringify(d.config, null, 2)}</pre></Disclosure>}
          </Card>
        );
      })}

      <ConnectorsCard />

      <p className="muted small">{t('mcp.note')}</p>
      {adding && <AddMcp provider={adding} providersMeta={mcp.data} onClose={() => setAdding(null)} onDone={() => mcp.reload(true)} />}
      {view && <Modal title={view.n} onClose={() => setView(null)}><pre>{JSON.stringify(view.cfg, null, 2)}</pre></Modal>}
    </div>
  );
}
