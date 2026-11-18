import { useState } from 'react';
import { KeyRound, Pencil, RefreshCw, RotateCcw, SlidersHorizontal, Smartphone, Sparkles } from 'lucide-react';
import { bridge, coolify } from '../api.js';
import { useT } from '../i18n.jsx';
import { Badge, Btn, Card, ErrorBox, Field, IconButton, Modal, useAction, useLoad } from '../ui.jsx';

const CRED_KEYS = [
  { key: 'CLAUDE_CODE_OAUTH_TOKEN', id: 'oauth' },
  { key: 'ANTHROPIC_API_KEY', id: 'apikey' },
  { key: 'CLAUDE_PERMISSION_MODE', id: 'perm' },
  { key: 'CLAUDE_TIMEOUT_SECONDS', id: 'timeout' },
];
const isSecret = (k) => /TOKEN|KEY/.test(k);

function Credentials() {
  const t = useT();
  const envs = useLoad(() => coolify.envs(), []);
  const [edit, setEdit] = useState(null);
  const [val, setVal] = useState('');
  const [busy, run] = useAction();
  const byKey = Object.fromEntries((envs.data || []).map((e) => [e.key, e]));
  const save = async () => {
    const r = await run('save', () => (byKey[edit.key] ? coolify.setEnv(edit.key, val) : coolify.addEnv(edit.key, val)), t('pr.savedRestart'));
    if (r !== undefined) { setEdit(null); envs.reload(true); }
  };
  return (
    <Card title={t('pr.creds')} icon={KeyRound} actions={<Btn icon={RefreshCw} className="ghost small" disabled={!!busy} onClick={() => run('restart', coolify.restart, t('ov.restartOk'))}>{t('pr.restartAgent')}</Btn>}>
      <ErrorBox error={envs.error} onRetry={() => envs.reload()} />
      {CRED_KEYS.map((k) => {
        const e = byKey[k.key];
        return (
          <div key={k.key} className="list-row">
            <div className="grow"><b>{t('pr.c.' + k.id)}</b><div className="muted small mono">{k.key}</div><div className="muted small">{t('pr.c.' + k.id + 'Hint')}</div></div>
            <div className="row">
              <Badge kind={e?.value ? 'ok' : 'muted'}>{e?.value ? (isSecret(k.key) ? t('pr.set') : e.value) : t('pr.empty')}</Badge>
              <IconButton icon={Pencil} label={t('common.edit')} onClick={() => { setEdit(k); setVal(isSecret(k.key) ? '' : (e?.value || '')); }} />
            </div>
          </div>
        );
      })}
      {edit && (
        <Modal title={t('pr.c.' + edit.id)} onClose={() => setEdit(null)}>
          <form className="stack" onSubmit={(e) => { e.preventDefault(); save(); }}>
            <Field label={edit.key} hint={t('pr.c.' + edit.id + 'Hint')}>
              <input autoFocus type={isSecret(edit.key) ? 'password' : 'text'} value={val} onChange={(e) => setVal(e.target.value)} placeholder={byKey[edit.key]?.value ? t('pr.keepHint') : ''} />
            </Field>
            <div className="row end"><button type="button" className="ghost" onClick={() => setEdit(null)}>{t('common.cancel')}</button><button disabled={busy === 'save'}>{t('common.save')}</button></div>
          </form>
        </Modal>
      )}
    </Card>
  );
}

