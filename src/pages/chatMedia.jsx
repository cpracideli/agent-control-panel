// Attachments, voice recording (with on-device transcription when the browser offers it)
// and spoken replies (speechSynthesis) for the web chat. No API keys involved.
import { useCallback, useEffect, useRef, useState } from 'react';
import { FileText, Pause, Play, X } from 'lucide-react';
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
const pickMime = () => {
  if (typeof MediaRecorder === 'undefined') return '';
  for (const m of ['audio/webm;codecs=opus', 'audio/mp4', 'audio/webm', 'audio/ogg;codecs=opus']) if (MediaRecorder.isTypeSupported?.(m)) return m;
  return '';
};
export const canRecord = () => typeof navigator !== 'undefined' && Boolean(navigator.mediaDevices?.getUserMedia) && typeof MediaRecorder !== 'undefined';

export function useRecorder(lang) {
  const [state, setState] = useState(null); // null | { started, transcript }
  const ref = useRef({});

  const start = useCallback(async () => {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
    const mime = pickMime();
    const rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
    const chunks = [];
    rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    rec.start(250);
    const r = { stream, rec, chunks, finals: '', interim: '' };
    // Live transcription where available (Chrome, Edge, Safari). The audio is sent either way.
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (SR) {
      try {
        const sr = new SR();
        sr.lang = lang; sr.continuous = true; sr.interimResults = true;
        sr.onresult = (e) => {
          let fin = '', inter = '';
          for (let i = 0; i < e.results.length; i++) (e.results[i].isFinal ? (fin += e.results[i][0].transcript + ' ') : (inter += e.results[i][0].transcript));
          r.finals = fin; r.interim = inter;
          setState((s) => s && { ...s, transcript: (fin + inter).trim() });
        };
        sr.onerror = () => {};
        sr.onend = () => { if (r.sr && r.keep) try { sr.start(); } catch {} };
        r.keep = true; r.sr = sr; sr.start();
      } catch {}
    }
    ref.current = r;
    setState({ started: Date.now(), transcript: '' });
  }, [lang]);

  const finish = useCallback((keep) => new Promise((resolve) => {
    const r = ref.current;
    if (!r.rec) return resolve(null);
    r.keep = false;
    try { r.sr?.stop(); } catch {}
    const done = () => {
      r.stream.getTracks().forEach((t) => t.stop());
      const type = (r.rec.mimeType || 'audio/webm').split(';')[0];
      const blob = new Blob(r.chunks, { type });
      const transcript = (r.finals + r.interim).trim();
      ref.current = {};
      setState(null);
      resolve(keep && blob.size ? { blob, type, transcript } : null);
    };
    if (r.rec.state === 'inactive') done(); else { r.rec.onstop = done; r.rec.stop(); }
  }), []);

  useEffect(() => () => { const r = ref.current; try { r.sr?.stop(); r.rec?.stop(); r.stream?.getTracks().forEach((t) => t.stop()); } catch {} }, []);
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

let speakingId = null;
const subs = new Set();
const notify = () => subs.forEach((fn) => fn(speakingId));

export function speak(id, text, lang) {
  if (!hasTTS()) return;
  const synth = window.speechSynthesis;
  synth.cancel();
  const clean = speakable(text);
  if (!clean) return;
  // Long answers are split by sentence: some engines stop after ~15 s on a single utterance.
  const parts = clean.match(/[^.!?…]+[.!?…]*\s*/g) || [clean];
  const voice = bestVoice(lang);
  speakingId = id; notify();
  parts.forEach((p, i) => {
    const u = new SpeechSynthesisUtterance(p.trim());
    u.lang = voice?.lang || lang; if (voice) u.voice = voice;
    u.rate = Number(store.get('acp_tts_rate')) || 1.05;
    if (i === parts.length - 1) u.onend = () => { if (speakingId === id) { speakingId = null; notify(); } };
    u.onerror = () => { speakingId = null; notify(); };
    synth.speak(u);
  });
}
export function stopSpeaking() { if (hasTTS()) window.speechSynthesis.cancel(); speakingId = null; notify(); }
// iOS only lets speech start from a user gesture: an empty utterance during the tap unlocks it for later.
export function unlockSpeech() { if (hasTTS()) { try { const u = new SpeechSynthesisUtterance(' '); u.volume = 0; window.speechSynthesis.speak(u); } catch {} } }

export function useSpeaking() {
  const [id, setId] = useState(speakingId);
  useEffect(() => { subs.add(setId); return () => subs.delete(setId); }, []);
  return id;
}

export function SpeakButton({ id, text, lang, label, stopLabel }) {
  const now = useSpeaking();
  if (!hasTTS() || !text) return null;
  const on = now === id;
  return (
    <button type="button" className={'ghost bare icon speak' + (on ? ' on' : '')} title={on ? stopLabel : label} aria-label={on ? stopLabel : label}
      onClick={() => (on ? stopSpeaking() : speak(id, text, lang))}>
      {on ? <Pause size={14} /> : <Play size={14} />}
    </button>
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

export function MessageFiles({ files, transcript }) {
  if (!files?.length) return null;
  return (
    <div className="msg-files">
      {files.map((f) => {
        const url = bridge.fileUrl(f.file);
        if (f.type.startsWith('image/')) return <a key={f.file} href={url} target="_blank" rel="noreferrer" className="msg-img"><img src={url} alt={f.name} loading="lazy" /></a>;
        if (f.type.startsWith('audio/') || f.voice) return <VoiceNote key={f.file} url={url} transcript={transcript} />;
        if (f.type.startsWith('video/')) return <video key={f.file} src={url} controls playsInline className="msg-video" />;
        return <a key={f.file} href={url} target="_blank" rel="noreferrer" className="msg-file"><FileText size={18} /><span>{f.name}<small>{fmtSize(f.size)}</small></span></a>;
      })}
    </div>
  );
}

function VoiceNote({ url, transcript }) {
  const ref = useRef(null);
  const [playing, setPlaying] = useState(false);
  const [pos, setPos] = useState(0);
  const [dur, setDur] = useState(0);
  return (
    <div className="voice-note">
      <div className="vn-row">
        <button type="button" className="vn-play" onClick={() => (playing ? ref.current.pause() : ref.current.play())} aria-label="play">
          {playing ? <Pause size={16} /> : <Play size={16} />}
        </button>
        <div className="vn-bar"><span style={{ width: dur ? (pos / dur) * 100 + '%' : 0 }} /></div>
        <span className="vn-time">{fmtClock(playing || pos ? pos : dur)}</span>
      </div>
      {transcript && <div className="vn-text">{transcript}</div>}
      <audio ref={ref} src={url} preload="metadata"
        onLoadedMetadata={(e) => Number.isFinite(e.target.duration) && setDur(e.target.duration)}
        onDurationChange={(e) => Number.isFinite(e.target.duration) && setDur(e.target.duration)}
        onTimeUpdate={(e) => setPos(e.target.currentTime)} onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)}
        onEnded={() => { setPlaying(false); setPos(0); }} />
    </div>
  );
}
