import { useState } from 'react';
import { CalendarClock, Globe, Pause, Pencil, Play, Plus, Smartphone, Trash2, Zap } from 'lucide-react';
import { bridge } from '../api.js';
import { useT } from '../i18n.jsx';
import { Badge, Btn, Card, ErrorBox, Field, IconButton, Modal, useAction, useConfirm, useFmt, useLoad } from '../ui.jsx';

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

function ScheduleForm({ initial, chats, onClose, onSaved }) {
  const t = useT();
  const fmt = useFmt();
  const editing = Boolean(initial?.id);
  const [f, setF] = useState({ chatId: chats[0]?.id || '', kind: 'cron', cron: '0 8 * * *', at: '', description: '', prompt: '', ...initial, ...(initial?.at ? { kind: 'at', at: toLocalInput(initial.at) } : {}) });
  const [busy, run] = useAction();
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const nextAt = f.kind === 'cron' ? nextCronRun(f.cron) : null;
  const submit = async (e) => {
    e.preventDefault();
    const r = editing
      ? await run('save', () => bridge.patchSchedule(f.id, { description: f.description, prompt: f.prompt, ...(f.kind === 'cron' ? { cron: f.cron } : {}) }), t('sch.saved'))
      : await run('save', () => bridge.addSchedule({ chatId: f.chatId, description: f.description, prompt: f.prompt, ...(f.kind === 'cron' ? { cron: f.cron } : { at: new Date(f.at).toISOString() }) }), t('sch.created'));
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
          <Field label={t('sch.when')}>
            <select value={f.kind} onChange={set('kind')} disabled={editing}><option value="cron">{t('sch.cron')}</option><option value="at">{t('sch.onceOpt')}</option></select>
          </Field>
          {f.kind === 'cron'
            ? <Field label="Cron" hint={nextAt ? t('sch.nextRun', { d: fmt.date(nextAt) }) : t('sch.cronInvalid')}><input className="mono" required value={f.cron} onChange={set('cron')} /></Field>
            : <Field label={t('sch.datetime')}><input type="datetime-local" required value={f.at} onChange={set('at')} disabled={editing} /></Field>}
        </div>
        {f.kind === 'cron' && <div className="presets">{CRON_HELP.map(([c, k]) => <button type="button" key={c} className="ghost small" onClick={() => setF({ ...f, cron: c })}>{t('sch.c.' + k)}</button>)}</div>}
        <Field label={t('sch.description')}><input required value={f.description} onChange={set('description')} placeholder={t('sch.descPh')} /></Field>
        <Field label={t('sch.prompt')} hint={t('sch.promptHint')}><textarea required rows={5} value={f.prompt} onChange={set('prompt')} /></Field>
        <div className="row end"><button type="button" className="ghost" onClick={onClose}>{t('common.cancel')}</button><button disabled={busy === 'save'}>{t('common.save')}</button></div>
      </form>
    </Modal>
  );
}

export default function Schedules() {
  const t = useT();
  const f = useFmt();
  const confirm = useConfirm();
  const sch = useLoad(() => bridge.schedules(), [], { interval: 30000 });
  const chats = useLoad(() => bridge.chats(), []);
  const [form, setForm] = useState(null);
  const [filter, setFilter] = useState('all');
  const [busy, run] = useAction();
  const list = (sch.data || []).filter((s) => filter === 'all' || (filter === 'paused' ? s.paused : !s.paused));
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
                <div className="row wrap"><b>#{s.id} · {s.description}</b>{s.paused && <Badge kind="warn">{t('sch.paused')}</Badge>}</div>
                <div className="muted small with-ic">
                  <span className="mono">{s.cron ? s.cron : t('sch.once', { d: f.date(s.at) })}</span> · <ChatIc id={s.chatId} />{s.chatTitle}
                  {nextAt && ' · ' + t('sch.nextRun', { d: f.date(nextAt) })}
                  {s.lastRun && ' · ' + t('sch.last', { d: f.date(s.lastRun) })}
                </div>
              </div>
              <div className="row">
                <IconButton icon={Zap} label={t('sch.runNow')} disabled={busy === 'run' + s.id} onClick={() => run('run' + s.id, () => bridge.runSchedule(s.id), t('sch.running'))} />
                <IconButton icon={s.paused ? Play : Pause} label={s.paused ? t('sch.resume') : t('sch.pause')} onClick={() => run('p' + s.id, () => bridge.patchSchedule(s.id, { paused: !s.paused })).then(() => sch.reload(true))} />
                <IconButton icon={Pencil} label={t('common.edit')} onClick={() => setForm(s)} />
                <IconButton icon={Trash2} className="ghost danger-text" label={t('common.remove')} onClick={async () => (await confirm(t('sch.removeConfirm', { id: s.id }))) && run('d' + s.id, () => bridge.deleteSchedule(s.id), t('common.removed')).then(() => sch.reload(true))} />
              </div>
            </div>
          );
        })}
      </Card>
      {form && <ScheduleForm initial={form} chats={chats.data || []} onClose={() => setForm(null)} onSaved={() => sch.reload(true)} />}
    </div>
  );
}
