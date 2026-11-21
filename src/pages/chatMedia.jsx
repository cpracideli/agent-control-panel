// Attachments, voice recording (with on-device transcription when the browser offers it)
// and audio playback for the web chat: one clip at a time, a shared speed (1x/1.5x/2x, remembered), and spoken
// replies generated on the bridge (~/bin/falar) with the browser's speechSynthesis only as a fallback.
import { useCallback, useEffect, useRef, useState } from 'react';
import { FileText, Loader2, Pause, Play, X } from 'lucide-react';
import { docLink, imageLink } from '../viewer.jsx';
import { bridge } from '../api.js';
import { store } from '../i18n.jsx';

export const MAX_FILE = 25 * 1024 * 1024;

export const readAsBase64 = (blob) => new Promise((resolve, reject) => {
  const r = new FileReader();
  r.onload = () => resolve(String(r.result).split(',')[1] || '');
  r.onerror = () => reject(r.error);
  r.readAsDataURL(blob);
});

export const fmtSize = (n) => (n >= 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB');
const fmtClock = (s) => Math.floor(s / 60) + ':' + String(Math.floor(s % 60)).padStart(2, '0');

// ---------- recording ----------
export const pickAudioMime = () => {
  if (typeof MediaRecorder === 'undefined') return '';
  // Safari records AAC in MP4, which plays everywhere; Chrome/Firefox fall through to WebM/Opus.
  for (const m of ['audio/mp4;codecs=mp4a.40.2', 'audio/webm;codecs=opus', 'audio/mp4', 'audio/webm', 'audio/ogg;codecs=opus']) if (MediaRecorder.isTypeSupported?.(m)) return m;
  return '';
};
const pickMime = pickAudioMime;
export const canRecord = () => typeof navigator !== 'undefined' && Boolean(navigator.mediaDevices?.getUserMedia) && typeof MediaRecorder !== 'undefined';

export function useRecorder(lang) {
  const [state, setState] = useState(null); // null | { started, transcript }
  const ref = useRef({});

  const start = useCallback(async () => {
    if (ref.current.rec || ref.current.starting) return; // double tap
    ref.current = { starting: true };
    let stream;
    try {
      setAudioSession('play-and-record');
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
      } catch (err) {
        if (/AudioSession/i.test(String(err?.message || ''))) {
          setAudioSession('auto');
          await new Promise((res) => setTimeout(res, 120));
          stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
        } else {
          throw err;
        }
      }
    } finally { ref.current = {}; }
    const mime = pickMime();
    const rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
    const chunks = [];
    rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    rec.start(250);
    const r = { stream, rec, chunks, finals: '', interim: '' };
    // Live transcription only on desktop. On phones (iOS Safari, Chrome Android) SpeechRecognition fights
    // MediaRecorder for the microphone: the recorder stops delivering data or never fires "stop", and the
    // composer froze. The audio is sent either way and transcribed on the server.
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    const mobile = window.matchMedia?.('(pointer: coarse)').matches;
    if (SR && !mobile) {
      try {
        const sr = new SR();
        sr.lang = lang; sr.continuous = true; sr.interimResults = true;
        sr.onresult = (e) => {
          let fin = '', inter = '';
          for (let i = 0; i < e.results.length; i++) (e.results[i].isFinal ? (fin += e.results[i][0].transcript + ' ') : (inter += e.results[i][0].transcript));
          r.finals = fin; r.interim = inter;
          setState((s) => s && { ...s, transcript: (fin + inter).trim() });
        };
        sr.onerror = (e) => { if (/not-allowed|service-not-allowed|audio-capture|language-not-supported/.test(e?.error)) r.keep = false; };
        // Restart after silence timeouts, but never in a tight loop.
        sr.onstart = () => { r.srStarted = Date.now(); };
        sr.onend = () => {
          if (!r.keep) return;
          r.srFails = Date.now() - (r.srStarted || 0) < 1500 ? (r.srFails || 0) + 1 : 0;
          if (r.srFails > 3) { r.keep = false; return; }
          setTimeout(() => { if (r.keep) try { sr.start(); } catch {} }, 300);
        };
        r.keep = true; r.sr = sr; sr.start();
      } catch {}
    }
    ref.current = r;
    setState({ started: Date.now(), transcript: '' });
  }, [lang]);

  // Leaves the recording screen right away; waits at most 1.5 s for the recorder's "stop" event,
  // which some browsers never fire, and builds the audio from the chunks collected so far.
  const finish = useCallback((keep) => new Promise((resolve) => {
    const r = ref.current;
    ref.current = {};
    setState(null);
    if (!r.rec) return resolve(null);
    r.keep = false;
    try { r.sr?.abort(); } catch {}
    let finished = false;
    const done = () => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      try { r.stream.getTracks().forEach((t) => t.stop()); } catch {}
      if (!keep) return resolve(null);
      const type = (r.rec.mimeType || 'audio/webm').split(';')[0];
      const blob = new Blob(r.chunks, { type });
      const transcript = (r.finals + r.interim).trim();
      resolve(blob.size ? { blob, type, transcript } : null);
    };
    const timer = setTimeout(done, keep ? 1500 : 0);
    if (!keep) return done();
    if (r.rec.state === 'inactive') return done();
    r.rec.onstop = done;
    r.rec.onerror = done;
    try { r.rec.stop(); } catch { done(); }
  }), []);

  useEffect(() => () => { const r = ref.current; r.keep = false; try { r.sr?.abort(); } catch {} try { r.rec?.stop(); } catch {} try { r.stream?.getTracks().forEach((t) => t.stop()); } catch {} }, []);
  return { recording: state, start, stop: () => finish(true), cancel: () => finish(false) };
}

