import { useEffect, useState } from 'react';
import { AlertTriangle, Bot, CheckCircle2, CheckSquare, Circle, Clock, ExternalLink, Eye, MessageSquare, Pencil, Play, Plus, RotateCcw, Send, Settings2, Trash2 } from 'lucide-react';
import { bridge } from '../api.js';
import { useT } from '../i18n.jsx';
import { Badge, Btn, Card, ErrorBox, Field, IconButton, Modal, useAction, useConfirm, useFmt, useLoad, useToast } from '../ui.jsx';
import { AddButton, HeaderActions, ListGroup, ListRow, useIsMobile } from '../native.jsx';
import { BotSelect, BotAvatar } from './Bots.jsx';

const STATUSES = ['todo', 'in_progress', 'review', 'blocked', 'done'];
const PRIO_KIND = { low: 'muted', medium: 'ok', high: 'warn', urgent: 'err' };
const STATUS_META = {
  todo: { icon: Circle, cls: 'st-todo' },
  in_progress: { icon: Clock, cls: 'st-prog' },
  review: { icon: Eye, cls: 'st-rev' },
  blocked: { icon: AlertTriangle, cls: 'st-blk' },
  done: { icon: CheckCircle2, cls: 'st-done' },
};

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
          <Field label={t('bots.label')}><BotSelect bots={bots || []} value={f.bot} onChange={(bot) => setF((cur) => ({ ...cur, bot }))} label={t('bots.label')} emptyLabel={t('bd.unassigned')} /></Field>
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

function BoardRunnerModal({ runner, bots, onClose, onSaved }) {
  const t = useT();
  const [f, setF] = useState({
    enabled: Boolean(runner?.enabled),
    intervalMin: runner?.intervalMin ?? 10,
    defaultBot: runner?.defaultBot || 'default',
    maxConcurrent: runner?.maxConcurrent ?? 1,
    respectQuietHours: runner?.respectQuietHours !== false,
    onlyAssigned: Boolean(runner?.onlyAssigned),
  });
  const [busy, run] = useAction();
  const submit = async (e) => {
    e.preventDefault();
    const r = await run('save', () => bridge.saveTicketRunner({
      enabled: Boolean(f.enabled),
      intervalMin: Math.min(1440, Math.max(1, Number(f.intervalMin) || 10)),
      defaultBot: f.defaultBot || 'default',
      maxConcurrent: Math.min(5, Math.max(1, Number(f.maxConcurrent) || 1)),
      respectQuietHours: Boolean(f.respectQuietHours),
      onlyAssigned: Boolean(f.onlyAssigned),
    }), t('bd.runnerSaved'));
    if (r) { onSaved(r); onClose(); }
  };
  return (
    <Modal title={t('bd.runnerConfigTitle')} onClose={onClose}>
      <form className="stack" onSubmit={submit}>
        <label className="check">
          <input type="checkbox" checked={f.enabled} onChange={(e) => setF({ ...f, enabled: e.target.checked })} />
          <span><b>{t('bd.runnerAuto')}</b> · {t('bd.runnerAutoHint')}</span>
        </label>
        <div className="form-grid">
          <Field label={t('bd.runnerInterval')} hint="1–1440 min">
            <input type="number" min={1} max={1440} value={f.intervalMin} onChange={(e) => setF({ ...f, intervalMin: e.target.value })} />
          </Field>
          <Field label={t('bd.runnerBot')}><BotSelect bots={bots || []} value={f.defaultBot} onChange={(defaultBot) => setF((cur) => ({ ...cur, defaultBot }))} label={t('bd.runnerBot')} /></Field>
          <Field label={t('bd.runnerMaxConc')} hint={t('bd.runnerMaxConcHint')}>
            <input type="number" min={1} max={5} value={f.maxConcurrent} onChange={(e) => setF({ ...f, maxConcurrent: e.target.value })} />
          </Field>
        </div>
        <label className="check">
          <input type="checkbox" checked={f.respectQuietHours} onChange={(e) => setF({ ...f, respectQuietHours: e.target.checked })} />
          <span>{t('bd.runnerQuiet')}</span>
        </label>
        <label className="check">
          <input type="checkbox" checked={f.onlyAssigned} onChange={(e) => setF({ ...f, onlyAssigned: e.target.checked })} />
          <span>{t('bd.runnerOnlyAssigned')}</span>
        </label>
        <div className="row end">
          <button type="button" className="ghost" onClick={onClose}>{t('common.cancel')}</button>
          <button disabled={busy === 'save'}>{t('common.save')}</button>
        </div>
      </form>
    </Modal>
  );
}