function ChatOverrides({ providers }) {
  const t = useT();
  const chats = useLoad(() => bridge.chats(), []);
  const [, run] = useAction();
  const wa = (chats.data || []).filter((c) => c.kind === 'whatsapp');
  const change = (id, b) => run(id, () => bridge.patchChat(id, b), t('common.updated')).then(() => chats.reload(true));
  return (
    <Card title={t('pr.perChat')} icon={Smartphone} actions={<span className="muted small">{t('pr.perChatHint')}</span>}>
      <ErrorBox error={chats.error} />
      {!wa.length && chats.data && <p className="muted">{t('pr.noWa')}</p>}
      {wa.map((c) => {
        const agy = c.provider === 'antigravity';
        const prov = providers.providers.find((p) => p.id === c.provider);
        const efforts = agy ? (prov.models.find((m) => m.id === c.agyModel)?.efforts || []) : prov.efforts;
        return (
          <div key={c.id} className="list-row wrap">
            <div className="grow"><b className="with-ic"><Smartphone size={14} />{c.title}</b><div className="muted small">{t('chat.session', { id: (agy ? c.agySession : c.session).slice(0, 8) || t('common.none') })}</div></div>
            <div className="row wrap">
              <select value={c.providerSet ? c.provider : ''} onChange={(e) => change(c.id, { provider: e.target.value })} aria-label={t('chat.provider')}>
                <option value="">{t('common.default')} ({providers.defaultProvider})</option>
                {providers.providers.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
              <select value={agy ? c.agyModel : c.model} onChange={(e) => change(c.id, agy ? { agyModel: e.target.value, agyEffort: '' } : { model: e.target.value })} aria-label={t('chat.model')}>
                <option value="">{t('common.defaultModel')}</option>
                {prov.models.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
              </select>
              <select value={agy ? c.agyEffort : c.effort} onChange={(e) => change(c.id, agy ? { agyEffort: e.target.value } : { effort: e.target.value })} aria-label={t('chat.effort')}>
                <option value="">{t('common.defaultEffort')}</option>
                {efforts.map((e) => <option key={e} value={e}>{e}</option>)}
              </select>
              <IconButton icon={RotateCcw} label={t('common.newSession')} onClick={() => change(c.id, { reset: true })} />
            </div>
          </div>
        );
      })}
    </Card>
  );
}

export default function Providers() {
  const t = useT();
  const p = useLoad(() => bridge.providers(), []);
  const [busy, run] = useAction();
  const save = (b) => run('settings', () => bridge.settings(b), t('pr.defaultUpdated')).then(() => p.reload(true));
  const data = p.data;
  const claude = data?.providers.find((x) => x.id === 'claude');
  return (
    <div className="page">
      <ErrorBox error={p.error} onRetry={() => p.reload()} />
      {p.loading && !data && <p className="muted">{t('common.loading')}</p>}
      {data && (
        <>
          <Card title={t('pr.globals')} icon={SlidersHorizontal}>
            <div className="form-grid">
              <Field label={t('pr.defaultProvider')} hint={t('pr.defaultProviderHint')}>
                <select value={data.defaultProvider} disabled={busy === 'settings'} onChange={(e) => save({ defaultProvider: e.target.value })}>
                  {data.providers.map((x) => <option key={x.id} value={x.id} disabled={!x.installed}>{x.name}</option>)}
                </select>
              </Field>
              <Field label={t('pr.claudeModel')} hint={claude.envModel ? t('pr.envModel', { m: claude.envModel }) : t('pr.noEnvModel')}>
                <select value={claude.defaultModel === claude.envModel ? '' : claude.defaultModel} onChange={(e) => save({ claudeModel: e.target.value })}>
                  <option value="">{claude.envModel || t('pr.accountDefault')}</option>
                  {claude.models.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
                </select>
              </Field>
              <Field label={t('pr.claudeEffort')}>
                <select value={claude.defaultEffort === claude.envEffort ? '' : claude.defaultEffort} onChange={(e) => save({ claudeEffort: e.target.value })}>
                  <option value="">{claude.envEffort || t('common.default')}</option>
                  {claude.efforts.map((x) => <option key={x} value={x}>{x}</option>)}
                </select>
              </Field>
            </div>
          </Card>

          <div className="grid2">
            {data.providers.map((x) => (
              <Card key={x.id} title={x.name} icon={Sparkles} actions={<Badge kind={x.installed ? 'ok' : 'err'}>{x.installed ? t('common.installed') : t('common.notInstalled')}</Badge>}>
                <dl className="kv">
                  <dt>{t('pr.version')}</dt><dd className="mono">{x.version || '—'}</dd>
                  {x.auth && <><dt>{t('pr.auth')}</dt><dd>{x.authKind ? t('pr.auth.' + x.authKind) : x.auth}</dd></>}
                  {x.permissionMode && <><dt>{t('pr.permissions')}</dt><dd className="mono">{x.permissionMode}</dd></>}
                  <dt>{t('pr.models')}</dt>
                  <dd>{x.models.length ? x.models.map((m) => <span key={m.id} className="chip" title={m.id}>{m.label}{m.efforts?.length ? ' · ' + m.efforts.join('/') : ''}</span>) : <span className="muted">{t('pr.noModels')}</span>}</dd>
                </dl>
                {x.id === 'antigravity' && !x.installed && <p className="muted small">{t('pr.installAgy')}</p>}
              </Card>
            ))}
          </div>

          <ChatOverrides providers={data} />
        </>
      )}
      <Credentials />
    </div>
  );
}
