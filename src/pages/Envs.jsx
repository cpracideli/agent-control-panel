import { useState } from 'react';
import { AlertTriangle, Eye, EyeOff, KeyRound, Lock, Plus, RefreshCw, Save, Search, Shield, Trash2 } from 'lucide-react';
import { bridge, coolify } from '../api.js';
import { useT } from '../i18n.jsx';
import { Badge, Btn, Card, ErrorBox, Field, IconButton, useAction, useConfirm, useFmt, useLoad } from '../ui.jsx';

const SECRET = /TOKEN|KEY|SECRET|PASSWORD|PASS/i;

function EnvRow({ e, onSaved }) {
  const t = useT();
  const confirm = useConfirm();
  const [val, setVal] = useState(e.value || '');
  const [show, setShow] = useState(!SECRET.test(e.key));
  const [busy, run] = useAction();
  const dirty = val !== (e.value || '');
  return (
    <div className="env-row">
      <div className="mono env-key" title={e.key}>{e.key}</div>
      <input className="mono" type={show ? 'text' : 'password'} value={val} onChange={(x) => setVal(x.target.value)} aria-label={e.key} />
      <div className="row">
        <IconButton icon={show ? EyeOff : Eye} label={show ? t('common.hide') : t('common.view')} onClick={() => setShow(!show)} />
        <IconButton icon={Save} className="primary" label={t('common.save')} disabled={!dirty || !!busy} onClick={() => run('s', () => coolify.setEnv(e.key, val), t('env.savedKey', { k: e.key })).then((r) => r !== undefined && onSaved())} />
        <IconButton icon={Trash2} className="ghost danger-text" label={t('common.remove')} disabled={!!busy} onClick={async () => (await confirm(t('env.removeConfirm', { k: e.key }))) && run('d', () => coolify.deleteEnv(e.uuid), t('common.removed')).then((r) => r !== undefined && onSaved())} />
      </div>
    </div>
  );
}

function VaultTab() {
  const t = useT();
  const f = useFmt();
  const confirm = useConfirm();
  const sec = useLoad(() => bridge.secrets(), [], { cacheKey: '/bridge/secrets' });
  const bots = useLoad(() => bridge.bots(), [], { cacheKey: '/bridge/bots' });
  const [form, setForm] = useState({ name: '', label: '', value: '', scope: 'global', kind: 'api_key', note: '' });
  const [busy, run] = useAction();
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  const save = async (e) => {
    e.preventDefault();
    const r = await run('add', () => bridge.addSecret(form), t('vlt.saved'));
    if (r) { setForm({ name: '', label: '', value: '', scope: 'global', kind: 'api_key', note: '' }); sec.reload(true); }
  };

  return (
    <>
      <Card title={t('vlt.title', { n: sec.data?.length || 0 })} icon={Shield}>
        <p className="muted small" style={{ marginTop: 0 }}>{t('vlt.intro')}</p>
        <ErrorBox error={sec.error} onRetry={() => sec.reload()} />
        {sec.data && !sec.data.length && <p className="muted">{t('vlt.none')}</p>}
        {(sec.data || []).map((s) => (
          <div key={s.name} className="list-row wrap">
            <div className="grow">
              <div className="row wrap">
                <Lock size={14} className="muted" />
                <b>{s.label || s.name}</b>
                <code className="mono muted small">{s.name}</code>
                <Badge>{s.hint}</Badge>
                <Badge kind="muted">{s.kind}</Badge>
                {s.scope !== 'global' && <Badge kind="muted">{s.scope}</Badge>}
              </div>
              <div className="muted small">{s.note ? s.note + ' · ' : ''}{f.ago(s.updated)}</div>
            </div>
            <IconButton icon={Trash2} className="ghost danger-text" label={t('common.remove')} disabled={busy === 'd' + s.name}
              onClick={async () => (await confirm(t('vlt.removeConfirm', { n: s.name }))) && run('d' + s.name, () => bridge.deleteSecret(s.name), t('common.removed')).then(() => sec.reload(true))} />
          </div>
        ))}
      </Card>
      <Card title={t('vlt.new')} icon={Plus}>
        <form className="stack" onSubmit={save}>
          <div className="form-grid">
            <Field label={t('vlt.name')}><input className="mono" required value={form.name} onChange={set('name')} placeholder="openai_api_key" /></Field>
            <Field label={t('vlt.label')}><input value={form.label} onChange={set('label')} placeholder="Chave da API" /></Field>
            <Field label={t('vlt.kind')}>
              <select value={form.kind} onChange={set('kind')}>
                <option value="api_key">API Key</option>
                <option value="token">Token</option>
                <option value="login">Login / Senha</option>
                <option value="command">Variável de comando</option>
                <option value="other">Outro</option>
              </select>
            </Field>
            <Field label={t('vlt.scope')}>
              <select value={form.scope} onChange={set('scope')}>
                <option value="global">{t('sk.allBots')}</option>
                {(bots.data || []).map((b) => <option key={b.id} value={b.id}>{(b.emoji ? b.emoji + ' ' : '') + b.name}</option>)}
              </select>
            </Field>
          </div>
          <Field label={t('env.value')}><input type="password" required value={form.value} onChange={set('value')} placeholder="••••••••••••" /></Field>
          <Field label={t('vlt.note')}><input value={form.note} onChange={set('note')} placeholder={t('vlt.notePh')} /></Field>
          <div className="row end"><Btn icon={Lock} disabled={busy === 'add' || !form.name.trim() || !form.value}>{t('vlt.saveBtn')}</Btn></div>
        </form>
      </Card>
    </>
  );
}

