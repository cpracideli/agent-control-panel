import { useState } from 'react';
import { CheckSquare, MessageSquare, Pencil, Play, Plus, Send, Trash2 } from 'lucide-react';
import { bridge } from '../api.js';
import { useT } from '../i18n.jsx';
import { Badge, Btn, Card, ErrorBox, Field, IconButton, Modal, useAction, useConfirm, useFmt, useLoad } from '../ui.jsx';
import { AddButton, HeaderActions, ListGroup, ListRow, useIsMobile } from '../native.jsx';

const STATUSES = ['todo', 'in_progress', 'review', 'blocked', 'done'];
const PRIO_KIND = { low: 'muted', medium: 'ok', high: 'warn', urgent: 'err' };

function TicketForm({ initial, bots, onClose, onSaved }) {
  const t = useT();
  const editing = Boolean(initial?.id);
  const [f, setF] = useState({
    title: '', description: '', status: 'todo', priority: 'medium', bot: '',
    goal: false, doneCriteria: '', checkIntervalMin: 0, nextCheckAt: '', maxRuns: 0,
    ...initial,
    ...(initial?.nextCheckAt ? { nextCheckAt: initial.nextCheckAt.slice(0, 16) } : {}),
  });
  const [busy, run] = useAction();
  const set = (k) => (e) => setF({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });

  const submit = async (e) => {
    e.preventDefault();
    const body = {
      title: f.title.trim(), description: f.description, status: f.status, priority: f.priority, bot: f.bot || '',
      goal: Boolean(f.goal), doneCriteria: f.doneCriteria || '',
      checkIntervalMin: Number(f.checkIntervalMin) || 0,
      maxRuns: Number(f.maxRuns) || 0,
      nextCheckAt: f.nextCheckAt ? new Date(f.nextCheckAt).toISOString() : '',
    };
    const r = editing
      ? await run('save', () => bridge.patchTicket(initial.id, body), t('bd.saved'))
      : await run('save', () => bridge.addTicket(body), t('bd.created'));
    if (r) { onSaved(r); onClose(); }
  };

  return (
    <Modal title={editing ? t('bd.editTitle', { id: initial.id }) : t('bd.newTitle')} onClose={onClose} wide>
      <form className="stack" onSubmit={submit}>
        <Field label={t('mem.title')}><input required autoFocus value={f.title} onChange={set('title')} placeholder={t('bd.titlePh')} maxLength={160} /></Field>
        <div className="form-grid">
          <Field label={t('bd.status')}>
            <select value={f.status} onChange={set('status')}>
              {STATUSES.map((s) => <option key={s} value={s}>{t('bd.st.' + s)}</option>)}
            </select>
          </Field>
          <Field label={t('bd.priority')}>
            <select value={f.priority} onChange={set('priority')}>
              {['low', 'medium', 'high', 'urgent'].map((p) => <option key={p} value={p}>{t('bd.pr.' + p)}</option>)}
            </select>
          </Field>
          <Field label={t('bots.label')}>
            <select value={f.bot} onChange={set('bot')}>
              <option value="">{t('bd.unassigned')}</option>
              {(bots || []).map((b) => <option key={b.id} value={b.id}>{(b.emoji ? b.emoji + ' ' : '') + b.name}</option>)}
            </select>
          </Field>
        </div>
        <Field label={t('bd.desc')}>
          <textarea rows={6} value={f.description} onChange={set('description')} placeholder={t('bd.descPh')} />
        </Field>
        <div className="trigger-box stack">
          <label className="check">
            <input type="checkbox" checked={Boolean(f.goal)} onChange={set('goal')} />
            <span><b>🎯 Objetivo contínuo (Auto-Wake)</b> · O bot acompanha e acorda sozinho até cumprir o critério de conclusão</span>
          </label>
          {f.goal && (
            <div className="form-grid">
              <Field label="Critério de conclusão"><input value={f.doneCriteria || ''} onChange={set('doneCriteria')} placeholder="Ex.: Fatura paga ou PR aprovado" /></Field>
              <Field label="Próximo despertar"><input type="datetime-local" value={f.nextCheckAt || ''} onChange={set('nextCheckAt')} /></Field>
              <Field label="Intervalo padrão (min)" hint="0 = bot decide quando acordar"><input type="number" min={0} max={10080} value={f.checkIntervalMin || 0} onChange={set('checkIntervalMin')} /></Field>
              <Field label="Máx. ciclos" hint="0 = ilimitado"><input type="number" min={0} max={200} value={f.maxRuns || 0} onChange={set('maxRuns')} /></Field>
            </div>
          )}
        </div>
        <div className="row end">
          <button type="button" className="ghost" onClick={onClose}>{t('common.cancel')}</button>
          <button disabled={busy === 'save'}>{t('common.save')}</button>
        </div>
      </form>
    </Modal>
  );
}