function BoardRunnerBar({ runner, bots, onToggle, onConfigure, onTick, busy }) {
  const t = useT();
  const f = useFmt();
  if (!runner) return null;
  const botObj = (bots || []).find((b) => b.id === runner.defaultBot);
  const botName = botObj ? botObj.name : runner.defaultBot;
  const activeCount = (runner.activeRuns || []).length;
  return (
    <div className={'runner-bar' + (runner.enabled ? ' on' : '')}>
      <label className="runner-switch">
        <input type="checkbox" checked={Boolean(runner.enabled)} disabled={busy === 'toggle'} onChange={onToggle} />
        <span className="runner-switch-track" aria-hidden />
        <span className="runner-switch-lbl"><b>{t('bd.runnerAuto')}</b></span>
      </label>
      <div className="runner-bar-meta meta-line muted small">
        <span>{t('bd.runnerEvery', { n: runner.intervalMin })}</span>
        <span className="row" style={{ gap: 4, display: 'inline-flex' }}>{botObj ? <BotAvatar bot={botObj} size={16} /> : <Bot size={12} />} {botName}</span>
        <span>{t('bd.runnerQueue', { n: runner.queueCount ?? 0 })}</span>
        {activeCount > 0 && <Badge kind="warn"><span className="spin" /> {t('bd.runnerActive', { n: activeCount })}</Badge>}
        {runner.lastScanAt && <span>{t('bd.runnerLastScan', { t: f.ago(runner.lastScanAt) })}</span>}
      </div>
      <div className="row wrap" style={{ gap: 6 }}>
        <Btn icon={Play} className="ghost small" disabled={busy === 'tick'} onClick={onTick}>{t('bd.runnerNow')}</Btn>
        <Btn icon={Settings2} className="ghost small" onClick={onConfigure}>{t('bd.runnerConfig')}</Btn>
      </div>
    </div>
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
  const canResume = Boolean(ticket.interrupted || (ticket.status === 'in_progress' && !ticket.running));
  const hasWebChat = Boolean(ticket.chatId && ticket.chatId.startsWith('web:'));

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
          {ticket.interrupted && <Badge kind="err"><AlertTriangle size={11} /> {t('bd.interrupted')}</Badge>}
          <span className="grow" />
          {hasWebChat && (
            <Btn icon={ExternalLink} className="ghost small" onClick={() => { onClose(); window.location.hash = '#/chat/' + ticket.chatId.slice(4); }}>
              {t('bd.openChat')}
            </Btn>
          )}
          {canResume ? (
            <Btn icon={RotateCcw} className="small" disabled={busy === 'resume' || ticket.running}
              onClick={() => run('resume', () => bridge.resumeTicket(ticket.id), t('bd.resumed')).then((r) => r && onChanged(r))}>
              {t('bd.resume')}
            </Btn>
          ) : (
            <Btn icon={Play} className="small" disabled={busy === 'run' || ticket.running}
              onClick={() => run('run', () => bridge.runTicket(ticket.id), t('bd.runStarted')).then((r) => r && onChanged(r))}>
              {t('bd.runWithBot')}
            </Btn>
          )}
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
  const toast = useToast();
  const tickets = useLoad(() => bridge.tickets(), [], { interval: 10000, cacheKey: '/bridge/tickets' });
  const runner = useLoad(() => bridge.ticketRunner(), [], { interval: 10000 });
  const bots = useLoad(() => bridge.bots(), [], { cacheKey: '/bridge/bots' });
  const [form, setForm] = useState(null);
  const [detailId, setDetailId] = useState(null);
  const [runnerModal, setRunnerModal] = useState(false);
  const [showDone, setShowDone] = useState(false);
  const [busy, run] = useAction();

  useEffect(() => {
    const onNew = () => setForm({});
    window.addEventListener('acp:new-ticket', onNew);
    return () => window.removeEventListener('acp:new-ticket', onNew);
  }, []);

  const list = tickets.data || [];
  const detail = detailId ? list.find((x) => x.id === detailId) : null;

  const mobile = useIsMobile();
  const runTicket = (tk) => run('run' + tk.id, () => bridge.runTicket(tk.id), t('bd.runStarted')).then(() => { tickets.reload(true); runner.reload(true); });
  const resumeTicket = (tk) => run('res' + tk.id, () => bridge.resumeTicket(tk.id), t('bd.resumed')).then(() => { tickets.reload(true); runner.reload(true); });
  const toggleRunner = () => {
    if (!runner.data) return;
    const next = !runner.data.enabled;
    run('toggle', () => bridge.saveTicketRunner({ enabled: next }), next ? t('bd.runnerEnabled') : t('bd.runnerDisabled'))
      .then(() => runner.reload(true));
  };
  const tickRunner = async () => {
    const r = await run('tick', () => bridge.tickTicketRunner());
    if (r) {
      if (r.started) toast(t('bd.runnerTickStarted', { id: r.ticketId }));
      else toast(t('bd.runnerTickSkipped', { r: r.reason || 'empty' }));
      tickets.reload(true);
      runner.reload(true);
    }
  };
  const runnerBar = (
    <BoardRunnerBar runner={runner.data} bots={bots.data} busy={busy}
      onToggle={toggleRunner} onConfigure={() => setRunnerModal(true)} onTick={tickRunner} />
  );
  const modals = (
    <>
      {form && <TicketForm initial={form} bots={bots.data} onClose={() => setForm(null)} onSaved={() => { tickets.reload(true); runner.reload(true); }} />}
      {detail && <TicketDetail ticket={detail} onClose={() => setDetailId(null)} onEdit={(tk) => setForm(tk)} onChanged={() => { tickets.reload(true); runner.reload(true); }} />}
      {runnerModal && <BoardRunnerModal runner={runner.data} bots={bots.data} onClose={() => setRunnerModal(false)} onSaved={() => runner.reload(true)} />}
    </>
  );
  if (mobile) {
    return (
      <div className="page page-list">
        <HeaderActions>
          <AddButton items={[
            { icon: Plus, label: t('bd.new'), onClick: () => setForm({}) },
            { icon: Settings2, label: t('bd.runnerConfig'), onClick: () => setRunnerModal(true) },
          ]} />
        </HeaderActions>
        <ErrorBox error={tickets.error} onRetry={() => tickets.reload()} />
        {runnerBar}
        {STATUSES.map((st) => {
          const col = list.filter((x) => x.status === st);
          if (!col.length) return null;
          const visible = st === 'done' && !showDone ? col.slice(0, 5) : col;
          const StIc = STATUS_META[st]?.icon || CheckSquare;
          const stCls = STATUS_META[st]?.cls || 'st-todo';
          return (
            <ListGroup key={st} title={t('bd.st.' + st) + ' · ' + col.length}>
              {visible.map((tk) => (
                <ListRow key={tk.id}
                  leading={<span className={'row-ic ' + stCls}>{tk.running ? <span className="spin" /> : <StIc size={18} />}</span>}
                  title={<span className="ellipsis-2">{tk.title}</span>}
                  badges={<>{st !== 'done' && <Badge kind={PRIO_KIND[tk.priority] || 'muted'}>{t('bd.pr.' + tk.priority)}</Badge>}{tk.interrupted && <Badge kind="err">{t('bd.interrupted')}</Badge>}</>}
                  subtitle={'#' + tk.id + ' · ' + (tk.botName || t('bd.unassigned')) + ' · ' + f.ago(tk.updated) + ((tk.comments || []).length ? ' · 💬 ' + tk.comments.length : '')}
                  onOpen={() => setDetailId(tk.id)}
                  swipe={[
                    tk.interrupted && !tk.running && { icon: RotateCcw, label: t('bd.resume'), kind: 'warn', disabled: busy === 'res' + tk.id, onClick: () => resumeTicket(tk) },
                    st === 'todo' && tk.bot && !tk.running && { icon: Play, label: t('bd.runWithBot'), kind: 'warn', disabled: busy === 'run' + tk.id, onClick: () => runTicket(tk) },
                    { icon: Pencil, label: t('common.edit'), kind: 'accent', onClick: () => setForm(tk) },
                  ].filter(Boolean)} />
              ))}
              {st === 'done' && col.length > 5 && (
                <button type="button" className="group-row press" style={{ justifyContent: 'center', color: 'var(--accent)', fontWeight: 500 }} onClick={() => setShowDone((v) => !v)}>
                  {showDone ? t('bd.hideDone') : `${t('bd.showDone')} (${col.length})`}
                </button>
              )}
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
      {runnerBar}
      <Card title={t('bd.title', { n: list.length })} icon={CheckSquare}
        actions={<Btn icon={Plus} className="small" onClick={() => setForm({})}>{t('bd.new')}</Btn>}>
        <div className="kanban">
          {STATUSES.map((st) => {
            const col = list.filter((x) => x.status === st);
            const visible = st === 'done' && !showDone ? col.slice(0, 5) : col;
            const StIc = STATUS_META[st]?.icon || CheckSquare;
            const stCls = STATUS_META[st]?.cls || 'st-todo';
            return (
              <div key={st} className="kanban-col">
                <div className="kanban-head">
                  <span className={'row-ic ' + stCls} style={{ width: 22, height: 22, borderRadius: 6 }}><StIc size={13} /></span>
                  <b>{t('bd.st.' + st)}</b>
                  <Badge>{col.length}</Badge>
                </div>
                <div className="kanban-items">
                  {!col.length && <div className="muted small" style={{ padding: '12px 4px', textAlign: 'center' }}>—</div>}
                  {visible.map((tk) => (
                    <div key={tk.id} className="kanban-card press" onClick={() => setDetailId(tk.id)}>
                      <div className="row between" style={{ gap: 6 }}>
                        <span className="mono muted small">#{tk.id}{tk.goal ? ' 🎯' : ''}</span>
                        <div className="row" style={{ gap: 4 }}>
                          {tk.interrupted && <Badge kind="err">{t('bd.interrupted')}</Badge>}
                          {st !== 'done' && <Badge kind={PRIO_KIND[tk.priority] || 'muted'}>{t('bd.pr.' + tk.priority)}</Badge>}
                        </div>
                      </div>
                      <b className="kanban-title ellipsis-2">{tk.title}</b>
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
                      {tk.interrupted && !tk.running && (
                        <div style={{ marginTop: 6 }} onClick={(e) => e.stopPropagation()}>
                          <Btn icon={RotateCcw} className="ghost small block" disabled={busy === 'res' + tk.id}
                            onClick={() => resumeTicket(tk)}>
                            {t('bd.resume')}
                          </Btn>
                        </div>
                      )}
                      {st === 'todo' && tk.bot && !tk.running && (
                        <div style={{ marginTop: 6 }} onClick={(e) => e.stopPropagation()}>
                          <Btn icon={Play} className="ghost small block" disabled={busy === 'run' + tk.id}
                            onClick={() => runTicket(tk)}>
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
