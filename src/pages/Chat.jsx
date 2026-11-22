import { memo, useEffect, useMemo, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Activity, Archive, ArrowDown, ArrowRight, ArrowUp, AudioLines, Bot, Check, Copy, ChevronLeft, Ellipsis, Flag, GitBranch, HelpCircle, History, Layers, Lock, Menu, MessageCircle, Monitor, PanelLeftClose, PanelLeftOpen, Mic, MicOff, Pencil, Phone, PhoneOff, Pin, Plus, Reply, RotateCcw, Search, Sparkles, Square, SquarePen, TextSelect, Trash2, Undo2, Users, UserRound, Volume2, Wand2, Wrench, X } from 'lucide-react';
import { bridge, localCache } from '../api.js';
import { store, useI18n, useT } from '../i18n.jsx';
import { MAX_FILE, MessageFiles, PendingFiles, RecordingTimer, SpeakButton, canRecord, hasTTS, pickAudioMime, prepareCallAudio, readAsBase64, setAudioSession, setCallAudioMode, speak, speakAndWait, stopSpeaking, unlockSpeech, useRecorder } from './chatMedia.jsx';
import { Badge, Btn, ErrorBox, Field, IconButton, Modal, Sheet, haptic, useConfirm, useFmt, useLoad, useTheme, useToast } from '../ui.jsx';
import { BotAvatar } from './Bots.jsx';
import CameraCapture from './CameraCapture.jsx';
import { provName } from '../prov.js';
import { ProvIcon, ProvMark } from '../ProvIcon.jsx';
import { Disclosure, LongPressButton, openContextMenu, useLongPress, useScreen } from '../native.jsx';
import { openDocument, openImage } from '../viewer.jsx';

const LAST_CHAT_KEY = 'acp_last_chat';
const chatFromHash = () => {
  const m = window.location.hash.match(/^#\/chat\/([a-f0-9]+)/);
  return m ? 'web:' + m[1] : null;
};

// Swipe-left gesture on mobile chat list rows to reveal Rename & Delete actions without closing the drawer.
function SwipeChatRow({ isOpen, onOpen, onClose, onRename, onDelete, className, children }) {
  const [dx, setDx] = useState(0);
  const st = useRef(null);
  const MAX = 112;
  const offset = st.current?.dragging ? dx : (isOpen ? -MAX : 0);

  const onTouchStart = (e) => {
    if (e.touches.length !== 1) return;
    const t = e.touches[0];
    st.current = { x0: t.clientX, y0: t.clientY, base: isOpen ? -MAX : 0, dragging: false, locked: false };
  };
  const onTouchMove = (e) => {
    const s = st.current;
    if (!s || s.locked) return;
    const t = e.touches[0];
    const mx = t.clientX - s.x0, my = t.clientY - s.y0;
    if (!s.dragging) {
      if (Math.abs(mx) < 8 && Math.abs(my) < 8) return;
      if (Math.abs(my) > Math.abs(mx) || (!isOpen && mx > 0)) { s.locked = true; return; }
      s.dragging = true;
    }
    e.stopPropagation();
    const next = Math.max(-MAX - 16, Math.min(0, s.base + mx));
    setDx(next);
  };
  const onTouchEnd = (e) => {
    const s = st.current;
    if (!s) return;
    if (s.dragging) {
      e.stopPropagation();
      if (dx < -MAX / 2) { if (!isOpen) haptic(10); onOpen(); } else onClose();
    }
    st.current = null;
    setDx(0);
  };

  return (
    <div className={'swipe-row ' + (offset ? 'swiping ' : '') + (className || '')} onTouchStart={onTouchStart} onTouchMove={onTouchMove} onTouchEnd={onTouchEnd} onTouchCancel={onTouchEnd}>
      <div className="swipe-actions only-mobile" aria-hidden={!isOpen}>
        <button type="button" className="swipe-btn edit" onClick={(e) => { e.stopPropagation(); onClose(); onRename(); }} aria-label="Renomear"><Pencil size={16} /></button>
        <button type="button" className="swipe-btn del" onClick={(e) => { e.stopPropagation(); onClose(); onDelete(); }} aria-label="Apagar"><Trash2 size={16} /></button>
      </div>
      <div className="swipe-track" style={{ transform: offset ? `translateX(${offset}px)` : undefined, transition: st.current?.dragging ? 'none' : 'transform 200ms cubic-bezier(.32, .72, 0, 1)' }}>
        {children}
      </div>
    </div>
  );
}

// Links in answers: our own files/pages open in the in-app viewer; other sites open in a new tab.
function MdLink({ node, href, children, ...p }) {
  let local = false;
  try { local = Boolean(href) && new URL(href, window.location.href).origin === window.location.origin && !String(href).startsWith('#'); } catch { /* bad url */ }
  if (!local) return <a {...p} href={href} target="_blank" rel="noreferrer">{children}</a>;
  const name = decodeURIComponent(String(href).split('?')[0].split('/').pop() || '') || String(children);
  const img = /\.(png|jpe?g|gif|webp|svg)$/i.test(name);
  return <a {...p} href={href} onClick={(e) => { if (e.metaKey || e.ctrlKey) return; e.preventDefault(); img ? openImage(href, name) : openDocument(href, name); }}>{children}</a>;
}

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

// Markdown parsing is the most expensive thing on screen: stable plugin/component refs and memo by text,
// so a message is only re-parsed when its text actually changes (not on every scroll, keystroke or tick).
const MD_PLUGINS = [remarkGfm];
const MdTable = ({ node, ...p }) => <div className="table-wrap"><table {...p} /></div>;
const MD_COMPONENTS = { a: MdLink, table: MdTable, pre: CodeBlock };
const Md = memo(({ text }) => (
  <div className="md">
    <ReactMarkdown remarkPlugins={MD_PLUGINS} components={MD_COMPONENTS}>{text || ''}</ReactMarkdown>
  </div>
));

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
    <Disclosure className="tools" summary={<>
        <Wrench size={13} /> {tools.length === 1 ? t('chat.toolsOne') : t('chat.toolsMany', { n: tools.length })}: {[...new Set(tools.map((x) => x.name))].join(', ')}
        {errCount > 0 && <> <Badge kind="err">{t('chat.toolsErrors', { n: errCount })}</Badge></>}
      </>}>
      {tools.map((x, i) => (
        <div key={x.id || i} className={'tool' + (x.isError ? ' bad' : '')}>
          <div className="tool-h">
            <b>{x.name}</b>
            {x.result === undefined && <span className="spin" />}
            {x.result !== undefined && <span className={'tool-chip ' + (x.isError ? 'bad' : 'ok')}>{x.isError ? 'erro' : 'ok'}{x.ms != null ? ' · ' + (x.ms < 1000 ? x.ms + ' ms' : (x.ms / 1000).toFixed(1) + ' s') : ''}</span>}
            {x.result !== undefined && <IconButton icon={Copy} size={12} className="ghost bare" label={t('common.copy')} onClick={() => { navigator.clipboard.writeText(x.result || ''); toast(t('common.copied')); }} />}
          </div>
          <pre>{x.input}</pre>
          {x.result !== undefined && <pre className="tool-out">{x.result || t('common.empty')}</pre>}
        </div>
      ))}
    </Disclosure>
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
    <Disclosure className="tools delegs" open={Boolean(runningOne)} summary={<>
        <Bot size={13} /> {runningOne ? t('chat.delegAsking', { n: runningOne.botName || runningOne.bot }) : (delegations.length === 1 ? t('chat.delegOne') : t('chat.delegMany', { n: delegations.length }))}: {[...new Set(delegations.map((x) => x.botName || x.bot))].join(', ')}
        {runningOne && <span className="spin" />}
        {errCount > 0 && <> <Badge kind="err">{t('chat.toolsErrors', { n: errCount })}</Badge></>}
      </>}>
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
    </Disclosure>
  );
}