function TicketDetail({ ticket, onClose, onEdit, onChanged }) {
  const t = useT();
  const f = useFmt();
  const confirm = useConfirm();
  const [comment, setComment] = useState('');
  const [busy, run] = useAction();

  const postComment = async (e) => {
    e.preventDefault();
    if (!comment.trim()) return;
    const r = await run('cm', () => bridge.commentTicket(ticket.id, comment.trim()));
    if (r) { setComment(''); onChanged(r); }
  };

  return (
    <Modal title={'#' + ticket.id + ' · ' + ticket.title} onClose={onClose} wide>
      <div className="stack">
        <div className="row wrap">
          <select value={ticket.status} onChange={(e) => run('st', () => bridge.patchTicket(ticket.id, { status: e.target.value })).then((r) => r && onChanged(r))}>
            {STATUSES.map((s) => <option key={s} value={s}>{t('bd.st.' + s)}</option>)}
          </select>
          <Badge kind={PRIO_KIND[ticket.priority] || 'muted'}>{t('bd.pr.' + ticket.priority)}</Badge>
          {ticket.botName && <span className="chip">{ticket.botName}</span>}
          {ticket.running && <Badge kind="warn">{t('common.running')}</Badge>}
          <span className="grow" />
          <Btn icon={Play} className="small" disabled={busy === 'run' || ticket.running}
            onClick={() => run('run', () => bridge.runTicket(ticket.id), t('bd.runStarted')).then((r) => r && onChanged(r))}>
            {t('bd.runWithBot')}
          </Btn>
          <IconButton icon={Pencil} label={t('common.edit')} onClick={() => { onClose(); onEdit(ticket); }} />
          <IconButton icon={Trash2} className="ghost danger-text" label={t('common.remove')}
            onClick={async () => (await confirm(t('bd.removeConfirm', { id: ticket.id }))) && run('del', () => bridge.deleteTicket(ticket.id), t('common.removed')).then(() => { onChanged(null); onClose(); })} />
        </div>
        {ticket.description && <div className="ticket-desc">{ticket.description}</div>}

        <div className="stack" style={{ marginTop: 8 }}>
          <b className="small muted">{t('bd.comments', { n: (ticket.comments || []).length })}</b>
          {!(ticket.comments || []).length && <p className="muted small">{t('bd.noComments')}</p>}
          {(ticket.comments || []).map((c) => (
            <div key={c.id} className="ticket-comment">
              <div className="row between small"><b>{c.author}</b><span className="muted">{f.ago(c.at)}</span></div>
              <pre className="history-preview" style={{ marginTop: 4 }}>{c.text}</pre>
            </div>
          ))}
        </div>

        <form className="row" onSubmit={postComment}>
          <input className="grow" value={comment} onChange={(e) => setComment(e.target.value)} placeholder={t('bd.commentPh')} />
          <Btn icon={Send} className="small" type="submit" disabled={busy === 'cm' || !comment.trim()}>{t('prp.send')}</Btn>
        </form>
      </div>
    </Modal>
  );
}