export function RecordingTimer({ started }) {
  const [, tick] = useState(0);
  useEffect(() => { const x = setInterval(() => tick((n) => n + 1), 250); return () => clearInterval(x); }, []);
  return <span className="rec-time">{fmtClock((Date.now() - started) / 1000)}</span>;
}

// ---------- speech output ----------
export const hasTTS = () => typeof window !== 'undefined' && 'speechSynthesis' in window;

// Markdown is for reading: drop code blocks, links' URLs and symbols before speaking.
export function speakable(md) {
  return String(md || '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/^\s*[-*+]\s+/gm, '')
    .replace(/^\s*#+\s*/gm, '')
    .replace(/^\s*>\s?/gm, '')
    .replace(/\|/g, ', ')
    .replace(/[*_~#]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function bestVoice(lang) {
  const voices = window.speechSynthesis.getVoices();
  const base = lang.split('-')[0];
  const same = voices.filter((v) => v.lang.replace('_', '-').toLowerCase().startsWith(lang.toLowerCase()));
  const pool = same.length ? same : voices.filter((v) => v.lang.toLowerCase().startsWith(base));
  const score = (v) => (/premium|enhanced|natural|neural/i.test(v.name) ? 4 : 0) + (/google|siri|luciana|felipe|samantha/i.test(v.name) ? 2 : 0) + (v.localService ? 1 : 0);
  return pool.sort((a, b) => score(b) - score(a))[0] || null;
}

// ---------- playback: one audio at a time, shared speed ----------
// Safari 17+ Audio Session API. 'ambient' mixes with other apps (Spotify, Apple Music) instead of interrupting them;
// 'playback' is set right before a real clip plays; 'play-and-record' allows getUserMedia + TTS during voice calls.
let callAudioMode = false;
export function setAudioSession(type) {
  try { if (typeof navigator !== 'undefined' && navigator.audioSession) navigator.audioSession.type = type; } catch {}
}
export function setCallAudioMode(on) {
  callAudioMode = Boolean(on);
  setAudioSession(on ? 'play-and-record' : 'auto');
}
const RATES = [1, 1.5, 2];
let rate = RATES.includes(Number(store.get('acp_rate'))) ? Number(store.get('acp_rate')) : 1;
const rateSubs = new Set();
let activeAudio = null;
export function useRate() {
  const [r, setR] = useState(rate);
  useEffect(() => { rateSubs.add(setR); return () => rateSubs.delete(setR); }, []);
  return r;
}
function cycleRate() {
  rate = RATES[(RATES.indexOf(rate) + 1) % RATES.length];
  store.set('acp_rate', String(rate));
  rateSubs.forEach((fn) => fn(rate));
  if (activeAudio) activeAudio.playbackRate = rate;
}
// Called on every "play": pauses whatever else is playing and applies the saved speed
// (Safari resets playbackRate when the source loads, so it is set again here).
function claim(a) {
  setAudioSession(callAudioMode ? 'play-and-record' : 'playback');
  if (activeAudio && activeAudio !== a) { try { activeAudio.pause(); } catch {} }
  activeAudio = a;
  a.defaultPlaybackRate = rate; a.playbackRate = rate;
  if (a !== ttsAudio && speakState) stopSpeaking();
}
export function RateButton() {
  const r = useRate();
  return <button type="button" className="vn-rate" onClick={cycleRate} aria-label="speed">{String(r).replace('.', ',')}×</button>;
}

// ---------- spoken replies ----------
// One shared <audio> for replies. iOS lets an element play later without a tap only if it already played during
// one, so unlockSpeech() (called on the send tap) plays a silent clip through it.
const SILENT = 'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQAAAAA=';
let ttsAudio = null;
let speakState = null; // { id, loading, browser }
const subs = new Set();
const notify = () => subs.forEach((fn) => fn(speakState));
function ttsEl() {
  if (ttsAudio || typeof Audio === 'undefined') return ttsAudio;
  ttsAudio = new Audio();
  ttsAudio.preload = 'auto';
  ttsAudio.onplay = () => { if (ttsAudio.src !== SILENT) claim(ttsAudio); };
  const done = () => { if (speakState && !speakState.loading && !speakState.browser) { speakState = null; notify(); } };
  ttsAudio.onpause = done; ttsAudio.onended = done; ttsAudio.onerror = done;
  return ttsAudio;
}

function speakBrowser(id, text, lang) {
  if (!hasTTS()) { speakState = null; notify(); return; }
  const synth = window.speechSynthesis;
  synth.cancel();
  const clean = speakable(text);
  if (!clean) { speakState = null; notify(); return; }
  // Long answers are split by sentence: some engines stop after ~15 s on a single utterance.
  const parts = clean.match(/[^.!?…]+[.!?…]*\s*/g) || [clean];
  const voice = bestVoice(lang);
  speakState = { id, browser: true }; notify();
  parts.forEach((p, i) => {
    const u = new SpeechSynthesisUtterance(p.trim());
    u.lang = voice?.lang || lang; if (voice) u.voice = voice;
    u.rate = rate;
    if (i === parts.length - 1) u.onend = () => { if (speakState?.id === id) { speakState = null; notify(); } };
    u.onerror = () => { speakState = null; notify(); };
    synth.speak(u);
  });
}

// Plays the reply's audio, generating it on the bridge the first time (a few seconds).
export async function speak(id, text, lang, chatId, file) {
  stopSpeaking();
  if (!chatId) return speakBrowser(id, text, lang);
  speakState = { id, loading: !file }; notify();
  try {
    const f = file || (await bridge.tts(chatId, id)).file;
    if (speakState?.id !== id) return; // stopped while it was being generated
    const a = ttsEl();
    a.src = bridge.fileUrl(f);
    speakState = { id, loading: false }; notify();
    setAudioSession(callAudioMode ? 'play-and-record' : 'playback');
    await a.play();
  } catch {
    if (speakState?.id === id) speakBrowser(id, text, lang);
  }
}
export async function speakAndWait(id, text, lang, chatId, file) {
  await speak(id, text, lang, chatId, file);
  if (!speakState || speakState.id !== id) return;
  await new Promise((resolve) => {
    if (!speakState || speakState.id !== id) return resolve();
    const fn = (st) => {
      if (!st || st.id !== id) { subs.delete(fn); resolve(); }
    };
    subs.add(fn);
  });
}
export function stopSpeaking() {
  const was = speakState;
  speakState = null; notify();
  if (was?.browser && hasTTS()) window.speechSynthesis.cancel();
  if (ttsAudio && !ttsAudio.paused) try { ttsAudio.pause(); } catch {}
}
// Only the silent <audio> unlock: a volume-0 SpeechSynthesisUtterance also grabbed the iOS audio session and paused
// the user's music. The silent clip plays as 'ambient' so it mixes with other apps; then the session goes back to
// 'auto' so other players (attachments, videos) keep their normal behaviour.
export function unlockSpeech() {
  const a = ttsEl();
  if (!a || !a.paused || speakState) return;
  if (callAudioMode) {
    setAudioSession('play-and-record');
    try { a.src = SILENT; a.play().catch(() => {}); } catch {}
    return;
  }
  setAudioSession('ambient');
  const restore = () => { if (!speakState && !callAudioMode && (a.paused || a.src === SILENT)) setAudioSession('auto'); };
  try { a.src = SILENT; a.play().then(restore, restore); } catch { restore(); }
}
// Unlocks iOS reply playback in 'play-and-record' mode so getUserMedia never fails with AudioSession mismatch.
export function prepareCallAudio() {
  callAudioMode = true;
  setAudioSession('play-and-record');
  const a = ttsEl();
  if (!a || !a.paused || speakState) return;
  try { a.src = SILENT; a.play().catch(() => {}); } catch {}
}

export function useSpeaking() {
  const [st, setSt] = useState(speakState);
  useEffect(() => { subs.add(setSt); return () => subs.delete(setSt); }, []);
  return st;
}

export function SpeakButton({ id, text, lang, chatId, file, label, stopLabel }) {
  const now = useSpeaking();
  if (!text) return null;
  const on = now?.id === id;
  return (
    <>
      <button type="button" className={'ghost bare icon speak' + (on ? ' on' : '')} title={on ? stopLabel : label} aria-label={on ? stopLabel : label}
        onClick={() => (on ? stopSpeaking() : speak(id, text, lang, chatId, file))}>
        {on && now.loading ? <Loader2 size={14} className="spin-ic" /> : on ? <Pause size={14} /> : <Play size={14} />}
      </button>
      {on && !now.loading && <RateButton />}
    </>
  );
}

// ---------- attachments ----------
export function PendingFiles({ files, onRemove }) {
  if (!files.length) return null;
  return (
    <div className="pending-files">
      {files.map((f, i) => (
        <div key={f.key} className="pending-file">
          {f.preview ? <img src={f.preview} alt="" /> : <span className="file-ic"><FileText size={18} /></span>}
          <span className="pf-name">{f.name}<small>{fmtSize(f.size)}</small></span>
          <button type="button" className="pf-x" aria-label="remove" onClick={() => onRemove(i)}><X size={12} /></button>
        </div>
      ))}
    </div>
  );
}

export function MessageFiles({ files, transcript, engine, pending, pendingLabel }) {
  if (!files?.length) return null;
  return (
    <div className="msg-files">
      {files.map((f) => {
        const url = bridge.fileUrl(f.file);
        if (f.type.startsWith('image/')) return <a key={f.file} {...imageLink(url, f.name)} className="msg-img"><img src={url} alt={f.name} loading="lazy" /></a>;
        if (f.type.startsWith('audio/') || f.voice) return <VoiceNote key={f.file} url={url} transcript={transcript} engine={engine} pending={pending} pendingLabel={pendingLabel} />;
        if (f.type.startsWith('video/')) return <video key={f.file} src={url} controls playsInline className="msg-video" />;
        return <a key={f.file} {...docLink(url, f.name, f.type)} className="msg-file"><FileText size={18} /><span>{f.name}<small>{fmtSize(f.size)}</small></span></a>;
      })}
    </div>
  );
}

function VoiceNote({ url, transcript, engine, pending, pendingLabel }) {
  const ref = useRef(null);
  const [playing, setPlaying] = useState(false);
  const [pos, setPos] = useState(0);
  const [dur, setDur] = useState(0);
  const [failed, setFailed] = useState(false);
  const toggle = () => {
    const a = ref.current;
    if (playing) return a.pause();
    claim(a);
    a.play().catch(() => setFailed(true));
  };
  return (
    <div className="voice-note">
      <div className="vn-row">
        <button type="button" className="vn-play" onClick={toggle} aria-label="play">
          {playing ? <Pause size={16} /> : <Play size={16} />}
        </button>
        <div className="vn-bar"><span style={{ width: dur ? (pos / dur) * 100 + '%' : 0 }} /></div>
        <span className="vn-time">{fmtClock(playing || pos ? pos : dur)}</span>
        {(playing || pos > 0) && <RateButton />}
      </div>
      {failed && <a className="vn-text" href={url} target="_blank" rel="noreferrer">Este navegador não tocou o áudio: abrir o arquivo</a>}
      {transcript ? <div className="vn-text">{transcript}{engine && <small className="vn-engine"> · {engine}</small>}</div>
        : pending ? <div className="vn-text vn-pending"><Loader2 size={12} className="spin-ic" /> {pendingLabel}</div> : null}
      <audio ref={ref} src={url} preload="metadata"
        onError={() => setFailed(true)}
        onLoadedMetadata={(e) => {
          const a = e.target;
          if (Number.isFinite(a.duration)) return setDur(a.duration);
          // Browser-recorded WebM has no duration in its header: seeking far ahead makes the browser compute it.
          const fix = () => { a.removeEventListener('timeupdate', fix); a.currentTime = 0; if (Number.isFinite(a.duration)) setDur(a.duration); };
          a.addEventListener('timeupdate', fix);
          a.currentTime = 1e7;
        }}
        onDurationChange={(e) => Number.isFinite(e.target.duration) && setDur(e.target.duration)}
        onTimeUpdate={(e) => setPos(e.target.currentTime)} onPlay={(e) => { claim(e.target); setPlaying(true); }} onPause={() => setPlaying(false)}
        onEnded={() => { setPlaying(false); setPos(0); }} />
    </div>
  );
}
