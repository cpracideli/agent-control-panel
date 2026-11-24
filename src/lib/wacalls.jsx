// WaCalls engine + React provider:
// - Full-duplex 16 kHz mono Int16 PCM LE over binary WebSocket (/api/bridge/wacalls/ws)
//   reusing /voice-worklet.js and iOS PWA audio helpers from chatMedia.jsx.
// - Backpressure protection on uplink (drops frame if ws.bufferedAmount > 65536).
// - Short jitter buffer (80ms prebuffer, 320ms cap) + mute + input/output VU meters.
// - Per-tab X-Client-Id, real-time SSE (/api/bridge/admin/wacalls/api/events), global
//   incoming/active call state, WebAudio ringtone, and mutual mic lock with Bot Voice.

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { bridge } from '../api.js';
import { setAudioSession, setCallAudioMode, stopSpeaking } from '../pages/chatMedia.jsx';
import { useToast } from '../ui.jsx';
import { acquireVoiceMic, getActiveVoiceOwner, releaseVoiceMic } from './voiceLock.js';

const WORKLET_URL = '/voice-worklet.js';
const SAMPLE_RATE = 16000;
const CHUNK_SAMPLES = 320; // 20ms @ 16kHz = 640 bytes Int16 LE
const MAX_BUFFERED_BYTES = 65536;
const MAX_WS_RECONNECTS = 3;

let prewarmedCtx = null;

function getAudioContextCtor() {
  if (typeof window === 'undefined') return null;
  return window.AudioContext || window.webkitAudioContext || null;
}

// Call synchronously inside user click/tap handler before async HTTP/getUserMedia/WS steps
// so iOS Safari/PWA unlocks Web Audio output in 'play-and-record' mode reliably.
export function unlockWaCallAudio() {
  stopSpeaking();
  setCallAudioMode(true);
  const AC = getAudioContextCtor();
  if (!AC) return;
  try {
    if (!prewarmedCtx || prewarmedCtx.state === 'closed') {
      prewarmedCtx = new AC();
    }
    if (prewarmedCtx.state === 'suspended' || prewarmedCtx.state === 'interrupted') {
      prewarmedCtx.resume().catch(() => {});
    }
    const buf = prewarmedCtx.createBuffer(1, 1, prewarmedCtx.sampleRate);
    const src = prewarmedCtx.createBufferSource();
    src.buffer = buf;
    src.connect(prewarmedCtx.destination);
    src.start(0);
  } catch {}
}

function takeAudioContext() {
  if (prewarmedCtx && prewarmedCtx.state !== 'closed') {
    const ctx = prewarmedCtx;
    prewarmedCtx = null;
    return ctx;
  }
  const AC = getAudioContextCtor();
  return AC ? new AC() : null;
}

export function getWaClientId() {
  const key = 'acp_wacalls_client_id';
  try {
    const existing = sessionStorage.getItem(key);
    if (existing) return existing;
    const id = (typeof crypto !== 'undefined' && crypto.randomUUID)
      ? crypto.randomUUID()
      : ('tab-' + Math.random().toString(36).slice(2) + Date.now().toString(36));
    sessionStorage.setItem(key, id);
    return id;
  } catch {
    return 'tab-' + Math.random().toString(36).slice(2);
  }
}

export function formatPeer(raw) {
  const clean = String(raw || '')
    .replace(/@s\.whatsapp\.net$/i, '')
    .replace(/@lid$/i, '')
    .replace(/:\d+$/, '')
    .trim();
  if (!clean) return 'Desconhecido';
  const digits = clean.replace(/\D/g, '');
  if (digits.length === 13 && digits.startsWith('55')) {
    return `+55 (${digits.slice(2, 4)}) ${digits.slice(4, 9)}-${digits.slice(9)}`;
  }
  if (digits.length === 12 && digits.startsWith('55')) {
    return `+55 (${digits.slice(2, 4)}) ${digits.slice(4, 8)}-${digits.slice(8)}`;
  }
  if (digits.length >= 10 && digits.length <= 15) {
    return '+' + digits;
  }
  return clean;
}

export function normalizeDialPhone(raw, defaultBrazilDdi = true) {
  const trimmed = String(raw || '').trim();
  const hasPlus = trimmed.startsWith('+');
  const digits = trimmed.replace(/\D/g, '');
  if (!digits) return '';
  if (hasPlus) return digits;
  if (defaultBrazilDdi && (digits.length === 10 || digits.length === 11) && !digits.startsWith('55')) {
    return '55' + digits;
  }
  return digits;
}

