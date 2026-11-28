import { useCallback, useEffect, useRef, useState } from 'react';
import { AlertTriangle, Camera, Check, Copy, Download, ExternalLink, Eye, Globe, GraduationCap, Hand, History, KeyRound, Laptop, Maximize2, Monitor, MousePointer2, PenTool, Play, Plus, Power, RefreshCw, Send, SkipForward, Trash2 } from 'lucide-react';
import { bridge } from '../api.js';
import { store, useT } from '../i18n.jsx';
import { Badge, Btn, Card, ErrorBox, Field, Modal, useAction, useFmt, useLoad, useToast } from '../ui.jsx';
import { imageLink, openImage } from '../viewer.jsx';
import { ListGroup, Row, useIsMobile } from '../native.jsx';

function AnnotateModal({ currentUrl, onClose }) {
  const toast = useToast();
  const chats = useLoad(() => bridge.chats(), [], { cacheKey: '/bridge/chats' });
  const webChats = (chats.data || []).filter((c) => c.kind === 'web' && !c.archived);
  const [chatId, setChatId] = useState('');
  const [note, setNote] = useState('');
  const [rect, setRect] = useState(null);
  const [drag, setDrag] = useState(null);
  const [imgSrc] = useState(() => bridge.computerScreenshotUrl());
  const imgRef = useRef(null);
  const [busy, run] = useAction();

  useEffect(() => { if (!chatId && webChats.length) setChatId(webChats[0].id); }, [webChats, chatId]);

  const toRel = (e) => {
    const box = e.currentTarget.getBoundingClientRect();
    return { x: Math.max(0, Math.min(1, (e.clientX - box.left) / box.width)), y: Math.max(0, Math.min(1, (e.clientY - box.top) / box.height)) };
  };
  const onDown = (e) => { const p = toRel(e); setDrag(p); setRect({ x: p.x, y: p.y, w: 0, h: 0 }); };
  const onMove = (e) => {
    if (!drag) return;
    const p = toRel(e);
    setRect({ x: Math.min(drag.x, p.x), y: Math.min(drag.y, p.y), w: Math.abs(p.x - drag.x), h: Math.abs(p.y - drag.y) });
  };
  const onUp = () => setDrag(null);

  const sendAnnotated = async (e) => {
    e.preventDefault();
    const targetId = chatId || webChats[0]?.id;
    if (!targetId) return toast('Crie uma conversa web primeiro', 'err');
    const img = imgRef.current;
    if (!img) return;
    const canvas = document.createElement('canvas');
    canvas.width = img.naturalWidth || 1280;
    canvas.height = img.naturalHeight || 800;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    if (rect && rect.w > 0.01 && rect.h > 0.01) {
      ctx.strokeStyle = '#ff375f';
      ctx.lineWidth = Math.max(4, Math.round(canvas.width / 250));
      ctx.strokeRect(rect.x * canvas.width, rect.y * canvas.height, rect.w * canvas.width, rect.h * canvas.height);
      ctx.fillStyle = 'rgba(255,55,95,0.14)';
      ctx.fillRect(rect.x * canvas.width, rect.y * canvas.height, rect.w * canvas.width, rect.h * canvas.height);
    }
    const dataUrl = canvas.toDataURL('image/png');
    const b64 = dataUrl.split(',')[1] || '';
    const msg = `[Anotação na tela do Computador${currentUrl ? ' (' + currentUrl + ')' : ''}]\n${note.trim() || 'Veja a área destacada em vermelho nesta tela.'}`;
    const r = await run('send', () => bridge.send(targetId, msg, [{ name: 'tela-anotada.png', type: 'image/png', data: b64 }]), 'Anotação enviada ao chat');
    if (r) { onClose(); window.location.hash = '#/chat/' + targetId.slice(4); }
  };

  return (
    <Modal title="Anotar tela e enviar ao chat" onClose={onClose} wide>
      <form className="stack" onSubmit={sendAnnotated}>
        <p className="muted small" style={{ margin: 0 }}>Arraste sobre a captura para destacar a área desejada, adicione seu comentário e envie direto para o bot.</p>
        <div style={{ position: 'relative', userSelect: 'none', cursor: 'crosshair', borderRadius: 10, overflow: 'hidden', border: '1px solid var(--border)' }}
          onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp}>
          <img ref={imgRef} src={imgSrc} alt="Tela" style={{ width: '100%', display: 'block' }} crossOrigin="anonymous" />
          {rect && rect.w > 0.005 && (
            <div style={{
              position: 'absolute', left: (rect.x * 100) + '%', top: (rect.y * 100) + '%',
              width: (rect.w * 100) + '%', height: (rect.h * 100) + '%',
              border: '2px solid #ff375f', background: 'rgba(255,55,95,0.16)', pointerEvents: 'none',
            }} />
          )}
        </div>
        <div className="form-grid">
          <Field label="Enviar para conversa">
            <select value={chatId} onChange={(e) => setChatId(e.target.value)}>
              {webChats.map((c) => <option key={c.id} value={c.id}>{c.title}</option>)}
            </select>
          </Field>
          <Field label="Instrução / comentário">
            <input required value={note} onChange={(e) => setNote(e.target.value)} placeholder="Ex.: Clique neste botão ou corrija este valor" />
          </Field>
        </div>
        <div className="row end">
          <button type="button" className="ghost" onClick={onClose}>Cancelar</button>
          <Btn icon={Send} disabled={busy === 'send' || !webChats.length}>Enviar anotação ao chat</Btn>
        </div>
      </form>
    </Modal>
  );
}

