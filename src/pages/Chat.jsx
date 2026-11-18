import { useEffect, useMemo, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { bridge } from '../api.js';
import { Badge, ErrorBox, confirmAsk, fmtAgo, fmtDur, useLoad, useToast, usd } from '../ui.jsx';

const chatFromHash = () => {
  const m = window.location.hash.match(/^#\/chat\/([a-f0-9]+)/);
  return m ? 'web:' + m[1] : null;
};

const Md = ({ text }) => (
  <div className="md">
    <ReactMarkdown remarkPlugins={[remarkGfm]} components={{ a: (p) => <a {...p} target="_blank" rel="noreferrer" /> }}>{text || ''}</ReactMarkdown>
  </div>
);

function ToolList({ tools }) {
  if (!tools || !tools.length) return null;
  return (
    <details className="tools">
      <summary>{tools.length} {tools.length === 1 ? 'ferramenta usada' : 'ferramentas usadas'}: {[...new Set(tools.map((t) => t.name))].join(', ')}</summary>
      {tools.map((t, i) => (
        <div key={t.id || i} className={'tool' + (t.isError ? ' bad' : '')}>
          <div className="tool-h"><b>{t.name}</b>{t.result === undefined && <span className="spin" />}</div>
          <pre>{t.input}</pre>
          {t.result !== undefined && <pre className="tool-out">{t.result || '(vazio)'}</pre>}
        </div>
      ))}
    </details>
  );
}

function Message({ m }) {
  if (m.role === 'user') return <div className="msg user"><div className="bubble">{m.text}</div></div>;
  return (
    <div className={'msg bot' + (m.error ? ' error' : '') + (m.stopped ? ' stopped' : '')}>
      <ToolList tools={m.tools} />
      <Md text={m.text} />
      <div className="msg-meta">
        {m.provider && <span>{m.provider === 'antigravity' ? 'Antigravity' : 'Claude'}</span>}
        {m.usage && m.usage.ms ? <span>{fmtDur(m.usage.ms)}</span> : null}
        {m.usage && m.usage.turns ? <span>{m.usage.turns} passos</span> : null}
        {m.usage && m.usage.cost ? <span>{usd(m.usage.cost)}</span> : null}
        <button className="link" onClick={() => navigator.clipboard.writeText(m.text)}>copiar</button>
      </div>
    </div>
  );
}

function LiveRun({ live }) {
  const secs = useTicker(live.started);
  return (
    <div className="msg bot live">
      <ToolList tools={live.tools} />
      {live.texts.length > 0 && <Md text={live.texts.join('\n\n')} />}
      <div className="msg-meta"><span className="spin" /> trabalhando… {secs}s{live.model ? ' · ' + live.model : ''}
        {live.mcp && live.mcp.length > 0 && <span> · MCP: {live.mcp.map((s) => s.name + (s.status === 'connected' ? '' : ' (' + s.status + ')')).join(', ')}</span>}
      </div>
    </div>
  );
}

function useTicker(since) {
  const [, set] = useState(0);
  useEffect(() => { const t = setInterval(() => set((x) => x + 1), 1000); return () => clearInterval(t); }, []);
  return Math.round((Date.now() - since) / 1000);
}

function ChatSettings({ chat, providers, onChange }) {
  if (!chat || !providers) return null;
  const prov = providers.providers.find((p) => p.id === chat.provider) || providers.providers[0];
  const agy = chat.provider === 'antigravity';
  const agyModel = agy && prov.models.find((m) => m.id === chat.agyModel);
  const efforts = agy ? (agyModel ? agyModel.efforts : []) : prov.efforts;
  return (
    <div className="chat-settings">
      <select value={chat.provider} onChange={(e) => onChange({ provider: e.target.value })} title="Provider">
        {providers.providers.map((p) => <option key={p.id} value={p.id} disabled={!p.installed}>{p.name}{p.installed ? '' : ' (não instalado)'}</option>)}
      </select>
      <select value={agy ? chat.agyModel : chat.model} onChange={(e) => onChange(agy ? { agyModel: e.target.value, agyEffort: '' } : { model: e.target.value })} title="Modelo">
        <option value="">{agy ? 'modelo padrão' : 'padrão (' + (prov.defaultModel || 'conta') + ')'}</option>
        {prov.models.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
      </select>
      {efforts && efforts.length > 0 && (
        <select value={agy ? chat.agyEffort : chat.effort} onChange={(e) => onChange(agy ? { agyEffort: e.target.value } : { effort: e.target.value })} title="Esforço">
          <option value="">esforço padrão</option>
          {efforts.map((e) => <option key={e} value={e}>{e}</option>)}
        </select>
      )}
    </div>
  );
}

export default function Chat() {
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

  // Pick the most recent conversation when none is selected.
  useEffect(() => {
    if (!current && webChats.length) select(webChats[0].id, true);
  }, [webChats.length]); // eslint-disable-line react-hooks/exhaustive-deps

  const select = (id, replace) => {
    const h = '#/chat/' + id.slice(4);
    if (replace) window.history.replaceState(null, '', h); else window.location.hash = h;
    setCurrent(id); setShowList(false);
  };
  useEffect(() => {
    const onHash = () => { const id = chatFromHash(); if (id) setCurrent(id); };
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  // Load history and follow live events of the selected conversation.
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
      if (ev.type === 'hello') {
        load();
        setLive(ev.running ? { started: ev.running.started, texts: [], tools: [] } : null);
      } else if (ev.type === 'message') {
        setMessages((ms) => (ms.some((m) => m.id === ev.message.id) ? ms : [...ms, ev.message]));
      } else if (ev.type === 'start') {
        setLive({ started: Date.now(), texts: [], tools: [], provider: ev.provider });
      } else if (ev.type === 'init') {
        setLive((l) => l && { ...l, model: ev.model, mcp: ev.mcp });
      } else if (ev.type === 'text') {
        setLive((l) => l && { ...l, texts: [...l.texts, ev.text] });
      } else if (ev.type === 'tool') {
        setLive((l) => l && { ...l, tools: [...l.tools, { id: ev.id, name: ev.name, input: ev.input }] });
      } else if (ev.type === 'tool_result') {
        setLive((l) => l && { ...l, tools: l.tools.map((t) => (t.id === ev.id ? { ...t, result: ev.text, isError: ev.isError } : t)) });
      } else if (ev.type === 'idle') {
        setLive(null);
        chats.reload(true);
      }
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
    const t = text.trim();
    if (!t) return;
    let id = current;
    try {
      if (!id) { const c = await bridge.newWeb({}); id = c.id; select(c.id); }
      setText('');
      const r = await bridge.send(id, t);
      if (r.ahead) toast('Na fila: ' + r.ahead + ' à frente');
      chats.reload(true);
    } catch (e) { toast(e.message, 'err'); setText(t); }
  };

  const change = async (b) => {
    try { setChatInfo(await bridge.patchChat(current, b)); chats.reload(true); } catch (e) { toast(e.message, 'err'); }
  };
  const remove = async () => {
    if (!confirmAsk('Apagar esta conversa e o histórico dela?')) return;
    try {
      await bridge.deleteChat(current);
      setCurrent(null); window.history.replaceState(null, '', '#/chat');
      chats.reload();
    } catch (e) { toast(e.message, 'err'); }
  };
  const reset = async () => { await change({ reset: true }); toast('A próxima mensagem começa uma sessão nova (o histórico daqui fica).'); };
  const stop = async () => { try { await bridge.stopChat(current); } catch (e) { toast(e.message, 'err'); } };

  const info = chatInfo || webChats.find((c) => c.id === current);

  return (
    <div className={'chat' + (showList ? ' list-open' : '')}>
      <aside className="chat-list">
        <button className="block" onClick={newChat}>+ Nova conversa</button>
        <ErrorBox error={chats.error} onRetry={() => chats.reload()} />
        {webChats.map((c) => (
          <button key={c.id} className={'chat-item' + (c.id === current ? ' active' : '')} onClick={() => select(c.id)}>
            <span className="chat-title">{c.running && <span className="spin" />}{c.title}</span>
            <small>{c.provider === 'antigravity' ? 'Antigravity' : 'Claude'} · {c.totals.runs} msgs · {fmtAgo((c.runs.at(-1) || {}).at || c.created)}</small>
          </button>
        ))}
        {!chats.loading && !webChats.length && <p className="muted small">Nenhuma conversa ainda.</p>}
      </aside>

      <section className="chat-main">
        <header className="chat-head">
          <button className="ghost icon only-mobile" onClick={() => setShowList((x) => !x)} aria-label="Conversas">☰</button>
          <div className="chat-head-title">{info ? info.title : 'Nova conversa'}</div>
          {info && <ChatSettings chat={info} providers={providers.data} onChange={change} />}
          {info && (
            <div className="row">
              <button className="ghost small" onClick={reset} title="Esquece o contexto da IA, mantém o histórico na tela">Nova sessão</button>
              <button className="ghost small danger-text" onClick={remove}>Apagar</button>
            </div>
          )}
        </header>

        <div className="chat-scroll">
          <ErrorBox error={loadErr} />
          {!messages.length && !live && (
            <div className="chat-empty">
              <h2>Fale com o agente</h2>
              <p className="muted">Mesmo agente do WhatsApp, com as mesmas ferramentas, MCPs e memória. As respostas aparecem aqui ao vivo.</p>
              <div className="suggest">
                {['Quais MCPs você tem disponíveis agora?', 'Liste meus agendamentos', 'Quanto espaço em disco o container está usando?'].map((s) => (
                  <button key={s} className="ghost" onClick={() => { setText(s); inputRef.current?.focus(); }}>{s}</button>
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
            placeholder="Mensagem para o agente… (Enter envia, Shift+Enter quebra linha)"
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); send(); } }}
          />
          {live ? <button type="button" className="danger" onClick={stop}>Parar</button> : null}
          <button disabled={!text.trim()}>Enviar</button>
        </form>
        {info && <div className="chat-foot muted small">
          {info.totals.runs} execuções · {fmtDur(info.totals.ms)} · {usd(info.totals.cost)}{info.session || info.agySession ? ' · sessão ' + (info.provider === 'antigravity' ? info.agySession : info.session).slice(0, 8) : ''}
          {' '}<Badge kind={live ? 'warn' : 'ok'}>{live ? 'trabalhando' : 'pronto'}</Badge>
        </div>}
      </section>
    </div>
  );
}