export function formatDuration(ms) {
  const totalSec = Math.max(0, Math.floor((Number(ms) || 0) / 1000));
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

// Downsample Float32 audio from srcRate to 16kHz Int16 LE (fallback when AudioWorklet unavailable).
function downsampleFloatToInt16LE(input, srcRate, targetRate) {
  const ratio = srcRate / targetRate;
  const outLen = Math.max(1, Math.floor(input.length / ratio));
  const out = new Int16Array(outLen);
  let sumSq = 0;
  for (let i = 0; i < outLen; i++) {
    const start = i * ratio;
    const end = Math.min(input.length, start + ratio);
    const i0 = Math.floor(start);
    const i1 = Math.floor(end);
    let acc = 0;
    if (i0 === i1) {
      acc = (input[i0] || 0) * (end - start);
    } else {
      acc += (input[i0] || 0) * (1 - (start - i0));
      for (let j = i0 + 1; j < i1; j++) acc += input[j] || 0;
      if (end > i1 && i1 < input.length) acc += (input[i1] || 0) * (end - i1);
    }
    const sample = Math.max(-1, Math.min(1, acc / Math.max(1e-6, end - start)));
    sumSq += sample * sample;
    out[i] = sample < 0 ? (sample * 0x8000) | 0 : (sample * 0x7fff) | 0;
  }
  return { int16: out, rms: Math.sqrt(sumSq / outLen) };
}

function int16LEToFloat32(buffer) {
  const byteLen = buffer.byteLength - (buffer.byteLength % 2);
  const count = byteLen >> 1;
  const out = new Float32Array(count);
  if (!count) return out;
  const view = new DataView(buffer, 0, byteLen);
  for (let i = 0; i < count; i++) out[i] = view.getInt16(i * 2, true) / 32768;
  return out;
}

async function openMicStream() {
  const constraints = {
    audio: {
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
      channelCount: 1,
    },
  };
  setAudioSession('play-and-record');
  try {
    return await navigator.mediaDevices.getUserMedia(constraints);
  } catch (err) {
    if (/AudioSession/i.test(String(err?.message || ''))) {
      setAudioSession('auto');
      await new Promise((res) => setTimeout(res, 120));
      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      setAudioSession('play-and-record');
      return stream;
    }
    throw err;
  }
}

// Gentle WebAudio ringtone for incoming WhatsApp calls (soft dual-tone pulse).
class RingtonePlayer {
  constructor() {
    this._ctx = null;
    this._timer = null;
    this._active = false;
  }

  start() {
    if (this._active) return;
    const AC = getAudioContextCtor();
    if (!AC) return;
    this._active = true;
    const playPulse = () => {
      if (!this._active) return;
      try {
        if (!this._ctx || this._ctx.state === 'closed') this._ctx = new AC();
        const ctx = this._ctx;
        if (ctx.state === 'suspended') ctx.resume().catch(() => {});
        if (ctx.state !== 'running') return;
        const now = ctx.currentTime;
        const gain = ctx.createGain();
        gain.gain.setValueAtTime(0.0001, now);
        gain.gain.exponentialRampToValueAtTime(0.09, now + 0.04);
        gain.gain.setValueAtTime(0.09, now + 0.34);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.4);
        gain.gain.setValueAtTime(0.0001, now + 0.52);
        gain.gain.exponentialRampToValueAtTime(0.09, now + 0.56);
        gain.gain.setValueAtTime(0.09, now + 0.86);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.94);
        gain.connect(ctx.destination);

        const osc1 = ctx.createOscillator();
        const osc2 = ctx.createOscillator();
        osc1.type = 'sine';
        osc2.type = 'sine';
        osc1.frequency.setValueAtTime(440, now);
        osc2.frequency.setValueAtTime(480, now);
        osc1.connect(gain);
        osc2.connect(gain);
        osc1.start(now);
        osc2.start(now);
        osc1.stop(now + 1.0);
        osc2.stop(now + 1.0);
      } catch {}
    };
    playPulse();
    this._timer = setInterval(playPulse, 2600);
  }

  stop() {
    this._active = false;
    if (this._timer) { clearInterval(this._timer); this._timer = null; }
    if (this._ctx) {
      try { this._ctx.close(); } catch {}
      this._ctx = null;
    }
  }
}

// Full-duplex 16kHz PCM Int16 LE WebSocket audio engine for a single WaCalls call.
export class WaCallAudioSession {
  constructor(opts = {}) {
    this.sid = opts.sid || '';
    this.callId = opts.callId || '';
    this.clientId = opts.clientId || getWaClientId();
    this.onLevel = opts.onLevel || (() => {});
    this.onWsState = opts.onWsState || (() => {});
    this.onError = opts.onError || (() => {});

    this._stopped = false;
    this._muted = false;
    this._volume = 1;
    this._audioCtx = null;
    this._stream = null;
    this._micSource = null;
    this._captureNode = null;
    this._captureSilentGain = null;
    this._playbackNode = null;
    this._outputGain = null;
    this._useWorklet = false;
    this._fbCarry = new Int16Array(0);
    this._fbSources = new Set();
    this._fbNextTime = 0;

    this._ws = null;
    this._reconnectTimer = null;
    this._reconnectAttempt = 0;
    this._wakeLock = null;
    this._onVisibility = null;
  }

