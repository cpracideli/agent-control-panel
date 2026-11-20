import { useState } from 'react';
import { CalendarClock, Eye, Globe, History, Link2, Pause, Pencil, Play, Plus, RefreshCw, Smartphone, Trash2, Webhook, Zap } from 'lucide-react';
import { bridge } from '../api.js';
import { useT } from '../i18n.jsx';
import { Badge, Btn, Card, ErrorBox, Field, IconButton, Modal, useAction, useConfirm, useFmt, useLoad, useToast } from '../ui.jsx';
import { AddButton, DetailSheet, HeaderActions, ListGroup, ListRow, useIsMobile } from '../native.jsx';

const hookUrl = (s) => window.location.origin + '/hooks/' + s.id + '/' + s.hookToken;
const STATUS_KIND = { ok: 'ok', quiet: 'muted', error: 'err', running: 'warn', queued: 'warn', stopped: 'warn' };

const CRON_HELP = [['0 8 * * *', 'daily'], ['0 9 * * 1-5', 'weekdays'], ['*/30 * * * *', '30'], ['0 18 * * 5', 'fri']];
const ChatIc = ({ id }) => (id.startsWith('web:') ? <Globe size={13} /> : <Smartphone size={13} />);

function matchField(expr, val, min, max) {
  for (const part of expr.split(',')) {
    const [range, stepStr] = part.split('/');
    const step = stepStr ? Number(stepStr) : 1;
    if (!step || step < 1) return false;
    if (range === '*') { if ((val - min) % step === 0) return true; continue; }
    const [aStr, bStr] = range.split('-');
    const a = Number(aStr), b = bStr !== undefined ? Number(bStr) : a;
    if (Number.isNaN(a) || Number.isNaN(b) || a < min || b > max) return false;
    if (val >= a && val <= b && (val - a) % step === 0) return true;
  }
  return false;
}

function nextCronRun(expr) {
  const parts = String(expr || '').trim().split(/\s+/);
  if (parts.length !== 5) return null;
  const [m, h, dom, mon, dow] = parts;
  const d = new Date();
  d.setSeconds(0, 0);
  d.setMinutes(d.getMinutes() + 1);
  for (let i = 0; i < 44640; i++) {
    if (matchField(m, d.getMinutes(), 0, 59) && matchField(h, d.getHours(), 0, 23)
      && matchField(dom, d.getDate(), 1, 31) && matchField(mon, d.getMonth() + 1, 1, 12)
      && matchField(dow, d.getDay(), 0, 7)) {
      return d.toISOString();
    }
    d.setMinutes(d.getMinutes() + 1);
  }
  return null;
}