export default function Envs() {
  const t = useT();
  const confirm = useConfirm();
  const [tab, setTab] = useState('vault');
  const envs = useLoad(() => coolify.envs(), [], { cacheKey: '/coolify/envs' });
  const [filter, setFilter] = useState('');
  const [k, setK] = useState('');
  const [v, setV] = useState('');
  const [pendingRestart, setPendingRestart] = useState(false);
  const [busy, run] = useAction();
  const list = (envs.data || []).filter((e) => e.key.toLowerCase().includes(filter.toLowerCase())).sort((a, b) => a.key.localeCompare(b.key));
  const applyRestart = async () => {
    if (!(await confirm(t('env.applyConfirm')))) return;
    const r = await run('r', coolify.restart, t('ov.restartOk'));
    if (r !== undefined) setPendingRestart(false);
  };
  return (
    <div className="page">
      <div className="row wrap">
        <div className="seg">
          <button type="button" className={tab === 'vault' ? 'on' : ''} onClick={() => setTab('vault')}>{t('vlt.tab')}</button>
          <button type="button" className={tab === 'coolify' ? 'on' : ''} onClick={() => setTab('coolify')}>{t('env.title')}</button>
        </div>
      </div>
      {tab === 'vault' ? <VaultTab /> : (
        <>
          {pendingRestart && (
            <div className="banner warn" style={{ borderRadius: 12 }}>
              <AlertTriangle size={15} /><span>{t('env.pendingRestart')}</span>
              <Btn icon={RefreshCw} className="warn small" disabled={!!busy} onClick={applyRestart}>{t('env.apply')}</Btn>
            </div>
          )}
          <Card title={t('env.title')} icon={KeyRound} actions={<>
            <label className="search"><Search size={14} /><input placeholder={t('common.filter')} value={filter} onChange={(e) => setFilter(e.target.value)} /></label>
            <Btn icon={RefreshCw} className="warn small" disabled={!!busy} onClick={applyRestart}>{t('env.apply')}</Btn>
          </>}>
            <ErrorBox error={envs.error} onRetry={() => envs.reload()} />
            {envs.loading && !envs.data && <p className="muted">{t('common.loading')}</p>}
            {list.map((e) => <EnvRow key={e.uuid + (e.value || '')} e={e} onSaved={() => { setPendingRestart(true); envs.reload(true); }} />)}
          </Card>
          <Card title={t('env.new')} icon={Plus}>
            <form className="env-row" onSubmit={(e) => { e.preventDefault(); run('add', () => coolify.addEnv(k.trim(), v), t('env.added', { k })).then((r) => { if (r !== undefined) { setK(''); setV(''); setPendingRestart(true); envs.reload(true); } }); }}>
              <input className="mono" placeholder={t('env.name')} value={k} onChange={(e) => setK(e.target.value.toUpperCase())} />
              <input className="mono" placeholder={t('env.value')} value={v} onChange={(e) => setV(e.target.value)} />
              <Btn icon={Plus} disabled={!k.trim() || busy === 'add'}>{t('common.add')}</Btn>
            </form>
          </Card>
        </>
      )}
    </div>
  );
}
