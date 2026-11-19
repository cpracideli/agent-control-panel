import { useState } from 'react';
import { AlertTriangle, Eye, EyeOff, KeyRound, Plus, RefreshCw, Save, Search, Trash2 } from 'lucide-react';
import { coolify } from '../api.js';
import { useT } from '../i18n.jsx';
import { Btn, Card, ErrorBox, IconButton, useAction, useConfirm, useLoad } from '../ui.jsx';

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

export default function Envs() {
  const t = useT();
  const confirm = useConfirm();
  const envs = useLoad(() => coolify.envs(), []);
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
    </div>
  );
}