  async start() {
    this._stopped = false;
    stopSpeaking();
    setCallAudioMode(true);
    this.onWsState('connecting');

    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      const msg = 'Este navegador não suporta microfone.';
      this.onError(msg);
      this.onWsState('error');
      return;
    }

    try {
      this._stream = await openMicStream();
    } catch (err) {
      if (this._stopped) return;
      const denied = err?.name === 'NotAllowedError' || err?.name === 'PermissionDeniedError';
      const msg = denied
        ? 'Permissão do microfone bloqueada. Libere o acesso no navegador/iPhone e tente novamente.'
        : ('Não foi possível abrir o microfone' + (err?.message ? ': ' + err.message : '.'));
      this.onError(msg);
      this.onWsState('error');
      return;
    }
    if (this._stopped) {
      this._stopStream();
      return;
    }

    try {
      await this._setupAudioGraph();
    } catch (err) {
      if (this._stopped) return;
      this.onError('Erro ao iniciar áudio: ' + (err?.message || err));
      this.onWsState('error');
      this.stop();
      return;
    }

    if (this._stopped) return;
    this._acquireWakeLock();
    this._onVisibility = () => {
      if (document.visibilityState === 'visible') {
        this._handleVisibilityResume();
      }
    };
    document.addEventListener('visibilitychange', this._onVisibility);
    this._connectWs(false);
  }

  async _acquireWakeLock() {
    if (this._stopped || this._wakeLock || document.visibilityState !== 'visible') return;
    try {
      this._wakeLock = await navigator.wakeLock?.request('screen');
      this._wakeLock?.addEventListener?.('release', () => { this._wakeLock = null; });
    } catch {}
  }

  async _setupAudioGraph() {
    const ctx = takeAudioContext();
    if (!ctx) throw new Error('AudioContext indisponível.');
    this._audioCtx = ctx;
    if (ctx.state !== 'running') {
      try { await ctx.resume(); } catch {}
    }

    this._outputGain = ctx.createGain();
    this._outputGain.gain.value = this._volume;
    this._outputGain.connect(ctx.destination);

    let workletReady = false;
    if (ctx.audioWorklet && typeof AudioWorkletNode !== 'undefined') {
      try {
        await ctx.audioWorklet.addModule(WORKLET_URL);
        workletReady = true;
      } catch {
        workletReady = false;
      }
    }
    this._useWorklet = workletReady;

    if (workletReady) {
      this._playbackNode = new AudioWorkletNode(ctx, 'voice-playback-processor', {
        numberOfInputs: 0,
        numberOfOutputs: 1,
        outputChannelCount: [1],
        processorOptions: {
          sourceSampleRate: SAMPLE_RATE,
          prebufferSec: 0.08, // 80ms jitter buffer
          maxBufferSec: 0.32, // drop stale frames if network bursts > 320ms
          volume: 1,
        },
      });
      this._playbackNode.port.onmessage = (ev) => {
        const msg = ev.data;
        if (!msg || this._stopped) return;
        if (msg.type === 'level') {
          this.onLevel({ output: Math.min(1, (msg.rms || 0) * 4.5) });
        } else if (msg.type === 'drained') {
          this.onLevel({ output: 0 });
        }
      };
      this._playbackNode.connect(this._outputGain);
    }

    this._attachMicToGraph();
  }

  _attachMicToGraph() {
    const ctx = this._audioCtx;
    if (!ctx || !this._stream) return;
    this._detachMicFromGraph();

    this._micSource = ctx.createMediaStreamSource(this._stream);
    this._captureSilentGain = ctx.createGain();
    this._captureSilentGain.gain.value = 0;
    this._captureSilentGain.connect(ctx.destination);

    if (this._useWorklet) {
      const cap = new AudioWorkletNode(ctx, 'voice-capture-processor', {
        numberOfInputs: 1,
        numberOfOutputs: 1,
        channelCount: 1,
        processorOptions: {
          targetSampleRate: SAMPLE_RATE,
          chunkSamples: CHUNK_SAMPLES, // 20ms = 320 samples = 640 bytes
          muted: this._muted,
        },
      });
      cap.port.onmessage = (ev) => {
        const msg = ev.data;
        if (!msg || msg.type !== 'audio') return;
        this._sendCapturedPcm(msg.pcm, msg.rms);
      };
      this._micSource.connect(cap);
      cap.connect(this._captureSilentGain);
      this._captureNode = cap;
    } else if (typeof ctx.createScriptProcessor === 'function') {
      const proc = ctx.createScriptProcessor(1024, 1, 1);
      proc.onaudioprocess = (ev) => {
        if (this._stopped || this._muted) return;
        const input = ev.inputBuffer.getChannelData(0);
        const { int16, rms } = downsampleFloatToInt16LE(input, ctx.sampleRate, SAMPLE_RATE);
        const merged = new Int16Array(this._fbCarry.length + int16.length);
        merged.set(this._fbCarry, 0);
        merged.set(int16, this._fbCarry.length);
        let offset = 0;
        while (offset + CHUNK_SAMPLES <= merged.length) {
          const frame = merged.slice(offset, offset + CHUNK_SAMPLES);
          this._sendCapturedPcm(frame.buffer, rms);
          offset += CHUNK_SAMPLES;
        }
        this._fbCarry = merged.slice(offset);
      };
      this._micSource.connect(proc);
      proc.connect(this._captureSilentGain);
      this._captureNode = proc;
    }
  }

  _detachMicFromGraph() {
    if (this._captureNode) {
      try {
        if (this._captureNode.port) this._captureNode.port.postMessage({ type: 'stop' });
        this._captureNode.onaudioprocess = null;
        this._captureNode.disconnect();
      } catch {}
      this._captureNode = null;
    }
    if (this._micSource) {
      try { this._micSource.disconnect(); } catch {}
      this._micSource = null;
    }
    if (this._captureSilentGain) {
      try { this._captureSilentGain.disconnect(); } catch {}
      this._captureSilentGain = null;
    }
    this._fbCarry = new Int16Array(0);
  }

  _sendCapturedPcm(pcmBuffer, rms) {
    if (this._stopped || this._muted) return;
    this.onLevel({ input: Math.min(1, (rms || 0) * 5.5) });
    const ws = this._ws;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    // Backpressure protection: drop frame if socket buffer exceeds 64 KB.
    if (ws.bufferedAmount > MAX_BUFFERED_BYTES) return;
    try {
      ws.send(pcmBuffer);
    } catch {}
  }

  _connectWs(isReconnect) {
    if (this._stopped) return;
    if (this._reconnectTimer) { clearTimeout(this._reconnectTimer); this._reconnectTimer = null; }
    if (this._ws) {
      try { this._ws.onclose = null; this._ws.onerror = null; this._ws.onmessage = null; this._ws.close(); } catch {}
      this._ws = null;
    }

    const url = bridge.wacallsWsUrl({ sid: this.sid, callId: this.callId, clientId: this.clientId });
    this.onWsState(isReconnect ? 'reconnecting' : 'connecting');

    let ws;
    try {
      ws = new WebSocket(url);
    } catch (err) {
      this.onError('Falha ao abrir WebSocket de áudio: ' + (err?.message || err));
      this.onWsState('error');
      return;
    }
    ws.binaryType = 'arraybuffer';
    this._ws = ws;

    ws.onopen = () => {
      if (this._stopped || this._ws !== ws) return;
      this._reconnectAttempt = 0;
      this.onWsState('open');
    };

    ws.onmessage = async (ev) => {
      if (this._stopped || this._ws !== ws) return;
      if (typeof ev.data === 'string') {
        try {
          const msg = JSON.parse(ev.data);
          if (msg?.type === 'error' && msg.message) this.onError(msg.message);
        } catch {}
        return;
      }
      let buf = ev.data;
      if (buf instanceof Blob) {
        try { buf = await buf.arrayBuffer(); } catch { return; }
      }
      if (buf instanceof ArrayBuffer && buf.byteLength >= 2) {
        this._enqueuePlaybackPcm(buf);
      }
    };

    ws.onerror = () => {};

    ws.onclose = (ev) => {
      if (this._stopped || this._ws !== ws) return;
      // Normal closure from server means call ended on server side.
      if (ev.code === 1000) {
        this.onWsState('closed');
        return;
      }
      if (this._reconnectAttempt < MAX_WS_RECONNECTS) {
        this._reconnectAttempt++;
        const delay = Math.min(3000, 600 * this._reconnectAttempt);
        this.onWsState('reconnecting');
        this._reconnectTimer = setTimeout(() => this._connectWs(true), delay);
      } else {
        this.onWsState('closed');
      }
    };
  }

  _enqueuePlaybackPcm(arrayBuffer) {
    if (this._stopped) return;
    const ctx = this._audioCtx;
    if (!ctx) return;
    if (ctx.state === 'suspended' || ctx.state === 'interrupted') {
      ctx.resume().catch(() => {});
    }
    if (this._useWorklet && this._playbackNode?.port) {
      this._playbackNode.port.postMessage({ type: 'pcm', buffer: arrayBuffer }, [arrayBuffer]);
      return;
    }

    const samples = int16LEToFloat32(arrayBuffer);
    if (!samples.length) return;
    const audioBuf = ctx.createBuffer(1, samples.length, SAMPLE_RATE);
    audioBuf.copyToChannel(samples, 0);
    const src = ctx.createBufferSource();
    src.buffer = audioBuf;
    src.connect(this._outputGain);
    const now = ctx.currentTime;
    const startAt = Math.max(now + 0.06, this._fbNextTime);
    this._fbNextTime = startAt + audioBuf.duration;
    this._fbSources.add(src);

    let sumSq = 0;
    for (let i = 0; i < samples.length; i += 4) sumSq += samples[i] * samples[i];
    const rms = Math.sqrt(sumSq / Math.max(1, samples.length / 4));
    this.onLevel({ output: Math.min(1, rms * 4.5) });

    src.onended = () => {
      this._fbSources.delete(src);
      if (this._fbSources.size === 0 && !this._stopped) this.onLevel({ output: 0 });
    };
    src.start(startAt);
  }

  setMuted(muted) {
    const next = Boolean(muted);
    this._muted = next;
    if (this._useWorklet && this._captureNode?.port) {
      try { this._captureNode.port.postMessage({ type: 'mute', muted: next }); } catch {}
    }
    if (next) {
      this.onLevel({ input: 0 });
    } else if (this._audioCtx && this._audioCtx.state !== 'running') {
      this._audioCtx.resume().catch(() => {});
    }
  }

  async _handleVisibilityResume() {
    if (this._stopped) return;
    setAudioSession('play-and-record');
    this._acquireWakeLock();
    if (this._audioCtx && this._audioCtx.state !== 'running') {
      try { await this._audioCtx.resume(); } catch {}
    }
    const tracks = this._stream?.getAudioTracks?.() || [];
    const micDead = tracks.length > 0 && tracks.every((tr) => tr.readyState === 'ended');
    if (micDead) {
      try {
        this._stopStream();
        this._stream = await openMicStream();
        if (!this._stopped) this._attachMicToGraph();
      } catch {}
    }
  }

  _stopStream() {
    if (this._stream) {
      try { this._stream.getTracks().forEach((t) => t.stop()); } catch {}
      this._stream = null;
    }
  }

  stop() {
    if (this._stopped) return;
    this._stopped = true;
    if (this._reconnectTimer) { clearTimeout(this._reconnectTimer); this._reconnectTimer = null; }
    if (this._onVisibility) {
      document.removeEventListener('visibilitychange', this._onVisibility);
      this._onVisibility = null;
    }
    try { this._wakeLock?.release(); } catch {}
    this._wakeLock = null;
    this._detachMicFromGraph();
    if (this._playbackNode) {
      try {
        if (this._playbackNode.port) {
          this._playbackNode.port.postMessage({ type: 'clear' });
          this._playbackNode.port.postMessage({ type: 'stop' });
        }
        this._playbackNode.disconnect();
      } catch {}
      this._playbackNode = null;
    }
    if (this._fbSources.size) {
      this._fbSources.forEach((src) => { try { src.onended = null; src.stop(0); src.disconnect(); } catch {} });
      this._fbSources.clear();
    }
    this._fbNextTime = 0;
    if (this._outputGain) {
      try { this._outputGain.disconnect(); } catch {}
      this._outputGain = null;
    }
    if (this._ws) {
      try { this._ws.onclose = null; this._ws.onerror = null; this._ws.onmessage = null; this._ws.close(1000, 'hangup'); } catch {}
      this._ws = null;
    }
    this._stopStream();
    if (this._audioCtx) {
      try { this._audioCtx.close(); } catch {}
      this._audioCtx = null;
    }
    this.onLevel({ input: 0, output: 0 });
    setCallAudioMode(false);
  }
}

