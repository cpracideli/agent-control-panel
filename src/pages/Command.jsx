// Command center: bot cards that light up while running, plus an animated timeline of today's events.
import { useMemo } from 'react';
import { CalendarClock, CheckSquare, Inbox, ListTodo, Zap } from 'lucide-react';
import { bridge } from '../api.js';
import { Card, ErrorBox, useFmt, useLoad } from '../ui.jsx';

const sameDay = (iso) => iso && new Date(iso).toDateString() === new Date().toDateString();
const hhmm = (iso) => new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });

function BotCard({ bot, run, task, tickets, f }) {
  const on = Boolean(run);
  const elapsed = run ? Math.max(0, Date.now() - run.started) : 0;
  return (
    <div className={'cc-bot' + (on ? ' on' : '')} style={{ '--bot': bot.color || '#0a84ff' }}>
      <span className="cc-avatar">{bot.avatar ? <img src={bot.avatar} alt="" /> : <span>{bot.emoji || '🤖'}</span>}{on && <i className="cc-dot" aria-label="em execução" />}</span>
      <div className="cc-info">
        <b className="ellipsis">{bot.name}</b>
        <span className="muted small ellipsis">{on ? (task?.title || '"' + String(run.prompt).slice(0, 60) + '"') : (tickets ? `${tickets} no board` : 'ocioso')}</span>
        {on && <span className="small cc-live">{f.dur(elapsed)}{task?.cost ? ' · $' + task.cost.toFixed(2) : ''}</span>}
      </div>
    </div>
  );
}

export default function Command() {
  const f = useFmt();
  const bots = useLoad(() => bridge.bots(), [], { interval: 60000, cacheKey: '/bridge/bots' });
  const ov = useLoad(() => bridge.overview(), [], { interval: 4000 });
  const tasks = useLoad(() => bridge.tasks(), [], { interval: 6000 });
  const tickets = useLoad(() => bridge.tickets(), [], { interval: 20000 });
  const scheds = useLoad(() => bridge.schedules(), [], { interval: 30000 });
  const inbox = useLoad(() => bridge.inbox(), [], { interval: 20000, cacheKey: '/bridge/inbox' });

  const taskList = Array.isArray(tasks.data) ? tasks.data : [];
  const running = ov.data?.running || [];
  const byBot = useMemo(() => {
    const m = {};
    for (const r of running) {
      const task = taskList.find((t) => t.chatId === r.chatId);
      const id = task?.bot || r.bot || 'default';
      m[id] = { run: r, task };
    }
    return m;
  }, [running, taskList]);
  const openTickets = useMemo(() => {
    const m = {};
    for (const t of Array.isArray(tickets.data) ? tickets.data : []) if (t.status !== 'done') m[t.bot] = (m[t.bot] || 0) + 1;
    return m;
  }, [tickets.data]);

  const events = useMemo(() => {
    const ev = [];
    for (const t of taskList) {
      if (sameDay(t.created)) ev.push({ at: t.created, kind: 'task', text: `${t.botName || t.bot} iniciou: ${t.title}` });
      if (t.doneAt && sameDay(t.doneAt)) ev.push({ at: t.doneAt, kind: t.status === 'error' ? 'err' : 'done', text: `${t.botName || t.bot} terminou: ${t.title}${t.cost ? ' · $' + t.cost.toFixed(2) : ''}` });
    }
    for (const s of Array.isArray(scheds.data) ? scheds.data : []) {
      const at = s.lastRunInfo?.at || s.lastRun;
      if (sameDay(at)) ev.push({ at, kind: 'sched', text: `Rotina: ${s.description || s.id} (${s.lastStatus || 'ok'})` });
    }
    for (const t of Array.isArray(tickets.data) ? tickets.data : []) if (sameDay(t.updated)) ev.push({ at: t.updated, kind: 'ticket', text: `Ticket ${t.id}: ${t.title.slice(0, 70)}` });
    return ev.sort((a, b) => new Date(b.at) - new Date(a.at)).slice(0, 40);
  }, [taskList, scheds.data, tickets.data]);

  const pending = Array.isArray(inbox.data) ? inbox.data : inbox.data?.items || [];
  const icon = { task: Zap, done: CheckSquare, err: Zap, sched: CalendarClock, ticket: ListTodo };
  const botList = Array.isArray(bots.data) ? bots.data : [];

  return (
    <div className="page">
      <ErrorBox error={ov.error && 'Ponte: ' + ov.error} onRetry={() => ov.reload()} />
      <div className="cc-head">
        <div className="stat"><small>Em execução</small><b>{running.length}</b></div>
        <div className="stat"><small>Aprovações pendentes</small><b>{pending.length}</b></div>
        <div className="stat"><small>Eventos hoje</small><b>{events.length}</b></div>
      </div>
      <Card title="Bots" icon={Zap}>
        <div className="cc-grid">
          {botList.map((b) => <BotCard key={b.id} bot={b} f={f} run={byBot[b.id]?.run} task={byBot[b.id]?.task} tickets={openTickets[b.id]} />)}
          {!botList.length && <p className="muted small">Carregando…</p>}
        </div>
      </Card>
      <Card title="Linha do tempo de hoje" icon={Inbox}>
        {!events.length && <p className="muted small">Nada ainda hoje.</p>}
        <ol className="cc-tl">
          {events.map((e, i) => { const Ic = icon[e.kind] || Zap; return (
            <li key={e.at + i} className={'cc-ev ' + e.kind} style={{ animationDelay: Math.min(i, 12) * 40 + 'ms' }}>
              <span className="cc-ev-ic"><Ic size={13} /></span>
              <time className="muted small">{hhmm(e.at)}</time>
              <span>{e.text}</span>
            </li>); })}
        </ol>
      </Card>
    </div>
  );
}