function TeachModal({ currentUrl, onClose }) {
  const t = useT();
  const toast = useToast();
  const [name, setName] = useState('');
  const [goal, setGoal] = useState('');
  const [steps, setSteps] = useState(currentUrl && currentUrl !== 'about:blank' ? `1. Abrir ${currentUrl}\n2. ` : '1. ');
  const [busy, run] = useAction();

  const save = async (e) => {
    e.preventDefault();
    const r = await run('teach', () => bridge.addSkill({
      name: name.trim(),
      description: goal.trim(),
      instructions: steps.trim(),
      source: 'taught',
    }), t('comp.taughtSaved'));
    if (r) { toast(t('comp.taughtSaved')); onClose(); }
  };

  return (
    <Modal title={t('comp.teachTitle')} onClose={onClose} wide>
      <form className="stack" onSubmit={save}>
        <p className="muted small" style={{ margin: 0 }}>{t('comp.teachIntro')}</p>
        <Field label={t('sk.name')}><input required autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder={t('comp.teachNamePh')} /></Field>
        <Field label={t('sk.desc')}><input value={goal} onChange={(e) => setGoal(e.target.value)} placeholder={t('comp.teachGoalPh')} /></Field>
        <Field label={t('sk.instructions')} hint={t('comp.teachStepsHint')}>
          <textarea required rows={9} value={steps} onChange={(e) => setSteps(e.target.value)} />
        </Field>
        <div className="row end">
          <button type="button" className="ghost" onClick={onClose}>{t('common.cancel')}</button>
          <button disabled={busy === 'teach'}>{t('comp.teachSave')}</button>
        </div>
      </form>
    </Modal>
  );
}

function LocalBridgeCard() {
  const toast = useToast();
  const f = useFmt();
  const devs = useLoad(() => bridge.localDevices(), [], { interval: 10000 });
  const [name, setName] = useState('');
  const [paired, setPaired] = useState(null);
  const [busy, run] = useAction();

  const pair = async (e) => {
    e.preventDefault();
    const r = await run('pair', () => bridge.localPair(name.trim() || 'Meu Computador'), 'Dispositivo pareado');
    if (r) { setPaired(r); setName(''); devs.reload(true); }
  };

  return (
    <Card title={`Meus Computadores — Local Bridge (${(devs.data || []).length})`} icon={Laptop}>
      <p className="muted small" style={{ marginTop: 0 }}>
        Conecte seu Mac, Linux ou Windows pessoal (estilo OpenAI Dots) para os bots acessarem arquivos locais ou abrirem sites no seu navegador pessoal. Conexão revogável a qualquer momento.
      </p>
      <form className="row wrap" onSubmit={pair} style={{ marginBottom: 10 }}>
        <input className="grow" value={name} onChange={(e) => setName(e.target.value)} placeholder="Nome do computador (ex.: Meu MacBook Pro)" />
        <Btn icon={Plus} className="small" disabled={busy === 'pair'}>Parear novo PC/Mac</Btn>
      </form>
      {paired && (
        <div className="trigger-box stack" style={{ marginBottom: 10 }}>
          <div className="row between wrap">
            <b>✅ Token gerado para "{paired.name}" (mostrado uma única vez)</b>
            <a className="btn small" href={bridge.localAgentUrl(paired.token)} download="local-bridge-agent.mjs">
              <Download size={14} /> Baixar local-bridge-agent.mjs
            </a>
          </div>
          <div className="row wrap">
            <code className="mono small grow ellipsis">node local-bridge-agent.mjs</code>
            <Btn icon={Copy} type="button" className="ghost small" onClick={() => { navigator.clipboard.writeText(paired.token); toast('Token copiado'); }}>Copiar token</Btn>
          </div>
          <p className="muted small" style={{ margin: 0 }}>Baixe o script acima (Node 22+, zero dependências) e rode no terminal do seu Mac/PC. O status muda para Online na hora.</p>
        </div>
      )}
      {!(devs.data || []).length && <p className="muted small">Nenhum computador local pareado ainda.</p>}
      {(devs.data || []).map((d) => (
        <div key={d.id} className="list-row wrap">
          <div className="grow">
            <div className="row wrap">
              <Laptop size={14} className="muted" />
              <b>{d.name}</b>
              <Badge kind={d.online ? 'ok' : 'muted'}>{d.online ? 'Online' : 'Offline'}</Badge>
              {d.os && <Badge kind="muted">{d.os}</Badge>}
            </div>
            <div className="muted small">{d.cwd ? d.cwd + ' · ' : ''}{d.lastSeen ? 'visto ' + f.ago(d.lastSeen) : 'nunca conectou'}</div>
          </div>
          <div className="row">
            {d.online && (
              <Btn icon={RefreshCw} className="ghost small" disabled={busy === 'ping' + d.id}
                onClick={() => run('ping' + d.id, () => bridge.localCall({ deviceId: d.id, action: 'info' })).then((r) => r && toast(`Conectado: ${r.hostname} (${r.platform})`))}>
                Testar
              </Btn>
            )}
            <Btn icon={Trash2} className="ghost danger-text small" disabled={busy === 'rev' + d.id}
              onClick={() => run('rev' + d.id, () => bridge.localRevoke(d.id), 'Acesso revogado').then(() => devs.reload(true))}>
              Revogar
            </Btn>
          </div>
        </div>
      ))}
    </Card>
  );
}

