import { useState } from 'react';
import { Activity, Box, Brain, Cpu, DollarSign, Globe, MessageCircle, Play, RefreshCw, Rocket, Send, Smartphone, Square } from 'lucide-react';
import { bridge, coolify } from '../api.js';
import { useT } from '../i18n.jsx';
import { Badge, Btn, Card, ErrorBox, Field, useAction, useConfirm, useFmt, useLoad } from '../ui.jsx';

const statusKind = (s) => (String(s).startsWith('running') ? 'ok' : /exit|stop/.test(String(s)) ? 'err' : 'warn');
const Stat = ({ icon: Icon, label, value, sub }) => (
  <div className="stat"><small><Icon size={14} />{label}</small><b>{value}</b>{sub && <small>{sub}</small>}</div>
);

export default function Overview() {
  const t = useT();
  const f = useFmt();
  const confirm = useConfirm();
  const app = useLoad(() => coolify.status(), [], { interval: 20000 });
  const ov = useLoad(() => bridge.overview(), [], { interval: 10000 });
  const chats = useLoad(() => bridge.chats(), [], { interval: 20000 });
  const [busy, run] = useAction();
  const [to, setTo] = useState('');
  const [msg, setMsg] = useState('');

  const all = chats.data || [];
  const waChats = all.filter((c) => c.kind === 'whatsapp');
  const tot = all.reduce((a, c) => ({ runs: a.runs + c.totals.runs, cost: a.cost + c.totals.cost, ms: a.ms + c.totals.ms, errors: a.errors + c.totals.errors }), { runs: 0, cost: 0, ms: 0, errors: 0 });
  const o = ov.data;

  return (
    <div className="page">
      <div className="stats">
        <Stat icon={Box} label={t('ov.container')} value={<Badge kind={statusKind(app.data?.status)}>{app.data?.status || '…'}</Badge>} />
        <Stat icon={Cpu} label={t('ov.bridge')} value={o ? 'v' + o.version.slice(0, 7) : ov.error ? t('ov.offline') : '…'} sub={o && t('ov.upFor', { t: f.dur(o.uptime * 1000) })} />
        <Stat icon={Activity} label={t('ov.runs')} value={tot.runs} sub={t('ov.withErrors', { n: tot.errors })} />
        <Stat icon={DollarSign} label={t('ov.cost')} value={f.usd(tot.cost)} sub={t('ov.work', { t: f.dur(tot.ms) })} />
        <Stat icon={Brain} label="ai-memory" value={<Badge kind={o?.aiMemory.status === 'ok' ? 'ok' : 'warn'}>{o?.aiMemory.status || '…'}</Badge>} />
      </div>
      <ErrorBox error={ov.error && 'Bridge: ' + ov.error} onRetry={() => ov.reload()} />
      <ErrorBox error={app.error && 'Coolify: ' + app.error} onRetry={() => app.reload()} />

      <div className="grid2">
        <Card title={t('ov.running')} icon={Play}>
          {o && !o.running.length && <p className="muted">{t('ov.nothing')}</p>}
          {o?.running.map((r) => (
            <div key={r.chatId} className="list-row">
              <div className="grow"><b>{r.chatId.startsWith('web:') ? 'Web' : r.chatId.split('@')[0]}</b><div className="muted small ellipsis">"{r.prompt}" · {t('ov.ago', { t: f.ago(r.started) })}</div></div>
              <Btn icon={Square} className="danger small" disabled={busy === r.chatId} onClick={() => run(r.chatId, () => bridge.stopChat(r.chatId), t('common.stopped')).then(() => ov.reload(true))}>{t('common.stop')}</Btn>
            </div>
          ))}
        </Card>

        <Card title={t('ov.actions')} icon={Box}>
          <p className="muted small ellipsis">{app.data?.git_repository}@{app.data?.git_branch}</p>
          <div className="row wrap">
            <Btn icon={RefreshCw} className="warn" disabled={!!busy} onClick={async () => (await confirm(t('ov.restartConfirm'))) && run('restart', coolify.restart, t('ov.restartOk'))}>{t('ov.restart')}</Btn>
            <Btn icon={Rocket} className="ghost" disabled={!!busy} onClick={async () => (await confirm(t('ov.deployConfirm'))) && run('deploy', coolify.deploy, t('ov.deployOk'))}>{t('ov.redeploy')}</Btn>
          </div>
          <p className="muted small">{t('ov.envNote')}</p>
        </Card>
      </div>

      <div className="grid2">
        <Card title={t('ov.chats')} icon={MessageCircle}>
          {all.map((c) => (
            <div key={c.id} className={'list-row' + (c.kind === 'web' ? ' clickable' : '')} onClick={c.kind === 'web' ? () => { window.location.hash = '#/chat/' + c.id.slice(4); } : undefined}>
              <div className="grow">
                <b className="with-ic">{c.kind === 'web' ? <Globe size={14} /> : <Smartphone size={14} />}<span className="ellipsis">{c.title}</span></b>
                <div className="muted small">{t('ov.chatLine', { p: c.provider === 'antigravity' ? 'Antigravity' : 'Claude', n: c.totals.runs, cost: f.usd(c.totals.cost), t: f.ago((c.runs.at(-1) || {}).at) || '—' })}</div>
              </div>
              {c.running ? <Badge kind="warn">{t('common.running')}</Badge> : c.totals.errors ? <Badge kind="err">{t('common.errors', { n: c.totals.errors })}</Badge> : <Badge>{t('common.ok')}</Badge>}
            </div>
          ))}
          {chats.data && !all.length && <p className="muted">{t('ov.noChats')}</p>}
        </Card>

        <Card title={t('ov.send')} icon={Send}>
          <form className="stack" onSubmit={(e) => { e.preventDefault(); run('send', () => bridge.sendWhatsApp(to, msg), t('ov.sent')).then((r) => r && setMsg('')); }}>
            <Field label={t('ov.to')} hint={t('ov.toHint')}>
              <input inputMode="tel" list="wa-contacts" value={to} onChange={(e) => setTo(e.target.value)} placeholder="+55 11 99999-8888" />
              <datalist id="wa-contacts">
                {waChats.map((c) => <option key={c.id} value={c.id}>{c.title}</option>)}
              </datalist>
            </Field>
            <Field label={t('ov.message')}><textarea rows={3} value={msg} onChange={(e) => setMsg(e.target.value)} /></Field>
            <Btn icon={Send} disabled={busy === 'send' || !to || !msg.trim()}>{t('ov.sendBtn')}</Btn>
          </form>
        </Card>
      </div>
    </div>
  );
}
