import { useState } from 'react';
import { Activity, Box, Brain, Cpu, DollarSign, Globe, MessageCircle, Play, RefreshCw, Rocket, Send, Smartphone, Square } from 'lucide-react';
import { bridge, coolify } from '../api.js';
import { useT } from '../i18n.jsx';
import { Badge, Btn, Card, ErrorBox, Field, useAction, useConfirm, useFmt, useLoad, useMore } from '../ui.jsx';
import { ListGroup, ListRow, Row, useIsMobile } from '../native.jsx';
import { ProvMark } from '../ProvIcon.jsx';

const statusKind = (s) => (String(s).startsWith('running') ? 'ok' : /exit|stop/.test(String(s)) ? 'err' : 'warn');
const Stat = ({ icon: Icon, label, value, sub }) => (
  <div className="stat"><small><Icon size={14} />{label}</small><b>{value}</b>{sub && <small>{sub}</small>}</div>
);

export default function Overview() {
  const t = useT();
  const f = useFmt();
  const confirm = useConfirm();
  const app = useLoad(() => coolify.status(), [], { interval: 20000, cacheKey: '/coolify/status' });
  const ov = useLoad(() => bridge.overview(), [], { interval: 10000, cacheKey: '/bridge/overview' });
  const chats = useLoad(() => bridge.chats(), [], { interval: 20000, cacheKey: '/bridge/chats' });
  const [busy, run] = useAction();
  const [to, setTo] = useState('');
  const [msg, setMsg] = useState('');
  const mobile = useIsMobile();

  const all = chats.data || [];
  const [vis_all, moreBtn_all] = useMore(all);
  const waChats = all.filter((c) => c.kind === 'whatsapp');
  const tot = all.reduce((a, c) => ({ runs: a.runs + c.totals.runs, cost: a.cost + c.totals.cost, ms: a.ms + c.totals.ms, errors: a.errors + c.totals.errors }), { runs: 0, cost: 0, ms: 0, errors: 0 });
  const o = ov.data;

  const sendForm = (
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
  );
  const restart = async () => (await confirm(t('ov.restartConfirm'))) && run('restart', coolify.restart, t('ov.restartOk'));
  const redeploy = async () => (await confirm(t('ov.deployConfirm'))) && run('deploy', coolify.deploy, t('ov.deployOk'));
  const stopRun = (r) => run(r.chatId, () => bridge.stopChat(r.chatId), t('common.stopped')).then(() => ov.reload(true));

  if (mobile) {
    return (
      <div className="page page-list">
        <ErrorBox error={ov.error && 'Bridge: ' + ov.error} onRetry={() => ov.reload()} />
        <ErrorBox error={app.error && 'Coolify: ' + app.error} onRetry={() => app.reload()} />
        <ListGroup title={t('ov.status')}>
          <Row icon={Box} tint="ic-overview" label={t('ov.container')} value={<Badge kind={statusKind(app.data?.status)}>{app.data?.status || '…'}</Badge>} />
          <Row icon={Cpu} tint="ic-mcp" label={t('ov.bridge')} sub={o && t('ov.upFor', { t: f.dur(o.uptime * 1000) })} value={<b>{o ? 'v' + o.version.slice(0, 7) : ov.error ? t('ov.offline') : '…'}</b>} />
          <Row icon={Brain} tint="ic-memory" label="ai-memory" value={<Badge kind={o?.aiMemory.status === 'ok' ? 'ok' : 'warn'}>{o?.aiMemory.status || '…'}</Badge>} />
        </ListGroup>
        <ListGroup title={t('ov.totals')}>
          <div className="dash-tiles">
            <div className="dash-tile"><small className="with-ic"><Activity size={13} />{t('ov.runs')}</small><b>{tot.runs}</b><small>{t('ov.withErrors', { n: tot.errors })}</small></div>
            <div className="dash-tile"><small className="with-ic"><DollarSign size={13} />{t('ov.cost')}</small><b>{f.usd(tot.cost)}</b><small>{t('ov.work', { t: f.dur(tot.ms) })}</small></div>
          </div>
        </ListGroup>
        <ListGroup title={t('ov.running') + (o ? ' · ' + o.running.length : '')}>
          {o && !o.running.length && <Row icon={Play} tint="ic-plain" label={<span className="muted">{t('ov.nothing')}</span>} />}
          {o?.running.map((r) => (
            <Row key={r.chatId} icon={Play} tint="ic-schedules" label={r.chatId.startsWith('web:') ? 'Web' : r.chatId.split('@')[0]}
              sub={'"' + r.prompt + '" · ' + t('ov.ago', { t: f.ago(r.started) })}
              value={<Btn icon={Square} className="danger small" disabled={busy === r.chatId} onClick={() => stopRun(r)}>{t('common.stop')}</Btn>} />
          ))}
        </ListGroup>
        <ListGroup title={t('ov.actions')} footer={t('ov.envNote')}>
          <Row icon={Rocket} tint="ic-plain" label={t('ov.repo')} sub={(app.data?.git_repository || '…') + '@' + (app.data?.git_branch || '')} />
          <Row icon={RefreshCw} tint="ic-schedules" label={t('ov.restart')} kind="accent" disabled={!!busy} onClick={restart} />
          <Row icon={Rocket} tint="ic-plain" label={t('ov.redeploy')} kind="accent" disabled={!!busy} onClick={redeploy} />
        </ListGroup>
        <ListGroup title={t('ov.chats') + ' · ' + all.length}>
          {chats.data && !all.length && <Row label={<span className="muted">{t('ov.noChats')}</span>} />}
          {vis_all.map((c) => (
            <ListRow key={c.id} leading={<span className={'row-ic ' + (c.kind === 'web' ? 'ic-chat' : 'ic-install')}>{c.kind === 'web' ? <Globe size={17} /> : <Smartphone size={17} />}</span>}
              title={c.title}
              badges={c.running ? <Badge kind="warn">{t('common.running')}</Badge> : c.totals.errors ? <Badge kind="err">{t('common.errors', { n: c.totals.errors })}</Badge> : null}
              subtitle={<span className="with-ic"><ProvMark id={c.provider} size={13} />{' · ' + t('ov.chatLine', { p: '', n: c.totals.runs, cost: f.usd(c.totals.cost), t: f.ago((c.runs.at(-1) || {}).at) || '—' }).replace(/^\s*·\s*/, '')}</span>}
              onOpen={c.kind === 'web' ? () => { window.location.hash = '#/chat/' + c.id.slice(4); } : undefined} />
          ))}
{moreBtn_all}
        </ListGroup>
        <ListGroup title={t('ov.send')}><div className="group-form">{sendForm}</div></ListGroup>
      </div>
    );
  }

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
          {vis_all.map((c) => (
            <div key={c.id} className={'list-row' + (c.kind === 'web' ? ' clickable' : '')} onClick={c.kind === 'web' ? () => { window.location.hash = '#/chat/' + c.id.slice(4); } : undefined}>
              <div className="grow">
                <b className="with-ic">{c.kind === 'web' ? <Globe size={14} /> : <Smartphone size={14} />}<span className="ellipsis">{c.title}</span></b>
                <div className="muted small"><span className="with-ic"><ProvMark id={c.provider} size={13} />{' · ' + t('ov.chatLine', { p: '', n: c.totals.runs, cost: f.usd(c.totals.cost), t: f.ago((c.runs.at(-1) || {}).at) || '—' }).replace(/^\s*·\s*/, '')}</span></div>
              </div>
              {c.running ? <Badge kind="warn">{t('common.running')}</Badge> : c.totals.errors ? <Badge kind="err">{t('common.errors', { n: c.totals.errors })}</Badge> : <Badge>{t('common.ok')}</Badge>}
            </div>
          ))}
{moreBtn_all}
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