function LiveVoiceCallModal({ chatId, botName, lang, messages, live, onClose }) {
  const toast = useToast();
  const [status, setStatus] = useState('idle'); // listening | sending | thinking | speaking | muted | idle
  const [muted, setMuted] = useState(false);
  const [handsFree, setHandsFree] = useState(true);
  const [heardSpeech, setHeardSpeech] = useState(false);
  const [level, setLevel] = useState(0);
  const [err, setErr] = useState('');
  const [transcript, setTranscript] = useState('');
  const [lastReply, setLastReply] = useState('');
  const [typed, setTyped] = useState('');
  const [recStarted, setRecStarted] = useState(null);

  const activeRef = useRef(true);
  const mutedRef = useRef(false);
  const handsFreeRef = useRef(true);
  const messagesRef = useRef(messages || []);
  const notifyMsgRef = useRef(null);
  const recCtxRef = useRef(null);
  const turnIdRef = useRef(0);
  const sendingRecRef = useRef(false);

  mutedRef.current = muted;
  handsFreeRef.current = handsFree;
  messagesRef.current = messages || [];
  useEffect(() => { notifyMsgRef.current?.(); }, [messages]);

  // Stops MediaRecorder + AudioContext + all mic tracks so iOS switches audio back to loudspeaker before TTS plays.
  const cleanupRecorder = (keep) => new Promise((resolve) => {
    const ctx = recCtxRef.current;
    recCtxRef.current = null;
    setRecStarted(null);
    setLevel(0);
    setHeardSpeech(false);
    if (!ctx) return resolve(null);
    if (ctx.vadTimer) { clearInterval(ctx.vadTimer); ctx.vadTimer = null; }
    if (ctx.sr) { try { ctx.sr.abort(); } catch {} ctx.sr = null; }
    if (ctx.audioCtx) { try { ctx.audioCtx.close(); } catch {} ctx.audioCtx = null; }
    let finished = false;
    const done = () => {
      if (finished) return;
      finished = true;
      clearTimeout(stopFallback);
      try { ctx.stream.getTracks().forEach((tr) => tr.stop()); } catch {}
      if (!keep) return resolve(null);
      const type = (ctx.rec?.mimeType || ctx.mime || 'audio/webm').split(';')[0];
      const blob = new Blob(ctx.chunks, { type });
      resolve(blob.size ? { blob, type } : null);
    };
    const stopFallback = setTimeout(done, keep ? 1500 : 0);
    if (!keep || !ctx.rec || ctx.rec.state === 'inactive') return done();
    ctx.rec.onstop = done;
    ctx.rec.onerror = done;
    try { ctx.rec.stop(); } catch { done(); }
  });

  const runTurn = async ({ text, audio }) => {
    const cleanText = String(text || '').trim();
    if (!cleanText && !audio) return;
    const myTurn = ++turnIdRef.current;
    stopSpeaking();
    setErr('');
    setStatus(audio ? 'sending' : 'thinking');
    setTranscript(cleanText || '🎤 Enviando e transcrevendo áudio…');

    try {
      const seenIds = new Set((messagesRef.current || []).map((m) => m.id));
      const payload = [];
      if (audio) {
        const rawExt = (audio.type.split('/')[1] || 'webm').replace(/[^a-z0-9]/gi, '') || 'webm';
        const b64 = await readAsBase64(audio.blob);
        if (!activeRef.current || turnIdRef.current !== myTurn) return;
        payload.push({ name: 'voz.' + rawExt, type: audio.type, data: b64, voice: true });
      }
      await bridge.send(chatId, cleanText, payload, '');
      if (!activeRef.current || turnIdRef.current !== myTurn) return;
      setStatus('thinking');

      // Wait for the NEW assistant reply (reactive to Chat SSE messages + 2.5s fallback poll).
      let replyMsg = null;
      const waitStart = Date.now();
      const scan = (list) => {
        for (const m of (list || [])) {
          if (seenIds.has(m.id)) continue;
          if (m.role === 'user' && m.transcript) setTranscript(m.transcript);
          if (m.role === 'assistant') replyMsg = m;
        }
      };
      while (activeRef.current && turnIdRef.current === myTurn && Date.now() - waitStart < 180000) {
        scan(messagesRef.current);
        if (replyMsg) break;
        const timedOut = await new Promise((res) => {
          const timer = setTimeout(() => { notifyMsgRef.current = null; res(true); }, 2500);
          notifyMsgRef.current = () => { clearTimeout(timer); notifyMsgRef.current = null; res(false); };
        });
        if (!activeRef.current || turnIdRef.current !== myTurn) return;
        if (timedOut) {
          const fetched = await bridge.messages(chatId).catch(() => null);
          if (fetched?.messages) scan(fetched.messages);
        } else {
          scan(messagesRef.current);
        }
        if (replyMsg) break;
      }
      if (!activeRef.current || turnIdRef.current !== myTurn) return;

      if (!replyMsg) {
        setErr('Tempo esgotado aguardando resposta do bot.');
        setStatus('idle');
        return;
      }

      const replyText = String(replyMsg.text || '').trim();
      setLastReply(replyText);
      if (replyText && !replyMsg.error && !replyMsg.stopped) {
        setStatus('speaking');
        // Resposta da ligação sempre em áudio do servidor (mesma voz da nota de voz); a voz do navegador só entra de reserva.
        await speakAndWait(replyMsg.id, replyText, lang, chatId, replyMsg.tts);
      }
    } catch (e) {
      if (activeRef.current && turnIdRef.current === myTurn) {
        const msg = e?.message || 'Erro durante a ligação';
        setErr(msg);
        toast(msg, 'err');
      }
    }

    if (!activeRef.current || turnIdRef.current !== myTurn) return;
    if (mutedRef.current) {
      setStatus('muted');
    } else if (handsFreeRef.current) {
      setTimeout(() => {
        if (activeRef.current && turnIdRef.current === myTurn && !mutedRef.current) startListening();
      }, 350);
    } else {
      setStatus('idle');
    }
  };

  const sendRecordedTurn = async () => {
    if (sendingRecRef.current) return;
    sendingRecRef.current = true;
    prepareCallAudio();
    try {
      const srText = String(recCtxRef.current?.srText || '').trim();
      const audio = await cleanupRecorder(true);
      if (!activeRef.current) return;
      if (srText && audio) { await runTurn({ text: srText }); return; } // browser transcript: skips upload + server transcription
      if (!audio) {
        if (!mutedRef.current) setStatus('idle');
        return;
      }
      await runTurn({ audio });
    } finally {
      sendingRecRef.current = false;
    }
  };

  const startListening = async () => {
    if (!activeRef.current || mutedRef.current) return;
    if (!canRecord()) {
      setErr('Este navegador não suporta gravação de áudio. Use o campo de texto abaixo.');
      setStatus('idle');
      return;
    }
    await cleanupRecorder(false);
    stopSpeaking();
    setErr('');
    let stream;
    try {
      setAudioSession('play-and-record');
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
      } catch (firstErr) {
        if (/AudioSession/i.test(String(firstErr?.message || ''))) {
          setAudioSession('auto');
          await new Promise((res) => setTimeout(res, 120));
          stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
        } else {
          throw firstErr;
        }
      }
    } catch (e) {
      const denied = e?.name === 'NotAllowedError' || e?.name === 'PermissionDeniedError';
      setErr(denied
        ? 'Microfone bloqueado. Libere a permissão do microfone no navegador/iPhone e toque em "Tocar para falar".'
        : ('Não foi possível abrir o microfone' + (e?.message ? ': ' + e.message : '.')));
      setStatus('idle');
      return;
    }
    if (!activeRef.current || mutedRef.current) {
      try { stream.getTracks().forEach((tr) => tr.stop()); } catch {}
      return;
    }
    const mime = pickAudioMime();
    const rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
    const chunks = [];
    rec.ondataavailable = (ev) => { if (ev.data && ev.data.size) chunks.push(ev.data); };
    rec.start(250);

    const ctx = { stream, rec, mime, chunks, audioCtx: null, vadTimer: null, sr: null, srText: '' };
    try {
      const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
      if (SR && !/iPhone|iPad|iPod|Android/i.test(navigator.userAgent)) {
        const r = new SR();
        r.lang = lang || 'pt-BR'; r.continuous = true; r.interimResults = true;
        r.onresult = (ev) => { let t = ''; for (let i = 0; i < ev.results.length; i++) t += ev.results[i][0].transcript; ctx.srText = t; setTranscript(t); };
        r.start();
        ctx.sr = r;
      }
    } catch {}
    recCtxRef.current = ctx;
    setRecStarted(Date.now());
    setHeardSpeech(false);
    setStatus('listening');

    // Web Audio RMS level meter + automatic end-of-speech detection (hands-free mode).
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (AC) {
        const audioCtx = new AC();
        if (audioCtx.state === 'suspended') audioCtx.resume().catch(() => {});
        const source = audioCtx.createMediaStreamSource(stream);
        const analyser = audioCtx.createAnalyser();
        analyser.fftSize = 1024;
        source.connect(analyser);
        ctx.audioCtx = audioCtx;
        const buf = new Uint8Array(analyser.fftSize);
        const startedAt = Date.now();
        let speechMs = 0;
        let hasSpoken = false;
        let lastVoiceAt = 0;
        const SPEECH_RMS = 0.022;
        const MIN_SPEECH_MS = 280;
        const SILENCE_MS = 900;
        const MAX_TURN_MS = 60000;
        ctx.vadTimer = setInterval(() => {
          if (recCtxRef.current !== ctx || !activeRef.current) return;
          analyser.getByteTimeDomainData(buf);
          let sum = 0;
          for (let i = 0; i < buf.length; i++) {
            const v = (buf[i] - 128) / 128;
            sum += v * v;
          }
          const rms = Math.sqrt(sum / buf.length);
          setLevel(Math.min(1, rms * 6));
          const now = Date.now();
          if (rms >= SPEECH_RMS) {
            speechMs += 80;
            lastVoiceAt = now;
            if (!hasSpoken && speechMs >= MIN_SPEECH_MS) {
              hasSpoken = true;
              setHeardSpeech(true);
            }
          }
          if (handsFreeRef.current && ((hasSpoken && now - lastVoiceAt >= SILENCE_MS) || (hasSpoken && now - startedAt >= MAX_TURN_MS))) {
            sendRecordedTurn();
          }
        }, 80);
      }
    } catch {}
  };

  useEffect(() => {
    activeRef.current = true;
    setCallAudioMode(true);
    // Keep the screen awake during the call: on phones the screen lock otherwise stops the mic and the audio.
    let wakeLock = null;
    let wakeWanted = true;
    const takeWakeLock = async () => {
      if (!wakeWanted || wakeLock || document.visibilityState !== 'visible') return;
      try { wakeLock = await navigator.wakeLock?.request('screen'); wakeLock?.addEventListener?.('release', () => { wakeLock = null; }); } catch {}
    };
    // Coming back from the background, the OS may have killed the mic track: reopen it only in that case,
    // so a turn that is still thinking or speaking is not interrupted.
    const onVisible = () => {
      if (document.visibilityState !== 'visible') return;
      takeWakeLock();
      const tracks = recCtxRef.current?.stream?.getAudioTracks?.() || [];
      const micDead = tracks.length > 0 && tracks.every((t) => t.readyState === 'ended');
      if (activeRef.current && !mutedRef.current && micDead) startListening();
    };
    takeWakeLock();
    document.addEventListener('visibilitychange', onVisible);
    startListening();
    return () => {
      wakeWanted = false;
      document.removeEventListener('visibilitychange', onVisible);
      try { wakeLock?.release(); } catch {}
      activeRef.current = false;
      turnIdRef.current++;
      notifyMsgRef.current = null;
      cleanupRecorder(false);
      stopSpeaking();
      setCallAudioMode(false);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const bargeIn = () => {
    turnIdRef.current++;
    prepareCallAudio();
    stopSpeaking();
    setMuted(false);
    mutedRef.current = false;
    startListening();
  };

  const toggleMute = () => {
    const next = !muted;
    setMuted(next);
    mutedRef.current = next;
    if (next) {
      cleanupRecorder(false);
      setStatus('muted');
    } else {
      prepareCallAudio();
      startListening();
    }
  };

  const submitTyped = async (e) => {
    e.preventDefault();
    const v = typed.trim();
    if (!v || status === 'sending' || status === 'thinking') return;
    prepareCallAudio();
    setTyped('');
    await cleanupRecorder(false);
    runTurn({ text: v });
  };

  const activeTool = status === 'thinking' && live?.tools?.length ? live.tools[live.tools.length - 1].name : '';
  const orbScale = status === 'listening' ? 1 + level * 0.22 : 1;
  const statusLabel = status === 'listening'
    ? (heardSpeech ? (handsFree ? 'Ouvindo você… (envia ao pausar)' : 'Gravando sua fala…') : 'Pode falar…')
    : status === 'sending' ? 'Enviando áudio…'
    : status === 'thinking' ? (activeTool ? `Executando: ${activeTool}…` : 'Pensando…')
    : status === 'speaking' ? 'Falando resposta…'
    : status === 'muted' ? 'Microfone mudo'
    : 'Pronto para falar';

  return (
    <Modal title={`📞 Ligação ao vivo · ${botName || 'Agent'}`} onClose={onClose}>
      <div className="stack" style={{ alignItems: 'center', textAlign: 'center', padding: '12px 4px', gap: 10 }}>
        <div
          className="hero-ic"
          style={{
            width: 72, height: 72, borderRadius: '50%',
            transition: 'transform 100ms ease, background 150ms ease',
            transform: `scale(${orbScale.toFixed(3)})`,
            background: status === 'listening'
              ? (heardSpeech ? 'rgba(48, 209, 88, 0.28)' : 'rgba(48, 209, 88, 0.14)')
              : status === 'speaking' ? 'rgba(10, 132, 255, 0.22)'
              : status === 'thinking' || status === 'sending' ? 'rgba(255, 159, 10, 0.18)'
              : 'var(--bg-soft)',
          }}
        >
          {status === 'muted' ? <MicOff size={28} />
            : status === 'speaking' ? <Volume2 size={28} />
            : status === 'thinking' || status === 'sending' ? <span className="spin" />
            : <AudioLines size={28} />}
        </div>
        <div className="row" style={{ gap: 8, justifyContent: 'center' }}>
          <b>{statusLabel}</b>
          {status === 'listening' && recStarted && <RecordingTimer started={recStarted} />}
        </div>
        {err && <ErrorBox error={err} />}
        {transcript && <div className="trigger-box small" style={{ width: '100%', textAlign: 'left' }}><b>Você:</b> {transcript}</div>}
        {lastReply && <div className="trigger-box small" style={{ width: '100%', textAlign: 'left', maxHeight: 160, overflow: 'auto' }}><b>{botName || 'Bot'}:</b> {lastReply}</div>}

        <div className="row wrap" style={{ justifyContent: 'center', gap: 8 }}>
          {status === 'listening' && (
            <Btn icon={ArrowUp} onClick={sendRecordedTurn}>Enviar fala agora</Btn>
          )}
          {status === 'speaking' && (
            <Btn icon={Mic} onClick={bargeIn}>Interromper e falar</Btn>
          )}
          {(status === 'idle' || status === 'muted') && (
            <Btn icon={Mic} onClick={() => { prepareCallAudio(); setMuted(false); mutedRef.current = false; startListening(); }}>Tocar para falar</Btn>
          )}
          {(status === 'sending' || status === 'thinking') && (
            <Btn icon={Square} className="ghost small" onClick={() => bridge.stopChat(chatId).catch(() => {})}>Interromper resposta</Btn>
          )}
        </div>

        <form className="row" style={{ width: '100%' }} onSubmit={submitTyped}>
          <input className="grow" value={typed} onChange={(e) => setTyped(e.target.value)} placeholder="Ou digite durante a chamada…" />
          <Btn icon={ArrowUp} className="small" disabled={!typed.trim() || status === 'sending' || status === 'thinking'}>Enviar</Btn>
        </form>

        <div className="row wrap" style={{ justifyContent: 'center', gap: 8, marginTop: 2 }}>
          <label className="check small" style={{ marginRight: 4 }}>
            <input type="checkbox" checked={handsFree} onChange={(e) => setHandsFree(e.target.checked)} />
            <span>Auto-enviar ao pausar</span>
          </label>
          <Btn icon={muted ? Mic : MicOff} className="ghost small" onClick={toggleMute}>{muted ? 'Ativar mic' : 'Mutar'}</Btn>
          <Btn icon={PhoneOff} className="danger small" onClick={onClose}>Encerrar</Btn>
        </div>
      </div>
    </Modal>
  );
}

function ParallelTaskModal({ chatId, bots, onClose, onStarted }) {
  const [title, setTitle] = useState('');
  const [prompt, setPrompt] = useState('');
  const [bot, setBot] = useState('');
  const [readOnly, setReadOnly] = useState(false);
  const [busy, run] = useAction();
  const submit = async (e) => {
    e.preventDefault();
    const r = await run('tsk', () => bridge.startTask({ parentChatId: chatId, title: title.trim(), prompt: prompt.trim(), bot: bot || undefined, readOnly }), 'Tarefa paralela iniciada');
    if (r) { onStarted?.(r); onClose(); }
  };
  return (
    <Modal title="🧵 Nova tarefa paralela (Task Session)" onClose={onClose} wide>
      <form className="stack" onSubmit={submit}>
        <p className="muted small" style={{ margin: 0 }}>Roda em segundo plano sem travar esta conversa e entrega o resultado aqui automaticamente ao terminar.</p>
        <div className="form-grid">
          <Field label="Título"><input required autoFocus value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Ex.: Pesquisar preços de voo" /></Field>
          <Field label="Bot">
            <select value={bot} onChange={(e) => setBot(e.target.value)}>
              <option value="">Bot desta conversa</option>
              {(bots || []).map((b) => <option key={b.id} value={b.id}>{(b.emoji ? b.emoji + ' ' : '') + b.name}</option>)}
            </select>
          </Field>
        </div>
        <Field label="Instrução completa"><textarea required rows={5} value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder="O que executar em paralelo..." /></Field>
        <label className="check"><input type="checkbox" checked={readOnly} onChange={(e) => setReadOnly(e.target.checked)} /><span>Modo somente leitura (read-only)</span></label>
        <div className="row end">
          <button type="button" className="ghost" onClick={onClose}>Cancelar</button>
          <Btn icon={Layers} disabled={busy === 'tsk' || !title.trim() || !prompt.trim()}>Iniciar em paralelo</Btn>
        </div>
      </form>
    </Modal>
  );
}

function normalizePromptOptionItems(p) {
  if (Array.isArray(p.optionItems) && p.optionItems.length) return p.optionItems;
  return (p.options || []).map((o) => (typeof o === 'string' ? { label: o, description: '', recommended: false } : { label: o.label || '', description: o.description || '', recommended: Boolean(o.recommended) })).filter((x) => x.label);
}

function PromptCardItem({ p, term, isFirstPending, busy, onReply }) {
  const t = useT();
  const pending = p.status === 'pending';
  const isSecret = p.kind === 'secret';
  const questions = Array.isArray(p.questions) && p.questions.length > 1
    ? p.questions.map((q) => ({ question: q.question, items: normalizePromptOptionItems(q), multiSelect: Boolean(q.multiSelect) }))
    : [{ question: p.question, items: normalizePromptOptionItems(p), multiSelect: Boolean(p.multiSelect) }];
  const multiQ = questions.length > 1;
  const [step, setStep] = useState(0);
  const [answersMap, setAnswersMap] = useState({});
  const [customOpen, setCustomOpen] = useState(false);
  const [note, setNote] = useState('');
  const [secretVal, setSecretVal] = useState('');
  const [pin, setPin] = useState('');
  const customRef = useRef(null);

  const curQ = questions[Math.min(step, questions.length - 1)];
  const curSel = answersMap[step];
  const curMulti = curQ.multiSelect;
  const selectedList = curMulti ? (Array.isArray(curSel) ? curSel : []) : [];

  const submitAll = (nextMap) => {
    const map = nextMap || answersMap;
    if (multiQ) {
      const list = questions.map((q, idx) => ({ question: q.question, answer: map[idx] ?? '' }));
      const summary = list.map((x, idx) => `${idx + 1}) ${Array.isArray(x.answer) ? x.answer.join(', ') : x.answer}`).join(' | ');
      onReply(p, summary, note, '', pin, list);
    } else {
      const val = map[0];
      if (Array.isArray(val)) onReply(p, val.join(', '), note, '', pin, val);
      else onReply(p, String(val || ''), note, '', pin);
    }
  };

  const pickOption = (label) => {
    if (busy === p.id) return;
    if (curMulti) {
      const next = selectedList.includes(label) ? selectedList.filter((x) => x !== label) : [...selectedList, label];
      setAnswersMap((m) => ({ ...m, [step]: next }));
      return;
    }
    const nextMap = { ...answersMap, [step]: label };
    setAnswersMap(nextMap);
    if (multiQ) {
      if (step < questions.length - 1) { setStep(step + 1); setCustomOpen(false); }
      else submitAll(nextMap);
    } else {
      onReply(p, label, note, '', pin);
    }
  };

  const submitCustom = () => {
    const val = note.trim();
    if (!val || busy === p.id) return;
    if (multiQ) {
      const nextMap = { ...answersMap, [step]: curMulti ? [...selectedList, val] : val };
      setAnswersMap(nextMap);
      setNote('');
      setCustomOpen(false);
      if (step < questions.length - 1) setStep(step + 1);
      else submitAll(nextMap);
    } else {
      onReply(p, val, val, '', pin);
    }
  };

  useEffect(() => {
    if (!pending || isSecret || !isFirstPending) return undefined;
    const onKey = (e) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const tag = document.activeElement?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || document.activeElement?.isContentEditable) return;
      const n = Number(e.key);
      if (n >= 1 && n <= curQ.items.length) {
        e.preventDefault();
        pickOption(curQ.items[n - 1].label);
      } else if (n === curQ.items.length + 1 && n <= 9) {
        e.preventDefault();
        setCustomOpen(true);
        setTimeout(() => customRef.current?.focus(), 30);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const canConfirmMulti = curMulti && selectedList.length > 0;
  const allStepsAnswered = !multiQ || questions.every((_, idx) => {
    const v = answersMap[idx];
    return Array.isArray(v) ? v.length > 0 : Boolean(String(v || '').trim());
  });

  return (
    <div className={'prompt-card' + (pending ? ' pending' : ' answered') + (term ? ' term-card' : '')}>
      <div className="prompt-h">
        {isSecret ? <Lock size={15} /> : <HelpCircle size={15} />}
        <b>{p.title || t('logs.a.prompt-ask')}</b>
        {isSecret && p.secretName && <Badge kind="muted">{p.secretName}</Badge>}
        <Badge kind={pending ? 'warn' : 'ok'}>{pending ? t('prp.pending') : t('prp.answered')}</Badge>
      </div>
      {pending && multiQ && (
        <div className="prompt-steps">
          <span>{t('prp.stepOf', { a: step + 1, b: questions.length })}</span>
          <span className="only-desktop">{t('prp.kbdHint')}</span>
        </div>
      )}
      <div className="prompt-q">{pending ? curQ.question : p.question}</div>
      {pending ? (
        <div className="prompt-actions stack">
          {isSecret ? (
            <div className="row wrap">
              <input className="grow" type="password" value={secretVal}
                onChange={(e) => setSecretVal(e.target.value)}
                placeholder={t('vlt.cardPh')}
                onKeyDown={(e) => { if (e.key === 'Enter' && secretVal.trim()) { e.preventDefault(); onReply(p, '', '', secretVal, pin); setSecretVal(''); } }} />
              <button type="button" className="small" disabled={busy === p.id || !secretVal.trim()}
                onClick={() => { onReply(p, '', '', secretVal, pin); setSecretVal(''); }}>{t('vlt.saveBtn')}</button>
              <button type="button" className="ghost small" disabled={busy === p.id}
                onClick={() => onReply(p, 'Cancelado', '', '', pin)}>{t('common.cancel')}</button>
            </div>
          ) : (
            <>
              {p.requirePin && (
                <div className="row">
                  <input type="password" value={pin} onChange={(e) => setPin(e.target.value)}
                    placeholder="🔐 PIN de segurança obrigatório para aprovar" />
                </div>
              )}
              <div className="prompt-opt-list">
                {curQ.items.map((opt, idx) => {
                  const isSel = curMulti ? selectedList.includes(opt.label) : curSel === opt.label;
                  return (
                    <button key={opt.label + idx} type="button" disabled={busy === p.id}
                      className={'prompt-opt press' + (curMulti ? ' multi' : '') + (isSel ? ' selected' : '') + (opt.recommended ? ' recommended' : '')}
                      onClick={() => pickOption(opt.label)}>
                      <span className="prompt-opt-ind" aria-hidden>{isSel && <Check size={11} strokeWidth={3} />}</span>
                      <span className="prompt-opt-body">
                        <span className="prompt-opt-head">
                          <span>{opt.label}</span>
                          {opt.recommended && <Badge kind="ok">{t('prp.recommended')}</Badge>}
                        </span>
                        {opt.description && <span className="prompt-opt-desc">{opt.description}</span>}
                      </span>
                      {idx < 9 && <span className="prompt-opt-key" aria-hidden>{idx + 1}</span>}
                    </button>
                  );
                })}
                <button type="button" disabled={busy === p.id}
                  className={'prompt-opt press' + (customOpen ? ' selected' : '')}
                  onClick={() => { setCustomOpen((o) => !o); setTimeout(() => customRef.current?.focus(), 30); }}>
                  <span className="prompt-opt-ind" aria-hidden>{customOpen && <Check size={11} strokeWidth={3} />}</span>
                  <span className="prompt-opt-body">
                    <span className="prompt-opt-head"><span>{t('prp.other')}</span></span>
                    <span className="prompt-opt-desc">{t('prp.customPh')}</span>
                  </span>
                  {curQ.items.length < 9 && <span className="prompt-opt-key" aria-hidden>{curQ.items.length + 1}</span>}
                </button>
              </div>
              {customOpen && (
                <div className="row">
                  <input ref={customRef} className="grow" value={note} onChange={(e) => setNote(e.target.value)}
                    placeholder={t('prp.customPh')}
                    onKeyDown={(e) => { if (e.key === 'Enter' && note.trim()) { e.preventDefault(); submitCustom(); } }} />
                  <button type="button" className="small" disabled={busy === p.id || !note.trim()} onClick={submitCustom}>{t('prp.send')}</button>
                </div>
              )}
              {(curMulti || multiQ) && (
                <div className="row between wrap" style={{ gap: 6 }}>
                  {multiQ && step > 0 ? (
                    <button type="button" className="ghost small" onClick={() => { setStep(step - 1); setCustomOpen(false); }}>{t('prp.back')}</button>
                  ) : <span />}
                  <div className="row" style={{ gap: 6 }}>
                    {multiQ && step < questions.length - 1 && (
                      <button type="button" className="small" disabled={curMulti ? !canConfirmMulti : !curSel}
                        onClick={() => { setStep(step + 1); setCustomOpen(false); }}>{t('prp.next')}</button>
                    )}
                    {(!multiQ && curMulti) && (
                      <button type="button" className="small" disabled={busy === p.id || !canConfirmMulti}
                        onClick={() => submitAll()}>{t('prp.confirmMulti', { n: selectedList.length })}</button>
                    )}
                    {(multiQ && step === questions.length - 1) && (
                      <button type="button" className="small" disabled={busy === p.id || !allStepsAnswered}
                        onClick={() => submitAll()}>{t('prp.finish')}</button>
                    )}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      ) : (
        <div className="prompt-ans">
          <Check size={14} /> <b>{p.answer}</b>{p.note && p.note !== p.answer ? <span className="muted"> — {p.note}</span> : null}
        </div>
      )}
    </div>
  );
}

function PromptList({ prompts, term, onAnswered }) {
  const toast = useToast();
  const [busy, setBusy] = useState(null);
  if (!prompts || !prompts.length) return null;
  const firstPendingId = prompts.find((x) => x.status === 'pending' && x.kind !== 'secret')?.id;
  const reply = async (p, ans, note = '', secretVal = '', pin = '', answers = undefined) => {
    const val = String(ans || '').trim();
    if ((!val && !secretVal && answers === undefined) || busy) return;
    setBusy(p.id);
    try {
      const updated = await bridge.answerPrompt(p.id, val, note, secretVal, pin, answers);
      window.dispatchEvent(new Event('acp:nav-refresh'));
      onAnswered?.(updated);
    } catch (e) { toast(e.message, 'err'); }
    finally { setBusy(null); }
  };
  return (
    <div className="prompt-cards">
      {prompts.map((p) => (
        <PromptCardItem key={p.id} p={p} term={term} isFirstPending={p.id === firstPendingId} busy={busy} onReply={reply} />
      ))}
    </div>
  );
}

// Sent/received time shown when the conversation is dragged to the left (like iMessage).
function MsgTime({ at, lang }) {
  if (!at) return null;
  const d = new Date(at);
  if (Number.isNaN(d.getTime())) return null;
  const today = new Date();
  const sameDay = d.toDateString() === today.toDateString();
  const time = d.toLocaleTimeString(lang, { hour: '2-digit', minute: '2-digit' });
  const day = sameDay ? '' : d.toLocaleDateString(lang, { day: '2-digit', month: '2-digit', ...(d.getFullYear() !== today.getFullYear() ? { year: '2-digit' } : {}) });
  return <time className="msg-time" dateTime={d.toISOString()} aria-hidden="true">{day && <span>{day}</span>}{time}</time>;
}

const Message = memo(function Message({ m, chatId, onResend, retryText, onRetryText, onQuote, onFork, onCorrect, bot, botsById, term }) {
  const onRetry = retryText && onRetryText ? () => onRetryText(retryText) : undefined;
  const { t, lang } = useI18n();
  const f = useFmt();
  const toast = useToast();
  const [selectable, setSelectable] = useState(false);
  const [pressed, setPressed] = useState(false);
  const copy = () => { navigator.clipboard.writeText(m.text || m.transcript || ''); toast(t('common.copied')); };
  const lp = useLongPress((rect) => {
    setPressed(true); setTimeout(() => setPressed(false), 260);
    const when = m.at ? new Date(m.at).toLocaleString(lang, { dateStyle: 'short', timeStyle: 'short' }) : '';
    openContextMenu({ rect, title: when, items: m.role === 'user' ? [
      (m.text || m.transcript) && { icon: Copy, label: t('common.copy'), onClick: copy },
      m.text && onResend && { icon: Pencil, label: t('common.edit'), onClick: () => onResend(m.text) },
      onFork && { icon: GitBranch, label: 'Ramificar daqui (Fork)', onClick: () => onFork(m) },
      m.text && { icon: TextSelect, label: t('chat.selectText'), onClick: () => setSelectable(true) },
    ] : [
      m.text && { icon: Copy, label: t('common.copy'), onClick: copy },
      m.text && onQuote && { icon: Reply, label: t('chat.quote'), onClick: () => onQuote(m.text) },
      onFork && { icon: GitBranch, label: 'Ramificar daqui (Fork)', onClick: () => onFork(m) },
      onCorrect && { icon: Flag, label: 'Corrigir comportamento', onClick: () => onCorrect(m) },
      m.text && !m.error && { icon: Volume2, label: t('chat.listen'), onClick: () => speak(m.id, m.text, lang, chatId, m.tts) },
      m.text && { icon: TextSelect, label: t('chat.selectText'), onClick: () => setSelectable(true) },
    ] });
  });
  const extra = (selectable ? ' selectable' : '') + (pressed ? ' pressed' : '');
  if (m.role === 'user') {
    return (
      <div className={'msg user' + extra} {...lp} title={m.at ? new Date(m.at).toLocaleString(lang) : undefined}>
        <MsgTime at={m.at} lang={lang} />
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
    <div className={'msg bot' + (m.error ? ' error' : '') + (m.stopped ? ' stopped' : '') + extra} {...lp} title={m.at ? new Date(m.at).toLocaleString(lang) : undefined}>
      <MsgTime at={m.at} lang={lang} />
      {bot && (bot.id !== 'default' || bot.avatar) ? <BotAvatar bot={bot} size={30} /> : <div className="avatar" aria-hidden><Bot size={16} /></div>}
      <div className="msg-body">
        <DelegationList delegations={m.delegations} botsById={botsById} term={term} />
        <PromptList prompts={m.prompts} term={term} />
        <ToolList tools={m.tools} term={term} />
        <Md text={m.text} />
        <div className="msg-meta">
          {bot && bot.id !== 'default' && <span>{(bot.emoji ? bot.emoji + ' ' : '') + bot.name}</span>}
          {m.provider && <ProvMark id={m.provider} size={13} />}
          {m.usage?.ms ? <span>{f.dur(m.usage.ms)}</span> : null}
          {m.usage?.turns ? <span>{m.usage.turns === 1 ? t('chat.stepOne') : t('chat.steps', { n: m.usage.turns })}</span> : null}
          {m.usage?.cost ? <span>{(m.usage.estimated || m.provider === 'antigravity' ? '~' : '') + f.usd(m.usage.cost)}</span> : null}
          {m.meta?.fallbackFrom && <Badge kind="warn" title={'Failover de ' + provName(m.meta.fallbackFrom)}>failover</Badge>}
          {m.meta?.routedReason === 'light' && <Badge kind="ok">econômico</Badge>}
          {m.meta?.skills?.length > 0 && <Badge kind="muted">/{m.meta.skills[0]}</Badge>}
          {m.meta?.memories?.length > 0 && <Badge kind="muted" title={m.meta.memories.join(', ')}>🧠 {m.meta.memories.length}</Badge>}
          {m.corrected && <Badge kind="ok" title={m.correctionNote || ''}>regra salva</Badge>}
          {!m.error && !m.stopped && <SpeakButton id={m.id} text={m.text} lang={lang} chatId={chatId} file={m.tts} label={t('chat.listen')} stopLabel={t('chat.stopListen')} />}
          {(m.error || m.stopped) && onRetry && <Btn icon={RotateCcw} className="ghost small" onClick={onRetry}>{t('chat.retry')}</Btn>}
          {onFork && <IconButton icon={GitBranch} size={13} className="ghost bare" label="Ramificar conversa daqui (Fork)" onClick={() => onFork(m)} />}
          {onCorrect && !m.error && <IconButton icon={Flag} size={13} className="ghost bare" label="Corrigir comportamento do bot" onClick={() => onCorrect(m)} />}
          {onQuote && m.text && <IconButton icon={Reply} size={13} className="ghost bare" label={t('chat.quote')} onClick={() => onQuote(m.text)} />}
          <IconButton icon={Copy} size={13} className="ghost bare" label={t('common.copy')} onClick={() => { navigator.clipboard.writeText(m.text); toast(t('common.copied')); }} />
        </div>
      </div>
    </div>
  );
});

function useTicker() {
  const [, set] = useState(0);
  useEffect(() => { const x = setInterval(() => set((n) => n + 1), 1000); return () => clearInterval(x); }, []);
}

function LiveRun({ live, bot, botsById, term, onPromptAnswered }) {
  const t = useT();
  useTicker();
  const secs = Math.round((Date.now() - live.started) / 1000);
  return (
    <div className="msg bot live">
      {bot && (bot.id !== 'default' || bot.avatar) ? <BotAvatar bot={bot} size={30} /> : <div className="avatar" aria-hidden><Bot size={16} /></div>}
      <div className="msg-body">
        <DelegationList delegations={live.delegations} botsById={botsById} term={term} />
        <PromptList prompts={live.prompts} term={term} onAnswered={onPromptAnswered} />
        <ToolList tools={live.tools} term={term} />
        {live.texts.length > 0 && <Md text={live.texts.join('\n\n')} />}
        <div className="msg-meta">{term ? <span className="term-star">✻</span> : <span className="spin" />} {bot && bot.id !== 'default' ? (bot.emoji ? bot.emoji + ' ' : '') + bot.name + ' · ' : ''}{t('chat.working')} {secs}s{live.model ? ' · ' + live.model : ''}
          {live.mcp?.length > 0 && <span> · MCP: {live.mcp.map((s) => s.name + (s.status === 'connected' ? '' : ' (' + s.status + ')')).join(', ')}</span>}
        </div>
      </div>
    </div>
  );
}

function BotPicker({ bots, value, onChange, label, hint }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const cur = bots.find((b) => b.id === value) || bots[0];
  useEffect(() => {
    if (!open) return;
    const close = (e) => { if (e.type === 'keydown' ? e.key === 'Escape' : !ref.current?.contains(e.target)) setOpen(false); };
    document.addEventListener('pointerdown', close);
    document.addEventListener('keydown', close);
    return () => { document.removeEventListener('pointerdown', close); document.removeEventListener('keydown', close); };
  }, [open]);
  if (!cur) return null;
  return (
    <div className="bot-picker" ref={ref}>
      <button type="button" className="bot-picker-btn" aria-label={label} title={hint} aria-haspopup="listbox" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <BotAvatar bot={cur} size={20} /><span className="ellipsis">{cur.name}</span>
      </button>
      {open && (
        <ul className="bot-picker-menu" role="listbox" aria-label={label}>
          {bots.map((b) => (
            <li key={b.id} role="option" aria-selected={b.id === cur.id}>
              <button type="button" className={'bot-picker-item' + (b.id === cur.id ? ' on' : '')} onClick={() => { setOpen(false); if (b.id !== cur.id) onChange(b.id); }}>
                <BotAvatar bot={b} size={24} /><span className="grow ellipsis">{b.name}</span>{b.id === cur.id && <Check size={15} className="bot-picker-chk" />}
              </button>
            </li>
          ))}
        </ul>
      )}
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
      {bots?.length > 1 && <BotPicker bots={bots} value={chat.bot || 'default'} onChange={(id) => onChange({ bot: id })} label={t('bots.label')} hint={t('bots.switchHint')} />}
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

const capFirst = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : '');

function ModelPickerSheet({ chat, providers, onChange, onClose }) {
  const t = useT();
  if (!chat || !providers) return null;
  const prov = providers.providers.find((p) => p.id === chat.provider) || providers.providers[0];
  const agy = chat.provider === 'antigravity';
  const currentModel = agy ? chat.agyModel : chat.model;
  const agyModel = agy && prov.models.find((m) => m.id === chat.agyModel);
  const efforts = agy ? (agyModel ? agyModel.efforts : []) : prov.efforts;
  const currentEffort = agy ? chat.agyEffort : chat.effort;
  const rawDef = (!chat.model && chat.effModel) || prov.defaultModel || '';
  const defModelObj = prov.models.find((m) => m.id === rawDef);
  const defaultLabel = capFirst(
    agy
      ? t('common.defaultModel')
      : t('chat.accountDefault', { m: defModelObj ? defModelObj.label : (rawDef || '—') })
  );

  return (
    <Sheet title={t('chat.model')} onClose={onClose}>
      <div className="group-label">{t('chat.provider')}</div>
      <div className="group">
        {providers.providers.map((p) => {
          const active = p.id === prov.id;
          return (
            <button
              key={p.id}
              type="button"
              disabled={!p.installed}
              className={'group-row press' + (active ? ' on' : '')}
              onClick={() => { if (!active) { haptic('light'); onChange({ provider: p.id }); } }}
            >
              <span className="row-ic ic-prov">
                <ProvIcon id={p.id} size={17} title={false} />
              </span>
              <span className="grow">
                <b>{p.name}</b>
                {!p.installed && <small className="muted">{t('common.notInstalled')}</small>}
              </span>
              {active && <Check size={17} />}
            </button>
          );
        })}
      </div>

      <div className="group-label">{t('chat.model')}</div>
      <div className="group no-ic">
        <button
          type="button"
          className={'group-row press' + (!currentModel ? ' on' : '')}
          onClick={() => { if (currentModel) { haptic('light'); onChange(agy ? { agyModel: '', agyEffort: '' } : { model: '' }); } }}
        >
          <span className="grow"><b className="ellipsis">{defaultLabel}</b></span>
          {!currentModel && <Check size={17} />}
        </button>
        {prov.models.map((m) => {
          const active = currentModel === m.id;
          return (
            <button
              key={m.id}
              type="button"
              className={'group-row press' + (active ? ' on' : '')}
              onClick={() => { if (!active) { haptic('light'); onChange(agy ? { agyModel: m.id, agyEffort: '' } : { model: m.id }); } }}
            >
              <span className="grow"><b className="ellipsis">{m.label}</b></span>
              {active && <Check size={17} />}
            </button>
          );
        })}
      </div>

      {efforts?.length > 0 && (
        <>
          <div className="group-label">{t('chat.effort')}</div>
          <div className="group pad">
            <div className="seg big seg-full-w" role="radiogroup" aria-label={t('chat.effort')}>
              <button
                type="button"
                role="radio"
                aria-checked={!currentEffort}
                className={!currentEffort ? 'on' : ''}
                onClick={() => { if (currentEffort) { haptic('light'); onChange(agy ? { agyEffort: '' } : { effort: '' }); } }}
              >
                {capFirst(t('common.default'))}
              </button>
              {efforts.map((e) => {
                const active = currentEffort === e;
                return (
                  <button
                    key={e}
                    type="button"
                    role="radio"
                    aria-checked={active}
                    className={active ? 'on' : ''}
                    onClick={() => { if (!active) { haptic('light'); onChange(agy ? { agyEffort: e } : { effort: e }); } }}
                  >
                    {e}
                  </button>
                );
              })}
            </div>
          </div>
        </>
      )}
    </Sheet>
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
  const screen = useScreen();
  const f = useFmt();
  const toast = useToast();
  const confirm = useConfirm();
  const chats = useLoad(() => bridge.chats(), [], { interval: 15000, cacheKey: '/bridge/chats' });
  const providers = useLoad(() => bridge.providers(), [], { cacheKey: '/bridge/providers' });
  const botsL = useLoad(() => bridge.bots(), [], { interval: 60000, cacheKey: '/bridge/bots' });
  const skillsL = useLoad(() => bridge.skills(), [], { interval: 60000, cacheKey: '/bridge/skills' });
  const activityL = useLoad(() => bridge.activity(), [], { interval: 15000, cacheKey: '/bridge/activity' });
  const compSt = useLoad(() => bridge.computerStatus(), [], { interval: 15000, cacheKey: '/bridge/computer/status' });
  const botsById = useMemo(() => Object.fromEntries((botsL.data || []).map((b) => [b.id, b])), [botsL.data]);
  const [listTab, setListTab] = useState('chats');
  const [showArchived, setShowArchived] = useState(false);
  const [swipedId, setSwipedId] = useState(null);
  const [current, setCurrent] = useState(() => chatFromHash() || store.get(LAST_CHAT_KEY) || null);
  const [messages, setMessages] = useState([]);
  const [chatInfo, setChatInfo] = useState(null);
  const [live, setLive] = useState(null);
  const [text, setText] = useState(() => {
    const pf = sessionStorage.getItem('acp_prefill') || '';
    if (pf) sessionStorage.removeItem('acp_prefill');
    return pf;
  });
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
  const [correctMsg, setCorrectMsg] = useState(null);
  const [correctText, setCorrectText] = useState('');
  const [undoOpen, setUndoOpen] = useState(false);
  const undoL = useLoad(() => (undoOpen ? bridge.undoList() : Promise.resolve([])), [undoOpen]);
  const [undoBusy, setUndoBusy] = useState(false);

  useEffect(() => {
    const openPending = () => {
      try {
        const cid = localStorage.getItem('acp_chat_open');
        if (cid && cid.startsWith('web:')) { localStorage.removeItem('acp_chat_open'); setCurrent(cid); }
      } catch {}
    };
    openPending();
    const onOpen = (e) => { if (e?.detail?.chatId) setCurrent(e.detail.chatId); };
    window.addEventListener('acp:open-chat', onOpen);
    return () => window.removeEventListener('acp:open-chat', onOpen);
  }, []);

  const forkFrom = async (m) => {
    if (!current) return;
    try {
      const r = await bridge.forkChat(current, { upToMessageId: m.id });
      if (r?.chat?.id) {
        toast('Conversa ramificada (Fork)');
        await chats.reload(true);
        setCurrent(r.chat.id);
      }
    } catch (e) { toast(e.message || 'Falha ao ramificar', 'err'); }
  };

  const saveCorrection = async (e) => {
    e.preventDefault();
    if (!correctMsg || !correctText.trim()) return;
    try {
      await bridge.correctFeedback({ chatId: current, messageId: correctMsg.id, botId: correctMsg.bot || info?.bot || 'default', correction: correctText.trim() });
      toast('Regra salva na memória do bot!');
      setMessages((ms) => ms.map((x) => (x.id === correctMsg.id ? { ...x, corrected: true, correctionNote: correctText.trim() } : x)));
      setCorrectMsg(null); setCorrectText('');
    } catch (err) { toast(err.message || 'Erro ao salvar regra', 'err'); }
  };
  const rootRef = useRef(null);
  const openRef = useRef(false);
  openRef.current = showList;
  const [showOpts, setShowOpts] = useState(false);
  const [showModelPicker, setShowModelPicker] = useState(false);
  const [liveCallOpen, setLiveCallOpen] = useState(false);
  const [newTaskOpen, setNewTaskOpen] = useState(false);
  const chatTasks = useLoad(() => (current ? bridge.tasks(current) : Promise.resolve([])), [current], { interval: 8000 });
  const runningTasks = (chatTasks.data || []).filter((tk) => tk.status === 'running');
  const [files, setFiles] = useState([]);
  const [sending, setSending] = useState(false);
  const [voiceMode, setVoiceModeState] = useState(() => store.get('acp_voice') === '1');
  // Chat style follows the global theme ('terminal' renders Claude Code terminal layout).
  const { theme } = useTheme();
  const term = theme === 'terminal';
  const setVoiceMode = (on) => { store.set('acp_voice', on ? '1' : '0'); setVoiceModeState(on); if (!on) stopSpeaking(); else unlockSpeech(); };
  const rec = useRecorder(lang);
  const fileRef = useRef(null);
  // Read inside the SSE handler, which is created once per conversation.
  const speakRef = useRef({ voiceMode, lastVoice: false, lang, liveCall: false });
  speakRef.current.voiceMode = voiceMode; speakRef.current.lang = lang; speakRef.current.liveCall = liveCallOpen;
  const scrollRef = useRef(null);
  const composerRef = useRef(null);
  const mainRef = useRef(null);
  const inputRef = useRef(null);
  const [atBottom, setAtBottom] = useState(true);

  const webChats = useMemo(() => (chats.data || []).filter((c) => c.kind === 'web'), [chats.data]);
  const archivedCount = useMemo(() => webChats.filter((c) => c.archived).length, [webChats]);
  const filteredChats = useMemo(() => {
    const q = chatSearch.trim().toLowerCase();
    return webChats
      .filter((c) => (showArchived ? Boolean(c.archived) : !c.archived))
      .filter((c) => !q || c.title.toLowerCase().includes(q))
      .sort((a, b) => Number(Boolean(b.pinned)) - Number(Boolean(a.pinned)));
  }, [webChats, chatSearch, showArchived]);
  const shownMessages = useMemo(() => {
    const q = msgSearch.trim().toLowerCase();
    return q ? messages.filter((m) => (m.text || m.transcript || '').toLowerCase().includes(q)) : messages;
  }, [messages, msgSearch]);

  // the user text before each assistant message (for "retry"), computed in one pass instead of per message
  const retryTexts = useMemo(() => {
    let last = null;
    return shownMessages.map((m) => {
      const r = m.role === 'assistant' ? last : null;
      if (m.role === 'user' && m.text) last = m.text;
      return r;
    });
  }, [shownMessages]);
  // stable callbacks for <Message> (memoized): they read the latest closures through a ref
  const latest = useRef({});
  const msgActions = useMemo(() => ({
    resend: (txt) => latest.current.resend(txt),
    quote: (txt) => latest.current.quote(txt),
    fork: (m) => latest.current.fork(m),
    correct: (m) => latest.current.correct(m),
    retry: (txt) => latest.current.retry(txt),
  }), []);

  const select = (id, replace) => {
    store.set(LAST_CHAT_KEY, id);
    const h = '#/chat/' + id.slice(4);
    window.history.replaceState(null, '', h); // never push: a swipe from the left edge must open the drawer, not go back
    setCurrent(id); setShowList(false); setSwipedId(null);
  };
  useEffect(() => {
    if (!webChats.length) return;
    if (!current || (chats.data && !webChats.some((c) => c.id === current))) select(webChats[0].id, true);
  }, [webChats.length]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!current) return;
    store.set(LAST_CHAT_KEY, current);
    const targetHash = '#/chat/' + current.slice(4);
    if (screen.active && window.location.hash !== targetHash) {
      window.history.replaceState(null, '', targetHash);
    }
  }, [current, screen.active]);
  useEffect(() => {
    // the chat stays mounted under the tab bar now, so links that open a chat with a prefilled
    // command (e.g. Skills > Use in chat) are picked up here as well as on first mount
    const onHash = () => {
      const id = chatFromHash(); if (id) setCurrent(id);
      const pf = sessionStorage.getItem('acp_prefill');
      if (pf) { sessionStorage.removeItem('acp_prefill'); setText(pf); }
    };
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  // History + live events of the selected conversation (local-first: hydrate from cache immediately).
  useEffect(() => {
    if (!current) return undefined;
    let closed = false;
    const msgKey = '/bridge/web/' + current.slice(4) + '/messages';
    const cached = localCache.get(msgKey);
    setMessages(cached?.messages || []); setChatInfo(cached?.chat || null);
    setLive(null); setLoadErr(null); setQueuedAhead(0); setMsgSearch(''); setShowMsgSearch(false);
    const notifyNav = () => window.dispatchEvent(new Event('acp:nav-refresh'));
    const load = () => bridge.messages(current)
      .then((r) => { if (!closed) { setMessages(r.messages); setChatInfo(r.chat); notifyNav(); } })
      .catch((e) => !closed && setLoadErr(e.message));
    load();
    const es = new EventSource(bridge.eventsUrl(current));
    es.onmessage = (e) => {
      const ev = JSON.parse(e.data);
      if (ev.type === 'hello') { load(); setLive(ev.running ? { started: ev.running.started, texts: [], tools: [], delegations: [], prompts: ev.prompt ? [ev.prompt] : [] } : null); }
      else if (ev.type === 'message') {
        setMessages((ms) => (ms.some((m) => m.id === ev.message.id) ? ms : [...ms, ev.message]));
        const sp = speakRef.current;
        if (ev.message.role === 'assistant') {
          if (!document.hidden) {
            bridge.patchChat(current, { read: true }).then(notifyNav).catch(notifyNav);
          } else {
            notifyNav();
          }
          if (!ev.message.error && !ev.message.stopped) {
            if (!sp.liveCall && (sp.voiceMode || sp.lastVoice)) speak(ev.message.id, ev.message.text, sp.lang, current);
          }
        }
      }
      else if (ev.type === 'update') setMessages((ms) => ms.map((m) => (m.id === ev.id ? { ...m, ...ev.patch } : m)));
      else if (ev.type === 'start') { setLive({ started: Date.now(), texts: [], tools: [], delegations: [], prompts: [], provider: ev.provider, bot: ev.bot }); setQueuedAhead((q) => Math.max(0, q - 1)); notifyNav(); }
      else if (ev.type === 'init') setLive((l) => l && { ...l, model: ev.model, mcp: ev.mcp });
      else if (ev.type === 'text') setLive((l) => l && { ...l, texts: [...l.texts, ev.text] });
      else if (ev.type === 'tool') setLive((l) => l && { ...l, tools: [...l.tools, { id: ev.id, name: ev.name, input: ev.input, t0: Date.now() }] });
      else if (ev.type === 'tool_result') setLive((l) => l && { ...l, tools: l.tools.map((x) => (x.id === ev.id ? { ...x, result: ev.text, isError: ev.isError, ms: x.t0 ? Date.now() - x.t0 : undefined } : x)) });
      else if (ev.type === 'delegation') setLive((l) => l && { ...l, delegations: (l.delegations || []).some((d) => d.id === ev.ask.id) ? l.delegations.map((d) => (d.id === ev.ask.id ? ev.ask : d)) : [...(l.delegations || []), ev.ask] });
      else if (ev.type === 'prompt') {
        setLive((l) => l && { ...l, prompts: (l.prompts || []).some((p) => p.id === ev.prompt.id) ? l.prompts.map((p) => (p.id === ev.prompt.id ? ev.prompt : p)) : [...(l.prompts || []), ev.prompt] });
        chats.reload(true);
        notifyNav();
      }
      else if (ev.type === 'idle') {
        setLive(null); setQueuedAhead(0); chats.reload(true);
        if (!document.hidden) bridge.patchChat(current, { read: true }).then(notifyNav).catch(notifyNav);
        else notifyNav();
      }
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
      // with the drawer open, a sideways swipe on a conversation row reveals its actions instead of closing the drawer
      if (openRef.current && e.target.closest?.('.swipe-row')) { s = null; return; }
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
  // Drag the conversation to the LEFT to peek at every message's date and time; it springs back on release.
  // Only leftward drags are taken, so the drawer (opened by dragging right / from the left edge) is untouched.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return undefined;
    const MAX = 76;
    let s = null, settle;
    const set = (x) => el.style.setProperty('--reveal', x + 'px');
    const start = (e) => {
      if (e.touches.length !== 1 || openRef.current) { s = null; return; }
      const p = e.touches[0];
      if (p.clientX < 24 || e.target.closest?.('.table-wrap, .pending-files, pre, textarea, input, .rec-body, .mic-hold, .vn, .msg-img')) { s = null; return; }
      s = { x: p.clientX, y: p.clientY, drag: false };
    };
    const move = (e) => {
      if (!s) return;
      const p = e.touches[0];
      const dx = p.clientX - s.x, dy = p.clientY - s.y;
      if (!s.drag) {
        if (Math.abs(dy) > 8 && Math.abs(dy) > Math.abs(dx)) { s = null; return; }
        if (dx > -8) { if (dx > 8) s = null; return; }
        s.drag = true; s.x = p.clientX; clearTimeout(settle); el.classList.remove('settling'); el.classList.add('revealing');
      }
      // no stopPropagation: the message's long-press needs this move to cancel itself (the drawer
      // handler already ignores leftward drags while closed)
      if (e.cancelable) e.preventDefault();
      const d = Math.min(0, p.clientX - s.x);
      set(d > -MAX ? d : -MAX - Math.pow(-d - MAX, 0.6)); // rubber band past the time column
    };
    const end = () => {
      if (!s) return;
      const was = s.drag; s = null;
      if (!was) return;
      el.classList.add('settling'); el.classList.remove('revealing');
      requestAnimationFrame(() => set(0));
      clearTimeout(settle); settle = setTimeout(() => el.classList.remove('settling'), 420);
    };
    el.addEventListener('touchstart', start, { passive: true });
    el.addEventListener('touchmove', move, { passive: false });
    el.addEventListener('touchend', end);
    el.addEventListener('touchcancel', end);
    return () => {
      el.removeEventListener('touchstart', start); el.removeEventListener('touchmove', move);
      el.removeEventListener('touchend', end); el.removeEventListener('touchcancel', end); clearTimeout(settle);
    };
  }, []);
  const toBottom = (smooth) => { const el = scrollRef.current; if (el) el.scrollTo({ top: el.scrollHeight, behavior: smooth ? 'smooth' : 'auto' }); };
  useEffect(() => { if (atBottom) toBottom(); }, [messages, live]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { setAtBottom(true); setTimeout(() => toBottom(), 0); }, [current]);
  // scroll: read geometry once per frame and only touch React state when "at bottom" actually flips
  const atBottomRef = useRef(true);
  atBottomRef.current = atBottom;
  const scrollRaf = useRef(0);
  const onScroll = () => {
    if (scrollRaf.current) return;
    scrollRaf.current = requestAnimationFrame(() => {
      scrollRaf.current = 0;
      const el = scrollRef.current;
      if (!el) return;
      const b = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
      if (b !== atBottomRef.current) { atBottomRef.current = b; setAtBottom(b); }
    });
  };
  useEffect(() => () => cancelAnimationFrame(scrollRaf.current), []);

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
    // Unlock reply audio only when a reply will be spoken: on iOS it interrupts the user's music.
    if (voice || voiceMode) unlockSpeech();
    if (!voice) haptic(8); // voice notes already buzz on release
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
  const change = async (b) => {
    const prev = chatInfo;
    if (info && (b.bot || 'provider' in b || 'model' in b || 'effort' in b || 'agyModel' in b || 'agyEffort' in b)) {
      setChatInfo({ ...info, ...b });
    }
    try { setChatInfo(await bridge.patchChat(current, b)); chats.reload(true); }
    catch (e) { setChatInfo(prev); toast(e.message, 'err'); }
  };
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

  const info = (chatInfo && (!chatInfo.id || chatInfo.id === current) ? chatInfo : null) || webChats.find((c) => c.id === current);
  const activeBot = botsById[info?.bot || 'default'] || botsById.default || (botsL.data || []).find((b) => b.isDefault) || null;

  const ml = modelLabel(info, providers.data);
  const empty = !text.trim() && !files.length;
  latest.current = {
    resend: (txt) => { setText(txt); inputRef.current?.focus(); },
    quote: (txt) => { const snip = txt.trim().split('\n').slice(0, 3).map((l) => '> ' + l).join('\n'); setText((prev) => (prev ? prev + '\n' : '') + snip + '\n\n'); inputRef.current?.focus(); },
    fork: forkFrom,
    correct: (msg) => { setCorrectMsg(msg); setCorrectText(''); },
    retry: (txt) => send(null, txt),
  };
  const mentionQuery = useMemo(() => {
    if ((botsL.data || []).length <= 1) return null;
    const m = text.match(/(?:^|\s)@([\p{L}\p{N}_-]*)$/u);
    return m ? m[1].toLowerCase() : null;
  }, [text, botsL.data]);
  const mentionItems = useMemo(() => {
    if (mentionQuery === null) return [];
    const all = [
      { id: 'todos', name: '@todos', emoji: '👥', description: t('chat.mentionAll') },
      ...(botsL.data || []).map((b) => ({ id: b.id, name: b.name, emoji: b.emoji || '🤖', avatar: b.avatar || '', color: b.color || '', description: b.description || '' })),
    ];
    return all.filter((x) => !mentionQuery || x.id.toLowerCase().includes(mentionQuery) || x.name.toLowerCase().includes(mentionQuery)).slice(0, 6);
  }, [mentionQuery, botsL.data, t]);
  const pickMention = (item) => {
    const tag = item.id === 'todos' ? '@todos ' : '@' + item.id + ' ';
    setText((prev) => prev.replace(/@[\p{L}\p{N}_-]*$/u, tag));
    inputRef.current?.focus();
  };
  const skillQuery = useMemo(() => {
    const m = text.match(/^\/([a-zA-Z0-9_-]*)$/);
    return m ? m[1].toLowerCase() : null;
  }, [text]);
  const skillItems = useMemo(() => {
    if (skillQuery === null) return [];
    return (skillsL.data || [])
      .filter((s) => !skillQuery || s.slug.toLowerCase().includes(skillQuery) || s.name.toLowerCase().includes(skillQuery))
      .slice(0, 6);
  }, [skillQuery, skillsL.data]);
  const pickSkill = (sk) => {
    setText('/' + sk.slug + ' ');
    inputRef.current?.focus();
  };
  const togglePin = async (c) => {
    try { await bridge.patchChat(c.id, { pinned: !c.pinned }); chats.reload(true); } catch (e) { toast(e.message, 'err'); }
  };
  const toggleArchive = async (c) => {
    try { await bridge.patchChat(c.id, { archived: !c.archived }); chats.reload(true); } catch (e) { toast(e.message, 'err'); }
  };
  // the drawer list (dozens of rows with icons) only depends on these: keep it out of every keystroke/stream render
  const chatRows = useMemo(() => filteredChats.map((c) => (
              <SwipeChatRow
                key={c.id}
                isOpen={swipedId === c.id}
                onOpen={() => setSwipedId(c.id)}
                onClose={() => setSwipedId((s) => (s === c.id ? null : s))}
                onRename={() => setRenaming({ id: c.id, title: c.title })}
                onDelete={() => remove(c.id)}
                className={'chat-item-row' + (c.id === current ? ' active' : '') + (c.unread && c.id !== current ? ' unread' : '')}
              >
                <LongPressButton className={'chat-item' + (c.id === current ? ' active' : '')} onClick={() => { if (swipedId === c.id) { setSwipedId(null); return; } select(c.id); }}
                  onLongPress={(rect) => openContextMenu({ rect, title: c.title, items: [
                    { icon: Pin, label: c.pinned ? t('chat.unpin') : t('chat.pin'), onClick: () => togglePin(c) },
                    { icon: Pencil, label: t('chat.rename'), onClick: () => setRenaming({ id: c.id, title: c.title }) },
                    { icon: Archive, label: c.archived ? t('chat.unarchive') : t('chat.archive'), onClick: () => toggleArchive(c) },
                    { icon: Trash2, label: t('chat.delete'), danger: true, onClick: () => remove(c.id) },
                  ] })}>
                  <span className="chat-title">
                    {c.running ? <span className="spin" /> : c.pinned ? <Pin size={14} strokeWidth={2} /> : <MessageCircle size={18} strokeWidth={1.7} />}
                    <span className="ellipsis">{c.title}</span>
                    {c.pendingPrompt && <span className="nav-dot err" title={t('prp.pending')} />}
                    {!c.pendingPrompt && c.unread && c.id !== current && <span className="nav-dot warn" title={t('chat.unread')} />}
                  </span>
                  <small>{c.bot && c.bot !== 'default' && botsById[c.bot] ? (botsById[c.bot].emoji || '') + ' ' + botsById[c.bot].name + ' · ' : ''}<ProvMark id={c.provider} size={12} /> · {t('chat.msgs', { n: c.totals.runs })} · {f.ago((c.runs.at(-1) || {}).at || c.created)}</small>
                </LongPressButton>
                <div className="chat-item-actions">
                  <IconButton icon={Pin} size={13} className={'ghost bare' + (c.pinned ? ' on' : '')} label={c.pinned ? t('chat.unpin') : t('chat.pin')} onClick={(e) => { e.stopPropagation(); togglePin(c); }} />
                  <IconButton icon={Archive} size={13} className="ghost bare" label={c.archived ? t('chat.unarchive') : t('chat.archive')} onClick={(e) => { e.stopPropagation(); toggleArchive(c); }} />
                  <IconButton icon={Pencil} size={13} className="ghost bare" label={t('chat.rename')} onClick={(e) => { e.stopPropagation(); setRenaming({ id: c.id, title: c.title }); }} />
                  <IconButton icon={Trash2} size={13} className="ghost bare danger-text" label={t('chat.delete')} onClick={(e) => { e.stopPropagation(); remove(c.id); }} />
                </div>
              </SwipeChatRow>
            )), [filteredChats, swipedId, current, botsById, t]); // eslint-disable-line react-hooks/exhaustive-deps
  const clearAllChats = async () => {
    if (!webChats.length) return;
    if (!(await confirm(t('chat.clearAll'), t('chat.clearAllQ', { n: webChats.length }), t('common.delete')))) return;
    try {
      await Promise.all(webChats.map((c) => bridge.deleteChat(c.id).catch(() => {})));
      webChats.forEach((c) => localCache.del('/bridge/web/' + c.id.slice(4) + '/messages'));
      store.set(LAST_CHAT_KEY, '');
      localCache.del('/bridge/chats');
      setCurrent(null); setMessages([]); setChatInfo(null);
      window.history.replaceState(null, '', '#/chat');
      toast(t('chat.clearedAll'));
      chats.reload(true);
      window.dispatchEvent(new Event('acp:nav-refresh'));
    } catch (e) { toast(e.message, 'err'); }
  };

  const [mePicErr, setMePicErr] = useState(false);
  useEffect(() => { setMePicErr(false); }, [me?.picture]);
  const [dismissedSugMsgId, setDismissedSugMsgId] = useState(null);
  const lastMsg = !msgSearch && !live && shownMessages.length ? shownMessages[shownMessages.length - 1] : null;
  const activeSuggestions = lastMsg && lastMsg.role === 'assistant' && lastMsg.id !== dismissedSugMsgId && Array.isArray(lastMsg.suggestions) && lastMsg.suggestions.length
    ? lastMsg.suggestions
    : [];

  return (
    <div ref={rootRef} className={'chat' + (showList ? ' list-open' : '') + (listHidden ? ' list-hidden' : '') + (term ? ' term' : '')}>
      <aside className="chat-list" id="chat-list">
        <div className="drawer-head only-mobile">
          <h1 className="serif-title">{t('chat.conversations')}</h1>
        </div>
        <Btn icon={Plus} className="block only-desktop" onClick={newChat}>{t('chat.new')}</Btn>
        <div className="seg chat-list-tabs">
          <button type="button" className={listTab === 'chats' ? 'on' : ''} onClick={() => setListTab('chats')}>{t('chat.conversations')}</button>
          <button type="button" className={listTab === 'activity' ? 'on' : ''} onClick={() => { setListTab('activity'); activityL.reload(true); }}>{t('chat.activity')}</button>
        </div>
        {listTab === 'chats' ? (
          <>
            <label className="search chat-search"><Search size={14} /><input value={chatSearch} onChange={(e) => setChatSearch(e.target.value)} placeholder={t('chat.searchChats')} />{chatSearch && <button type="button" className="ghost bare icon" onClick={() => setChatSearch('')}><X size={13} /></button>}</label>
            <ErrorBox error={chats.error} onRetry={() => chats.reload()} />
            {chatRows}
            {!chats.loading && !filteredChats.length && <p className="muted small">{t('chat.none')}</p>}
            {(archivedCount > 0 || showArchived) && (
              <button type="button" className="ghost small block" style={{ marginTop: 6 }} onClick={() => setShowArchived((x) => !x)}>
                <Archive size={13} /> {showArchived ? t('chat.backToChats') : t('chat.showArchived', { n: archivedCount })}
              </button>
            )}
            {webChats.length > 0 && (
              <details className="drawer-danger-menu" style={{ marginTop: 8 }}>
                <summary className="ghost small block muted" style={{ listStyle: 'none', cursor: 'pointer', textAlign: 'center', padding: '6px 8px' }}>
                  ⋯ {t('pg.more')}
                </summary>
                <button type="button" className="ghost small block danger-text" style={{ marginTop: 4 }} onClick={clearAllChats}>
                  <Trash2 size={13} /> {t('chat.clearAll')}
                </button>
              </details>
            )}
          </>
        ) : (
          <div className="stack" style={{ gap: 6, marginTop: 6 }}>
            {(activityL.data || []).map((ev) => (
              <button key={ev.id} type="button" className="chat-item activity-item" onClick={() => {
                if (ev.kind === 'computer') window.location.hash = '#/computer';
                else if (ev.kind === 'ticket') window.location.hash = '#/board';
                else if (ev.chatId?.startsWith('web:')) { setListTab('chats'); select(ev.chatId); }
              }}>
                <span className="chat-title">
                  <Activity size={14} />
                  <span className="ellipsis">{ev.title}</span>
                  <Badge kind={ev.status === 'pending' || ev.status === 'running' ? 'warn' : ev.status === 'error' ? 'err' : 'muted'}>{ev.kind}</Badge>
                </span>
                <small className="ellipsis">{ev.text || ev.status} · {f.ago(ev.at)}</small>
              </button>
            ))}
            {activityL.data && !activityL.data.length && <p className="muted small">{t('chat.noActivity')}</p>}
          </div>
        )}
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
            {info && <IconButton icon={Phone} className="ghost" label="Ligação de voz ao vivo" onClick={() => { prepareCallAudio(); setLiveCallOpen(true); }} />}
            <IconButton icon={SquarePen} className="ghost" label={t('chat.new')} onClick={newChat} />
            <IconButton icon={Ellipsis} className="ghost" label={t('chat.options')} onClick={() => info && setShowOpts(true)} disabled={!info} />
          </div>
          {openMore && (
            <button type="button" className="glass-btn icon press head-avatar only-mobile" aria-label={t('nav.settings')} onClick={openMore}>
              <span className="avatar-ring" style={{ width: 34, height: 34 }}>
                {me?.picture && !mePicErr
                  ? <img src={me.picture} alt="" referrerPolicy="no-referrer" onError={() => setMePicErr(true)} />
                  : me?.email ? <span className="avatar-letter">{(me.name || me.email).trim()[0]?.toUpperCase()}</span> : <UserRound size={19} />}
              </span>
            </button>
          )}
          {info && <div className="only-desktop"><ChatSettings chat={info} providers={providers.data} bots={botsL.data} onChange={change} /></div>}
          {info && <IconButton icon={Layers} className={'ghost voice-toggle only-desktop' + (runningTasks.length ? ' on' : '')} label="Nova tarefa paralela (Task Session)" onClick={() => setNewTaskOpen(true)} />}
          {info && <IconButton icon={Sparkles} className="ghost voice-toggle only-desktop" label="Conselho Multi-Modelo (/council)" onClick={() => { setText((prev) => (prev.startsWith('/council ') ? prev : '/council ' + prev)); inputRef.current?.focus(); }} />}
          <IconButton icon={Undo2} className="ghost voice-toggle only-desktop" label="Checkpoints & Desfazer no Workspace" onClick={() => setUndoOpen(true)} />
          {info && <IconButton icon={Phone} className="ghost voice-toggle only-desktop" label="Ligação de voz ao vivo" onClick={() => { prepareCallAudio(); setLiveCallOpen(true); }} />}
          <IconButton icon={Monitor} className={'ghost voice-toggle only-desktop' + (compSt.data?.status === 'running' ? ' on' : '')} label={t('nav.computer')} onClick={() => { window.location.hash = '#/computer'; }} />
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
        {runningTasks.length > 0 && (
          <div className="banner" style={{ margin: '6px 12px 0', borderRadius: 10, padding: '6px 10px', gap: 8 }}>
            <Layers size={14} />
            <div className="row wrap grow small" style={{ gap: 6 }}>
              {runningTasks.map((tk) => (
                <span key={tk.id} className="chip" style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                  <span className="spin" /> {tk.title}
                  <button type="button" className="ghost bare" style={{ padding: 0 }} title="Parar tarefa" onClick={() => bridge.stopTask(tk.id).then(() => chatTasks.reload(true))}>✕</button>
                </span>
              ))}
            </div>
          </div>
        )}

        <div className="chat-scroll" ref={scrollRef} onScroll={onScroll}>
          <ErrorBox error={loadErr} />
          {!messages.length && !live && (
            <div className="chat-empty">
              {activeBot
                ? <BotAvatar bot={activeBot} size={64} className="chat-empty-avatar" />
                : <div className="hero-ic"><Bot size={28} /></div>}
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
          {shownMessages.map((m, idx) => (
            <Message key={m.id} m={m} chatId={current} bot={botsById[m.bot]} botsById={botsById} term={term}
              onResend={msgActions.resend} onQuote={msgActions.quote} onFork={msgActions.fork} onCorrect={msgActions.correct}
              retryText={retryTexts[idx]} onRetryText={msgActions.retry} />
          ))}
          {activeSuggestions.length > 0 && (
            <div className="quick-suggestions" role="group" aria-label="Sugestões rápidas">
              {activeSuggestions.map((s, idx) => (
                <button key={(s.label || '') + idx} type="button" className="quick-sug-btn press" disabled={sending}
                  onClick={() => { setDismissedSugMsgId(lastMsg.id); send(null, s.text || s.label); }}>
                  <b>{s.label}</b>
                  {s.description && <small>{s.description}</small>}
                </button>
              ))}
            </div>
          )}
          {live && <LiveRun live={live} bot={botsById[live.bot || (info && info.bot) || 'default']} botsById={botsById} term={term}
            onPromptAnswered={(upd) => setLive((l) => l && { ...l, prompts: (l.prompts || []).map((p) => (p.id === upd.id ? upd : p)) })} />}
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
                    <span className="mention-ic">{it.avatar ? <BotAvatar bot={it} size={20} /> : it.emoji}</span>
                    <b>{it.id === 'todos' ? '@todos' : it.name}</b>
                    {it.id !== 'todos' && <small className="muted">@{it.id}</small>}
                    {it.description && <span className="muted small ellipsis">{it.description}</span>}
                  </button>
                ))}
              </div>
            )}
            {skillItems.length > 0 && (
              <div className="mention-pop" role="listbox">
                {skillItems.map((sk) => (
                  <button key={sk.slug} type="button" className="mention-item press" onClick={() => pickSkill(sk)}>
                    <span className="mention-ic"><Wand2 size={15} /></span>
                    <b>/{sk.slug}</b>
                    <small className="muted">{sk.name}</small>
                    {sk.description && <span className="muted small ellipsis">{sk.description}</span>}
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
                <CameraCapture onPhoto={(f) => addFiles([f])} />
                {ml && (
                  <button type="button" className="model-pill press" onClick={() => setShowModelPicker(true)} aria-label={t('chat.model')}>
                    <ProvIcon id={info?.provider} size={14} /><span className="ellipsis">{ml.name}</span>{ml.effort && <span className="model-effort">{ml.effort}</span>}
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
          <div className="group pad group-open"><ChatSettings chat={info} providers={providers.data} bots={botsL.data} onChange={change} /></div>
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
                        <BotAvatar bot={b} size={18} />{b.name}
                      </label>
                    );
                  })}
                </div>
              )}
            </div>
          )}
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
            <button className="group-row press" onClick={() => { prepareCallAudio(); setShowOpts(false); setLiveCallOpen(true); }}>
              <span className="row-ic ic-chat"><Phone size={17} /></span>
              <span className="grow"><b>Ligação de voz ao vivo</b><small className="muted">Conversa por voz em tempo real</small></span>
            </button>
            <button className="group-row press" onClick={() => { setShowOpts(false); setNewTaskOpen(true); }}>
              <span className="row-ic ic-schedules"><Layers size={17} /></span>
              <span className="grow"><b>Nova tarefa paralela</b><small className="muted">Roda em segundo plano sem travar o chat</small></span>
            </button>
          </div>
          <div className="group">
            <button className="group-row press" onClick={() => { setShowOpts(false); setShowMsgSearch(true); }}>
              <span className="row-ic ic-chat"><Search size={17} /></span>
              <span className="grow"><b>{t('chat.searchMsgs')}</b></span>
            </button>
            <button className="group-row press" onClick={() => { setShowOpts(false); setRenaming({ id: info.id, title: info.title }); }}>
              <span className="row-ic ic-chat"><Pencil size={17} /></span>
              <span className="grow"><b>{t('chat.rename')}</b></span>
            </button>
            <button className="group-row press" onClick={() => { setShowOpts(false); setUndoOpen(true); }}>
              <span className="row-ic ic-providers"><Undo2 size={17} /></span>
              <span className="grow"><b>Checkpoints & Desfazer</b><small className="muted">Snapshots git do workspace</small></span>
            </button>
            <button className="group-row press" onClick={() => { setShowOpts(false); setText('/council '); inputRef.current?.focus(); }}>
              <span className="row-ic ic-skills"><Sparkles size={17} /></span>
              <span className="grow"><b>Conselho Multi-Modelo</b><small className="muted">Comparar 2–3 modelos em paralelo</small></span>
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
      {showModelPicker && info && providers.data && (
        <ModelPickerSheet
          chat={info}
          providers={providers.data}
          onChange={change}
          onClose={() => setShowModelPicker(false)}
        />
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
      {liveCallOpen && current && (
        <LiveVoiceCallModal chatId={current} botName={botsById[info?.bot || 'default']?.name || 'Agent'} lang={lang}
          messages={messages} live={live} onClose={() => setLiveCallOpen(false)} />
      )}
      {newTaskOpen && current && (
        <ParallelTaskModal chatId={current} bots={botsL.data} onClose={() => setNewTaskOpen(false)} onStarted={() => chatTasks.reload(true)} />
      )}
      {correctMsg && (
        <Modal title="Corrigir comportamento do bot" onClose={() => setCorrectMsg(null)}>
          <form className="stack" onSubmit={saveCorrection}>
            <p className="muted small" style={{ margin: 0 }}>
              A regra será salva diretamente na memória do bot <b>{botsById[correctMsg.bot || info?.bot || 'default']?.name || 'Agent'}</b> para valer nas próximas conversas.
            </p>
            <Field label="O que o bot deve fazer (ou nunca mais fazer)?">
              <textarea autoFocus required rows={3} value={correctText} onChange={(e) => setCorrectText(e.target.value)} placeholder="Ex.: Nunca usar tabelas no WhatsApp; sempre resumir em até 3 tópicos." />
            </Field>
            <div className="row end">
              <button type="button" className="ghost" onClick={() => setCorrectMsg(null)}>Cancelar</button>
              <button disabled={!correctText.trim()}>Salvar regra</button>
            </div>
          </form>
        </Modal>
      )}
      {undoOpen && (
        <Modal title="Checkpoints & Desfazer no Workspace" onClose={() => setUndoOpen(false)} wide>
          <div className="stack">
            <div className="row wrap">
              <span className="muted small grow">Crie pontos de restauração git antes de mudanças grandes e reverta em 1 clique.</span>
              <Btn icon={Plus} className="small" disabled={undoBusy} onClick={async () => {
                setUndoBusy(true);
                try { await bridge.undoSnapshot({ repo: 'claude-zap', label: 'Snapshot claude-zap' }); toast('Snapshot criado (claude-zap)'); undoL.reload(true); }
                catch (e) { toast(e.message, 'err'); } finally { setUndoBusy(false); }
              }}>Snapshot Ponte</Btn>
              <Btn icon={Plus} className="ghost small" disabled={undoBusy} onClick={async () => {
                setUndoBusy(true);
                try { await bridge.undoSnapshot({ repo: 'agent-control-panel', label: 'Snapshot painel' }); toast('Snapshot criado (painel)'); undoL.reload(true); }
                catch (e) { toast(e.message, 'err'); } finally { setUndoBusy(false); }
              }}>Snapshot Painel</Btn>
            </div>
            <ErrorBox error={undoL.error} onRetry={() => undoL.reload()} />
            {undoL.data && !undoL.data.length && <p className="muted small">Nenhum checkpoint salvo ainda.</p>}
            {(undoL.data || []).map((cp) => (
              <div key={cp.id} className="list-row wrap">
                <div className="grow">
                  <div className="row wrap" style={{ gap: 6 }}>
                    <b>{cp.label}</b>
                    <Badge kind="muted">{cp.repo}</Badge>
                    <span className="chip mono">{cp.ref.slice(0, 7)}</span>
                  </div>
                  <div className="muted small">{f.date(cp.at)} · {cp.files?.length || 0} arquivos alterados</div>
                </div>
                <Btn icon={Undo2} className="ghost small" disabled={undoBusy} onClick={async () => {
                  if (!(await confirm('Restaurar arquivos rastreados de "' + cp.repo + '" para o checkpoint "' + cp.label + '"? (Um backup do estado atual será salvo antes.)'))) return;
                  setUndoBusy(true);
                  try { await bridge.undoRestore(cp.id); toast('Checkpoint restaurado!'); undoL.reload(true); }
                  catch (e) { toast(e.message, 'err'); } finally { setUndoBusy(false); }
                }}>Restaurar</Btn>
              </div>
            ))}
          </div>
        </Modal>
      )}
    </div>
  );
}
