import { useEffect, useMemo, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Bot, Copy, Globe, MessagesSquare, Plus, RotateCcw, SendHorizontal, Square, Trash2, Wrench } from 'lucide-react';
import { bridge } from '../api.js';
import { useT } from '../i18n.jsx';
import { Badge, Btn, ErrorBox, IconButton, confirmAsk, useFmt, useLoad, useToast } from '../ui.jsx';

const chatFromHash = () => {
  const m = window.location.hash.match(/^#\/chat\/([a-f0-9]+)/);
  return m ? 'web:' + m[1] : null;
};
const provName = (p) => (p === 'antigravity' ? 'Antigravity' : 'Claude');

const Md = ({ text }) => (
  <div className="md">
    <ReactMarkdown remarkPlugins={[remarkGfm]} components={{ a: (p) => <a {...p} target="_blank" rel="noreferrer" /> }}>{text || ''}</ReactMarkdown>
  </div>
);

function ToolList({ tools }) {
  const t = useT();
  if (!tools || !tools.length) return null;
  return (
    <details className="tools">
      <summary><Wrench size={13} /> {tools.length === 1 ? t('chat.toolsOne') : t('chat.toolsMany', { n: tools.length })}: {[...new Set(tools.map((x) => x.name))].join(', ')}</summary>
      {tools.map((x, i) => (
        <div key={x.id || i} className={'tool' + (x.isError ? ' bad' : '')}>
          <div className="tool-h"><b>{x.name}</b>{x.result === undefined && <span className="spin" />}</div>
          <pre>{x.input}</pre>
          {x.result !== undefined && <pre className="tool-out">{x.result || t('common.empty')}</pre>}
        </div>
      ))}
    </details>
  );
}

function Message({ m }) {
  const t = useT();
  const f = useFmt();
  const toast = useToast();
  if (m.role === 'user') return <div className="msg user"><div className="bubble">{m.text}</div></div>;
  return (
    <div className={'msg bot' + (m.error ? ' error' : '') + (m.stopped ? ' stopped' : '')}>
      <div className="avatar" aria-hidden><Bot size={16} /></div>
      <div className="msg-body">
        <ToolList tools={m.tools} />
        <Md text={m.text} />
        <div className="msg-meta">
          {m.provider && <span>{provName(m.provider)}</span>}
          {m.usage?.ms ? <span>{f.dur(m.usage.ms)}</span> : null}
          {m.usage?.turns ? <span>{t('chat.steps', { n: m.usage.turns })}</span> : null}
          {m.usage?.cost ? <span>{f.usd(m.usage.cost)}</span> : null}
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

function LiveRun({ live }) {
  const t = useT();
  useTicker();
  const secs = Math.round((Date.now() - live.started) / 1000);
  return (
    <div className="msg bot live">
      <div className="avatar" aria-hidden><Bot size={16} /></div>
      <div className="msg-body">
        <ToolList tools={live.tools} />
        {live.texts.length > 0 && <Md text={live.texts.join('\n\n')} />}
        <div className="msg-meta"><span className="spin" /> {t('chat.working')} {secs}s{live.model ? ' · ' + live.model : ''}
          {live.mcp?.length > 0 && <span> · MCP: {live.mcp.map((s) => s.name + (s.status === 'connected' ? '' : ' (' + s.status + ')')).join(', ')}</span>}
        </div>
      </div>
    </div>
  );
}

function ChatSettings({ chat, providers, onChange }) {
  const t = useT();
  if (!chat || !providers) return null;
  const prov = providers.providers.find((p) => p.id === chat.provider) || providers.providers[0];
  const agy = chat.provider === 'antigravity';
  const agyModel = agy && prov.models.find((m) => m.id === chat.agyModel);
  const efforts = agy ? (agyModel ? agyModel.efforts : []) : prov.efforts;
  return (
    <div className="chat-settings">
      <select value={chat.provider} onChange={(e) => onChange({ provider: e.target.value })} aria-label={t('chat.provider')}>
        {providers.providers.map((p) => <option key={p.id} value={p.id} disabled={!p.installed}>{p.name}{p.installed ? '' : ' (' + t('common.notInstalled') + ')'}</option>)}
      </select>
      <select value={agy ? chat.agyModel : chat.model} onChange={(e) => onChange(agy ? { agyModel: e.target.value, agyEffort: '' } : { model: e.target.value })} aria-label={t('chat.model')}>
        <option value="">{agy ? t('common.defaultModel') : t('chat.accountDefault', { m: prov.defaultModel || '—' })}</option>
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

export default function Chat() {
  const t = useT();
  const f = useFmt();
  const toast = useToast();
  const chats = useLoad(() => bridge.chats(), [], { interval: 15000 });
  const providers = useLoad(() => bridge.providers(), []);
  const [current, setCurrent] = useState(chatFromHash);
  const [messages, setMessages] = useState([]);
  const [chatInfo, setChatInfo] = useState(null);
  const [live, setLive] = useState(null);
  const [text, setText] = useState('');
  const [loadErr, setLoadErr] = useState(null);
  const [showList, setShowList] = useState(false);
  const endRef = useRef(null);
  const inputRef = useRef(null);

  const webChats = useMemo(() => (chats.data || []).filter((c) => c.kind === 'web'), [chats.data]);

  const select = (id, replace) => {
    const h = '#/chat/' + id.slice(4);
    if (replace) window.history.replaceState(null, '', h); else window.location.hash = h;
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
    setMessages([]); setLive(null); setLoadErr(null); setChatInfo(null);
    const load = () => bridge.messages(current)
      .then((r) => { if (!closed) { setMessages(r.messages); setChatInfo(r.chat); } })
      .catch((e) => !closed && setLoadErr(e.message));
    load();
    const es = new EventSource(bridge.eventsUrl(current));
    es.onmessage = (e) => {
      const ev = JSON.parse(e.data);
      if (ev.type === 'hello') { load(); setLive(ev.running ? { started: ev.running.started, texts: [], tools: [] } : null); }
      else if (ev.type === 'message') setMessages((ms) => (ms.some((m) => m.id === ev.message.id) ? ms : [...ms, ev.message]));
      else if (ev.type === 'start') setLive({ started: Date.now(), texts: [], tools: [], provider: ev.provider });
      else if (ev.type === 'init') setLive((l) => l && { ...l, model: ev.model, mcp: ev.mcp });
      else if (ev.type === 'text') setLive((l) => l && { ...l, texts: [...l.texts, ev.text] });
      else if (ev.type === 'tool') setLive((l) => l && { ...l, tools: [...l.tools, { id: ev.id, name: ev.name, input: ev.input }] });
      else if (ev.type === 'tool_result') setLive((l) => l && { ...l, tools: l.tools.map((x) => (x.id === ev.id ? { ...x, result: ev.text, isError: ev.isError } : x)) });
      else if (ev.type === 'idle') { setLive(null); chats.reload(true); }
    };
    return () => { closed = true; es.close(); };
  }, [current]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { endRef.current?.scrollIntoView({ block: 'end' }); }, [messages, live]);

  const newChat = async () => {
    try {
      const c = await bridge.newWeb({});
      await chats.reload(true);
      select(c.id);
      setTimeout(() => inputRef.current?.focus(), 50);
    } catch (e) { toast(e.message, 'err'); }
  };
  const send = async () => {
    const msg = text.trim();
    if (!msg) return;
    let id = current;
    try {
      if (!id) { const c = await bridge.newWeb({}); id = c.id; select(c.id); }
      setText('');
      const r = await bridge.send(id, msg);
      if (r.ahead) toast(t('chat.queued', { n: r.ahead }));
      chats.reload(true);
    } catch (e) { toast(e.message, 'err'); setText(msg); }
  };
  const change = async (b) => { try { setChatInfo(await bridge.patchChat(current, b)); chats.reload(true); } catch (e) { toast(e.message, 'err'); } };
  const remove = async () => {
    if (!confirmAsk(t('chat.deleteConfirm'))) return;
    try { await bridge.deleteChat(current); setCurrent(null); window.history.replaceState(null, '', '#/chat'); chats.reload(); }
    catch (e) { toast(e.message, 'err'); }
  };
  const reset = async () => { await change({ reset: true }); toast(t('chat.resetDone')); };
  const stop = async () => { try { await bridge.stopChat(current); } catch (e) { toast(e.message, 'err'); } };

  const info = chatInfo || webChats.find((c) => c.id === current);

  return (
    <div className={'chat' + (showList ? ' list-open' : '')}>
      <aside className="chat-list">
        <Btn icon={Plus} className="block" onClick={newChat}>{t('chat.new')}</Btn>
        <ErrorBox error={chats.error} onRetry={() => chats.reload()} />
        {webChats.map((c) => (
          <button key={c.id} className={'chat-item' + (c.id === current ? ' active' : '')} onClick={() => select(c.id)}>
            <span className="chat-title">{c.running ? <span className="spin" /> : <Globe size={13} />}{c.title}</span>
            <small>{provName(c.provider)} · {t('chat.msgs', { n: c.totals.runs })} · {f.ago((c.runs.at(-1) || {}).at || c.created)}</small>
          </button>
        ))}
        {!chats.loading && !webChats.length && <p className="muted small">{t('chat.none')}</p>}
      </aside>
      <div className="chat-scrim" onClick={() => setShowList(false)} />

      <section className="chat-main">
        <header className="chat-head">
          <IconButton icon={MessagesSquare} className="ghost only-mobile" label={t('chat.conversations')} onClick={() => setShowList((x) => !x)} />
          <div className="chat-head-title">{info ? info.title : t('chat.new')}</div>
          {info && <ChatSettings chat={info} providers={providers.data} onChange={change} />}
          {info && (
            <div className="row">
              <IconButton icon={RotateCcw} label={t('common.newSession') + ' — ' + t('chat.resetTitle')} onClick={reset} />
              <IconButton icon={Trash2} className="ghost danger-text" label={t('chat.delete')} onClick={remove} />
            </div>
          )}
        </header>

        <div className="chat-scroll">
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
          {messages.map((m) => <Message key={m.id} m={m} />)}
          {live && <LiveRun live={live} />}
          <div ref={endRef} />
        </div>

        <form className="composer" onSubmit={(e) => { e.preventDefault(); send(); }}>
          <textarea
            ref={inputRef} rows={Math.min(8, Math.max(1, text.split('\n').length))} value={text}
            placeholder={t('chat.placeholder')} aria-label={t('chat.placeholder')} enterKeyHint="send"
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing && window.matchMedia('(hover: hover)').matches) { e.preventDefault(); send(); } }}
          />
          {live && <IconButton icon={Square} className="danger" label={t('common.stop')} onClick={stop} />}
          <IconButton icon={SendHorizontal} className="primary" label={t('chat.send')} type="submit" disabled={!text.trim()} />
        </form>
        {info && (
          <div className="chat-foot muted small">
            {t('chat.foot', { runs: info.totals.runs, time: f.dur(info.totals.ms), cost: f.usd(info.totals.cost) })}
            {(info.session || info.agySession) ? ' · ' + t('chat.session', { id: (info.provider === 'antigravity' ? info.agySession : info.session).slice(0, 8) }) : ''}
            {' '}<Badge kind={live ? 'warn' : 'ok'}>{live ? t('chat.busy') : t('chat.ready')}</Badge>
          </div>
        )}
      </section>
    </div>
  );
}
