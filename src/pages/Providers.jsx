import { useEffect, useState } from 'react';
import { Bell, Copy, KeyRound, Lock, Moon, Pencil, Plus, RefreshCw, RotateCcw, Save, Send, Shield, SlidersHorizontal, Smartphone, Sparkles, Trash2, Users } from 'lucide-react';
import { bridge, coolify, webPush } from '../api.js';
import { useT } from '../i18n.jsx';
import { Badge, Btn, Card, ErrorBox, Field, IconButton, Modal, Skeleton, useAction, useLoad, useToast } from '../ui.jsx';

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = window.atob(base64);
  return Uint8Array.from([...rawData].map((c) => c.charCodeAt(0)));
}

function ProactivityAndChannelsCard({ providers }) {
  const toast = useToast();
  const cfg = useLoad(() => bridge.getSettings(), []);
  const [busy, run] = useAction();
  const [qh, setQh] = useState({ enabled: false, start: '22:00', end: '07:00' });
  const [models, setModels] = useState({ triageProvider: '', triageModel: '', backgroundProvider: '', backgroundModel: '', semanticMemory: false });
  const [pin, setPin] = useState('');
  const [tg, setTg] = useState({ enabled: false, token: '', allowedUsers: '' });
  const [dc, setDc] = useState({ enabled: false, token: '', allowedUsers: '', allowedChannels: '' });
  const [sl, setSl] = useState({ enabled: false, botToken: '', signingSecret: '', allowedUsers: '', allowedChannels: '' });
  const [byom, setByom] = useState({ enabled: false, baseUrl: '', defaultModel: 'gpt-4.1-mini', models: 'gpt-4.1-mini, gpt-4.1', apiKey: '' });
  const [pushSubscribed, setPushSubscribed] = useState(false);

  useEffect(() => {
    const s = cfg.data;
    if (!s) return;
    if (s.proactivity?.quietHours) setQh(s.proactivity.quietHours);
    if (s.proactivity) {
      setModels({
        triageProvider: s.proactivity.triageProvider || '',
        triageModel: s.proactivity.triageModel || '',
        backgroundProvider: s.proactivity.backgroundProvider || '',
        backgroundModel: s.proactivity.backgroundModel || '',
        semanticMemory: Boolean(s.proactivity.semanticMemory),
      });
    }
    if (s.telegram) setTg((cur) => ({ ...cur, enabled: Boolean(s.telegram.enabled), allowedUsers: s.telegram.allowedUsers || '' }));
    if (s.discord) setDc((cur) => ({ ...cur, enabled: Boolean(s.discord.enabled), allowedUsers: s.discord.allowedUsers || '', allowedChannels: s.discord.allowedChannels || '' }));
    if (s.slack) setSl((cur) => ({ ...cur, enabled: Boolean(s.slack.enabled), allowedUsers: s.slack.allowedUsers || '', allowedChannels: s.slack.allowedChannels || '' }));
    if (s.openaiCompat) {
      setByom((cur) => ({
        ...cur, enabled: Boolean(s.openaiCompat.enabled), baseUrl: s.openaiCompat.baseUrl || '',
        defaultModel: s.openaiCompat.defaultModel || 'gpt-4.1-mini',
        models: (s.openaiCompat.models || []).map((m) => m.id || m).join(', '),
      }));
    }
  }, [cfg.data]);

  useEffect(() => {
    if ('serviceWorker' in navigator && 'PushManager' in window) {
      navigator.serviceWorker.ready.then((reg) => reg.pushManager.getSubscription()).then((sub) => setPushSubscribed(Boolean(sub))).catch(() => {});
    }
  }, []);

  const savePro = () => run('pro', () => bridge.settings({ proactivity: { quietHours: qh, ...models } }), 'Proatividade salva').then(() => cfg.reload(true));
  const savePin = (val) => run('pin', () => bridge.settings({ securityPin: val }), val ? 'PIN de segurança salvo' : 'PIN removido').then(() => { setPin(''); cfg.reload(true); });
  const saveTg = () => run('tg', () => bridge.settings({ telegram: { enabled: tg.enabled, allowedUsers: tg.allowedUsers, ...(tg.token.trim() ? { token: tg.token.trim() } : {}) } }), 'Telegram atualizado').then(() => { setTg((cur) => ({ ...cur, token: '' })); cfg.reload(true); });
  const saveDc = () => run('dc', () => bridge.settings({ discord: { enabled: dc.enabled, allowedUsers: dc.allowedUsers, allowedChannels: dc.allowedChannels, ...(dc.token.trim() ? { token: dc.token.trim() } : {}) } }), 'Discord atualizado').then(() => { setDc((cur) => ({ ...cur, token: '' })); cfg.reload(true); });
  const saveSl = () => run('sl', () => bridge.settings({ slack: { enabled: sl.enabled, allowedUsers: sl.allowedUsers, allowedChannels: sl.allowedChannels, ...(sl.botToken.trim() ? { botToken: sl.botToken.trim() } : {}), ...(sl.signingSecret.trim() ? { signingSecret: sl.signingSecret.trim() } : {}) } }), 'Slack atualizado').then(() => { setSl((cur) => ({ ...cur, botToken: '', signingSecret: '' })); cfg.reload(true); });
  const saveByom = () => run('byom', () => bridge.settings({ openaiCompat: { enabled: byom.enabled, baseUrl: byom.baseUrl.trim(), defaultModel: byom.defaultModel.trim(), models: byom.models, ...(byom.apiKey.trim() ? { apiKey: byom.apiKey.trim() } : {}) } }), 'API Direta (BYOM) salva').then(() => { setByom((cur) => ({ ...cur, apiKey: '' })); cfg.reload(true); });

  const enableWebPush = async () => {
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) return toast('Navegador sem suporte a Web Push', 'err');
    const perm = await Notification.requestPermission();
    if (perm !== 'granted') return toast('Permissão de notificação negada', 'err');
    const r = await run('push', async () => {
      const { publicKey } = await webPush.key();
      const reg = await navigator.serviceWorker.ready;
      let sub = await reg.pushManager.getSubscription();
      if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(publicKey) });
      await webPush.subscribe(sub.toJSON());
      setPushSubscribed(true);
      return true;
    }, 'Web Push ativado neste dispositivo');
    if (r) cfg.reload(true);
  };
  const disableWebPush = async () => {
    await run('push', async () => {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (sub) { await webPush.unsubscribe(sub.endpoint); await sub.unsubscribe(); }
      setPushSubscribed(false);
    }, 'Web Push desativado');
  };

  const s = cfg.data || {};
  return (
    <div className="grid2">
      <Card title="Proatividade & Horário de Silêncio" icon={Moon}>
        <div className="stack">
          <label className="check">
            <input type="checkbox" checked={Boolean(qh.enabled)} onChange={(e) => setQh({ ...qh, enabled: e.target.checked })} />
            <span><b>Ativar Horário de Silêncio (Quiet Hours)</b> · Adia rotinas não urgentes e dispara em lote depois</span>
          </label>
          <div className="form-grid">
            <Field label="Início (HH:MM)"><input type="time" value={qh.start} onChange={(e) => setQh({ ...qh, start: e.target.value })} /></Field>
            <Field label="Fim (HH:MM)"><input type="time" value={qh.end} onChange={(e) => setQh({ ...qh, end: e.target.value })} /></Field>
            <Field label="Provedor de triagem leve">
              <select value={models.triageProvider} onChange={(e) => setModels({ ...models, triageProvider: e.target.value })}>
                <option value="">Padrão</option>
                {(providers?.providers || []).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </Field>
            <Field label="Modelo de triagem" hint="Ex.: haiku ou flash"><input value={models.triageModel} onChange={(e) => setModels({ ...models, triageModel: e.target.value })} placeholder="haiku" /></Field>
            <Field label="Provedor background (rotinas)">
              <select value={models.backgroundProvider} onChange={(e) => setModels({ ...models, backgroundProvider: e.target.value })}>
                <option value="">Padrão</option>
                {(providers?.providers || []).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </Field>
            <Field label="Modelo background"><input value={models.backgroundModel} onChange={(e) => setModels({ ...models, backgroundModel: e.target.value })} placeholder="sonnet" /></Field>
          </div>
          <label className="check">
            <input type="checkbox" checked={Boolean(models.semanticMemory)} onChange={(e) => setModels({ ...models, semanticMemory: e.target.checked })} />
            <span><b>Memória semântica automática (ai-memory)</b> · Recupera trechos relevantes antes de cada resposta</span>
          </label>
          <div className="row end"><Btn icon={Save} className="small" disabled={busy === 'pro'} onClick={savePro}>Salvar proatividade</Btn></div>

          <hr style={{ border: 0, borderTop: '1px solid var(--border)', margin: '4px 0' }} />

          <div className="row wrap">
            <Sparkles size={14} className="muted" />
            <b>3º Provedor: API Direta (BYOM)</b>
            <Badge kind={s.openaiCompat?.enabled ? 'ok' : 'muted'}>{s.openaiCompat?.enabled ? 'Ativo' : 'Desligado'}</Badge>
          </div>
          <div className="presets">
            <button type="button" className="ghost small" onClick={() => setByom({ ...byom, enabled: true, baseUrl: 'https://api.openai.com/v1', defaultModel: 'gpt-4.1-mini', models: 'gpt-4.1-mini, gpt-4.1, o4-mini' })}>OpenAI</button>
            <button type="button" className="ghost small" onClick={() => setByom({ ...byom, enabled: true, baseUrl: 'https://openrouter.ai/api/v1', defaultModel: 'openai/gpt-4.1-mini', models: 'openai/gpt-4.1-mini, google/gemini-2.5-flash, deepseek/deepseek-chat' })}>OpenRouter</button>
            <button type="button" className="ghost small" onClick={() => setByom({ ...byom, enabled: true, baseUrl: 'http://host.docker.internal:11434/v1', defaultModel: 'llama3.3', models: 'llama3.3, qwen2.5:14b' })}>Ollama local</button>
          </div>
          <label className="check">
            <input type="checkbox" checked={Boolean(byom.enabled)} onChange={(e) => setByom({ ...byom, enabled: e.target.checked })} />
            <span>Habilitar provedor OpenAI-compatible (com tool-calling nativo)</span>
          </label>
          <div className="form-grid">
            <Field label="Base URL"><input value={byom.baseUrl} onChange={(e) => setByom({ ...byom, baseUrl: e.target.value })} placeholder="https://api.openai.com/v1" /></Field>
            <Field label="Modelo padrão"><input value={byom.defaultModel} onChange={(e) => setByom({ ...byom, defaultModel: e.target.value })} placeholder="gpt-4.1-mini" /></Field>
            <Field label="Modelos (vírgula)"><input value={byom.models} onChange={(e) => setByom({ ...byom, models: e.target.value })} placeholder="gpt-4.1-mini, gpt-4.1" /></Field>
            <Field label="API Key (salva no Cofre AES-GCM)"><input type="password" value={byom.apiKey} onChange={(e) => setByom({ ...byom, apiKey: e.target.value })} placeholder={s.openaiCompat?.hasKey ? '•••• salva no cofre' : 'sk-... (vazio p/ Ollama)'} /></Field>
          </div>
          <div className="row end"><Btn icon={Save} className="small" disabled={busy === 'byom'} onClick={saveByom}>Salvar BYOM</Btn></div>
        </div>
      </Card>

      <Card title="Segurança (PIN), Web Push & Telegram" icon={Shield}>
        <div className="stack">
          <div className="row wrap">
            <Lock size={14} className="muted" />
            <b>PIN para ações críticas</b>
            <Badge kind={s.securityPinSet ? 'ok' : 'muted'}>{s.securityPinSet ? 'Ativo' : 'Desativado'}</Badge>
          </div>
          <div className="row wrap">
            <input type="password" className="grow" value={pin} onChange={(e) => setPin(e.target.value)} placeholder="Novo PIN (4 a 32 caracteres)" />
            <Btn icon={Lock} className="small" disabled={busy === 'pin' || pin.trim().length < 4} onClick={() => savePin(pin.trim())}>Definir PIN</Btn>
            {s.securityPinSet && <button type="button" className="ghost small danger-text" disabled={busy === 'pin'} onClick={() => savePin('')}>Remover</button>}
          </div>

          <hr style={{ border: 0, borderTop: '1px solid var(--border)', margin: '4px 0' }} />

          <div className="row wrap">
            <Bell size={14} className="muted" />
            <b>Web Push (aba fechada / PWA)</b>
            <Badge kind={pushSubscribed ? 'ok' : 'muted'}>{pushSubscribed ? 'Inscrito' : 'Inativo'}</Badge>
            <span className="grow" />
            {!pushSubscribed ? (
              <Btn icon={Bell} className="small" disabled={busy === 'push'} onClick={enableWebPush}>Ativar Push</Btn>
            ) : (
              <>
                <Btn icon={Send} className="ghost small" disabled={busy === 'ptest'} onClick={() => run('ptest', webPush.test, 'Push de teste enviado')}>Testar</Btn>
                <button type="button" className="ghost small" disabled={busy === 'push'} onClick={disableWebPush}>Desativar</button>
              </>
            )}
          </div>

          <hr style={{ border: 0, borderTop: '1px solid var(--border)', margin: '4px 0' }} />

          <div className="row wrap">
            <Send size={14} className="muted" />
            <b>Canal Telegram (polling)</b>
            <Badge kind={s.telegram?.running ? 'ok' : 'muted'}>{s.telegram?.running ? '@' + (s.telegram.botUsername || 'ativo') : 'Desligado'}</Badge>
          </div>
          <label className="check">
            <input type="checkbox" checked={Boolean(tg.enabled)} onChange={(e) => setTg({ ...tg, enabled: e.target.checked })} />
            <span>Habilitar bot do Telegram (mesmos bots, memória e botões inline para aprovações)</span>
          </label>
          <div className="form-grid">
            <Field label="Bot Token (BotFather)"><input type="password" value={tg.token} onChange={(e) => setTg({ ...tg, token: e.target.value })} placeholder={s.telegram?.hasToken ? '•••• salvo (vazio mantém)' : '123456:ABC...'} /></Field>
            <Field label="User IDs permitidos" hint="Separados por vírgula"><input value={tg.allowedUsers} onChange={(e) => setTg({ ...tg, allowedUsers: e.target.value })} placeholder="123456789" /></Field>
          </div>
          {s.telegram?.error && <p className="err small" style={{ margin: 0 }}>{s.telegram.error}</p>}
          <div className="row end"><Btn icon={Save} className="small" disabled={busy === 'tg'} onClick={saveTg}>Salvar Telegram</Btn></div>

          <hr style={{ border: 0, borderTop: '1px solid var(--border)', margin: '4px 0' }} />

          <div className="row wrap">
            <Send size={14} className="muted" />
            <b>Canal Discord (Gateway WS)</b>
            <Badge kind={s.discord?.running ? 'ok' : 'muted'}>{s.discord?.running ? '@' + (s.discord.botUsername || 'online') : 'Desligado'}</Badge>
          </div>
          <label className="check">
            <input type="checkbox" checked={Boolean(dc.enabled)} onChange={(e) => setDc({ ...dc, enabled: e.target.checked })} />
            <span>Habilitar bot do Discord (com botões interativos para aprovações)</span>
          </label>
          <div className="form-grid">
            <Field label="Bot Token"><input type="password" value={dc.token} onChange={(e) => setDc({ ...dc, token: e.target.value })} placeholder={s.discord?.hasToken ? '•••• salvo' : 'MT...'} /></Field>
            <Field label="User IDs permitidos"><input value={dc.allowedUsers} onChange={(e) => setDc({ ...dc, allowedUsers: e.target.value })} placeholder="IDs separados por vírgula" /></Field>
            <Field label="Channel IDs (opcional)"><input value={dc.allowedChannels} onChange={(e) => setDc({ ...dc, allowedChannels: e.target.value })} placeholder="DMs sempre aceitas se user permitido" /></Field>
          </div>
          <div className="row end"><Btn icon={Save} className="small" disabled={busy === 'dc'} onClick={saveDc}>Salvar Discord</Btn></div>

          <hr style={{ border: 0, borderTop: '1px solid var(--border)', margin: '4px 0' }} />

          <div className="row wrap">
            <Send size={14} className="muted" />
            <b>Canal Slack (Events API + Block Kit)</b>
            <Badge kind={s.slack?.enabled ? 'ok' : 'muted'}>{s.slack?.enabled ? 'Ativo' : 'Desligado'}</Badge>
          </div>
          <label className="check">
            <input type="checkbox" checked={Boolean(sl.enabled)} onChange={(e) => setSl({ ...sl, enabled: e.target.checked })} />
            <span>Habilitar Slack (Events: <code className="mono">{window.location.origin}/slack/events</code>)</span>
          </label>
          <div className="form-grid">
            <Field label="Bot Token (xoxb-...)"><input type="password" value={sl.botToken} onChange={(e) => setSl({ ...sl, botToken: e.target.value })} placeholder={s.slack?.hasToken ? '•••• salvo' : 'xoxb-...'} /></Field>
            <Field label="Signing Secret (HMAC)"><input type="password" value={sl.signingSecret} onChange={(e) => setSl({ ...sl, signingSecret: e.target.value })} placeholder={s.slack?.hasSigningSecret ? '•••• salvo' : 'signing secret'} /></Field>
            <Field label="User IDs permitidos"><input value={sl.allowedUsers} onChange={(e) => setSl({ ...sl, allowedUsers: e.target.value })} placeholder="U0123..." /></Field>
            <Field label="Channel IDs (opcional)"><input value={sl.allowedChannels} onChange={(e) => setSl({ ...sl, allowedChannels: e.target.value })} placeholder="C0123..." /></Field>
          </div>
          <div className="row end"><Btn icon={Save} className="small" disabled={busy === 'sl'} onClick={saveSl}>Salvar Slack</Btn></div>
        </div>
      </Card>
    </div>
  );
}

const CRED_KEYS = [
  { key: 'CLAUDE_CODE_OAUTH_TOKEN', id: 'oauth' },
  { key: 'ANTHROPIC_API_KEY', id: 'apikey' },
  { key: 'CLAUDE_PERMISSION_MODE', id: 'perm' },
  { key: 'CLAUDE_TIMEOUT_SECONDS', id: 'timeout' },
];
const isSecret = (k) => /TOKEN|KEY/.test(k);

function Credentials() {
  const t = useT();
  const envs = useLoad(() => coolify.envs(), [], { cacheKey: '/coolify/envs' });
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
  const chats = useLoad(() => bridge.chats(), [], { cacheKey: '/bridge/chats' });
  const [, run] = useAction();
  const wa = (chats.data || []).filter((c) => c.kind === 'whatsapp');
  const change = (id, b) => run(id, () => bridge.patchChat(id, b), t('common.updated')).then(() => chats.reload(true));
  return (
    <Card title={t('pr.perChat')} icon={Smartphone} actions={<span className="muted small">{t('pr.perChatHint')}</span>}>
      <ErrorBox error={chats.error} />
      {!wa.length && chats.data && <p className="muted">{t('pr.noWa')}</p>}
      {wa.map((c) => {
        const agy = c.provider === 'antigravity';
        const prov = providers.providers.find((p) => p.id === c.provider) || providers.providers[0];
        const efforts = agy ? (prov?.models.find((m) => m.id === c.agyModel)?.efforts || []) : (prov?.efforts || []);
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

function RouterShortcutsAndGuestsCard({ providers }) {
  const toast = useToast();
  const cfg = useLoad(() => bridge.getSettings(), []);
  const scCfg = useLoad(() => bridge.shortcutConfig(), []);
  const bots = useLoad(() => bridge.bots(), []);
  const [busy, run] = useAction();
  const [routing, setRouting] = useState({ enabled: false, fallbackOrder: 'antigravity, claude, opencode, openai_compat', lightRouting: false, lightProvider: 'opencode', lightModel: 'opencode/deepseek-v4.1-flash-free' });
  const [startupNotify, setStartupNotify] = useState(true);
  const [newToken, setNewToken] = useState('');
  const [guests, setGuests] = useState([]);
  const [newGuest, setNewGuest] = useState({ name: '', number: '', bot: 'familia', readOnly: true });

  useEffect(() => {
    const s = cfg.data;
    if (!s) return;
    if (s.routing) {
      setRouting({
        enabled: Boolean(s.routing.enabled),
        fallbackOrder: (s.routing.fallbackOrder || ['antigravity', 'claude', 'opencode', 'openai_compat']).join(', '),
        lightRouting: Boolean(s.routing.lightRouting),
        lightProvider: s.routing.lightProvider || 'opencode',
        lightModel: s.routing.lightModel || 'opencode/deepseek-v4.1-flash-free',
      });
    }
    setStartupNotify(s.startupNotify !== false);
    setGuests(Array.isArray(s.guestAccess) ? s.guestAccess : []);
  }, [cfg.data]);

  const saveRouting = () => run('rt', () => bridge.settings({
    startupNotify,
    routing: {
      enabled: routing.enabled,
      fallbackOrder: routing.fallbackOrder.split(/[,\s]+/).map((x) => x.trim()).filter(Boolean),
      lightRouting: routing.lightRouting,
      lightProvider: routing.lightProvider,
      lightModel: routing.lightModel,
    },
  }), 'Roteamento salvo').then(() => cfg.reload(true));

  const rotateToken = async () => {
    const r = await run('sctok', () => bridge.rotateShortcutToken(), 'Novo token gerado (copie agora!)');
    if (r?.token) { setNewToken(r.token); scCfg.reload(true); }
  };
  const revokeToken = () => run('scdel', () => bridge.revokeShortcutToken(), 'Token revogado').then(() => { setNewToken(''); scCfg.reload(true); });

  const saveGuests = (next) => run('gst', () => bridge.settings({ guestAccess: next }), 'Acesso convidado atualizado').then(() => cfg.reload(true));
  const addGuest = () => {
    if (!newGuest.name.trim() || newGuest.number.replace(/\D/g, '').length < 10) return toast('Informe nome e número com DDI+DDD', 'err');
    const next = [...guests, { ...newGuest, name: newGuest.name.trim(), number: newGuest.number.replace(/\D/g, ''), enabled: true }];
    setNewGuest({ name: '', number: '', bot: newGuest.bot, readOnly: true });
    saveGuests(next);
  };

  const endpointUrl = scCfg.data?.endpointUrl || (window.location.origin + '/api/shortcut');
  return (
    <div className="grid2">
      <Card title="Roteador Inteligente & Failover" icon={Sparkles}>
        <div className="stack">
          <label className="check">
            <input type="checkbox" checked={routing.enabled} onChange={(e) => setRouting({ ...routing, enabled: e.target.checked })} />
            <span><b>Failover automático entre provedores</b> · Se um provedor falhar/der rate-limit, tenta o próximo da fila automaticamente</span>
          </label>
          <Field label="Ordem de failover (vírgula)" hint="Valores: antigravity, claude, opencode, openai_compat">
            <input className="mono" value={routing.fallbackOrder} onChange={(e) => setRouting({ ...routing, fallbackOrder: e.target.value })} />
          </Field>
          <label className="check">
            <input type="checkbox" checked={routing.lightRouting} onChange={(e) => setRouting({ ...routing, lightRouting: e.target.checked })} />
            <span><b>Roteamento econômico em perguntas leves</b> · Envia perguntas curtas sem código/ação para modelo leve/gratuito</span>
          </label>
          <div className="form-grid">
            <Field label="Provedor leve">
              <select value={routing.lightProvider} onChange={(e) => setRouting({ ...routing, lightProvider: e.target.value })}>
                {(providers?.providers || []).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </Field>
            <Field label="Modelo leve"><input className="mono" value={routing.lightModel} onChange={(e) => setRouting({ ...routing, lightModel: e.target.value })} /></Field>
          </div>
          <label className="check">
            <input type="checkbox" checked={startupNotify} onChange={(e) => setStartupNotify(e.target.checked)} />
            <span>Avisar no WhatsApp quando a ponte reiniciar (sempre silenciado no Horário de Silêncio)</span>
          </label>
          <div className="row end"><Btn icon={Save} className="small" disabled={busy === 'rt'} onClick={saveRouting}>Salvar roteador</Btn></div>

          <hr style={{ border: 0, borderTop: '1px solid var(--border)', margin: '4px 0' }} />

          <div className="row wrap">
            <Users size={14} className="muted" />
            <b>Acesso Convidado / Família (WhatsApp isolado)</b>
            <Badge kind={guests.some((g) => g.enabled) ? 'ok' : 'muted'}>{guests.filter((g) => g.enabled).length} ativos</Badge>
          </div>
          <p className="muted small" style={{ margin: 0 }}>Permite que familiares conversem apenas com um bot isolado (sandbox, sem acesso a trabalho, infra ou credenciais).</p>
          {guests.map((g, i) => (
            <div key={g.id || i} className="list-row wrap">
              <div className="grow">
                <b>{g.name}</b> <span className="muted small mono">{g.number}</span>
                <div className="muted small">Bot: {g.bot} · {g.readOnly ? 'somente leitura' : 'padrão'}</div>
              </div>
              <label className="check" style={{ margin: 0 }}>
                <input type="checkbox" checked={Boolean(g.enabled)} onChange={(e) => saveGuests(guests.map((x, j) => (j === i ? { ...x, enabled: e.target.checked } : x)))} />
                <span className="small">Ativo</span>
              </label>
              <IconButton icon={Trash2} className="ghost danger-text" label="Remover" onClick={() => saveGuests(guests.filter((_, j) => j !== i))} />
            </div>
          ))}
          <div className="form-grid">
            <Field label="Nome"><input value={newGuest.name} onChange={(e) => setNewGuest({ ...newGuest, name: e.target.value })} placeholder="Ex.: Bia" /></Field>
            <Field label="WhatsApp (DDI+DDD)"><input value={newGuest.number} onChange={(e) => setNewGuest({ ...newGuest, number: e.target.value })} placeholder="5511999998888" /></Field>
            <Field label="Bot exclusivo">
              <select value={newGuest.bot} onChange={(e) => setNewGuest({ ...newGuest, bot: e.target.value })}>
                {(bots.data || []).map((b) => <option key={b.id} value={b.id}>{(b.emoji ? b.emoji + ' ' : '') + b.name}</option>)}
              </select>
            </Field>
          </div>
          <div className="row end"><Btn icon={Plus} className="ghost small" disabled={busy === 'gst'} onClick={addGuest}>Adicionar convidado</Btn></div>
        </div>
      </Card>

      <Card title="iOS Shortcuts · Share Sheet · Siri" icon={Smartphone}>
        <div className="stack">
          <div className="row wrap">
            <b>Endpoint pessoal autenticado</b>
            <Badge kind={scCfg.data?.configured ? 'ok' : 'muted'}>{scCfg.data?.configured ? 'Token ativo' : 'Não configurado'}</Badge>
          </div>
          <div className="row hook-url" style={{ paddingLeft: 0 }}>
            <code className="mono grow ellipsis">{endpointUrl}</code>
            <IconButton icon={Copy} size={14} label="Copiar URL" onClick={() => { navigator.clipboard.writeText(endpointUrl); toast('URL copiada'); }} />
          </div>
          <div className="row wrap" style={{ gap: 6 }}>
            <Btn icon={KeyRound} className="small" disabled={busy === 'sctok'} onClick={rotateToken}>{scCfg.data?.configured ? 'Gerar novo token' : 'Gerar token'}</Btn>
            {scCfg.data?.configured && <button type="button" className="ghost small danger-text" disabled={busy === 'scdel'} onClick={revokeToken}>Revogar</button>}
          </div>
          {newToken && (
            <div className="stack" style={{ padding: 10, borderRadius: 10, border: '1px solid var(--accent)', gap: 6 }}>
              <b className="small">Token gerado (salve no app Atalhos do iPhone — não será mostrado novamente):</b>
              <div className="row">
                <code className="mono grow ellipsis">{newToken}</code>
                <IconButton icon={Copy} size={14} label="Copiar token" onClick={() => { navigator.clipboard.writeText(newToken); toast('Token copiado'); }} />
              </div>
            </div>
          )}
          <p className="muted small" style={{ margin: 0 }}>
            No app <b>Atalhos (iOS)</b>: ação <i>Obter Conteúdo do URL</i> → método <b>POST</b> → cabeçalho <code className="mono">Authorization: Bearer SEU_TOKEN</code> → JSON:
          </p>
          <pre className="history-preview" style={{ margin: 0 }}>{`// Capturar tarefa via Siri:
{"action":"ticket","title":"Ligar pro dentista","priority":"high"}

// Salvar link do Share Sheet no Obsidian:
{"action":"note","title":"Artigo","url":"https://..."}

// Resumir link ou perguntar à Siri (retorna campo "spoken"):
{"action":"summarize","url":"https://...","wait":true}

// Arquivar Nota Fiscal (Arquivista -> Google Drive):
{"action":"receipt","text":"NF Mercado","file":{"name":"nf.jpg","type":"image/jpeg","data":"<base64>"}}`}</pre>
        </div>
      </Card>
    </div>
  );
}

export default function Providers() {
  const t = useT();
  const p = useLoad(() => bridge.providers(), [], { cacheKey: '/bridge/providers' });
  const [busy, run] = useAction();
  const save = (b) => run('settings', () => bridge.settings(b), t('pr.defaultUpdated')).then(() => p.reload(true));
  const data = p.data;
  const claude = data?.providers.find((x) => x.id === 'claude');
  return (
    <div className="page">
      <ErrorBox error={p.error} onRetry={() => p.reload()} />
      {p.loading && !data && <Skeleton rows={3} />}
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

          <ProactivityAndChannelsCard providers={data} />

          <RouterShortcutsAndGuestsCard providers={data} />

          <ChatOverrides providers={data} />
        </>
      )}
      <Credentials />
    </div>
  );
}
