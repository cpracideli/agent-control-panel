import { useState } from 'react';
import { bridge, coolify } from '../api.js';
import { Badge, Card, ErrorBox, Field, Modal, useAction, useLoad } from '../ui.jsx';

const CRED_KEYS = [
  { key: 'CLAUDE_CODE_OAUTH_TOKEN', label: 'Token da assinatura Claude', hint: 'Gerado com "claude setup-token" (sk-ant-oat01-…)' },
  { key: 'ANTHROPIC_API_KEY', label: 'Anthropic API key', hint: 'Alternativa ao token. Deixe vazio para usar a assinatura.' },
  { key: 'CLAUDE_PERMISSION_MODE', label: 'Modo de permissão', hint: 'bypassPermissions (padrão) libera tudo' },
  { key: 'CLAUDE_TIMEOUT_SECONDS', label: 'Tempo limite por tarefa (s)', hint: 'Padrão 1800' },
];

function Credentials() {
  const envs = useLoad(() => coolify.envs(), []);
  const [edit, setEdit] = useState(null);
  const [val, setVal] = useState('');
  const [busy, run] = useAction();
  const byKey = Object.fromEntries((envs.data || []).map((e) => [e.key, e]));
  const save = async () => {
    const exists = byKey[edit.key];
    const r = await run('save', () => (exists ? coolify.setEnv(edit.key, val) : coolify.addEnv(edit.key, val)), 'Salvo. Reinicie o agente para aplicar.');
    if (r !== undefined) { setEdit(null); envs.reload(true); }
  };
  return (
    <Card title="Credenciais e opções (Coolify)" actions={<button className="ghost small" disabled={!!busy} onClick={() => run('restart', coolify.restart, 'Reinício solicitado')}>Reiniciar agente</button>}>
      <ErrorBox error={envs.error} onRetry={() => envs.reload()} />
      {CRED_KEYS.map((k) => {
        const e = byKey[k.key];
        const set = e && e.value;
        return (
          <div key={k.key} className="list-row">
            <div><b>{k.label}</b><div className="muted small mono">{k.key}</div><div className="muted small">{k.hint}</div></div>
            <div className="row">
              <Badge kind={set ? 'ok' : 'muted'}>{set ? (k.key.match(/TOKEN|KEY/) ? 'definido' : e.value) : 'vazio'}</Badge>
              <button className="ghost small" onClick={() => { setEdit(k); setVal(k.key.match(/TOKEN|KEY/) ? '' : (e?.value || '')); }}>Editar</button>
            </div>
          </div>
        );
      })}
      {edit && (
        <Modal title={edit.label} onClose={() => setEdit(null)}>
          <form className="stack" onSubmit={(e) => { e.preventDefault(); save(); }}>
            <Field label={edit.key} hint={edit.hint}>
              <input autoFocus type={edit.key.match(/TOKEN|KEY/) ? 'password' : 'text'} value={val} onChange={(e) => setVal(e.target.value)} placeholder={byKey[edit.key]?.value ? '(mantém o atual se você não mudar nada… digite o novo valor)' : ''} />
            </Field>
            <div className="row end"><button type="button" className="ghost" onClick={() => setEdit(null)}>Cancelar</button><button disabled={busy === 'save'}>Salvar</button></div>
          </form>
        </Modal>
      )}
    </Card>
  );
}

