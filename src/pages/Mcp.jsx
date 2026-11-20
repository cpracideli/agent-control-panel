import { useState } from 'react';
import { Activity, Eye, Plug, Plus, Server, Trash2 } from 'lucide-react';
import { bridge } from '../api.js';
import { useT } from '../i18n.jsx';
import { Badge, Btn, Card, ErrorBox, Field, IconButton, Modal, useAction, useConfirm, useLoad } from '../ui.jsx';
import { AddButton, Disclosure, HeaderActions, ListGroup, ListRow, useIsMobile } from '../native.jsx';

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
const describe = (cfg) => (cfg.url ? cfg.url : [cfg.command, ...(cfg.args || [])].join(' '));
const transportOf = (cfg) => cfg.type || (cfg.url ? 'http' : 'stdio');

function AddMcp({ provider, onClose, onDone }) {
  const t = useT();
  const [f, setF] = useState({ provider, scope: 'user', name: '', transport: 'stdio', command: '', args: '', url: '', env: '', headers: '' });
  const [busy, run] = useAction();
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const agy = f.provider === 'antigravity';
  const submit = async (e) => {
    e.preventDefault();
    const body = { provider: f.provider, scope: f.scope, name: f.name.trim(), transport: f.transport };
    if (f.transport === 'stdio') Object.assign(body, { command: f.command.trim(), args: splitArgs(f.args), env: parseKV(f.env) });
    else Object.assign(body, { url: f.url.trim(), headers: parseKV(f.headers) });
    const r = await run('add', () => bridge.addMcp(body), t('mcp.added', { n: body.name }));
    if (r) { onDone(); onClose(); }
  };
  return (
    <Modal title={t('mcp.addTitle')} onClose={onClose} wide>
      <div className="presets">
        {PRESETS.map((p) => <button key={p.name} type="button" className="ghost small" onClick={() => setF({ ...f, ...p, env: '', headers: p.headers || '' })}>{t('mcp.p.' + p.name)}</button>)}
      </div>
      <form className="stack" onSubmit={submit}>
        <div className="form-grid">
          <Field label={t('mcp.provider')}>
            <select value={f.provider} onChange={set('provider')}><option value="claude">Claude Code</option><option value="antigravity">Antigravity</option></select>
          </Field>
          <Field label={t('mcp.name')}><input required value={f.name} onChange={set('name')} placeholder="playwright" pattern="[A-Za-z0-9_.\-]+" /></Field>
          <Field label={t('mcp.transport')}>
            <select value={f.transport} onChange={set('transport')}><option value="stdio">{t('mcp.stdio')}</option><option value="http">HTTP</option>{!agy && <option value="sse">SSE</option>}</select>
          </Field>
          {!agy && (
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
        {agy && <p className="muted small">{t('mcp.agyNote')}</p>}
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
  const [agyStatus, setAgyStatus] = useState(null);
  const [adding, setAdding] = useState(null);
  const [view, setView] = useState(null);
  const [busy, run] = useAction();
  const mobile = useIsMobile();

  const check = async () => { const r = await run('status', () => bridge.mcpStatus()); setStatus(r ? { output: r.output } : null); };
  const checkAgy = async () => { const r = await run('agy-status', () => bridge.mcpStatus('antigravity')); setAgyStatus(r || null); };
  const remove = async (provider, name, scope) => (await confirm(t('mcp.removeConfirm', { n: name }))) &&
    run('rm-' + name, () => bridge.removeMcp(provider, name, scope), t('common.removed')).then(() => mcp.reload(true));

  // "name: … - ✓ Connected" lines from `claude mcp list`
  const health = {};
  for (const line of String(status?.output || '').split('\n')) {
    const m = line.match(/^([^:]+):.*-\s*(.+)$/);
    if (m) health[m[1].trim()] = m[2].replace(/[✓✗]\s*/g, '').trim();
  }
  const c = mcp.data?.claude;
  const rows = c ? ['user', 'local', 'project'].flatMap((scope) => Object.entries(c[scope]).map(([n, cfg]) => ({ n, cfg, scope }))) : [];
  const agy = mcp.data?.antigravity;
  const agyRows = Object.entries(agy?.servers || {});
  const agyHealth = (n) => { const r = agyStatus?.servers?.[n]; return r && (r.disabled ? 'Disabled' : r.ok ? 'Connected' : r.status.replace(/^✗\s*/, '')); };

  if (mobile) {
    const claudeRows = rows.map(({ n, cfg, scope }) => {
      const h = health[n];
      return (
        <ListRow key={scope + n} leading={<span className="row-ic ic-mcp"><Server size={18} /></span>} title={n}
          badges={<>{h ? <Badge kind={/connected/i.test(h) ? 'ok' : 'err'}>{h}</Badge> : <Badge kind="muted">{scope}</Badge>}</>}
          subtitle={<span className="mono">{transportOf(cfg)} · {describe(cfg)}</span>}
          onOpen={() => setView({ n, cfg })}
          swipe={scope !== 'project' ? [{ icon: Trash2, label: t('common.remove'), kind: 'danger', disabled: busy === 'rm-' + n, onClick: () => remove('claude', n, scope) }] : []} />
      );
    });
    const agyList = agyRows.map(([n, cfg]) => {
      const h = agyHealth(n);
      return (
        <ListRow key={'agy' + n} leading={<span className="row-ic ic-mcp"><Server size={18} /></span>} title={n}
          badges={<>{h ? <Badge kind={/connected/i.test(h) ? 'ok' : /disabled/i.test(h) ? 'muted' : 'err'}>{h}</Badge> : cfg.disabled && <Badge kind="muted">disabled</Badge>}</>}
          subtitle={<span className="mono">{cfg.command ? 'stdio · ' + [cfg.command, ...(cfg.args || [])].join(' ') : 'http · ' + (cfg.serverUrl || cfg.url)}</span>}
          onOpen={() => setView({ n, cfg })}
          swipe={[{ icon: Trash2, label: t('common.remove'), kind: 'danger', disabled: busy === 'rm-' + n, onClick: () => remove('antigravity', n) }]} />
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
            agy?.installed && { icon: Plug, label: 'Antigravity', onClick: () => setAdding('antigravity') },
          ]} />
        </HeaderActions>
        <ErrorBox error={mcp.error} onRetry={() => mcp.reload()} />
        {mcp.loading && !c && <p className="muted">{t('common.loading')}</p>}
        <ListGroup title="Claude Code">{c && !rows.length ? <p className="muted nlist-empty">{t('mcp.none')}</p> : claudeRows}</ListGroup>
        {testRow('status', check)}
        {status?.output && <Disclosure className="tools" open summary={t('mcp.listOutput')}><pre>{status.output}</pre></Disclosure>}
        <ListGroup title="Antigravity">
          {agy && !agy.installed ? <p className="muted nlist-empty">{t('mcp.agyMissing')}</p> : agy?.installed && !agyRows.length ? <pre className="nlist-empty">{agy.list || t('mcp.agyEmpty')}</pre> : agyList}
        </ListGroup>
        {agy?.installed && testRow('agy-status', checkAgy)}
        {agyStatus?.output && <Disclosure className="tools" open summary={t('mcp.listOutput')}><pre>{agyStatus.output}</pre></Disclosure>}
        {agy?.config && <Disclosure className="tools" summary={t('mcp.config', { p: agy.configPath })}><pre>{JSON.stringify(agy.config, null, 2)}</pre></Disclosure>}
        <p className="muted small">{t('mcp.note')}</p>
        {adding && <AddMcp provider={adding} onClose={() => setAdding(null)} onDone={() => mcp.reload(true)} />}
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
        {mcp.loading && !c && <p className="muted">{t('common.loading')}</p>}
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
                {scope !== 'project' && <IconButton icon={Trash2} className="ghost danger-text" label={t('common.remove')} disabled={busy === 'rm-' + n} onClick={() => remove('claude', n, scope)} />}
              </div>
            </div>
          );
        })}
        {status?.output && <Disclosure className="tools" open summary={t('mcp.listOutput')}><pre>{status.output}</pre></Disclosure>}
      </Card>

      <Card title="Antigravity" icon={Plug} actions={agy?.installed && <>
        <Btn icon={Activity} className="ghost small" disabled={busy === 'agy-status'} onClick={checkAgy}>{busy === 'agy-status' ? t('mcp.testing') : t('mcp.test')}</Btn>
        <Btn icon={Plus} className="small" onClick={() => setAdding('antigravity')}>{t('common.add')}</Btn>
      </>}>
        {agy && !agy.installed && <p className="muted">{t('mcp.agyMissing')}</p>}
        {agy?.installed && !agyRows.length && <pre>{agy.list || t('mcp.agyEmpty')}</pre>}
        {agyRows.map(([n, cfg]) => {
          const h = agyHealth(n);
          return (
            <div key={'agy' + n} className="list-row">
              <div className="grow">
                <div className="row wrap"><b className="with-ic"><Server size={14} />{n}</b><Badge>{cfg.command ? 'stdio' : 'http'}</Badge>
                  {cfg.disabled && !h && <Badge kind="muted">disabled</Badge>}
                  {h && <Badge kind={/connected/i.test(h) ? 'ok' : /disabled/i.test(h) ? 'muted' : 'err'}>{h}</Badge>}</div>
                <div className="muted small mono ellipsis">{cfg.command ? [cfg.command, ...(cfg.args || [])].join(' ') : cfg.serverUrl || cfg.url}</div>
              </div>
              <div className="row">
                <IconButton icon={Eye} label={t('common.view')} onClick={() => setView({ n, cfg })} />
                <IconButton icon={Trash2} className="ghost danger-text" label={t('common.remove')} disabled={busy === 'rm-' + n} onClick={() => remove('antigravity', n)} />
              </div>
            </div>
          );
        })}
        {agyStatus?.output && <Disclosure className="tools" open summary={t('mcp.listOutput')}><pre>{agyStatus.output}</pre></Disclosure>}
        {agy?.config && <Disclosure className="tools" summary={t('mcp.config', { p: agy.configPath })}><pre>{JSON.stringify(agy.config, null, 2)}</pre></Disclosure>}
      </Card>

      <p className="muted small">{t('mcp.note')}</p>
      {adding && <AddMcp provider={adding} onClose={() => setAdding(null)} onDone={() => mcp.reload(true)} />}
      {view && <Modal title={view.n} onClose={() => setView(null)}><pre>{JSON.stringify(view.cfg, null, 2)}</pre></Modal>}
    </div>
  );
}
