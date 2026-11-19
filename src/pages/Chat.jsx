import { useEffect, useMemo, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { ArrowDown, ArrowRight, ArrowUp, AudioLines, Bot, Check, Copy, ChevronLeft, Ellipsis, Lock, Menu, MessageCircle, PanelLeftClose, PanelLeftOpen, Mic, Pencil, Plus, RotateCcw, Search, Square, SquarePen, SquareTerminal, Trash2, Users, UserRound, Wrench, X } from 'lucide-react';
import { bridge } from '../api.js';
import { store, useI18n, useT } from '../i18n.jsx';
import { MAX_FILE, MessageFiles, PendingFiles, RecordingTimer, SpeakButton, canRecord, hasTTS, readAsBase64, speak, stopSpeaking, unlockSpeech, useRecorder } from './chatMedia.jsx';
import { Badge, Btn, ErrorBox, Field, IconButton, Modal, Sheet, useConfirm, useFmt, useLoad, useToast } from '../ui.jsx';
import { BotAvatar } from './Bots.jsx';

const chatFromHash = () => {
  const m = window.location.hash.match(/^#\/chat\/([a-f0-9]+)/);
  return m ? 'web:' + m[1] : null;
};
const provName = (p) => (p === 'antigravity' ? 'Antigravity' : 'Claude');

function CodeBlock({ children, ...props }) {
  const t = useT();
  const [ok, setOk] = useState(false);
  const preRef = useRef(null);
  const copy = () => {
    const txt = preRef.current?.innerText || '';
    navigator.clipboard.writeText(txt);
    setOk(true);
    setTimeout(() => setOk(false), 1500);
  };
  return (
    <div className="code-wrap">
      <button type="button" className="code-copy ghost icon" aria-label={t('common.copy')} title={t('common.copy')} onClick={copy}>
        {ok ? <Check size={13} /> : <Copy size={13} />}
      </button>
      <pre ref={preRef} {...props}>{children}</pre>
    </div>
  );
}

const Md = ({ text }) => (
  <div className="md">
    <ReactMarkdown remarkPlugins={[remarkGfm]} components={{ a: (p) => <a {...p} target="_blank" rel="noreferrer" />, table: ({ node, ...p }) => <div className="table-wrap"><table {...p} /></div>, pre: CodeBlock }}>{text || ''}</ReactMarkdown>
  </div>
);

// Terminal style: tool calls as in Claude Code ("⏺ Bash(ls)" then "⎿ output"), output folded after the first line.
function termArg(input) {
  let v = input;
  try { const o = JSON.parse(input); v = o.command || o.file_path || o.path || o.pattern || o.url || o.query || o.prompt || o.description || input; } catch {}
  v = String(v || '').replace(/\s+/g, ' ').trim();
  return v.length > 90 ? v.slice(0, 90) + '…' : v;
}
function TermTools({ tools }) {
  const t = useT();
  if (!tools || !tools.length) return null;
  return (
    <div className="term-tools">
      {tools.map((x, i) => {
        const lines = String(x.result || '').split('\n').filter((l) => l.trim());
        return (
          <div key={x.id || i} className={'term-tool' + (x.isError ? ' bad' : '') + (x.result === undefined ? ' run' : '')}>
            <div className="term-tool-h"><b>{x.name}</b><span className="term-arg">({termArg(x.input)})</span></div>
            {x.result === undefined
              ? <div className="term-out"><span className="term-elbow">⎿</span> <span className="term-dim">{t('chat.working')}…</span></div>
              : lines.length > 1
                ? <details className="term-out"><summary><span className="term-elbow">⎿</span> {lines[0].slice(0, 160)} <span className="term-dim">{t('chat.termMore', { n: lines.length - 1 })}</span></summary><pre>{x.result}</pre></details>
                : <div className="term-out"><span className="term-elbow">⎿</span> {(lines[0] || t('common.empty')).slice(0, 300)}</div>}
          </div>
        );
      })}
    </div>
  );
}

function ToolList({ tools, term }) {
  if (term) return <TermTools tools={tools} />;
  const t = useT();
  const toast = useToast();
  if (!tools || !tools.length) return null;
  const errCount = tools.filter((x) => x.isError).length;
  return (
    <details className="tools">
      <summary>
        <Wrench size={13} /> {tools.length === 1 ? t('chat.toolsOne') : t('chat.toolsMany', { n: tools.length })}: {[...new Set(tools.map((x) => x.name))].join(', ')}
        {errCount > 0 && <> <Badge kind="err">{t('chat.toolsErrors', { n: errCount })}</Badge></>}
      </summary>
      {tools.map((x, i) => (
        <div key={x.id || i} className={'tool' + (x.isError ? ' bad' : '')}>
          <div className="tool-h">
            <b>{x.name}</b>
            {x.result === undefined && <span className="spin" />}
            {x.result !== undefined && <IconButton icon={Copy} size={12} className="ghost bare" label={t('common.copy')} onClick={() => { navigator.clipboard.writeText(x.result || ''); toast(t('common.copied')); }} />}
          </div>
          <pre>{x.input}</pre>
          {x.result !== undefined && <pre className="tool-out">{x.result || t('common.empty')}</pre>}
        </div>
      ))}
    </details>
  );
}

function DelegationList({ delegations, botsById, term }) {
  const t = useT();
  const f = useFmt();
  const toast = useToast();
  if (!delegations || !delegations.length) return null;
  if (term) {
    return (
      <div className="term-tools">
        {delegations.map((d, i) => {
          const lines = String(d.error || d.answer || '').split('\n').filter((l) => l.trim());
          return (
            <div key={d.id || i} className={'term-tool' + (d.status === 'error' ? ' bad' : '') + (d.status === 'running' ? ' run' : '')}>
              <div className="term-tool-h"><b>Bot</b><span className="term-arg">({d.botName || d.bot}: {termArg(d.question)})</span></div>
              {d.status === 'running'
                ? <div className="term-out"><span className="term-elbow">⎿</span> <span className="term-dim">{t('chat.delegAsking', { n: d.botName || d.bot })}</span></div>
                : lines.length > 1
                  ? <details className="term-out"><summary><span className="term-elbow">⎿</span> {lines[0].slice(0, 160)} <span className="term-dim">{t('chat.termMore', { n: lines.length - 1 })}</span></summary><pre>{d.error || d.answer}</pre></details>
                  : <div className="term-out"><span className="term-elbow">⎿</span> {(lines[0] || t('common.empty')).slice(0, 300)}</div>}
            </div>
          );
        })}
      </div>
    );
  }
  const errCount = delegations.filter((x) => x.status === 'error').length;
  const runningOne = delegations.find((x) => x.status === 'running');
  return (
    <details className="tools delegs" open={Boolean(runningOne)}>
      <summary>
        <Bot size={13} /> {runningOne ? t('chat.delegAsking', { n: runningOne.botName || runningOne.bot }) : (delegations.length === 1 ? t('chat.delegOne') : t('chat.delegMany', { n: delegations.length }))}: {[...new Set(delegations.map((x) => x.botName || x.bot))].join(', ')}
        {runningOne && <span className="spin" />}
        {errCount > 0 && <> <Badge kind="err">{t('chat.toolsErrors', { n: errCount })}</Badge></>}
      </summary>
      {delegations.map((d, i) => {
        const caller = (botsById && botsById[d.byBot]) || null;
        const target = (botsById && botsById[d.bot]) || null;
        const callerLabel = caller ? (caller.emoji ? caller.emoji + ' ' : '') + caller.name : (d.byBot || 'Claude');
        const targetLabel = target ? (target.emoji ? target.emoji + ' ' : '') + target.name : (d.botName || d.bot);
        const out = d.error || d.answer || '';
        return (
          <div key={d.id || i} className={'tool deleg-card' + (d.status === 'error' ? ' bad' : '')}>
            <div className="tool-h">
              <b className="row" style={{ gap: 6 }}>{callerLabel} <ArrowRight size={12} /> {targetLabel}</b>
              {d.ms ? <small className="muted">{f.dur(d.ms)}</small> : null}
              {d.status === 'running' && <span className="spin" />}
              {d.status !== 'running' && out && <IconButton icon={Copy} size={12} className="ghost bare" label={t('common.copy')} onClick={() => { navigator.clipboard.writeText(out); toast(t('common.copied')); }} />}
            </div>
            <pre>{d.question}</pre>
            {d.status !== 'running' && <pre className="tool-out">{out || t('common.empty')}</pre>}
          </div>
        );
      })}
    </details>
  );
}

function Message({ m, chatId, onResend, onRetry, bot, botsById, term }) {
  const { t, lang } = useI18n();
  const f = useFmt();
  const toast = useToast();
  if (m.role === 'user') {
    return (
      <div className="msg user">
        <div className="user-col">
          <MessageFiles files={m.files} transcript={m.transcript} engine={m.transcriptEngine} pendingLabel={t('chat.transcribing')}
            pending={!m.transcript && !m.transcriptFailed && Date.now() - new Date(m.at).getTime() < 180000} />
          {m.text && <div className="bubble">{m.text}</div>}
          {(m.injected || (m.text && onResend)) && (
            <div className="msg-actions-user">
              {m.injected && <span className="injected-tag">📨 {t('chat.injected')}</span>}
              {m.text && onResend && <IconButton icon={RotateCcw} size={12} className="ghost bare" label={t('chat.resend')} onClick={() => onResend(m.text)} />}
            </div>
          )}
        </div>
      </div>
    );
  }
  return (
    <div className={'msg bot' + (m.error ? ' error' : '') + (m.stopped ? ' stopped' : '')}>
      {bot && bot.id !== 'default' ? <BotAvatar bot={bot} size={30} /> : <div className="avatar" aria-hidden><Bot size={16} /></div>}
      <div className="msg-body">
        <DelegationList delegations={m.delegations} botsById={botsById} term={term} />
        <ToolList tools={m.tools} term={term} />
        <Md text={m.text} />
        <div className="msg-meta">
          {bot && bot.id !== 'default' && <span>{(bot.emoji ? bot.emoji + ' ' : '') + bot.name}</span>}
          {m.provider && <span>{provName(m.provider)}</span>}
          {m.usage?.ms ? <span>{f.dur(m.usage.ms)}</span> : null}
          {m.usage?.turns ? <span>{t('chat.steps', { n: m.usage.turns })}</span> : null}
          {m.usage?.cost ? <span>{f.usd(m.usage.cost)}</span> : null}
          {!m.error && !m.stopped && <SpeakButton id={m.id} text={m.text} lang={lang} chatId={chatId} file={m.tts} label={t('chat.listen')} stopLabel={t('chat.stopListen')} />}
          {(m.error || m.stopped) && onRetry && <Btn icon={RotateCcw} className="ghost small" onClick={onRetry}>{t('chat.retry')}</Btn>}
          <IconButton icon={Copy} size={13} className="ghost bare" label={t('common.copy')} onClick={() => { navigator.clipboard.writeText(m.text); toast(t('common.copied')); }} />
        </div>
      </div>
    </div>
  );
}

function useTicker() {
  const [, set] = useState(0);
  useEffect(() => { const x = setInterval(() => set((n) => n + 1), 1000); return () => clearInterval(x); }, []);
}

function LiveRun({ live, bot, botsById, term }) {
  const t = useT();
  useTicker();
  const secs = Math.round((Date.now() - live.started) / 1000);
  return (
    <div className="msg bot live">
      {bot && bot.id !== 'default' ? <BotAvatar bot={bot} size={30} /> : <div className="avatar" aria-hidden><Bot size={16} /></div>}
      <div className="msg-body">
        <DelegationList delegations={live.delegations} botsById={botsById} term={term} />
        <ToolList tools={live.tools} term={term} />
        {live.texts.length > 0 && <Md text={live.texts.join('\n\n')} />}
        <div className="msg-meta">{term ? <span className="term-star">✻</span> : <span className="spin" />} {bot && bot.id !== 'default' ? (bot.emoji ? bot.emoji + ' ' : '') + bot.name + ' · ' : ''}{t('chat.working')} {secs}s{live.model ? ' · ' + live.model : ''}
          {live.mcp?.length > 0 && <span> · MCP: {live.mcp.map((s) => s.name + (s.status === 'connected' ? '' : ' (' + s.status + ')')).join(', ')}</span>}
        </div>
      </div>
    </div>
  );
}

function ChatSettings({ chat, providers, bots, onChange }) {
  const t = useT();
  if (!chat || !providers) return null;
  const prov = providers.providers.find((p) => p.id === chat.provider) || providers.providers[0];
  const agy = chat.provider === 'antigravity';
  const agyModel = agy && prov.models.find((m) => m.id === chat.agyModel);
  const efforts = agy ? (agyModel ? agyModel.efforts : []) : prov.efforts;
  return (
    <div className="chat-settings">
      {bots?.length > 1 && (
        <select value={chat.bot || 'default'} onChange={(e) => onChange({ bot: e.target.value })} aria-label={t('bots.label')} title={t('bots.switchHint')}>
          {bots.map((b) => <option key={b.id} value={b.id}>{(b.emoji ? b.emoji + ' ' : '') + b.name}</option>)}
        </select>
      )}
      <select value={chat.provider} onChange={(e) => onChange({ provider: e.target.value })} aria-label={t('chat.provider')}>
        {providers.providers.map((p) => <option key={p.id} value={p.id} disabled={!p.installed}>{p.name}{p.installed ? '' : ' (' + t('common.notInstalled') + ')'}</option>)}
      </select>
      <select value={agy ? chat.agyModel : chat.model} onChange={(e) => onChange(agy ? { agyModel: e.target.value, agyEffort: '' } : { model: e.target.value })} aria-label={t('chat.model')}>
        <option value="">{agy ? t('common.defaultModel') : t('chat.accountDefault', { m: (!chat.model && chat.effModel) || prov.defaultModel || '—' })}</option>
        {prov.models.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
      </select>
      {efforts?.length > 0 && (
        <select value={agy ? chat.agyEffort : chat.effort} onChange={(e) => onChange(agy ? { agyEffort: e.target.value } : { effort: e.target.value })} aria-label={t('chat.effort')}>
          <option value="">{t('common.defaultEffort')}</option>
          {efforts.map((e) => <option key={e} value={e}>{e}</option>)}
        </select>
      )}
    </div>
  );
}

// "Opus 4.7 · medium" for the composer pill, like the model picker in the Claude app.
function modelLabel(chat, providers) {
  if (!chat || !providers) return null;
  const prov = providers.providers.find((p) => p.id === chat.provider) || providers.providers[0];
  if (!prov) return null;
  const agy = chat.provider === 'antigravity';
  const id = agy ? chat.agyModel : (chat.model || chat.effModel || prov.defaultModel);
  const m = prov.models.find((x) => x.id === id);
  const name = m ? m.label : (id || provName(chat.provider));
  return { name, effort: (agy ? chat.agyEffort : (chat.effort || chat.effEffort)) || '' };
}

export default function Chat({ openMore, me }) {
  const { t, lang } = useI18n();
  const f = useFmt();
  const toast = useToast();
  const confirm = useConfirm();
  const chats = useLoad(() => bridge.chats(), [], { interval: 15000 });
  const providers = useLoad(() => bridge.providers(), []);
  const botsL = useLoad(() => bridge.bots(), [], { interval: 60000 });
  const botsById = useMemo(() => Object.fromEntries((botsL.data || []).map((b) => [b.id, b])), [botsL.data]);
  const [current, setCurrent] = useState(chatFromHash);
  const [messages, setMessages] = useState([]);
  const [chatInfo, setChatInfo] = useState(null);
  const [live, setLive] = useState(null);
  const [text, setText] = useState('');
  const [loadErr, setLoadErr] = useState(null);
  const [showList, setShowList] = useState(false);
  // desktop: the conversations column can be collapsed; remembered per browser
  const [listHidden, setListHiddenState] = useState(() => store.get('acp_chatlist_hidden') === '1');
  const toggleListHidden = () => setListHiddenState((h) => { store.set('acp_chatlist_hidden', h ? '0' : '1'); return !h; });
  useEffect(() => {
    const onKey = (e) => {
      if ((e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'b' && window.matchMedia('(min-width: 821px)').matches) { e.preventDefault(); toggleListHidden(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  const [chatSearch, setChatSearch] = useState('');
  const [showMsgSearch, setShowMsgSearch] = useState(false);
  const [msgSearch, setMsgSearch] = useState('');
  const [renaming, setRenaming] = useState(null);
  const [queuedAhead, setQueuedAhead] = useState(0);
  const rootRef = useRef(null);
  const openRef = useRef(false);
  openRef.current = showList;
  const [showOpts, setShowOpts] = useState(false);
  const [files, setFiles] = useState([]);
  const [sending, setSending] = useState(false);
  const [voiceMode, setVoiceModeState] = useState(() => store.get('acp_voice') === '1');
  // Chat style: 'bubbles' (default) or 'terminal' (looks like Claude Code in a terminal). Visual only, per browser.
  const [term, setTermState] = useState(() => store.get('acp_chat_style') === 'terminal');
  const setTerm = (on) => { store.set('acp_chat_style', on ? 'terminal' : 'bubbles'); setTermState(on); };
  const setVoiceMode = (on) => { store.set('acp_voice', on ? '1' : '0'); setVoiceModeState(on); if (!on) stopSpeaking(); else unlockSpeech(); };
  const rec = useRecorder(lang);
  const fileRef = useRef(null);
  // Read inside the SSE handler, which is created once per conversation.
  const speakRef = useRef({ voiceMode, lastVoice: false, lang });
  speakRef.current.voiceMode = voiceMode; speakRef.current.lang = lang;
  const scrollRef = useRef(null);
  const composerRef = useRef(null);
  const mainRef = useRef(null);
  const inputRef = useRef(null);
  const [atBottom, setAtBottom] = useState(true);

  const webChats = useMemo(() => (chats.data || []).filter((c) => c.kind === 'web'), [chats.data]);
  const filteredChats = useMemo(() => {
    const q = chatSearch.trim().toLowerCase();
    return q ? webChats.filter((c) => c.title.toLowerCase().includes(q)) : webChats;
  }, [webChats, chatSearch]);
  const shownMessages = useMemo(() => {
    const q = msgSearch.trim().toLowerCase();
    return q ? messages.filter((m) => (m.text || m.transcript || '').toLowerCase().includes(q)) : messages;
  }, [messages, msgSearch]);

  const select = (id, replace) => {
    const h = '#/chat/' + id.slice(4);
    window.history.replaceState(null, '', h); // never push: a swipe from the left edge must open the drawer, not go back
    setCurrent(id); setShowList(false);
  };
  useEffect(() => { if (!current && webChats.length) select(webChats[0].id, true); }, [webChats.length]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const onHash = () => { const id = chatFromHash(); if (id) setCurrent(id); };
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  // History + live events of the selected conversation.
  useEffect(() => {
    if (!current) return undefined;
    let closed = false;
    setMessages([]); setLive(null); setLoadErr(null); setChatInfo(null); setQueuedAhead(0); setMsgSearch(''); setShowMsgSearch(false);
    const load = () => bridge.messages(current)
      .then((r) => { if (!closed) { setMessages(r.messages); setChatInfo(r.chat); } })
      .catch((e) => !closed && setLoadErr(e.message));
    load();
    const es = new EventSource(bridge.eventsUrl(current));
    es.onmessage = (e) => {
      const ev = JSON.parse(e.data);
      if (ev.type === 'hello') { load(); setLive(ev.running ? { started: ev.running.started, texts: [], tools: [], delegations: [] } : null); }
      else if (ev.type === 'message') {
        setMessages((ms) => (ms.some((m) => m.id === ev.message.id) ? ms : [...ms, ev.message]));
        const sp = speakRef.current;
        if (ev.message.role === 'assistant' && !ev.message.error && !ev.message.stopped && (sp.voiceMode || sp.lastVoice)) speak(ev.message.id, ev.message.text, sp.lang, current);
      }
      else if (ev.type === 'update') setMessages((ms) => ms.map((m) => (m.id === ev.id ? { ...m, ...ev.patch } : m)));
      else if (ev.type === 'start') { setLive({ started: Date.now(), texts: [], tools: [], delegations: [], provider: ev.provider, bot: ev.bot }); setQueuedAhead((q) => Math.max(0, q - 1)); }
      else if (ev.type === 'init') setLive((l) => l && { ...l, model: ev.model, mcp: ev.mcp });
      else if (ev.type === 'text') setLive((l) => l && { ...l, texts: [...l.texts, ev.text] });
      else if (ev.type === 'tool') setLive((l) => l && { ...l, tools: [...l.tools, { id: ev.id, name: ev.name, input: ev.input }] });
      else if (ev.type === 'tool_result') setLive((l) => l && { ...l, tools: l.tools.map((x) => (x.id === ev.id ? { ...x, result: ev.text, isError: ev.isError } : x)) });
      else if (ev.type === 'delegation') setLive((l) => l && { ...l, delegations: (l.delegations || []).some((d) => d.id === ev.ask.id) ? l.delegations.map((d) => (d.id === ev.ask.id ? ev.ask : d)) : [...(l.delegations || []), ev.ask] });
      else if (ev.type === 'idle') { setLive(null); setQueuedAhead(0); chats.reload(true); }
    };
    return () => { closed = true; es.close(); };
  }, [current]); // eslint-disable-line react-hooks/exhaustive-deps

  // The composer floats over the conversation (glass), so the list reserves its height as bottom padding.
  useEffect(() => {
    const el = composerRef.current, host = mainRef.current;
    if (!el || !host || typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver(() => host.style.setProperty('--composer-h', el.offsetHeight + 'px'));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  // Claude-style drawer gesture: drag right anywhere on the conversation to open, left to close; the page
  // follows the finger. A touch that starts at the very left edge is claimed so iOS doesn't treat it as "back".
  useEffect(() => {
    const root = rootRef.current, main = mainRef.current;
    if (!root || !main) return undefined;
    const list = root.querySelector('.chat-list');
    const mobile = () => window.matchMedia('(max-width: 820px)').matches;
    const W = () => Math.min(window.innerWidth * 0.8, 340);
    let s = null;
    const paint = (x) => {
      const w = W();
      main.style.transform = x ? `translateX(${x}px)` : 'translateX(0)';
      main.style.borderRadius = Math.round(Math.min(1, x / w) * 44) + 'px';
      list.style.opacity = String(Math.min(1, x / w));
    };
    const clear = () => { root.classList.remove('dragging'); main.style.transform = ''; main.style.borderRadius = ''; list.style.opacity = ''; };
    const start = (e) => {
      if (!mobile() || e.touches.length !== 1) { s = null; return; }
      const p = e.touches[0];
      if (p.clientX < 24 && !openRef.current) e.preventDefault();
      // horizontal scrollers and the text box keep their own sideways gestures
      if (p.clientX >= 24 && e.target.closest?.('.table-wrap, .pending-files, textarea, pre, .rec-body, .mic-hold')) { s = null; return; }
      s = { x: p.clientX, y: p.clientY, open: openRef.current, drag: false, pos: openRef.current ? W() : 0 };
    };
    const move = (e) => {
      if (!s) return;
      const p = e.touches[0];
      const dx = p.clientX - s.x, dy = p.clientY - s.y;
      if (!s.drag) {
        if (Math.abs(dy) > 10 && Math.abs(dy) > Math.abs(dx)) { s = null; return; }
        if (Math.abs(dx) < 10) return;
        if ((!s.open && dx < 0) || (s.open && dx > 0)) { s = null; return; }
        s.drag = true; s.x = p.clientX; root.classList.add('dragging');
      }
      e.preventDefault();
      const w = W();
      s.pos = Math.max(0, Math.min(w, (s.open ? w : 0) + (p.clientX - s.x)));
      paint(s.pos);
    };
    const end = () => {
      if (!s) return;
      const { drag, pos, open } = s; s = null;
      if (!drag) return;
      const w = W();
      const next = open ? pos > w * 0.7 : pos > w * 0.25;
      requestAnimationFrame(() => { clear(); setShowList(next); });
    };
    root.addEventListener('touchstart', start, { passive: false });
    root.addEventListener('touchmove', move, { passive: false });
    root.addEventListener('touchend', end);
    root.addEventListener('touchcancel', end);
    return () => {
      root.removeEventListener('touchstart', start); root.removeEventListener('touchmove', move);
      root.removeEventListener('touchend', end); root.removeEventListener('touchcancel', end);
    };
  }, []);
  const toBottom = (smooth) => { const el = scrollRef.current; if (el) el.scrollTo({ top: el.scrollHeight, behavior: smooth ? 'smooth' : 'auto' }); };
  useEffect(() => { if (atBottom) toBottom(); }, [messages, live]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { setAtBottom(true); setTimeout(() => toBottom(), 0); }, [current]);
  const onScroll = (e) => { const el = e.currentTarget; setAtBottom(el.scrollHeight - el.scrollTop - el.clientHeight < 120); };

  const newChat = async () => {
    try {
      const c = await bridge.newWeb({});
      await chats.reload(true);
      select(c.id);
      setTimeout(() => inputRef.current?.focus(), 50);
    } catch (e) { toast(e.message, 'err'); }
  };
  const send = async (voice, overrideText) => {
    const msg = (overrideText !== undefined ? overrideText : text).trim();
    const pending = overrideText !== undefined ? [] : files;
    if (!msg && !pending.length && !voice) return;
    unlockSpeech();
    let id = current;
    setSending(true);
    try {
      const payload = await Promise.all(pending.map(async (f) => ({ name: f.name, type: f.type, data: await readAsBase64(f.file) })));
      if (voice) payload.push({ name: 'voz.' + (voice.type.split('/')[1] || 'webm'), type: voice.type, data: await readAsBase64(voice.blob), voice: true });
      if (!id) { const c = await bridge.newWeb({}); id = c.id; select(c.id); }
      if (overrideText === undefined) { setText(''); setFiles([]); }
      speakRef.current.lastVoice = Boolean(voice);
      const r = await bridge.send(id, msg, payload, voice?.transcript);
      if (r.injected) toast('📨 ' + t('chat.injectedToast'));
      else if (r.ahead) { setQueuedAhead(r.ahead); toast(t('chat.queued', { n: r.ahead })); }
      chats.reload(true);
      pending.forEach((f) => f.preview && URL.revokeObjectURL(f.preview));
    } catch (e) { toast(e.message, 'err'); if (overrideText === undefined) { setText(msg); setFiles(pending); } }
    finally { setSending(false); }
  };
  const addFiles = (list) => {
    const add = [];
    for (const file of list) {
      if (file.size > MAX_FILE) { toast(t('chat.tooBig', { n: file.name }), 'err'); continue; }
      add.push({ key: Math.random(), file, name: file.name || 'arquivo', type: file.type || 'application/octet-stream', size: file.size, preview: file.type.startsWith('image/') ? URL.createObjectURL(file) : null });
    }
    setFiles((x) => [...x, ...add].slice(0, 10));
  };
  const startRec = async () => {
    stopSpeaking();
    try { await rec.start(); } catch (e) { toast(t('chat.micDenied') + (e?.message ? ' (' + e.message + ')' : ''), 'err'); }
  };
  // The send tap is the user gesture iOS needs to allow the spoken reply later; doing it at record start
  // put speech output and the microphone in the same audio session.
  const finishRec = async () => { unlockSpeech(); const v = await rec.stop(); if (v) send(v); };
  // WhatsApp-style mic: press and hold to record, release to send, slide left to discard, slide up to lock
  // (keep recording hands-free). A quick tap also locks, so tap-to-record keeps working on desktop.
  // Listeners live on window because the composer re-renders under the finger while recording.
  const [hold, setHold] = useState(null); // { dx, dy } while the finger is down
  const buzz = (ms) => { try { navigator.vibrate?.(ms); } catch {} };
  const onMicDown = (e) => {
    if (e.button > 0 || rec.recording) return;
    e.preventDefault();
    const h = { x: e.clientX, y: e.clientY, t: Date.now(), id: e.pointerId };
    const apply = (how) => {
      if (how === 'send') { buzz(10); finishRec(); }
      else if (how === 'cancel') { buzz([15, 40, 15]); rec.cancel(); }
    };
    const end = (how) => {
      if (h.done) return;
      h.done = true; h.how = how;
      window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); window.removeEventListener('pointercancel', lost);
      if (h.ready) apply(how); // before clearing hold, so "send" never flashes the locked screen
      setHold(null);
    };
    const move = (ev) => {
      if (ev.pointerId !== h.id || h.done) return;
      const dx = Math.min(0, ev.clientX - h.x), dy = Math.min(0, ev.clientY - h.y);
      if (dx < -110) return end('cancel');
      if (dy < -80) { buzz(10); return end('lock'); }
      setHold({ dx, dy });
    };
    const up = (ev) => { if (ev.pointerId === h.id) end(Date.now() - h.t < 350 ? 'lock' : 'send'); };
    // The system took the touch (notification, permission prompt): keep the recording instead of losing it.
    const lost = (ev) => { if (ev.pointerId === h.id) end('lock'); };
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up); window.addEventListener('pointercancel', lost);
    setHold({ dx: 0, dy: 0 });
    stopSpeaking();
    rec.start().then(() => {
      h.ready = true; buzz(15);
      // Released before the microphone opened (e.g. first permission prompt): nothing was recorded yet, so lock.
      if (h.done) apply(h.how === 'cancel' ? 'cancel' : 'lock');
    }, (err) => { end('fail'); toast(t('chat.micDenied') + (err?.message ? ' (' + err.message + ')' : ''), 'err'); });
  };
  const micButton = (
    <button key="mic" type="button" className={'icon ghost cbtn mic-hold' + (hold ? ' holding' : '')} aria-label={t('chat.record')} title={t('chat.holdHint')}
      onPointerDown={onMicDown} onContextMenu={(e) => e.preventDefault()}
      onClick={(e) => { if (e.detail === 0) startRec(); /* keyboard */ }}
      style={hold ? { transform: `translate(${hold.dx}px, ${hold.dy}px) scale(1.6)` } : undefined}>
      <Mic size={19} />
    </button>
  );
  const onPaste = (e) => { const list = [...(e.clipboardData?.files || [])]; if (list.length) { e.preventDefault(); addFiles(list); } };
  const change = async (b) => { try { setChatInfo(await bridge.patchChat(current, b)); chats.reload(true); } catch (e) { toast(e.message, 'err'); } };
  const remove = async (targetId = current) => {
    if (!(await confirm(t('chat.deleteConfirm')))) return;
    try {
      await bridge.deleteChat(targetId);
      if (targetId === current) { setCurrent(null); window.history.replaceState(null, '', '#/chat'); }
      chats.reload();
    } catch (e) { toast(e.message, 'err'); }
  };
  const saveRename = async (e) => {
    e.preventDefault();
    if (!renaming || !renaming.title.trim()) return;
    try {
      const updated = await bridge.patchChat(renaming.id, { title: renaming.title.trim() });
      if (renaming.id === current) setChatInfo(updated);
      chats.reload(true);
      setRenaming(null);
    } catch (err) { toast(err.message, 'err'); }
  };
  const reset = async () => { await change({ reset: true }); toast(t('chat.resetDone')); };
  const stop = async () => { try { await bridge.stopChat(current); } catch (e) { toast(e.message, 'err'); } };

  const info = chatInfo || webChats.find((c) => c.id === current);

  const ml = modelLabel(info, providers.data);
  const empty = !text.trim() && !files.length;
  const mentionQuery = useMemo(() => {
    if ((botsL.data || []).length <= 1) return null;
    const m = text.match(/(?:^|\s)@([\p{L}\p{N}_-]*)$/u);
    return m ? m[1].toLowerCase() : null;
  }, [text, botsL.data]);
  const mentionItems = useMemo(() => {
    if (mentionQuery === null) return [];
    const all = [
      { id: 'todos', name: '@todos', emoji: '👥', description: t('chat.mentionAll') },
      ...(botsL.data || []).map((b) => ({ id: b.id, name: b.name, emoji: b.emoji || '🤖', description: b.description || '' })),
    ];
    return all.filter((x) => !mentionQuery || x.id.toLowerCase().includes(mentionQuery) || x.name.toLowerCase().includes(mentionQuery)).slice(0, 6);
  }, [mentionQuery, botsL.data, t]);
  const pickMention = (item) => {
    const tag = item.id === 'todos' ? '@todos ' : '@' + item.id + ' ';
    setText((prev) => prev.replace(/@[\p{L}\p{N}_-]*$/u, tag));
    inputRef.current?.focus();
  };

  return (
    <div ref={rootRef} className={'chat' + (showList ? ' list-open' : '') + (listHidden ? ' list-hidden' : '') + (term ? ' term' : '')}>
      <aside className="chat-list" id="chat-list">
        <div className="drawer-head only-mobile">
          <h1 className="serif-title">{t('chat.conversations')}</h1>
        </div>
        <Btn icon={Plus} className="block only-desktop" onClick={newChat}>{t('chat.new')}</Btn>
        <label className="search chat-search"><Search size={14} /><input value={chatSearch} onChange={(e) => setChatSearch(e.target.value)} placeholder={t('chat.searchChats')} />{chatSearch && <button type="button" className="ghost bare icon" onClick={() => setChatSearch('')}><X size={13} /></button>}</label>
        <ErrorBox error={chats.error} onRetry={() => chats.reload()} />
        {filteredChats.map((c) => (
          <div key={c.id} className={'chat-item-row' + (c.id === current ? ' active' : '')}>
            <button className={'chat-item' + (c.id === current ? ' active' : '')} onClick={() => select(c.id)}>
              <span className="chat-title">{c.running ? <span className="spin" /> : <MessageCircle size={18} strokeWidth={1.7} />}<span className="ellipsis">{c.title}</span></span>
              <small>{c.bot && c.bot !== 'default' && botsById[c.bot] ? (botsById[c.bot].emoji || '') + ' ' + botsById[c.bot].name + ' · ' : ''}{provName(c.provider)} · {t('chat.msgs', { n: c.totals.runs })} · {f.ago((c.runs.at(-1) || {}).at || c.created)}</small>
            </button>
            <div className="chat-item-actions">
              <IconButton icon={Pencil} size={13} className="ghost bare" label={t('chat.rename')} onClick={(e) => { e.stopPropagation(); setRenaming({ id: c.id, title: c.title }); }} />
              <IconButton icon={Trash2} size={13} className="ghost bare danger-text" label={t('chat.delete')} onClick={(e) => { e.stopPropagation(); remove(c.id); }} />
            </div>
          </div>
        ))}
        {!chats.loading && !filteredChats.length && <p className="muted small">{t('chat.none')}</p>}
        <div className="drawer-foot only-mobile">
          <button type="button" className="new-pill press" onClick={newChat}><Plus size={20} />{t('chat.new')}</button>
        </div>
      </aside>

      <section className="chat-main" ref={mainRef}>
        <div className="chat-scrim" onClick={() => setShowList(false)} />
        <header className="chat-head">
          <IconButton icon={Menu} className="ghost only-mobile nav-btn" label={t('chat.conversations')} onClick={() => setShowList((x) => !x)} />
          <IconButton icon={listHidden ? PanelLeftOpen : PanelLeftClose} className="ghost bare only-desktop list-toggle" label={(listHidden ? t('chat.showList') : t('chat.hideList')) + ' (⌘/Ctrl+B)'} aria-controls="chat-list" aria-expanded={!listHidden} onClick={toggleListHidden} />
          {listHidden && <IconButton icon={SquarePen} className="ghost bare only-desktop list-toggle" label={t('chat.new')} onClick={newChat} />}
          <div className="chat-head-title">{info ? info.title : t('chat.new')}</div>
          <div className="head-capsule only-mobile">
            <IconButton icon={SquarePen} className="ghost" label={t('chat.new')} onClick={newChat} />
            <IconButton icon={Ellipsis} className="ghost" label={t('chat.options')} onClick={() => info && setShowOpts(true)} disabled={!info} />
          </div>
          {openMore && (
            <button type="button" className="glass-btn icon press head-avatar only-mobile" aria-label={t('nav.settings')} onClick={openMore}>
              <span className="avatar-ring" style={{ width: 34, height: 34 }}>{me?.picture ? <img src={me.picture} alt="" referrerPolicy="no-referrer" /> : <UserRound size={19} />}</span>
            </button>
          )}
          {info && <div className="only-desktop"><ChatSettings chat={info} providers={providers.data} bots={botsL.data} onChange={change} /></div>}
          <IconButton icon={SquareTerminal} className={'ghost voice-toggle only-desktop' + (term ? ' on' : '')} label={t('chat.style') + ': ' + (term ? t('chat.styleTerminal') : t('chat.styleBubbles'))} onClick={() => setTerm(!term)} />
          {hasTTS() && (
            <IconButton icon={AudioLines} className={'ghost voice-toggle only-desktop' + (voiceMode ? ' on' : '')} label={t('chat.voiceMode') + ': ' + (voiceMode ? t('common.on') : t('common.off'))} onClick={() => setVoiceMode(!voiceMode)} />
          )}
          {info && (
            <div className="row only-desktop">
              <IconButton icon={Search} className={'ghost' + (showMsgSearch ? ' active' : '')} label={t('chat.searchMsgs')} onClick={() => { setShowMsgSearch((x) => !x); setMsgSearch(''); }} />
              <IconButton icon={RotateCcw} label={t('common.newSession') + ' — ' + t('chat.resetTitle')} onClick={reset} />
              <IconButton icon={Trash2} className="ghost danger-text" label={t('chat.delete')} onClick={() => remove(current)} />
            </div>
          )}
        </header>
        {showMsgSearch && (
          <div className="chat-search-bar">
            <label className="search grow"><Search size={14} /><input autoFocus value={msgSearch} onChange={(e) => setMsgSearch(e.target.value)} placeholder={t('chat.searchMsgs')} /></label>
            <IconButton icon={X} label={t('common.close')} onClick={() => { setShowMsgSearch(false); setMsgSearch(''); }} />
          </div>
        )}

        <div className="chat-scroll" ref={scrollRef} onScroll={onScroll}>
          <ErrorBox error={loadErr} />
          {!messages.length && !live && (
            <div className="chat-empty">
              <div className="hero-ic"><Bot size={28} /></div>
              <h2>{t('chat.emptyTitle')}</h2>
              <p className="muted">{t('chat.emptyText')}</p>
              <div className="suggest">
                {['chat.s1', 'chat.s2', 'chat.s3'].map((k) => (
                  <button key={k} className="ghost" onClick={() => { setText(t(k)); inputRef.current?.focus(); }}>{t(k)}</button>
                ))}
              </div>
            </div>
          )}
          {msgSearch && !shownMessages.length && messages.length > 0 && <p className="muted small" style={{ textAlign: 'center', marginTop: 24 }}>{t('chat.noMatches')}</p>}
          {shownMessages.map((m, idx) => {
            const prevUser = m.role === 'assistant' ? [...shownMessages.slice(0, idx)].reverse().find((x) => x.role === 'user' && x.text) : null;
            return (
              <Message key={m.id} m={m} chatId={current} bot={botsById[m.bot]} botsById={botsById} term={term}
                onResend={(txt) => { setText(txt); inputRef.current?.focus(); }}
                onRetry={prevUser ? () => send(null, prevUser.text) : undefined} />
            );
          })}
          {live && <LiveRun live={live} bot={botsById[live.bot || (info && info.bot) || 'default']} botsById={botsById} term={term} />}
        </div>

        <div className="composer-dock" ref={composerRef}>
          {queuedAhead > 0 && <div className="queue-pill"><Badge kind="warn">{t('chat.queuedBanner', { n: queuedAhead })}</Badge></div>}
          {!atBottom && <button type="button" className="glass-btn icon to-bottom press" aria-label="↓" onClick={() => toBottom(true)}><ArrowDown size={20} /></button>}
          {rec.recording && !hold ? (
            <div className="composer recording">
              <div className="rec-body">
                <span className="rec-dot" /><RecordingTimer started={rec.recording.started} />
                <span className="rec-text">{rec.recording.transcript || t('chat.recording')}</span>
              </div>
              <div className="composer-bar">
                <IconButton icon={Trash2} className="ghost cbtn rec-cancel" size={19} label={t('chat.cancelRec')} onClick={rec.cancel} />
                <span className="grow" />
                <IconButton icon={ArrowUp} className="cmain" size={20} label={t('chat.send')} onClick={finishRec} />
              </div>
            </div>
          ) : (
          <form className={'composer' + (hold && rec.recording ? ' recording holding' : '')} onSubmit={(e) => { e.preventDefault(); send(); }}
            onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); addFiles([...e.dataTransfer.files]); }}>
            {hold && rec.recording ? (
              <div className="rec-body">
                <span className="rec-dot" /><RecordingTimer started={rec.recording.started} />
                <span className="rec-slide" style={{ transform: `translateX(${hold.dx / 2}px)`, opacity: Math.max(0.2, 1 + hold.dx / 110) }}>
                  <ChevronLeft size={16} />{t('chat.slideCancel')}
                </span>
              </div>
            ) : <>
            {mentionItems.length > 0 && (
              <div className="mention-pop" role="listbox">
                {mentionItems.map((it) => (
                  <button key={it.id} type="button" className="mention-item press" onClick={() => pickMention(it)}>
                    <span className="mention-ic">{it.emoji}</span>
                    <b>{it.id === 'todos' ? '@todos' : it.name}</b>
                    {it.id !== 'todos' && <small className="muted">@{it.id}</small>}
                    {it.description && <span className="muted small ellipsis">{it.description}</span>}
                  </button>
                ))}
              </div>
            )}
            <PendingFiles files={files} onRemove={(i) => setFiles((x) => x.filter((_, j) => j !== i))} />
            <input ref={fileRef} type="file" multiple hidden onChange={(e) => { addFiles([...e.target.files]); e.target.value = ''; }} />
            <textarea onPaste={onPaste}
              ref={inputRef} rows={Math.min(8, Math.max(1, text.split('\n').length))} value={text}
              placeholder={t('chat.placeholder')} aria-label={t('chat.placeholder')} enterKeyHint="send"
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing && window.matchMedia('(hover: hover)').matches) { e.preventDefault(); send(); } }}
            />
            </>}
            <div className="composer-bar">
              <div className="cb-left">
                <IconButton icon={Plus} className="ghost cbtn" size={21} label={t('chat.attach')} onClick={() => fileRef.current?.click()} />
                {ml && (
                  <button type="button" className="model-pill press" onClick={() => setShowOpts(true)} aria-label={t('chat.model')}>
                    <span className="ellipsis">{ml.name}</span>{ml.effort && <span className="model-effort">{ml.effort}</span>}
                  </button>
                )}
              </div>
              <span className="grow" />
              {empty && canRecord() && (
                <div className="mic-slot" key="mic-slot">
                  {hold && rec.recording && <span className="rec-lock" style={{ opacity: Math.min(1, 0.45 - hold.dy / 80) }}><Lock size={15} /></span>}
                  {micButton}
                </div>
              )}
              {!hold && (!empty
                ? <IconButton icon={ArrowUp} className="cmain" size={20} label={t('chat.send')} type="submit" disabled={sending} />
                : live
                  ? <IconButton icon={Square} className="cmain" size={16} label={t('common.stop')} onClick={stop} />
                  : hasTTS()
                    ? <IconButton icon={AudioLines} className={'cmain' + (voiceMode ? ' on' : ' off')} size={20} label={t('chat.voiceMode') + ': ' + (voiceMode ? t('common.on') : t('common.off'))} onClick={() => setVoiceMode(!voiceMode)} />
                    : <IconButton icon={ArrowUp} className="cmain" size={20} label={t('chat.send')} type="submit" disabled />)}
            </div>
          </form>
          )}
          {info && (
            <div className="chat-foot muted small">
              {t('chat.foot', { runs: info.totals.runs, time: f.dur(info.totals.ms), cost: f.usd(info.totals.cost) })}
              {(info.session || info.agySession) ? ' · ' + t('chat.session', { id: (info.provider === 'antigravity' ? info.agySession : info.session).slice(0, 8) }) : ''}
              {' '}<Badge kind={live ? 'warn' : 'ok'}>{live ? t('chat.busy') : t('chat.ready')}</Badge>
            </div>
          )}
        </div>
      </section>
      {showOpts && info && (
        <Sheet title={t('chat.options')} onClose={() => setShowOpts(false)}>
          <div className="group-label">{info.title}</div>
          <div className="group pad"><ChatSettings chat={info} providers={providers.data} bots={botsL.data} onChange={change} /></div>
          {(botsL.data || []).length > 1 && (
            <div className="group pad stack">
              <div className="row spread">
                <span className="row" style={{ gap: 8 }}><span className="row-ic ic-bots"><Users size={16} /></span><b>{t('chat.groupMembers')}</b></span>
                <div className="seg seg-ios" role="radiogroup">
                  <button type="button" className={!(info.members && info.members.length) ? 'on' : ''} onClick={() => change({ members: [] })}>{t('chat.groupAll')}</button>
                  <button type="button" className={(info.members && info.members.length) ? 'on' : ''} onClick={() => !(info.members && info.members.length) && change({ members: (botsL.data || []).map((b) => b.id) })}>{t('chat.groupSome')}</button>
                </div>
              </div>
              <small className="muted">{t('chat.groupHint')}</small>
              {info.members && info.members.length > 0 && (
                <div className="row wrap" style={{ gap: 6 }}>
                  {(botsL.data || []).map((b) => {
                    const on = info.members.includes(b.id);
                    return (
                      <label key={b.id} className="check chip-check">
                        <input type="checkbox" checked={on} onChange={(e) => {
                          const next = e.target.checked ? [...info.members, b.id] : info.members.filter((x) => x !== b.id);
                          change({ members: next });
                        }} />
                        {(b.emoji ? b.emoji + ' ' : '') + b.name}
                      </label>
                    );
                  })}
                </div>
              )}
            </div>
          )}
          <div className="group">
            <div className="group-row">
              <span className="row-ic ic-chat"><SquareTerminal size={17} /></span>
              <span className="grow"><b>{t('chat.style')}</b><small className="muted">{t('chat.styleHint')}</small></span>
              <div className="seg seg-ios" role="radiogroup" aria-label={t('chat.style')}>
                <button type="button" role="radio" aria-checked={!term} className={!term ? 'on' : ''} onClick={() => setTerm(false)}>{t('chat.styleBubbles')}</button>
                <button type="button" role="radio" aria-checked={term} className={term ? 'on' : ''} onClick={() => setTerm(true)}>{t('chat.styleTerminal')}</button>
              </div>
            </div>
          </div>
          {hasTTS() && (
            <div className="group">
              <label className="group-row">
                <span className="row-ic ic-chat"><AudioLines size={17} /></span>
                <span className="grow"><b>{t('chat.voiceMode')}</b><small className="muted">{t('chat.voiceModeHint')}</small></span>
                <input type="checkbox" checked={voiceMode} onChange={(e) => setVoiceMode(e.target.checked)} />
              </label>
            </div>
          )}
          <div className="group">
            <button className="group-row press" onClick={() => { setShowOpts(false); setShowMsgSearch(true); }}>
              <span className="row-ic ic-chat"><Search size={17} /></span>
              <span className="grow"><b>{t('chat.searchMsgs')}</b></span>
            </button>
            <button className="group-row press" onClick={() => { setShowOpts(false); setRenaming({ id: info.id, title: info.title }); }}>
              <span className="row-ic ic-chat"><Pencil size={17} /></span>
              <span className="grow"><b>{t('chat.rename')}</b></span>
            </button>
            <button className="group-row press" onClick={() => { setShowOpts(false); reset(); }}>
              <span className="row-ic ic-providers"><RotateCcw size={17} /></span>
              <span className="grow"><b>{t('common.newSession')}</b><small className="muted">{t('chat.resetTitle')}</small></span>
            </button>
            <button className="group-row press danger-text" onClick={() => { setShowOpts(false); remove(current); }}>
              <span className="row-ic ic-logout"><Trash2 size={17} /></span><span className="grow">{t('chat.delete')}</span>
            </button>
          </div>
        </Sheet>
      )}
      {renaming && (
        <Modal title={t('chat.renameTitle')} onClose={() => setRenaming(null)}>
          <form className="stack" onSubmit={saveRename}>
            <Field label={t('mem.title')}>
              <input autoFocus required value={renaming.title} onChange={(e) => setRenaming({ ...renaming, title: e.target.value })} />
            </Field>
            <div className="row end">
              <button type="button" className="ghost" onClick={() => setRenaming(null)}>{t('common.cancel')}</button>
              <button disabled={!renaming.title.trim()}>{t('common.save')}</button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}