export default function Board() {
  const t = useT();
  const f = useFmt();
  const tickets = useLoad(() => bridge.tickets(), [], { interval: 10000, cacheKey: '/bridge/tickets' });
  const bots = useLoad(() => bridge.bots(), [], { cacheKey: '/bridge/bots' });
  const [form, setForm] = useState(null);
  const [detailId, setDetailId] = useState(null);
  const [busy, run] = useAction();

  const list = tickets.data || [];
  const detail = detailId ? list.find((x) => x.id === detailId) : null;

  const mobile = useIsMobile();
  const runTicket = (tk) => run('run' + tk.id, () => bridge.runTicket(tk.id), t('bd.runStarted')).then(() => tickets.reload(true));
  const modals = (
    <>
      {form && <TicketForm initial={form} bots={bots.data} onClose={() => setForm(null)} onSaved={() => tickets.reload(true)} />}
      {detail && <TicketDetail ticket={detail} onClose={() => setDetailId(null)} onEdit={(tk) => setForm(tk)} onChanged={() => tickets.reload(true)} />}
    </>
  );
  if (mobile) {
    return (
      <div className="page page-list">
        <HeaderActions>
          <AddButton items={[{ icon: Plus, label: t('bd.new'), onClick: () => setForm({}) }]} />
        </HeaderActions>
        <ErrorBox error={tickets.error} onRetry={() => tickets.reload()} />
        {STATUSES.map((st) => {
          const col = list.filter((x) => x.status === st);
          if (!col.length) return null;
          return (
            <ListGroup key={st} title={t('bd.st.' + st) + ' · ' + col.length}>
              {col.map((tk) => (
                <ListRow key={tk.id}
                  leading={<span className={'row-ic ic-board prio-' + tk.priority}>{tk.running ? <span className="spin" /> : <CheckSquare size={18} />}</span>}
                  title={tk.title}
                  badges={<Badge kind={PRIO_KIND[tk.priority] || 'muted'}>{t('bd.pr.' + tk.priority)}</Badge>}
                  subtitle={'#' + tk.id + ' · ' + (tk.botName || t('bd.unassigned')) + ' · ' + f.ago(tk.updated) + ((tk.comments || []).length ? ' · 💬 ' + tk.comments.length : '')}
                  onOpen={() => setDetailId(tk.id)}
                  swipe={[
                    st === 'todo' && tk.bot && !tk.running && { icon: Play, label: t('bd.runWithBot'), kind: 'warn', disabled: busy === 'run' + tk.id, onClick: () => runTicket(tk) },
                    { icon: Pencil, label: t('common.edit'), kind: 'accent', onClick: () => setForm(tk) },
                  ].filter(Boolean)} />
              ))}
            </ListGroup>
          );
        })}
        {tickets.data && !list.length && <p className="muted empty-note">—</p>}
        {modals}
      </div>
    );
  }

  return (
    <div className="page">
      <ErrorBox error={tickets.error} onRetry={() => tickets.reload()} />
      <p className="muted page-intro">{t('bd.intro')}</p>
      <Card title={t('bd.title', { n: list.length })} icon={CheckSquare}
        actions={<Btn icon={Plus} className="small" onClick={() => setForm({})}>{t('bd.new')}</Btn>}>
        <div className="kanban">
          {STATUSES.map((st) => {
            const col = list.filter((x) => x.status === st);
            return (
              <div key={st} className="kanban-col">
                <div className="kanban-head">
                  <b>{t('bd.st.' + st)}</b>
                  <Badge>{col.length}</Badge>
                </div>
                <div className="kanban-items">
                  {!col.length && <div className="muted small" style={{ padding: '12px 4px', textAlign: 'center' }}>—</div>}
                  {col.map((tk) => (
                    <div key={tk.id} className="kanban-card press" onClick={() => setDetailId(tk.id)}>
                      <div className="row between" style={{ gap: 6 }}>
                        <span className="mono muted small">#{tk.id}{tk.goal ? ' 🎯' : ''}</span>
                        <Badge kind={PRIO_KIND[tk.priority] || 'muted'}>{t('bd.pr.' + tk.priority)}</Badge>
                      </div>
                      <b className="kanban-title">{tk.title}</b>
                      {tk.goal && tk.nextCheckAt && <div className="muted small">⏰ {f.date(tk.nextCheckAt)}</div>}
                      {tk.description && <div className="muted small ellipsis-2">{tk.description}</div>}
                      <div className="row between wrap" style={{ marginTop: 6 }}>
                        <span className="muted small">{tk.botName || t('bd.unassigned')}</span>
                        <div className="row" style={{ gap: 6 }}>
                          {tk.running && <span className="spin" />}
                          {(tk.comments || []).length > 0 && <span className="muted small row" style={{ gap: 3 }}><MessageSquare size={12} />{tk.comments.length}</span>}
                          <span className="muted small">{f.ago(tk.updated)}</span>
                        </div>
                      </div>
                      {st === 'todo' && tk.bot && !tk.running && (
                        <div style={{ marginTop: 6 }} onClick={(e) => e.stopPropagation()}>
                          <Btn icon={Play} className="ghost small block" disabled={busy === 'run' + tk.id}
                            onClick={() => run('run' + tk.id, () => bridge.runTicket(tk.id), t('bd.runStarted')).then(() => tickets.reload(true))}>
                            {t('bd.runWithBot')}
                          </Btn>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </Card>
      {modals}
    </div>
  );
}