// ---------- Global WaCalls React Context ----------
const WaCallsCtx = createContext(null);
export const useWaCalls = () => useContext(WaCallsCtx);

function pickSelectedSession(sessions, currentId) {
  if (!Array.isArray(sessions) || !sessions.length) return null;
  if (currentId && sessions.some((s) => s.id === currentId)) return currentId;
  const paired = sessions.find((s) => s.paired);
  return paired ? paired.id : sessions[0].id;
}

export function WaCallsProvider({ authed, children }) {
  const toast = useToast();
  const clientId = useMemo(() => getWaClientId(), []);

  const [serviceStatus, setServiceStatus] = useState({
    loading: true,
    available: null,
    running: false,
    port: null,
    sessions: 0,
    error: '',
  });
  const [sseConnected, setSseConnected] = useState(false);
  const [sessions, setSessions] = useState([]);
  const [selectedSessionId, setSelectedSessionId] = useState(null);
  const [qrs, setQrs] = useState({}); // sessionId -> qr string
  const [calls, setCalls] = useState([]); // all calls from server
  const [incoming, setIncoming] = useState(null); // { sessionId, callId, peer, offeredAt }
  const [activeCall, setActiveCall] = useState(null); // { sessionId, callId, peer, direction, status, startedAt, connectedAt }
  const [callMinimized, setCallMinimized] = useState(false);
  const [muted, setMuted] = useState(false);
  const [levels, setLevels] = useState({ input: 0, output: 0 });
  const [wsState, setWsState] = useState('idle');
  const [audioError, setAudioError] = useState('');
  const [historyVersion, setHistoryVersion] = useState(0);
  const [lastCallError, setLastCallError] = useState('');

  const audioRef = useRef(null);
  const activeCallRef = useRef(null);
  activeCallRef.current = activeCall;
  const ringtoneRef = useRef(null);
  const esRef = useRef(null);

  const stopRingtone = useCallback(() => {
    try { ringtoneRef.current?.stop(); } catch {}
  }, []);

  const stopAudio = useCallback(() => {
    if (audioRef.current) {
      try { audioRef.current.stop(); } catch {}
      audioRef.current = null;
    }
    setMuted(false);
    setLevels({ input: 0, output: 0 });
    setWsState('idle');
    releaseVoiceMic('wacalls');
  }, []);

  const refreshSessions = useCallback(async () => {
    try {
      const data = await bridge.wacallsSessions(clientId);
      const list = Array.isArray(data?.sessions) ? data.sessions : [];
      setSessions(list);
      setSelectedSessionId((cur) => pickSelectedSession(list, cur));
      return list;
    } catch {
      return null;
    }
  }, [clientId]);

  const refreshStatus = useCallback(async () => {
    try {
      const st = await bridge.wacallsStatus();
      setServiceStatus({
        loading: false,
        available: st?.available !== false,
        running: Boolean(st?.running),
        port: st?.port || null,
        sessions: Array.isArray(st?.sessions) ? st.sessions.length : (typeof st?.sessions === 'number' ? st.sessions : 0),
        error: st?.error || '',
      });
      return st;
    } catch (e) {
      setServiceStatus((prev) => ({
        ...prev,
        loading: false,
        available: false,
        running: false,
        error: e.message || 'WaCalls indisponível',
      }));
      return null;
    }
  }, []);

  // Poll initial status when authenticated.
  useEffect(() => {
    if (!authed) {
      stopRingtone();
      stopAudio();
      setActiveCall(null);
      setIncoming(null);
      setSseConnected(false);
      return;
    }
    refreshStatus();
  }, [authed, refreshStatus, stopAudio, stopRingtone]);

  // Ringtone lifecycle bound to `incoming`.
  useEffect(() => {
    if (!ringtoneRef.current) ringtoneRef.current = new RingtonePlayer();
    if (incoming) {
      ringtoneRef.current.start();
    } else {
      ringtoneRef.current.stop();
    }
    return () => { try { ringtoneRef.current?.stop(); } catch {} };
  }, [incoming]);

  // Connect EventSource whenever WaCalls service is running and user is authed.
  useEffect(() => {
    if (!authed || !serviceStatus.running) {
      if (esRef.current) {
        try { esRef.current.close(); } catch {}
        esRef.current = null;
      }
      setSseConnected(false);
      return undefined;
    }

    refreshSessions();

    const url = bridge.wacallsEventsUrl(clientId);
    const es = new EventSource(url);
    esRef.current = es;

    es.onopen = () => setSseConnected(true);
    es.onerror = () => setSseConnected(false);
    es.onmessage = (ev) => {
      let msg;
      try { msg = JSON.parse(ev.data); } catch { return; }
      if (!msg || typeof msg !== 'object') return;

      switch (msg.type) {
        case 'session-list': {
          const list = Array.isArray(msg.sessions) ? msg.sessions : [];
          setSessions(list);
          setSelectedSessionId((cur) => pickSelectedSession(list, cur));
          const ids = new Set(list.map((s) => s.id));
          setQrs((prev) => {
            const next = {};
            for (const [k, v] of Object.entries(prev)) {
              if (ids.has(k)) next[k] = v;
            }
            return next;
          });
          break;
        }
        case 'session-qr': {
          if (msg.sessionId && msg.qr) {
            setQrs((prev) => ({ ...prev, [msg.sessionId]: msg.qr }));
          }
          break;
        }
        case 'auth-state': {
          const sid = msg.sessionId;
          if (!sid) break;
          setSessions((prev) => prev.map((s) => (
            s.id === sid ? { ...s, state: msg.state ?? s.state, paired: Boolean(msg.paired) } : s
          )));
          setQrs((prev) => {
            const next = { ...prev };
            if (msg.paired) delete next[sid];
            else if (msg.qr) next[sid] = msg.qr;
            return next;
          });
          if (msg.paired) {
            refreshSessions();
          }
          break;
        }
        case 'call-list': {
          const list = Array.isArray(msg.calls) ? msg.calls : [];
          setCalls(list);
          const cur = activeCallRef.current;
          if (cur) {
            const match = list.find((c) => c.callId === cur.callId);
            if (match) {
              setActiveCall((prev) => (prev && prev.callId === match.callId
                ? {
                  ...prev,
                  status: match.status || prev.status,
                  peer: match.peer || prev.peer,
                  startedAt: match.startedAt || prev.startedAt,
                  connectedAt: match.status === 'connected' && !prev.connectedAt ? Date.now() : prev.connectedAt,
                }
                : prev));
            }
          }
          break;
        }
        case 'call-status': {
          setCalls((prev) => {
            const exists = prev.some((c) => c.callId === msg.id);
            const row = {
              sessionId: msg.sessionId,
              callId: msg.id,
              owner: msg.owner ?? null,
              status: msg.status,
              peer: msg.peer,
              startedAt: msg.startedAt,
            };
            return exists
              ? prev.map((c) => (c.callId === msg.id ? { ...c, ...row } : c))
              : [...prev, row];
          });
          if (activeCallRef.current?.callId === msg.id) {
            setActiveCall((prev) => (prev && prev.callId === msg.id
              ? {
                ...prev,
                status: msg.status || prev.status,
                peer: msg.peer || prev.peer,
                startedAt: msg.startedAt || prev.startedAt,
                connectedAt: msg.status === 'connected' && !prev.connectedAt ? Date.now() : prev.connectedAt,
              }
              : prev));
          }
          break;
        }
        case 'call-ended': {
          setCalls((prev) => prev.filter((c) => c.callId !== msg.id));
          setIncoming((prev) => (prev?.callId === msg.id ? null : prev));
          if (activeCallRef.current?.callId === msg.id) {
            stopAudio();
            setActiveCall(null);
            setCallMinimized(false);
            if (msg.reason && msg.reason !== 'user_ended') {
              toast(`Chamada encerrada (${msg.reason})`);
            }
          }
          setHistoryVersion((v) => v + 1);
          break;
        }
        case 'incoming': {
          const payload = {
            sessionId: msg.sessionId,
            callId: msg.id,
            peer: msg.peer,
            offeredAt: msg.offeredAt || Date.now(),
          };
          setIncoming(payload);
          if (document.hidden && typeof Notification !== 'undefined' && Notification.permission === 'granted') {
            try {
              const n = new Notification('Chamada recebida · WhatsApp', {
                body: formatPeer(msg.peer),
                tag: 'wacall-' + msg.id,
                requireInteraction: true,
              });
              n.onclick = () => { try { window.focus(); } catch {} n.close(); };
            } catch {}
          }
          break;
        }
        case 'incoming-claimed': {
          setIncoming((prev) => (prev?.callId === msg.id ? null : prev));
          break;
        }
        default:
          break;
      }
    };

    return () => {
      try { es.close(); } catch {}
      if (esRef.current === es) esRef.current = null;
      setSseConnected(false);
    };
  }, [authed, serviceStatus.running, clientId, refreshSessions, stopAudio, toast]);

  // Cleanup on unmount.
  useEffect(() => () => {
    stopRingtone();
    stopAudio();
  }, [stopAudio, stopRingtone]);

  const startService = useCallback(async () => {
    const r = await bridge.wacallsStart();
    await refreshStatus();
    return r;
  }, [refreshStatus]);

  const stopService = useCallback(async () => {
    stopRingtone();
    stopAudio();
    setActiveCall(null);
    setIncoming(null);
    const r = await bridge.wacallsStop();
    await refreshStatus();
    setSessions([]);
    setQrs({});
    setCalls([]);
    return r;
  }, [refreshStatus, stopAudio, stopRingtone]);

  const createSession = useCallback(async (name) => {
    const clean = String(name || '').trim() || 'WhatsApp';
    const res = await bridge.wacallsCreateSession(clean, clientId);
    await refreshSessions();
    if (res?.id) setSelectedSessionId(res.id);
    return res;
  }, [clientId, refreshSessions]);

  const pairSession = useCallback(async (sid) => {
    await bridge.wacallsPairSession(sid, clientId);
  }, [clientId]);

  const logoutSession = useCallback(async (sid) => {
    await bridge.wacallsLogoutSession(sid, clientId);
    setQrs((prev) => { const next = { ...prev }; delete next[sid]; return next; });
    await refreshSessions();
  }, [clientId, refreshSessions]);

  const deleteSession = useCallback(async (sid) => {
    await bridge.wacallsDeleteSession(sid, clientId);
    setQrs((prev) => { const next = { ...prev }; delete next[sid]; return next; });
    await refreshSessions();
  }, [clientId, refreshSessions]);

  const openAudioForCall = useCallback((sid, callId) => {
    stopAudio();
    setAudioError('');
    const prevOwner = getActiveVoiceOwner();
    if (prevOwner === 'bot-voice') {
      toast('Ligação com o bot encerrada para usar o microfone no WhatsApp.');
    }
    acquireVoiceMic('wacalls', {
      preempt: true,
      onForceRelease: () => {
        if (audioRef.current) {
          try { audioRef.current.stop(); } catch {}
          audioRef.current = null;
        }
      },
    });
    const session = new WaCallAudioSession({
      sid,
      callId,
      clientId,
      onLevel: ({ input, output }) => {
        setLevels((prev) => ({
          input: input !== undefined ? input : prev.input,
          output: output !== undefined ? output : prev.output,
        }));
      },
      onWsState: (st) => setWsState(st),
      onError: (msg) => setAudioError(msg),
    });
    audioRef.current = session;
    session.start();
  }, [clientId, stopAudio, toast]);

  const startCall = useCallback(async (sid, phone) => {
    setLastCallError('');
    setAudioError('');
    if (!sid) throw new Error('Selecione uma sessão WhatsApp conectada.');
    const cleanPhone = String(phone || '').trim();
    if (!cleanPhone) throw new Error('Informe um número de telefone.');
    if (activeCallRef.current) throw new Error('Já existe uma chamada ativa.');

    unlockWaCallAudio();
    try {
      const res = await bridge.wacallsStartCall(sid, cleanPhone, clientId);
      const callId = res?.call?.callId || res?.callId;
      if (!callId) throw new Error('Resposta inválida ao iniciar chamada.');
      const nextCall = {
        sessionId: sid,
        callId,
        peer: cleanPhone,
        direction: 'outbound',
        status: 'ringing',
        startedAt: Date.now(),
        connectedAt: null,
      };
      setActiveCall(nextCall);
      setCallMinimized(false);
      setMuted(false);
      openAudioForCall(sid, callId);
      return nextCall;
    } catch (err) {
      setCallAudioMode(false);
      const msg = err?.status === 403
        ? (err.message || 'Número bloqueado pela política de chamadas.')
        : (err?.message || 'Não foi possível iniciar a chamada.');
      setLastCallError(msg);
      throw err;
    }
  }, [clientId, openAudioForCall]);

  const acceptIncoming = useCallback(async (inc = incoming) => {
    if (!inc) return null;
    stopRingtone();
    unlockWaCallAudio();
    setLastCallError('');
    setAudioError('');
    try {
      const res = await bridge.wacallsAcceptCall(inc.sessionId, inc.callId, clientId);
      const callId = res?.call?.callId || inc.callId;
      setIncoming(null);
      const nextCall = {
        sessionId: inc.sessionId,
        callId,
        peer: inc.peer,
        direction: 'inbound',
        status: 'connected',
        startedAt: inc.offeredAt || Date.now(),
        connectedAt: Date.now(),
      };
      setActiveCall(nextCall);
      setCallMinimized(false);
      setMuted(false);
      openAudioForCall(inc.sessionId, callId);
      return nextCall;
    } catch (err) {
      setCallAudioMode(false);
      setIncoming(null);
      toast(err?.message || 'Não foi possível atender a chamada.', 'err');
      return null;
    }
  }, [clientId, incoming, openAudioForCall, stopRingtone, toast]);

  const rejectIncoming = useCallback(async (inc = incoming) => {
    if (!inc) return;
    stopRingtone();
    setIncoming(null);
    try {
      await bridge.wacallsRejectCall(inc.sessionId, inc.callId, clientId);
      setHistoryVersion((v) => v + 1);
    } catch (err) {
      toast(err?.message || 'Erro ao recusar chamada.', 'err');
    }
  }, [clientId, incoming, stopRingtone, toast]);

  const hangupCall = useCallback(async () => {
    const cur = activeCallRef.current;
    stopAudio();
    setActiveCall(null);
    setCallMinimized(false);
    if (!cur) return;
    try {
      await bridge.wacallsEndCall(cur.sessionId, cur.callId, clientId);
    } catch {}
    setHistoryVersion((v) => v + 1);
  }, [clientId, stopAudio]);

  const toggleMute = useCallback(() => {
    setMuted((prev) => {
      const next = !prev;
      audioRef.current?.setMuted(next);
      return next;
    });
  }, []);

  const loadHistory = useCallback(async (sid) => {
    if (!sid) return [];
    const data = await bridge.wacallsHistory(sid, clientId);
    return Array.isArray(data?.rows) ? data.rows : [];
  }, [clientId]);

  const value = useMemo(() => ({
    clientId,
    serviceStatus,
    sseConnected,
    sessions,
    selectedSessionId,
    setSelectedSessionId,
    qrs,
    calls,
    incoming,
    activeCall,
    callMinimized,
    setCallMinimized,
    muted,
    levels,
    wsState,
    audioError,
    lastCallError,
    setLastCallError,
    historyVersion,
    refreshStatus,
    refreshSessions,
    startService,
    stopService,
    createSession,
    pairSession,
    logoutSession,
    deleteSession,
    startCall,
    acceptIncoming,
    rejectIncoming,
    hangupCall,
    toggleMute,
    loadHistory,
  }), [
    clientId, serviceStatus, sseConnected, sessions, selectedSessionId, qrs, calls,
    incoming, activeCall, callMinimized, muted, levels, wsState, audioError,
    lastCallError, historyVersion, refreshStatus, refreshSessions, startService,
    stopService, createSession, pairSession, logoutSession, deleteSession,
    startCall, acceptIncoming, rejectIncoming, hangupCall, toggleMute, loadHistory,
  ]);

  return <WaCallsCtx.Provider value={value}>{children}</WaCallsCtx.Provider>;
}
