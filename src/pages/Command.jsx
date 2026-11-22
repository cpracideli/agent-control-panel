// Command center: bot cards that light up while running, plus an animated timeline of today's events.
import { useMemo, useState } from 'react';
import { CalendarClock, CheckSquare, FileCode2, Inbox, ListTodo, MessageSquare, Sparkles, X, Zap } from 'lucide-react';
import { bridge } from '../api.js';
import { useT } from '../i18n.jsx';
import { Card, ErrorBox, useFmt, useLoad } from '../ui.jsx';
import { BotAvatar } from './Bots.jsx';

const sameDay = (iso) => iso && new Date(iso).toDateString() === new Date().toDateString();
const hhmm = (iso) => new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
const SYS_PROMPT_RE = /^(Você está conversando com o usuário|IMPORTANTE:\s*agora você atende um PEDIDO DE OUTRO BOT|\[Pedido do bot |\[Contexto recuperado automaticamente|\[Conversa em grupo:)/i;

function runLabel(run, task, act, chat) {
  if (task?.title) return task.title;
  const raw = String(run?.prompt || '').replace(/\s+/g, ' ').trim();
  if (raw && !SYS_PROMPT_RE.test(raw)) return '"' + raw.slice(0, 60) + '"';
  const actTitle = String(act?.title || '').replace(/^[^←]+←\s*/, '').trim();
  if (actTitle) return actTitle.slice(0, 60);
  if (chat?.title) return String(chat.title).slice(0, 60);
  return 'Em execução…';
}

function BotCard({ bot, entry, tickets, f }) {
  const run = entry?.run;
  const task = entry?.task;
  const count = entry?.count || 0;
  const on = Boolean(run);
  const elapsed = run ? Math.max(0, Date.now() - run.started) : 0;
  const botColor = typeof bot.color === 'string' && bot.color.trim() ? bot.color.trim() : '#0a84ff';
  return (
    <div className={'cc-bot' + (on ? ' on' : '')} style={{ '--bot': botColor }}>
      <span className="cc-avatar"><BotAvatar bot={bot} size={48} />{on && <i className="cc-dot" aria-label="em execução" />}</span>
      <div className="cc-info">
        <b className="ellipsis">{bot.name}</b>
        <span className="muted small ellipsis">{on ? runLabel(run, task, entry.act, entry.chat) : (tickets ? `${tickets} no board` : 'ocioso')}</span>
        {on && (
          <span className="small cc-live ellipsis">
            {f.dur(elapsed)}
            {count > 1 ? ` · ${count} ativas` : ''}
            {task?.cost ? ' · $' + task.cost.toFixed(2) : ''}
          </span>
        )}
      </div>
    </div>
  );
}

export default function Command() {
  const t = useT();
  const f = useFmt();
  const [onboardDismissed, setOnboardDismissed] = useState(() => {
    try { return localStorage.getItem('acp_onboard_dismissed') === '1'; } catch { return false; }
  });
  const dismissOnboard = () => {
    setOnboardDismissed(true);
    try { localStorage.setItem('acp_onboard_dismissed', '1'); } catch {}
  };
  const bots = useLoad(() => bridge.bots(), [], { interval: 60000, cacheKey: '/bridge/bots' });
  const ov = useLoad(() => bridge.overview(), [], { interval: 4000 });
  const activity = useLoad(() => bridge.activity(), [], { interval: 4000 });
  const chats = useLoad(() => bridge.chats(), [], { interval: 15000, cacheKey: '/bridge/chats' });
  const tasks = useLoad(() => bridge.tasks(), [], { interval: 6000 });
  const tickets = useLoad(() => bridge.tickets(), [], { interval: 20000 });
  const scheds = useLoad(() => bridge.schedules(), [], { interval: 30000 });
  const inbox = useLoad(() => bridge.inbox(), [], { interval: 20000, cacheKey: '/bridge/inbox' });

  const taskList = Array.isArray(tasks.data) ? tasks.data : [];
  const running = ov.data?.running || [];
  const byBot = useMemo(() => {
    const chatById = {};
    for (const c of Array.isArray(chats.data) ? chats.data : []) chatById[c.id] = c;
    const actByChat = {};
    for (const a of Array.isArray(activity.data) ? activity.data : []) {
      if (a.kind === 'running' && a.chatId) actByChat[a.chatId] = a;
    }
    const m = {};
    for (const r of running) {
      const task = taskList.find((t) => t.chatId === r.chatId);
      const act = actByChat[r.chatId];
      const chat = chatById[r.chatId];
      const id = r.bot || task?.bot || act?.bot || chat?.bot || 'default';
      if (!m[id]) {
        m[id] = { run: r, task, act, chat, count: 1 };
      } else {
        m[id].count += 1;
        if ((r.started || 0) >= (m[id].run?.started || 0)) {
          m[id].run = r;
          m[id].task = task || m[id].task;
          m[id].act = act || m[id].act;
          m[id].chat = chat || m[id].chat;
        }
      }
    }
    return m;
  }, [running, taskList, activity.data, chats.data]);
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
  const activeBots = botList.filter((b) => Boolean(byBot[b.id]));
  const idleBots = botList.filter((b) => !byBot[b.id]);

  return (
    <div className="page">
      <ErrorBox error={ov.error && 'Ponte: ' + ov.error} onRetry={() => ov.reload()} />
      {!onboardDismissed && (
        <Card
          title={t('cc.onboardTitle')}
          icon={Sparkles}
          actions={<button type="button" className="ghost small" aria-label={t('common.close')} onClick={dismissOnboard}><X size={15} /></button>}
        >
          <div className="cc-onboard-grid">
            <button type="button" className="group-row press" onClick={() => { window.location.hash = '#/chat'; }}>
              <span className="row-ic ic-chat"><MessageSquare size={16} /></span>
              <span className="grow"><b>{t('cc.onboardChat')}</b><small className="muted">{t('cc.onboardChatSub')}</small></span>
            </button>
            <button type="button" className="group-row press" onClick={() => { window.location.hash = '#/schedules'; }}>
              <span className="row-ic ic-schedules"><CalendarClock size={16} /></span>
              <span className="grow"><b>{t('cc.onboardRoutine')}</b><small className="muted">{t('cc.onboardRoutineSub')}</small></span>
            </button>
            <button type="button" className="group-row press" onClick={() => { window.location.hash = '#/dashboards'; }}>
              <span className="row-ic ic-dashboards"><FileCode2 size={16} /></span>
              <span className="grow"><b>{t('cc.onboardApp')}</b><small className="muted">{t('cc.onboardAppSub')}</small></span>
            </button>
          </div>
        </Card>
      )}
      <div className="cc-head">
        <button type="button" className="stat press" onClick={() => { window.location.hash = '#/board'; }}>
          <small>{t('cc.running')}</small><b>{running.length}</b>
        </button>
        <button type="button" className="stat press" onClick={() => { window.location.hash = '#/board'; }}>
          <small>{t('cc.pending')}</small><b>{pending.length}</b>
        </button>
        <button type="button" className="stat press" onClick={() => document.getElementById('cc-timeline')?.scrollIntoView({ behavior: 'smooth' })}>
          <small>{t('cc.today')}</small><b>{events.length}</b>
        </button>
      </div>
      <Card title="Bots" icon={Zap}>
        {activeBots.length > 0 && (
          <div className="cc-grid" style={{ marginBottom: idleBots.length ? 12 : 0 }}>
            {activeBots.map((b) => <BotCard key={b.id} bot={b} f={f} entry={byBot[b.id]} tickets={openTickets[b.id]} />)}
          </div>
        )}
        {idleBots.length > 0 && (
          <div className="cc-idle-grid">
            {idleBots.map((b) => {
              const botColor = typeof b.color === 'string' && b.color.trim() ? b.color.trim() : '#0a84ff';
              return (
                <button
                  key={b.id}
                  type="button"
                  className="cc-idle-chip press"
                  style={{ '--bot': botColor }}
                  onClick={() => { window.location.hash = '#/bots'; }}
                >
                  <span className="cc-avatar sm"><BotAvatar bot={b} size={24} /></span>
                  <span className="ellipsis small"><b>{b.name}</b></span>
                  {openTickets[b.id] > 0 && <span className="muted small">· {openTickets[b.id]}</span>}
                </button>
              );
            })}
          </div>
        )}
        {!botList.length && <p className="muted small">Carregando…</p>}
      </Card>
      <Card id="cc-timeline" title="Linha do tempo de hoje" icon={Inbox}>
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