const CURSOR_PREF_KEY = 'acp_computer_cursor';
const CURSOR_HIDE_MS = 6000;
const BADGE_HIDE_MS = 1800;

function clipText(val, max = 28) {
  const s = String(val ?? '').replace(/\s+/g, ' ').trim();
  if (!s) return '';
  return s.length > max ? s.slice(0, max - 1) + '…' : s;
}

function formatCursorBadge(ev, fillingLoginLabel) {
  const kind = ev?.kind;
  if (kind === 'type') {
    if (ev.sensitive === true) return { text: '🔒 ••••••', sensitive: true };
    const txt = clipText(ev.text, 28);
    return { text: txt ? `⌨ ${txt}` : '⌨ …', sensitive: false };
  }
  if (kind === 'key') {
    const k = clipText(ev.text || ev.label, 24);
    return k ? { text: `⌘ ${k}`, sensitive: false } : null;
  }
  if (kind === 'scroll') {
    const arrow = (Number(ev.deltaY) || 0) >= 0 ? '↓' : '↑';
    const lbl = clipText(ev.label, 20);
    return { text: lbl ? `${arrow} ${lbl}` : arrow, sensitive: false };
  }
  if (kind === 'navigate') {
    const lbl = clipText(ev.label || ev.text, 32);
    return lbl ? { text: `🌐 ${lbl}`, sensitive: false } : null;
  }
  if (kind === 'fill_login') {
    const lbl = clipText(ev.label, 28) || fillingLoginLabel;
    return { text: `🔐 ${lbl}`, sensitive: true };
  }
  if (kind === 'click' || kind === 'dblclick') {
    const lbl = clipText(ev.label, 28);
    return lbl ? { text: lbl, sensitive: false } : null;
  }
  return null;
}