function toLocalInput(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function ScheduleForm({ initial, chats, bots, onClose, onSaved }) {
  const t = useT();
  const fmt = useFmt();
  const toast = useToast();
  const editing = Boolean(initial?.id);
  const [f, setF] = useState(() => ({ chatId: chats[0]?.id || '', kind: 'cron', cron: '0 8 * * *', at: '', description: '', prompt: '', bot: '', webhook: false, quiet: false,
    watchOn: false, watchCommand: '', watchEvery: 30, ...initial,
    ...(initial?.id ? { kind: initial.cron ? 'cron' : initial.at ? 'at' : 'none', at: toLocalInput(initial.at), cron: initial.cron || '0 8 * * *', bot: initial.bot || '',
      webhook: Boolean(initial.webhook), quiet: Boolean(initial.quiet), watchOn: Boolean(initial.watch), watchCommand: initial.watch?.command || '', watchEvery: initial.watch?.every || 30 } : {}) }));
  const [busy, run] = useAction();
  const set = (k) => (e) => setF({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });
  const nextAt = f.kind === 'cron' ? nextCronRun(f.cron) : null;
  const chatBot = (chats.find((c) => c.id === f.chatId) || {}).bot;
  const botName = (id) => { const b = bots.find((x) => x.id === id); return b ? (b.emoji ? b.emoji + ' ' : '') + b.name : id; };
  const submit = async (e) => {
    e.preventDefault();
    if (f.kind === 'none' && !f.webhook && !f.watchOn) return toast(t('sch.needTrigger'), 'err');
    const body = { description: f.description, prompt: f.prompt, bot: f.bot || '', webhook: f.webhook, quiet: f.quiet,
      watch: f.watchOn ? { command: f.watchCommand, every: Number(f.watchEvery) } : null,
      ...(f.kind === 'cron' ? { cron: f.cron } : f.kind === 'at' ? { at: new Date(f.at).toISOString() } : editing ? { cron: '', at: '' } : {}) };
    const r = editing
      ? await run('save', () => bridge.patchSchedule(f.id, body), t('sch.saved'))
      : await run('save', () => bridge.addSchedule({ chatId: f.chatId, ...body }), t('sch.created'));
    if (r) { onSaved(); onClose(); }
  };
  return (
    <Modal title={editing ? t('sch.editTitle', { id: f.id }) : t('sch.newTitle')} onClose={onClose} wide>
      <form className="stack" onSubmit={submit}>
        <div className="form-grid">
          <Field label={t('sch.deliver')} hint={t('sch.deliverHint')}>
            <select value={f.chatId} onChange={set('chatId')} disabled={editing}>
              {chats.map((c) => <option key={c.id} value={c.id}>{c.kind === 'web' ? 'Web · ' : 'WhatsApp · '}{c.title}</option>)}
            </select>
          </Field>
          <Field label={t('sch.bot')} hint={t('sch.botHint')}>
            <select value={f.bot} onChange={set('bot')}>
              <option value="">{t('sch.chatBot', { n: botName(chatBot || 'default') })}</option>
              {bots.map((b) => <option key={b.id} value={b.id}>{botName(b.id)}</option>)}
            </select>
          </Field>
          <Field label={t('sch.when')}>
            <select value={f.kind} onChange={set('kind')}><option value="cron">{t('sch.cron')}</option><option value="at">{t('sch.onceOpt')}</option><option value="none">{t('sch.noTime')}</option></select>
          </Field>
          {f.kind === 'cron' && <Field label="Cron" hint={nextAt ? t('sch.nextRun', { d: fmt.date(nextAt) }) : t('sch.cronInvalid')}><input className="mono" required value={f.cron} onChange={set('cron')} /></Field>}
          {f.kind === 'at' && <Field label={t('sch.datetime')}><input type="datetime-local" required value={f.at} onChange={set('at')} /></Field>}
        </div>
        {f.kind === 'cron' && <div className="presets">{CRON_HELP.map(([c, k]) => <button type="button" key={c} className="ghost small" onClick={() => setF({ ...f, cron: c })}>{t('sch.c.' + k)}</button>)}</div>}
        <div className="trigger-box stack">
          <label className="check"><input type="checkbox" checked={f.webhook} onChange={set('webhook')} /><Webhook size={15} /><span><b>{t('sch.webhook')}</b> · {t('sch.webhookHint')}</span></label>
          {editing && f.webhook && initial.hookToken && (
            <div className="row wrap hook-url">
              <code className="mono grow ellipsis">{hookUrl(initial)}</code>
              <Btn icon={Link2} type="button" className="ghost small" onClick={() => { navigator.clipboard.writeText(hookUrl(initial)); toast(t('common.copied')); }}>{t('common.copy')}</Btn>
              <Btn icon={RefreshCw} type="button" className="ghost small" onClick={async () => { const r = await run('tok', () => bridge.patchSchedule(f.id, { newToken: true }), t('sch.newToken')); if (r) { onSaved(); onClose(); } }}>{t('sch.newTokenBtn')}</Btn>
            </div>
          )}
          <label className="check"><input type="checkbox" checked={f.watchOn} onChange={set('watchOn')} /><Eye size={15} /><span><b>{t('sch.watch')}</b> · {t('sch.watchHint')}</span></label>
          {f.watchOn && (
            <div className="stack">
              <div className="presets">
                <button type="button" className="ghost small" onClick={() => setF({ ...f, watchCommand: '~/bin/gmail.py list --unread --limit 5', watchEvery: 15, quiet: true })}>{t('sch.presetEmail')}</button>
                <button type="button" className="ghost small" onClick={() => setF({ ...f, watchCommand: 'ls -lt /home/node/workspace/inbox | head -n 10', watchEvery: 10, quiet: true })}>{t('sch.presetFolder')}</button>
              </div>
              <div className="form-grid">
                <Field label={t('sch.watchCommand')} hint={t('sch.watchCommandHint')}><input className="mono" required value={f.watchCommand} onChange={set('watchCommand')} placeholder="curl -s https://exemplo.com/status | jq .versao" /></Field>
                <Field label={t('sch.watchEvery')}><input type="number" min={5} max={1440} required value={f.watchEvery} onChange={set('watchEvery')} /></Field>
              </div>
            </div>
          )}
          {editing && initial.watchError && <p className="err small">{t('sch.watchError', { e: initial.watchError })}</p>}
          <label className="check"><input type="checkbox" checked={f.quiet} onChange={set('quiet')} /><span><b>{t('sch.quiet')}</b> · {t('sch.quietHint')}</span></label>
        </div>
        <Field label={t('sch.description')}><input required value={f.description} onChange={set('description')} placeholder={t('sch.descPh')} /></Field>
        <Field label={t('sch.prompt')} hint={t('sch.promptHint')}><textarea required rows={5} value={f.prompt} onChange={set('prompt')} /></Field>
        <div className="row end"><button type="button" className="ghost" onClick={onClose}>{t('common.cancel')}</button><button disabled={busy === 'save'}>{t('common.save')}</button></div>
      </form>
    </Modal>
  );
}

function RunsModal({ sch, onClose }) {
  const t = useT();
  const f = useFmt();
  const runs = useLoad(() => bridge.scheduleRuns(sch.id), [sch.id], { interval: 5000 });
  return (
    <Modal title={t('sch.runsTitle', { id: sch.id, d: sch.description })} onClose={onClose} wide>
      <ErrorBox error={runs.error} onRetry={() => runs.reload()} />
      {runs.data && !runs.data.length && <p className="muted">{t('sch.runsNone')}</p>}
      {(runs.data || []).map((r) => (
        <details key={r.id} className="run-row">
          <summary className="row wrap">
            <Badge kind={STATUS_KIND[r.status] || 'muted'}>{t('sch.st.' + r.status)}</Badge>
            <b>{f.date(r.at)}</b>
            <span className="muted small">{t('sch.tr.' + r.trigger)}{r.ms ? ' · ' + f.dur(r.ms) : ''}{r.cost ? ' · ' + f.usd(r.cost) : ''}</span>
          </summary>
          {r.text ? <pre className="history-preview">{r.text}</pre> : <p className="muted small">{t('common.empty')}</p>}
        </details>
      ))}
    </Modal>
  );
}

export default function Schedules() {
  const t = useT();
  const f = useFmt();
  const confirm = useConfirm();
  const sch = useLoad(() => bridge.schedules(), [], { interval: 30000, cacheKey: '/bridge/schedules' });
  const chats = useLoad(() => bridge.chats(), [], { cacheKey: '/bridge/chats' });
  const bots = useLoad(() => bridge.bots(), [], { cacheKey: '/bridge/bots' });
  const toast = useToast();
  const [form, setForm] = useState(null);
  const [runsOf, setRunsOf] = useState(null);
  const [filter, setFilter] = useState('all');
  const [busy, run] = useAction();
  const list = (sch.data || []).filter((s) => filter === 'all' || (filter === 'paused' ? s.paused : !s.paused));
  const mobile = useIsMobile();
  const [detail, setDetail] = useState(null);
  const removeSch = async (s) => (await confirm(t('sch.removeConfirm', { id: s.id }))) && run('d' + s.id, () => bridge.deleteSchedule(s.id), t('common.removed')).then(() => sch.reload(true));
  const togglePause = (s) => run('p' + s.id, () => bridge.patchSchedule(s.id, { paused: !s.paused })).then(() => sch.reload(true));
  const modals = (
    <>
      {form && <ScheduleForm initial={form} chats={chats.data || []} bots={bots.data || []} onClose={() => setForm(null)} onSaved={() => sch.reload(true)} />}
      {runsOf && <RunsModal sch={runsOf} onClose={() => { setRunsOf(null); sch.reload(true); }} />}
    </>
  );
  const filterSeg = (
    <div className="seg">
      {[['all', 'sch.filterAll'], ['active', 'sch.filterActive'], ['paused', 'sch.filterPaused']].map(([k, lk]) => (
        <button key={k} type="button" className={filter === k ? 'on' : ''} onClick={() => setFilter(k)}>{t(lk)}</button>
      ))}
    </div>
  );

  if (mobile) {
    const sel = (sch.data || []).find((s) => s.id === detail);
    const when = (s) => (s.cron ? s.cron : s.at ? t('sch.once', { d: f.date(s.at) }) : s.webhook ? 'webhook' : s.watch ? t('sch.watchBadge', { n: s.watch.every }) : '');
    return (
      <div className="page page-list">
        <HeaderActions>
          <AddButton items={[{ icon: Plus, label: t('sch.new'), disabled: !chats.data?.length, onClick: () => setForm({}) }]} />
        </HeaderActions>
        <ErrorBox error={sch.error} onRetry={() => sch.reload()} />
        <div className="list-toolbar seg-full">{filterSeg}</div>
        {sch.data && !list.length && <p className="muted empty-note">{t('sch.none')}</p>}
        {list.length > 0 && (
          <ListGroup>
            {list.map((s) => {
              const nextAt = !s.paused && s.cron ? nextCronRun(s.cron) : null;
              return (
                <ListRow key={s.id}
                  leading={<span className={'row-ic ' + (s.paused ? 'ic-paused' : 'ic-schedules')}>{s.paused ? <Pause size={18} /> : <CalendarClock size={18} />}</span>}
                  title={s.description || '#' + s.id}
                  badges={<>{s.paused && <Badge kind="warn">{t('sch.paused')}</Badge>}{s.lastRunInfo && s.lastRunInfo.status !== 'ok' && <Badge kind={STATUS_KIND[s.lastRunInfo.status] || 'muted'}>{t('sch.st.' + s.lastRunInfo.status)}</Badge>}</>}
                  subtitle={<><span className="mono">{when(s)}</span>{nextAt ? ' · ' + t('sch.nextRun', { d: f.date(nextAt) }) : ''}{s.botName ? ' · ' + s.botName : ''}</>}
                  onOpen={() => setDetail(s.id)}
                  swipe={[
                    { icon: s.paused ? Play : Pause, label: s.paused ? t('sch.resume') : t('sch.pause'), kind: 'warn', onClick: () => togglePause(s) },
                    { icon: Pencil, label: t('common.edit'), kind: 'accent', onClick: () => setForm(s) },
                    { icon: Trash2, label: t('common.remove'), kind: 'danger', onClick: () => removeSch(s) },
                  ]} />
              );
            })}
          </ListGroup>
        )}
        {sel && (
          <DetailSheet title={'#' + sel.id} onClose={() => setDetail(null)}
            header={<>
              <span className={'row-ic detail-ic ' + (sel.paused ? 'ic-paused' : 'ic-schedules')}>{sel.paused ? <Pause size={30} /> : <CalendarClock size={30} />}</span>
              <h2>{sel.description || '#' + sel.id}</h2>
              <div className="row wrap center">
                {sel.paused && <Badge kind="warn">{t('sch.paused')}</Badge>}
                {sel.webhook && <Badge kind="muted">webhook</Badge>}{sel.watch && <Badge kind="muted">{t('sch.watchBadge', { n: sel.watch.every })}</Badge>}
                {sel.quiet && <Badge kind="muted">{t('sch.quietBadge')}</Badge>}
                {sel.lastRunInfo && <Badge kind={STATUS_KIND[sel.lastRunInfo.status] || 'muted'}>{t('sch.st.' + sel.lastRunInfo.status)}</Badge>}
              </div>
              <div className="detail-lines muted">
                {(sel.cron || sel.at) && <span className="mono">{sel.cron ? sel.cron : t('sch.once', { d: f.date(sel.at) })}</span>}
                <span className="with-ic center-ic"><ChatIc id={sel.chatId} />{sel.chatTitle}{sel.botName && ' · ' + sel.botName}</span>
                {!sel.paused && sel.cron && nextCronRun(sel.cron) && <span>{t('sch.nextRun', { d: f.date(nextCronRun(sel.cron)) })}</span>}
                {sel.lastRun && <span>{t('sch.last', { d: f.date(sel.lastRun) })}</span>}
              </div>
            </>}
            actions={[
              { icon: Zap, label: t('sch.runNow'), kind: 'primary', disabled: busy === 'run' + sel.id, onClick: () => run('run' + sel.id, () => bridge.runSchedule(sel.id), t('sch.running')) },
              { icon: sel.paused ? Play : Pause, label: sel.paused ? t('sch.resume') : t('sch.pause'), onClick: () => togglePause(sel) },
              { icon: History, label: t('sch.runs'), onClick: () => setRunsOf(sel) },
              sel.webhook && { icon: Link2, label: t('sch.copyHook'), onClick: () => { navigator.clipboard.writeText(hookUrl(sel)); toast(t('common.copied')); } },
              { icon: Pencil, label: t('common.edit'), onClick: () => setForm(sel) },
              { icon: Trash2, label: t('common.remove'), kind: 'danger', onClick: () => removeSch(sel) },
            ]} />
        )}
        {modals}
      </div>
    );
  }

  return (
    <div className="page">
      <ErrorBox error={sch.error} onRetry={() => sch.reload()} />
      <Card title={t('sch.title', { n: list.length })} icon={CalendarClock} actions={<>
        <div className="seg">
          {[['all', 'sch.filterAll'], ['active', 'sch.filterActive'], ['paused', 'sch.filterPaused']].map(([k, lk]) => (
            <button key={k} type="button" className={filter === k ? 'on' : ''} onClick={() => setFilter(k)}>{t(lk)}</button>
          ))}
        </div>
        <Btn icon={Plus} className="small" disabled={!chats.data?.length} onClick={() => setForm({})}>{t('sch.new')}</Btn>
      </>}>
        {sch.data && !list.length && <p className="muted">{t('sch.none')}</p>}
        {list.map((s) => {
          const nextAt = !s.paused && s.cron ? nextCronRun(s.cron) : null;
          return (
            <div key={s.id} className="list-row wrap">
              <div className="grow">
                <div className="row wrap"><b>#{s.id} · {s.description}</b>{s.paused && <Badge kind="warn">{t('sch.paused')}</Badge>}
                  {s.webhook && <Badge kind="muted">webhook</Badge>}{s.watch && <Badge kind="muted">{t('sch.watchBadge', { n: s.watch.every })}</Badge>}
                  {s.quiet && <Badge kind="muted">{t('sch.quietBadge')}</Badge>}
                  {s.lastRunInfo && <Badge kind={STATUS_KIND[s.lastRunInfo.status] || 'muted'}>{t('sch.st.' + s.lastRunInfo.status)}</Badge>}</div>
                <div className="muted small with-ic">
                  {(s.cron || s.at) && <><span className="mono">{s.cron ? s.cron : t('sch.once', { d: f.date(s.at) })}</span> · </>}<ChatIc id={s.chatId} />{s.chatTitle}{s.botName && ' · ' + s.botName}
                  {nextAt && ' · ' + t('sch.nextRun', { d: f.date(nextAt) })}
                  {s.lastRun && ' · ' + t('sch.last', { d: f.date(s.lastRun) })}
                </div>
              </div>
              <div className="row">
                {s.webhook && <IconButton icon={Link2} label={t('sch.copyHook')} onClick={() => { navigator.clipboard.writeText(hookUrl(s)); toast(t('common.copied')); }} />}
                <IconButton icon={History} label={t('sch.runs')} onClick={() => setRunsOf(s)} />
                <IconButton icon={Zap} label={t('sch.runNow')} disabled={busy === 'run' + s.id} onClick={() => run('run' + s.id, () => bridge.runSchedule(s.id), t('sch.running'))} />
                <IconButton icon={s.paused ? Play : Pause} label={s.paused ? t('sch.resume') : t('sch.pause')} onClick={() => run('p' + s.id, () => bridge.patchSchedule(s.id, { paused: !s.paused })).then(() => sch.reload(true))} />
                <IconButton icon={Pencil} label={t('common.edit')} onClick={() => setForm(s)} />
                <IconButton icon={Trash2} className="ghost danger-text" label={t('common.remove')} onClick={async () => (await confirm(t('sch.removeConfirm', { id: s.id }))) && run('d' + s.id, () => bridge.deleteSchedule(s.id), t('common.removed')).then(() => sch.reload(true))} />
              </div>
            </div>
          );
        })}
      </Card>
      {modals}
    </div>
  );
}