function ChatOverrides({ providers }) {
  const chats = useLoad(() => bridge.chats(), []);
  const [, run] = useAction();
  const wa = (chats.data || []).filter((c) => c.kind === 'whatsapp');
  const change = (id, b) => run(id, () => bridge.patchChat(id, b), 'Atualizado').then(() => chats.reload(true));
  return (
    <Card title="Por conversa do WhatsApp" actions={<span className="muted small">Mesmo efeito de /provider, /model e /effort</span>}>
      <ErrorBox error={chats.error} />
      {!wa.length && chats.data && <p className="muted">Nenhuma conversa do WhatsApp ainda.</p>}
      {wa.map((c) => {
        const agy = c.provider === 'antigravity';
        const prov = providers.providers.find((p) => p.id === c.provider);
        const efforts = agy ? (prov.models.find((m) => m.id === c.agyModel)?.efforts || []) : prov.efforts;
        return (
          <div key={c.id} className="list-row wrap">
            <div><b>📱 {c.title}</b><div className="muted small">sessão {(agy ? c.agySession : c.session).slice(0, 8) || 'nenhuma'}</div></div>
            <div className="row wrap">
              <select value={c.providerSet ? c.provider : ''} onChange={(e) => change(c.id, { provider: e.target.value })}>
                <option value="">padrão ({providers.defaultProvider})</option>
                {providers.providers.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
              <select value={agy ? c.agyModel : c.model} onChange={(e) => change(c.id, agy ? { agyModel: e.target.value, agyEffort: '' } : { model: e.target.value })}>
                <option value="">modelo padrão</option>
                {prov.models.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
              </select>
              <select value={agy ? c.agyEffort : c.effort} onChange={(e) => change(c.id, agy ? { agyEffort: e.target.value } : { effort: e.target.value })}>
                <option value="">esforço padrão</option>
                {efforts.map((e) => <option key={e} value={e}>{e}</option>)}
              </select>
              <button className="ghost small" onClick={() => change(c.id, { reset: true })}>Nova sessão</button>
            </div>
          </div>
        );
      })}
    </Card>
  );
}

export default function Providers() {
  const p = useLoad(() => bridge.providers(), []);
  const [busy, run] = useAction();
  const save = (b) => run('settings', () => bridge.settings(b), 'Padrão atualizado').then(() => p.reload(true));
  const data = p.data;
  const claude = data?.providers.find((x) => x.id === 'claude');
  return (
    <div className="page">
      <ErrorBox error={p.error} onRetry={() => p.reload()} />
      {data && (
        <>
          <Card title="Padrões globais">
            <div className="form-grid">
              <Field label="Provider padrão" hint="Usado por conversas que nunca escolheram um">
                <select value={data.defaultProvider} disabled={busy === 'settings'} onChange={(e) => save({ defaultProvider: e.target.value })}>
                  {data.providers.map((x) => <option key={x.id} value={x.id} disabled={!x.installed}>{x.name}</option>)}
                </select>
              </Field>
              <Field label="Modelo Claude padrão" hint={claude.envModel ? 'CLAUDE_MODEL do ambiente: ' + claude.envModel : 'Sem CLAUDE_MODEL: usa o padrão da conta'}>
                <select value={claude.defaultModel === claude.envModel ? '' : claude.defaultModel} onChange={(e) => save({ claudeModel: e.target.value })}>
                  <option value="">{claude.envModel || 'padrão da conta'}</option>
                  {claude.models.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
                </select>
              </Field>
              <Field label="Esforço Claude padrão">
                <select value={claude.defaultEffort === claude.envEffort ? '' : claude.defaultEffort} onChange={(e) => save({ claudeEffort: e.target.value })}>
                  <option value="">{claude.envEffort || 'padrão'}</option>
                  {claude.efforts.map((x) => <option key={x} value={x}>{x}</option>)}
                </select>
              </Field>
            </div>
          </Card>

          <div className="grid2">
            {data.providers.map((x) => (
              <Card key={x.id} title={x.name} actions={<Badge kind={x.installed ? 'ok' : 'err'}>{x.installed ? 'instalado' : 'não instalado'}</Badge>}>
                <dl className="kv">
                  <dt>Versão</dt><dd className="mono">{x.version || '—'}</dd>
                  {x.auth && <><dt>Autenticação</dt><dd>{x.auth}</dd></>}
                  {x.permissionMode && <><dt>Permissões</dt><dd className="mono">{x.permissionMode}</dd></>}
                  <dt>Modelos</dt>
                  <dd>{x.models.length ? x.models.map((m) => <span key={m.id} className="chip" title={m.id}>{m.label}{m.efforts?.length ? ' · ' + m.efforts.join('/') : ''}</span>) : <span className="muted">nenhum lido{x.id === 'antigravity' ? ' (agy models)' : ''}</span>}</dd>
                </dl>
                {x.id === 'antigravity' && !x.installed && <p className="muted small">Peça ao agente no chat: "instale o Antigravity CLI (agy)".</p>}
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