function BotCursorOverlay({ visible, rect, fb, cursor, badge, ripples }) {
  if (!visible || !rect || rect.width <= 0 || rect.height <= 0) return null;
  if (!cursor && !ripples.length) return null;

  const refW = cursor?.w || fb?.w || 1280;
  const refH = cursor?.h || fb?.h || 800;
  const tx = cursor ? Math.max(0, Math.min(rect.width, (cursor.x / refW) * rect.width)) : 0;
  const ty = cursor ? Math.max(0, Math.min(rect.height, (cursor.y / refH) * rect.height)) : 0;
  const flipX = tx > rect.width - 190;
  const flipY = ty > rect.height - 76;

  return (
    <div
      className="bot-cursor-layer"
      aria-hidden="true"
      style={{
        left: rect.left,
        top: rect.top,
        width: rect.width,
        height: rect.height,
      }}
    >
      {ripples.map((r) => {
        const rx = Math.max(0, Math.min(rect.width, r.xNorm * rect.width));
        const ry = Math.max(0, Math.min(rect.height, r.yNorm * rect.height));
        return (
          <div
            key={r.id}
            className={'bot-cursor-ripple' + (r.dbl ? ' dbl' : '') + (r.right ? ' right' : '')}
            style={{ transform: `translate3d(${rx}px, ${ry}px, 0)` }}
          >
            <span className="bot-cursor-ring ring-1" />
            {r.dbl && <span className="bot-cursor-ring ring-2" />}
          </div>
        );
      })}
      {cursor && (
        <div
          className="bot-cursor-node"
          style={{ transform: `translate3d(${tx}px, ${ty}px, 0)` }}
        >
          <svg
            className="bot-cursor-arrow"
            width="24"
            height="24"
            viewBox="0 0 24 24"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
          >
            <path
              d="M2.2 1.8L20.4 10.2C21.2 10.6 21.1 11.7 20.2 11.9L12.7 13.7L9.3 20.8C8.9 21.6 7.7 21.4 7.5 20.5L2.2 1.8Z"
              fill="#0a84ff"
              stroke="#ffffff"
              strokeWidth="1.9"
              strokeLinejoin="round"
            />
          </svg>
          {(cursor.botName || badge?.text) && (
            <div className={'bot-cursor-tags' + (flipX ? ' flip-x' : '') + (flipY ? ' flip-y' : '')}>
              {cursor.botName && <span className="bot-cursor-pill">{clipText(cursor.botName, 20)}</span>}
              {badge?.text && (
                <span className={'bot-cursor-badge' + (badge.sensitive ? ' sensitive' : '')}>
                  {badge.text}
                </span>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function Computer() {
  const t = useT();
  const f = useFmt();
  const toast = useToast();
  const st = useLoad(() => bridge.computerStatus(), [], { interval: 5000, cacheKey: '/bridge/computer/status' });
  const tl = useLoad(() => bridge.computerTimeline(), [], { interval: 15000 });
  const secs = useLoad(() => bridge.secrets(), [], { cacheKey: '/bridge/secrets' });
  const loginSecrets = (secs.data || []).filter((s) => s.kind === 'login' || s.username || s.domain);
  const [liveState, setLiveState] = useState(null);
  const [url, setUrl] = useState('');
  const [loginPick, setLoginPick] = useState('');
  const [viewerKey, setViewerKey] = useState(0);
  const [teaching, setTeaching] = useState(false);
  const [annotating, setAnnotating] = useState(false);
  const [cursorEnabled, setCursorEnabled] = useState(() => store.get(CURSOR_PREF_KEY) !== '0');
  const [canvasRect, setCanvasRect] = useState(null);
  const [fbSize, setFbSize] = useState({ w: 1280, h: 800 });
  const [cursor, setCursor] = useState(null);
  const [cursorBadge, setCursorBadge] = useState(null);
  const [ripples, setRipples] = useState([]);
  const [busy, run] = useAction();
  const frameRef = useRef(null);
  const wrapRef = useRef(null);
  const fbSizeRef = useRef(fbSize);
  fbSizeRef.current = fbSize;
  const cursorRef = useRef(cursor);
  cursorRef.current = cursor;
  const hideTimerRef = useRef(null);
  const badgeTimerRef = useRef(null);
  const rippleTimersRef = useRef(new Set());
  const rippleSeqRef = useRef(0);
  const mobile = useIsMobile();

  useEffect(() => { setLiveState(null); }, [st.data]);

  const d = st.data || liveState ? { ...(st.data || {}), ...(liveState || {}) } : null;
  const running = d?.status === 'running';
  const human = d?.control === 'human';
  const needs = d?.needsHuman?.active;

  const clearCursorVisuals = useCallback(() => {
    if (hideTimerRef.current) { clearTimeout(hideTimerRef.current); hideTimerRef.current = null; }
    if (badgeTimerRef.current) { clearTimeout(badgeTimerRef.current); badgeTimerRef.current = null; }
    for (const tm of rippleTimersRef.current) clearTimeout(tm);
    rippleTimersRef.current.clear();
    setCursor(null);
    setCursorBadge(null);
    setRipples([]);
  }, []);

  const toggleCursor = useCallback(() => {
    setCursorEnabled((prev) => {
      const next = !prev;
      store.set(CURSOR_PREF_KEY, next ? '1' : '0');
      return next;
    });
  }, []);

  const requestCanvasRect = useCallback(() => {
    const viewer = frameRef.current?.contentWindow;
    if (!viewer) return;
    viewer.postMessage({ type: 'computer-rect-request' }, window.location.origin);
  }, []);

  const syncViewerControl = useCallback(() => {
    const viewer = frameRef.current?.contentWindow;
    if (!viewer) return;
    viewer.postMessage({ type: 'viewOnly', value: !human }, window.location.origin);
    if (human) viewer.postMessage({ type: 'computer-focus' }, window.location.origin);
    viewer.postMessage({ type: 'computer-rect-request' }, window.location.origin);
  }, [human]);

  useEffect(() => { syncViewerControl(); }, [syncViewerControl]);

  useEffect(() => {
    if (!running) setCanvasRect(null);
  }, [running]);

  useEffect(() => {
    if (human || !running || !cursorEnabled) clearCursorVisuals();
  }, [human, running, cursorEnabled, clearCursorVisuals]);

  useEffect(() => () => clearCursorVisuals(), [clearCursorVisuals]);

  useEffect(() => {
    const onMessage = (e) => {
      if (e.origin !== window.location.origin) return;
      const viewer = frameRef.current?.contentWindow;
      if (!viewer || e.source !== viewer) return;
      const msg = e.data;
      if (!msg || typeof msg !== 'object') return;
      if (msg.type === 'computer-connected') {
        requestCanvasRect();
        return;
      }
      if (msg.type === 'computer-canvas-rect') {
        if (msg.fb && Number(msg.fb.w) > 0 && Number(msg.fb.h) > 0) {
          setFbSize({ w: Number(msg.fb.w), h: Number(msg.fb.h) });
        }
        const r = msg.rect;
        if (r && Number(r.width) > 0 && Number(r.height) > 0) {
          setCanvasRect({
            left: Number(r.left) || 0,
            top: Number(r.top) || 0,
            width: Number(r.width),
            height: Number(r.height),
          });
        } else {
          setCanvasRect(null);
        }
      }
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [requestCanvasRect]);

  useEffect(() => {
    let settleTimer = null;
    const onLayoutChange = () => {
      requestCanvasRect();
      if (settleTimer) clearTimeout(settleTimer);
      settleTimer = setTimeout(requestCanvasRect, 140);
    };
    document.addEventListener('fullscreenchange', onLayoutChange);
    window.addEventListener('resize', onLayoutChange);
    return () => {
      document.removeEventListener('fullscreenchange', onLayoutChange);
      window.removeEventListener('resize', onLayoutChange);
      if (settleTimer) clearTimeout(settleTimer);
    };
  }, [requestCanvasRect]);

  const applyCursorEvent = useCallback((ev, { skipRipple = false } = {}) => {
    if (!ev || typeof ev !== 'object') return;
    if (ev.kind === 'hide') {
      clearCursorVisuals();
      return;
    }
    const refW = Number(ev.w) > 0 ? Number(ev.w) : (fbSizeRef.current.w || 1280);
    const refH = Number(ev.h) > 0 ? Number(ev.h) : (fbSizeRef.current.h || 800);
    const hasCoords = typeof ev.x === 'number' && Number.isFinite(ev.x) && typeof ev.y === 'number' && Number.isFinite(ev.y);
    const prev = cursorRef.current;
    const x = hasCoords ? ev.x : (prev ? prev.x : refW / 2);
    const y = hasCoords ? ev.y : (prev ? prev.y : refH / 2);

    setCursor({
      x,
      y,
      w: refW,
      h: refH,
      kind: ev.kind || 'move',
      button: ev.button || 'left',
      botId: ev.botId || prev?.botId || '',
      botName: ev.botName || prev?.botName || '',
      source: ev.source || '',
      ts: ev.ts || Date.now(),
    });

    if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    hideTimerRef.current = setTimeout(() => {
      hideTimerRef.current = null;
      setCursor(null);
      setCursorBadge(null);
    }, CURSOR_HIDE_MS);

    if (!skipRipple && (ev.kind === 'click' || ev.kind === 'dblclick')) {
      const id = ++rippleSeqRef.current;
      const dbl = ev.kind === 'dblclick';
      const right = ev.button === 'right' || ev.button === 2;
      const xNorm = Math.max(0, Math.min(1, x / refW));
      const yNorm = Math.max(0, Math.min(1, y / refH));
      setRipples((list) => [...list.slice(-7), { id, xNorm, yNorm, dbl, right }]);
      const tm = setTimeout(() => {
        rippleTimersRef.current.delete(tm);
        setRipples((list) => list.filter((r) => r.id !== id));
      }, dbl ? 680 : 480);
      rippleTimersRef.current.add(tm);
    }

    const nextBadge = formatCursorBadge(ev, t('comp.fillingLogin'));
    if (nextBadge) {
      setCursorBadge({ id: Date.now() + Math.random(), ...nextBadge });
      if (badgeTimerRef.current) clearTimeout(badgeTimerRef.current);
      badgeTimerRef.current = setTimeout(() => {
        badgeTimerRef.current = null;
        setCursorBadge(null);
      }, BADGE_HIDE_MS);
    }
  }, [clearCursorVisuals, t]);

  const applyCursorRef = useRef(applyCursorEvent);
  applyCursorRef.current = applyCursorEvent;

  useEffect(() => {
    if (typeof EventSource === 'undefined') return undefined;
    const es = new EventSource(bridge.computerEventsUrl());
    es.onmessage = (m) => {
      if (!m.data) return;
      let ev;
      try { ev = JSON.parse(m.data); } catch { return; }
      if (!ev || typeof ev !== 'object') return;
      if (ev.type === 'hello') {
        if (ev.screen && Number(ev.screen.w) > 0 && Number(ev.screen.h) > 0) {
          setFbSize({ w: Number(ev.screen.w), h: Number(ev.screen.h) });
        }
        setLiveState((prev) => {
          const next = { ...(prev || {}) };
          if (ev.status !== undefined) next.status = ev.status;
          if (ev.control !== undefined) next.control = ev.control;
          return Object.keys(next).length ? next : prev;
        });
        if (ev.lastCursor && ev.lastCursor.kind !== 'hide') {
          const fresh = typeof ev.lastCursor.ts !== 'number' || (Date.now() - ev.lastCursor.ts) < CURSOR_HIDE_MS;
          if (fresh && ev.control !== 'human' && ev.status === 'running') {
            applyCursorRef.current(ev.lastCursor, { skipRipple: true });
          }
        }
      } else if (ev.type === 'computer_state') {
        setLiveState((prev) => {
          const next = { ...(prev || {}) };
          if (ev.status !== undefined) next.status = ev.status;
          if (ev.control !== undefined) next.control = ev.control;
          if (ev.currentUrl !== undefined) next.currentUrl = ev.currentUrl;
          if (ev.needsHuman !== undefined) {
            next.needsHuman = typeof ev.needsHuman === 'boolean'
              ? { ...(prev?.needsHuman || {}), active: ev.needsHuman }
              : ev.needsHuman;
          }
          return next;
        });
        if (ev.control === 'human' || (ev.status !== undefined && ev.status !== 'running')) {
          clearCursorVisuals();
        }
      } else if (ev.type === 'computer_cursor') {
        applyCursorRef.current(ev);
      }
    };
    es.onerror = () => {
      // EventSource reconecta automaticamente; não poluir a UI.
    };
    return () => { try { es.close(); } catch {} };
  }, [clearCursorVisuals]);

  const openViewerKeyboard = () => {
    frameRef.current?.contentWindow?.postMessage(
      { type: 'computer-keyboard', action: 'open' },
      window.location.origin,
    );
  };

  const start = async () => {
    const r = await run('start', () => bridge.computerStart(url.trim()), t('comp.started'));
    if (r) { st.reload(true); setViewerKey((k) => k + 1); }
  };
  const stop = async () => {
    const r = await run('stop', () => bridge.computerStop(), t('comp.stopped'));
    if (r) st.reload(true);
  };
  const toggleControl = async () => {
    const next = human ? 'bot' : 'human';
    const r = await run('ctrl', () => bridge.computerControl(next));
    if (r) {
      st.reload(true);
      toast(next === 'human' ? t('comp.youHaveControl') : t('comp.botHasControl'));
    }
  };
  const openUrl = async (e) => {
    e.preventDefault();
    const u = url.trim();
    if (!u) return;
    const norm = /^https?:\/\//i.test(u) ? u : 'https://' + u;
    const r = await run('open', () => bridge.computerOpen(norm));
    if (r) { setUrl(norm); st.reload(true); toast(t('comp.opened')); }
  };
  const resolveHuman = async (action) => {
    const r = await run('res', () => bridge.computerResolve(action), action === 'done' ? t('comp.resolvedDone') : t('comp.resolvedSkip'));
    if (r) st.reload(true);
  };
  const fullscreen = () => {
    const el = wrapRef.current;
    if (!el) return;
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    else el.requestFullscreen?.().catch(() => {});
  };

  const teach = async () => { if (!human) await run('ctrl', () => bridge.computerControl('human')); st.reload(true); setTeaching(true); };
  const screen = (
    <div ref={wrapRef} className={'computer-screen' + (human ? ' human' : '')}>
      {running ? (
        <>
          <iframe
            key={viewerKey}
            ref={frameRef}
            src={bridge.computerViewerUrl(true)}
            title={t('comp.title')}
            className="computer-frame"
            tabIndex={0}
            onLoad={syncViewerControl}
          />
          <BotCursorOverlay
            visible={running && !human && cursorEnabled}
            rect={canvasRect}
            fb={fbSize}
            cursor={cursor}
            badge={cursorBadge}
            ripples={ripples}
          />
        </>
      ) : (
        <div className="computer-off">
          <Monitor size={42} className="muted" />
          <h3>{t('comp.offTitle')}</h3>
          <p className="muted small" style={{ maxWidth: 460, textAlign: 'center' }}>{t('comp.offHint')}</p>
          <Btn icon={Play} disabled={busy === 'start'} onClick={start}>{t('comp.start')}</Btn>
        </div>
      )}
    </div>
  );
  const needBanner = needs && (
    <div className="banner warn computer-need-banner">
      <AlertTriangle size={18} />
      <div className="grow">
        <b>{t('comp.needsYou')}</b>
        <div className="small">{d.needsHuman.reason}</div>
      </div>
      <Btn icon={Check} className="small" disabled={busy === 'res'} onClick={() => resolveHuman('done')}>{t('comp.imDone')}</Btn>
      <Btn icon={SkipForward} className="ghost small" disabled={busy === 'res'} onClick={() => resolveHuman('skip')}>{t('comp.skip')}</Btn>
    </div>
  );

  if (mobile) {
    const statusBadge = <Badge kind={running ? (needs ? 'warn' : 'ok') : 'muted'}>{running ? (human ? t('comp.youHaveControl') : t('comp.running')) : t('comp.stoppedState')}</Badge>;
    return (
      <div className="page page-list">
        <ErrorBox error={st.error} onRetry={() => st.reload()} />
        {needBanner}
        <ListGroup title={t('comp.screenTitle')}>{screen}</ListGroup>
        <ListGroup title={t('comp.statusLbl')}>
          <Row icon={Monitor} tint="ic-computer" label={t('comp.title')} value={statusBadge} sub={running && d?.currentUrl ? d.currentUrl : undefined} />
          {running && (
            <form className="group-row vrow" onSubmit={openUrl}>
              <span className="row-ic ic-plain"><Globe size={17} /></span>
              <label className="search grow"><input value={url} onChange={(e) => setUrl(e.target.value)} placeholder={d?.currentUrl || 'https://...'} aria-label={t('comp.openUrl')} /></label>
              <Btn icon={ExternalLink} className="ghost small" type="submit" disabled={busy === 'open' || !url.trim()}>{t('comp.go')}</Btn>
            </form>
          )}
        </ListGroup>
        <ListGroup title={t('comp.actions')}>
          {!running ? (
            <Row icon={Play} tint="ic-chat" label={t('comp.start')} kind="accent" disabled={busy === 'start'} onClick={start} />
          ) : (
            <>
              <Row icon={human ? Eye : Hand} tint={human ? 'ic-schedules' : 'ic-overview'} label={human ? t('comp.releaseControl') : t('comp.takeControl')} kind="accent" disabled={busy === 'ctrl'} onClick={toggleControl} chevron />
              {human && <Row icon={KeyRound} tint="ic-plain" label="Digitar no navegador" onClick={openViewerKeyboard} chevron />}
              <Row
                icon={MousePointer2}
                tint="ic-computer"
                label={t('comp.cursor')}
                value={<Badge kind={cursorEnabled ? 'ok' : 'muted'}>{cursorEnabled ? t('comp.cursorOn') : t('comp.cursorOff')}</Badge>}
                onClick={toggleCursor}
              />
              <Row icon={GraduationCap} tint="ic-skills" label={t('comp.teach')} onClick={teach} chevron />
              <Row icon={Camera} tint="ic-dashboards" label={t('comp.screenshot')} onClick={() => openImage(bridge.computerScreenshotUrl(), t('comp.screenshot'))} chevron />
              <Row icon={RefreshCw} tint="ic-plain" label={t('comp.reconnect')} onClick={() => setViewerKey((k) => k + 1)} />
              <Row icon={Maximize2} tint="ic-plain" label={t('pg.full')} onClick={fullscreen} />
              <Row icon={Power} tint="ic-logout" label={t('comp.stop')} kind="danger" disabled={busy === 'stop'} onClick={stop} />
            </>
          )}
        </ListGroup>
        {d && (
          <ListGroup title={t('comp.details')} footer={t('comp.profileHint')}>
            <Row label="Display" value={<code className="mono">{d.display}</code>} />
            {d.cdpUrl && <Row label="CDP" value={<code className="mono">{d.cdpUrl}</code>} />}
          </ListGroup>
        )}
        <LocalBridgeCard />

      {teaching && <TeachModal currentUrl={d?.currentUrl} onClose={() => setTeaching(false)} />}
      </div>
    );
  }

  return (
    <div className="page">
      <ErrorBox error={st.error} onRetry={() => st.reload()} />
      <p className="muted page-intro">{t('comp.intro')}</p>

      {needBanner}

      <Card title={t('comp.title')} icon={Monitor} actions={
        <div className="row wrap">
          <Badge kind={running ? (needs ? 'warn' : 'ok') : 'muted'}>
            {running ? (human ? t('comp.youHaveControl') : t('comp.running')) : t('comp.stoppedState')}
          </Badge>
          {!running ? (
            <Btn icon={Play} className="small" disabled={busy === 'start'} onClick={start}>{t('comp.start')}</Btn>
          ) : (
            <>
              {human && <Btn icon={KeyRound} className="ghost small" onClick={openViewerKeyboard}>Digitar</Btn>}
              <Btn icon={human ? Eye : Hand} className={human ? 'warn small' : 'small'} disabled={busy === 'ctrl'} onClick={toggleControl}>
                {human ? t('comp.releaseControl') : t('comp.takeControl')}
              </Btn>
              <Btn icon={GraduationCap} className="ghost small" onClick={teach}>
                {t('comp.teach')}
              </Btn>
              <Btn icon={Power} className="ghost danger-text small" disabled={busy === 'stop'} onClick={stop}>{t('comp.stop')}</Btn>
            </>
          )}
        </div>
      }>
        {running && (
          <div className="stack" style={{ gap: 8, marginBottom: 8 }}>
            <form className="row wrap computer-bar" onSubmit={openUrl} style={{ marginBottom: 0 }}>
              <label className="search grow">
                <Globe size={14} />
                <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder={d?.currentUrl || 'https://...'} />
              </label>
              <Btn icon={ExternalLink} className="ghost small" type="submit" disabled={busy === 'open' || !url.trim()}>{t('comp.go')}</Btn>
              <Btn
                icon={MousePointer2}
                type="button"
                className={'ghost small computer-cursor-toggle' + (cursorEnabled ? ' on' : '')}
                aria-pressed={cursorEnabled}
                title={t('comp.cursorHint')}
                onClick={toggleCursor}
              >
                {t('comp.cursor')}
              </Btn>
              <Btn icon={PenTool} type="button" className="ghost small" onClick={() => setAnnotating(true)}>Anotar</Btn>
              <a className="btn ghost small" {...imageLink(bridge.computerScreenshotUrl(), t('comp.screenshot'))}><Camera size={14} /> {t('comp.screenshot')}</a>
              <Btn icon={RefreshCw} type="button" className="ghost small" onClick={() => setViewerKey((k) => k + 1)}>{t('comp.reconnect')}</Btn>
              <Btn icon={Maximize2} type="button" className="ghost small" onClick={fullscreen}>{t('pg.full')}</Btn>
            </form>
            {loginSecrets.length > 0 && (
              <div className="row wrap small">
                <KeyRound size={14} className="muted" />
                <select value={loginPick} onChange={(e) => setLoginPick(e.target.value)} style={{ maxWidth: 260 }}>
                  <option value="">Preencher login do cofre (cego)...</option>
                  {loginSecrets.map((s) => <option key={s.name} value={s.name}>{s.label || s.name}{s.domain ? ' · ' + s.domain : ''}{s.hasTotp ? ' (+2FA)' : ''}</option>)}
                </select>
                <Btn icon={KeyRound} type="button" className="ghost small" disabled={!loginPick || busy === 'fill'}
                  onClick={() => run('fill', () => bridge.computerFillLogin({ name: loginPick }), 'Credenciais preenchidas sem expor ao modelo').then(() => tl.reload(true))}>
                  Preencher
                </Btn>
              </div>
            )}
          </div>
        )}

        {screen}

        {d && (
          <div className="row wrap muted small" style={{ marginTop: 10 }}>
            <span>Display <code className="mono">{d.display}</code></span>
            {d.cdpUrl && <span>· CDP <code className="mono">{d.cdpUrl}</code></span>}
            <span>· {t('comp.profileHint')}</span>
          </div>
        )}
      </Card>

      <Card title={`Linha do tempo (${(tl.data || []).length})`} icon={History} actions={
        running && <Btn icon={Camera} className="ghost small" disabled={busy === 'cap'} onClick={() => run('cap', () => bridge.computerCaptureTimeline('manual'), 'Frame salvo').then(() => tl.reload(true))}>Capturar agora</Btn>
      }>
        {!(tl.data || []).length && <p className="muted small">Os snapshots automáticos aparecem aqui conforme o bot navega, faz login ou pede ajuda.</p>}
        {(tl.data || []).length > 0 && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(170px, 1fr))', gap: 10 }}>
            {(tl.data || []).slice(0, 12).map((fr) => (
              <a key={fr.id} {...imageLink(bridge.computerTimelineFrameUrl(fr.id), fr.label + ' · ' + f.date(fr.at))} className="bot-card" style={{ padding: 6, textDecoration: 'none', color: 'inherit' }}>
                <img src={bridge.computerTimelineFrameUrl(fr.id)} alt={fr.label} loading="lazy" style={{ width: '100%', height: 96, objectFit: 'cover', borderRadius: 6 }} />
                <div className="small ellipsis" style={{ marginTop: 4 }}><b>{fr.label}</b></div>
                <div className="muted small">{f.ago(fr.at)}</div>
              </a>
            ))}
          </div>
        )}
      </Card>

      <LocalBridgeCard />

      {teaching && <TeachModal currentUrl={d?.currentUrl} onClose={() => setTeaching(false)} />}
      {annotating && <AnnotateModal currentUrl={d?.currentUrl} onClose={() => setAnnotating(false)} />}
    </div>
  );
}
