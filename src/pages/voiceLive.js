// Full-duplex real-time voice engine for Gemini Live API over WebSocket.
// - Capture: AudioWorklet (16kHz Int16 PCM LE + RMS) with ScriptProcessorNode fallback.
// - Playback: AudioWorklet FIFO ring buffer (24kHz Int16 PCM LE -> device rate) with instant
//   click-free barge-in flush (< 15ms) and AudioBufferSourceNode fallback.
// - iOS/Safari friendly: pre-warmable AudioContext + navigator.audioSession 'play-and-record'
//   + automatic visibility/mic recovery.

import { bridge } from '../api.js';
import { setAudioSession, setCallAudioMode } from './chatMedia.jsx';

const WORKLET_URL = '/voice-worklet.js';
const DEFAULT_RATE_IN = 16000;
const DEFAULT_RATE_OUT = 24000;
const PING_INTERVAL_MS = 25000;
const MAX_RECONNECTS = 3;

let prewarmedCtx = null;

function getAudioContextCtor() {
  if (typeof window === 'undefined') return null;
  return window.AudioContext || window.webkitAudioContext || null;
}

// Call synchronously inside the user's tap/click gesture when opening a call so iOS Safari
// unlocks Web Audio playback in 'play-and-record' mode before async getUserMedia/WS steps run.
export function unlockLiveAudio() {
  setCallAudioMode(true);
  const AC = getAudioContextCtor();
  if (!AC) return;
  try {
    if (!prewarmedCtx || prewarmedCtx.state === 'closed') {
      prewarmedCtx = new AC();
    }
    if (prewarmedCtx.state === 'suspended') {
      prewarmedCtx.resume().catch(() => {});
    }
    // 1-sample silent buffer unlocks iOS Web Audio output reliably.
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

export function isRealtimeAvailable(status) {
  if (!status || typeof status !== 'object') return false;
  if (status.available === false || status.enabled === false || status.realtime === false) return false;
  return Boolean(
    status.available ||
    status.enabled ||
    status.realtime ||
    status.geminiConfigured ||
    status.configured ||
    status.ok
  );
}

// Downsamples Float32 audio from srcRate to targetRate and returns { pcm: ArrayBuffer (Int16 LE), rms }.
function downsampleToInt16LE(input, srcRate, targetRate) {
  const ratio = srcRate / targetRate;
  const outLen = Math.max(1, Math.floor(input.length / ratio));
  const buf = new ArrayBuffer(outLen * 2);
  const view = new DataView(buf);
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
    view.setInt16(i * 2, sample < 0 ? (sample * 0x8000) | 0 : (sample * 0x7fff) | 0, true);
  }
  return { pcm: buf, rms: Math.sqrt(sumSq / outLen) };
}

function int16LEBufferToFloat32(buffer) {
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

export class VoiceLiveSession {
  constructor(opts = {}) {
    this.chatId = opts.chatId || '';
    this.bot = opts.bot || '';
    this.lang = opts.lang || 'pt-BR';
    this.voice = opts.voice || '';
    this.onState = opts.onState || (() => {});
    this.onLevel = opts.onLevel || (() => {});
    this.onTranscript = opts.onTranscript || (() => {});
    this.onTool = opts.onTool || (() => {});
    this.onReconnecting = opts.onReconnecting || (() => {});
    this.onError = opts.onError || (() => {});
    this.onFallbackClassic = opts.onFallbackClassic || (() => {});
    this.onReady = opts.onReady || (() => {});

    this._stopped = false;
    this._muted = false;
    this._volume = 1;
    this._ready = false;
    this._everReady = false;
    this._speaking = false;
    this._turnComplete = false;
    this._suppressTurnAudio = false;
    this._sampleRateIn = DEFAULT_RATE_IN;
    this._sampleRateOut = DEFAULT_RATE_OUT;

    this._audioCtx = null;
    this._stream = null;
    this._micSource = null;
    this._captureNode = null;
    this._captureSilentGain = null;
    this._playbackNode = null;
    this._outputGain = null;
    this._useWorklet = false;

    // Fallback playback state (when AudioWorklet is unavailable)
    this._fbSources = new Set();
    this._fbNextTime = 0;

    // WebSocket state
    this._ws = null;
    this._pingTimer = null;
    this._reconnectTimer = null;
    this._reconnectAttempt = 0;
    this._lastPongAt = 0;
    this._fatalReceived = false;
  }

  async start() {
    this._stopped = false;
    this._fatalReceived = false;
    this._setState('connecting');
    setCallAudioMode(true);

    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      const msg = 'Este navegador não suporta acesso ao microfone.';
      this.onError({ message: msg, fatal: true });
      this.onFallbackClassic(msg);
      return;
    }

    try {
      this._stream = await openMicStream();
    } catch (err) {
      if (this._stopped) return;
      const denied = err?.name === 'NotAllowedError' || err?.name === 'PermissionDeniedError';
      const msg = denied
        ? 'Microfone bloqueado. Libere a permissão do microfone no navegador/iPhone e tente novamente.'
        : ('Não foi possível abrir o microfone' + (err?.message ? ': ' + err.message : '.'));
      this.onError({ message: msg, fatal: true, micError: true });
      this._setState('error');
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
      const msg = 'Erro ao inicializar áudio em tempo real: ' + (err?.message || err);
      this.onError({ message: msg, fatal: true });
      this.onFallbackClassic(msg);
      this.stop();
      return;
    }

    if (this._stopped) return;
    this._connectWs(false);
  }

  async _setupAudioGraph() {
    const ctx = takeAudioContext();
    if (!ctx) throw new Error('AudioContext indisponível neste navegador.');
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
          sourceSampleRate: this._sampleRateOut,
          prebufferSec: 0.04,
          volume: 1,
        },
      });
      this._playbackNode.port.onmessage = (ev) => this._handlePlaybackMessage(ev.data);
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
          targetSampleRate: this._sampleRateIn,
          chunkSamples: 960, // 60ms @ 16kHz
          muted: this._muted,
        },
      });
      cap.port.onmessage = (ev) => {
        const msg = ev.data;
        if (!msg || msg.type !== 'audio') return;
        this._handleCapturedAudio(msg.pcm, msg.rms);
      };
      this._micSource.connect(cap);
      // Connecting to a zero-gain node keeps WebKit/Safari ticking process() without any echo.
      cap.connect(this._captureSilentGain);
      this._captureNode = cap;
    } else if (typeof ctx.createScriptProcessor === 'function') {
      const proc = ctx.createScriptProcessor(2048, 1, 1);
      proc.onaudioprocess = (ev) => {
        if (this._stopped || this._muted) return;
        const input = ev.inputBuffer.getChannelData(0);
        const { pcm, rms } = downsampleToInt16LE(input, ctx.sampleRate, this._sampleRateIn);
        this._handleCapturedAudio(pcm, rms);
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
  }

  _handleCapturedAudio(pcmBuffer, rms) {
    if (this._stopped || this._muted) return;
    const norm = Math.min(1, (rms || 0) * 5.5);
    this.onLevel({ input: norm, output: this._speaking ? undefined : 0 });
    if (this._ready && this._ws && this._ws.readyState === WebSocket.OPEN) {
      try {
        this._ws.send(pcmBuffer);
      } catch {}
    }
  }

  _handlePlaybackMessage(msg) {
    if (!msg || this._stopped) return;
    if (msg.type === 'level') {
      const norm = Math.min(1, (msg.rms || 0) * 4.5);
      this.onLevel({ output: norm });
    } else if (msg.type === 'drained') {
      this._speaking = false;
      this.onLevel({ output: 0 });
      if (this._turnComplete && this._ready) {
        this._setState(this._muted ? 'muted' : 'listening');
      }
    }
  }

  _connectWs(isReconnect) {
    if (this._stopped) return;
    this._clearTimers();
    if (this._ws) {
      try { this._ws.onclose = null; this._ws.onerror = null; this._ws.onmessage = null; this._ws.close(); } catch {}
      this._ws = null;
    }

    const url = bridge.voiceWsUrl({
      chatId: this.chatId,
      bot: this.bot,
      lang: this.lang,
      voice: this.voice,
    });

    if (isReconnect) {
      this.onReconnecting({ active: true, reason: 'Reconectando áudio em tempo real…' });
    } else {
      this._setState('connecting');
    }

    let ws;
    try {
      ws = new WebSocket(url);
    } catch (err) {
      const msg = 'Falha ao abrir WebSocket de voz: ' + (err?.message || err);
      this.onError({ message: msg, fatal: true });
      if (!this._everReady) this.onFallbackClassic(msg);
      return;
    }

    ws.binaryType = 'arraybuffer';
    this._ws = ws;

    ws.onopen = () => {
      if (this._stopped || this._ws !== ws) return;
      this._lastPongAt = Date.now();
      this._pingTimer = setInterval(() => {
        if (this._ws && this._ws.readyState === WebSocket.OPEN) {
          this._sendJson({ type: 'ping' });
        }
      }, PING_INTERVAL_MS);
    };

    ws.onmessage = async (ev) => {
      if (this._stopped || this._ws !== ws) return;
      if (typeof ev.data === 'string') {
        this._handleJsonMessage(ev.data);
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

    ws.onerror = () => {
      // onclose handles retry / fallback cleanly.
    };

    ws.onclose = (ev) => {
      if (this._stopped || this._ws !== ws) return;
      this._clearPing();
      this._ready = false;

      if (this._fatalReceived) return;

      // Never became ready on initial connection: fall back cleanly to classic mode.
      if (!this._everReady) {
        const reason = ev?.reason || (ev?.code === 1006 ? 'Conexão WebSocket indisponível' : `Conexão encerrada (${ev?.code || 0})`);
        this.onError({ message: reason, fatal: true });
        this.onFallbackClassic(reason);
        return;
      }

      // Transient disconnect during an active call: try to auto-reconnect without ending the call.
      if (this._reconnectAttempt < MAX_RECONNECTS) {
        this._reconnectAttempt++;
        const delay = Math.min(4000, 900 * Math.pow(2, this._reconnectAttempt - 1));
        this.onReconnecting({ active: true, reason: `Reconectando sessão (${this._reconnectAttempt}/${MAX_RECONNECTS})…` });
        this._reconnectTimer = setTimeout(() => this._connectWs(true), delay);
      } else {
        this.onReconnecting({ active: false, reason: '' });
        this.onError({ message: 'Conexão em tempo real perdida. Você pode reconectar ou continuar no modo clássico.', fatal: true });
        this._setState('error');
      }
    };
  }

  _handleJsonMessage(raw) {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }
    if (!msg || typeof msg !== 'object') return;

    switch (msg.type) {
      case 'ready': {
        this._ready = true;
        this._everReady = true;
        this._reconnectAttempt = 0;
        this._suppressTurnAudio = false;
        this._turnComplete = false;
        if (msg.sampleRateIn && msg.sampleRateIn !== this._sampleRateIn) {
          this._sampleRateIn = Number(msg.sampleRateIn) || DEFAULT_RATE_IN;
          if (this._useWorklet && this._captureNode?.port) {
            this._captureNode.port.postMessage({ type: 'config', targetSampleRate: this._sampleRateIn });
          }
        }
        if (msg.sampleRateOut && msg.sampleRateOut !== this._sampleRateOut) {
          this._sampleRateOut = Number(msg.sampleRateOut) || DEFAULT_RATE_OUT;
          if (this._useWorklet && this._playbackNode?.port) {
            this._playbackNode.port.postMessage({ type: 'config', sourceSampleRate: this._sampleRateOut });
          }
        }
        this.onReconnecting({ active: false, reason: '' });
        this.onReady({
          model: msg.model || '',
          voice: msg.voice || '',
          sampleRateIn: this._sampleRateIn,
          sampleRateOut: this._sampleRateOut,
          resumed: Boolean(msg.resumed),
        });
        this._setState(this._muted ? 'muted' : 'listening');
        break;
      }
      case 'transcript': {
        if (msg.role === 'user') this._suppressTurnAudio = false;
        const isFinal = Boolean(msg.final);
        const rawText = typeof msg.text === 'string' ? msg.text : '';
        const deltaStr = typeof msg.delta === 'string'
          ? msg.delta
          : (msg.delta === true && !isFinal ? rawText : '');
        const textStr = (msg.delta === true && !isFinal) ? '' : rawText;
        this.onTranscript({
          role: msg.role === 'user' ? 'user' : 'assistant',
          text: textStr,
          delta: deltaStr,
          final: isFinal,
        });
        break;
      }
      case 'interrupted': {
        this._suppressTurnAudio = false;
        this._turnComplete = false;
        this._clearPlayback();
        this._setState(this._muted ? 'muted' : 'listening');
        this.onTranscript({ role: 'assistant', text: '', delta: '', final: true, interrupted: true });
        break;
      }
      case 'turn_complete': {
        this._turnComplete = true;
        this._suppressTurnAudio = false;
        if (this._useWorklet && this._playbackNode?.port) {
          this._playbackNode.port.postMessage({ type: 'turn_complete' });
        } else if (this._fbSources.size === 0) {
          this._speaking = false;
          this.onLevel({ output: 0 });
          this._setState(this._muted ? 'muted' : 'listening');
        }
        if (!this._speaking && this._ready) {
          this._setState(this._muted ? 'muted' : 'listening');
        }
        break;
      }
      case 'tool': {
        this.onTool({
          name: msg.name || 'agent',
          status: msg.status || 'running',
          detail: msg.detail || '',
        });
        break;
      }
      case 'reconnecting': {
        this.onReconnecting({ active: true, reason: msg.reason || 'Reconectando sessão…' });
        break;
      }
      case 'error': {
        const message = msg.message || 'Erro na sessão de voz em tempo real.';
        const fatal = Boolean(msg.fatal);
        if (fatal) this._fatalReceived = true;
        this.onError({ message, fatal });
        if (fatal) {
          this._clearPlayback();
          this._ready = false;
          if (!this._everReady) {
            this.onFallbackClassic(message);
          } else {
            this._setState('error');
          }
        }
        break;
      }
      case 'pong': {
        this._lastPongAt = Date.now();
        break;
      }
      default:
        break;
    }
  }

  _enqueuePlaybackPcm(arrayBuffer) {
    if (this._stopped || this._suppressTurnAudio) return;
    const ctx = this._audioCtx;
    if (!ctx) return;
    if (ctx.state === 'suspended' || ctx.state === 'interrupted') {
      ctx.resume().catch(() => {});
    }

    this._turnComplete = false;
    if (!this._speaking) {
      this._speaking = true;
      this._setState('speaking');
    }

    if (this._useWorklet && this._playbackNode?.port) {
      this._playbackNode.port.postMessage({ type: 'pcm', buffer: arrayBuffer }, [arrayBuffer]);
      return;
    }

    // Fallback: gapless chained AudioBufferSourceNodes with instant stop() on barge-in.
    const samples = int16LEBufferToFloat32(arrayBuffer);
    if (!samples.length) return;
    const audioBuf = ctx.createBuffer(1, samples.length, this._sampleRateOut);
    audioBuf.copyToChannel(samples, 0);
    const src = ctx.createBufferSource();
    src.buffer = audioBuf;
    src.connect(this._outputGain);
    const now = ctx.currentTime;
    const startAt = Math.max(now + 0.02, this._fbNextTime);
    this._fbNextTime = startAt + audioBuf.duration;
    this._fbSources.add(src);

    // Quick RMS approximation for orb animation in fallback mode.
    let sumSq = 0;
    for (let i = 0; i < samples.length; i += 8) sumSq += samples[i] * samples[i];
    const rms = Math.sqrt(sumSq / Math.max(1, samples.length / 8));
    this.onLevel({ output: Math.min(1, rms * 4.5) });

    src.onended = () => {
      this._fbSources.delete(src);
      if (this._fbSources.size === 0 && !this._stopped) {
        this._speaking = false;
        this.onLevel({ output: 0 });
        if (this._turnComplete && this._ready) {
          this._setState(this._muted ? 'muted' : 'listening');
        }
      }
    };
    src.start(startAt);
  }

  _clearPlayback() {
    this._speaking = false;
    this.onLevel({ output: 0 });
    if (this._useWorklet && this._playbackNode?.port) {
      try { this._playbackNode.port.postMessage({ type: 'clear' }); } catch {}
    }
    if (this._fbSources.size) {
      this._fbSources.forEach((src) => {
        try { src.onended = null; src.stop(0); src.disconnect(); } catch {}
      });
      this._fbSources.clear();
    }
    this._fbNextTime = 0;
  }

  _sendJson(obj) {
    if (!this._ws || this._ws.readyState !== WebSocket.OPEN) return false;
    try {
      this._ws.send(JSON.stringify(obj));
      return true;
    } catch {
      return false;
    }
  }

  setMuted(muted) {
    const next = Boolean(muted);
    if (this._muted === next) return;
    this._muted = next;
    if (this._useWorklet && this._captureNode?.port) {
      try { this._captureNode.port.postMessage({ type: 'mute', muted: next }); } catch {}
    }
    if (next) {
      this.onLevel({ input: 0 });
      this._sendJson({ type: 'audio_end' });
      if (!this._speaking && this._ready) this._setState('muted');
    } else {
      if (this._audioCtx && this._audioCtx.state !== 'running') {
        this._audioCtx.resume().catch(() => {});
      }
      if (!this._speaking && this._ready) this._setState('listening');
    }
  }

  interrupt() {
    if (!this._speaking) return;
    this._suppressTurnAudio = true;
    this._clearPlayback();
    if (this._muted) this.setMuted(false);
    if (this._ready) this._setState('listening');
  }

  sendText(text) {
    const clean = String(text || '').trim();
    if (!clean) return false;
    this._suppressTurnAudio = false;
    if (this._speaking) this._clearPlayback();
    return this._sendJson({ type: 'text', text: clean });
  }

  setVolume(val) {
    this._volume = Math.max(0, Math.min(1.2, Number(val) || 0));
    if (this._outputGain && this._audioCtx) {
      try {
        this._outputGain.gain.setTargetAtTime(this._volume, this._audioCtx.currentTime, 0.015);
      } catch {
        this._outputGain.gain.value = this._volume;
      }
    }
  }

  reconnect() {
    if (this._stopped) return;
    this._fatalReceived = false;
    this._reconnectAttempt = 0;
    const tracks = this._stream?.getAudioTracks?.() || [];
    const micDead = !this._stream || tracks.length === 0 || tracks.every((tr) => tr.readyState === 'ended');
    if (!this._audioCtx || this._audioCtx.state === 'closed' || micDead) {
      this._clearTimers();
      this._clearPlayback();
      this._detachMicFromGraph();
      if (this._playbackNode) {
        try {
          if (this._playbackNode.port) this._playbackNode.port.postMessage({ type: 'stop' });
          this._playbackNode.disconnect();
        } catch {}
        this._playbackNode = null;
      }
      if (this._outputGain) {
        try { this._outputGain.disconnect(); } catch {}
        this._outputGain = null;
      }
      this._stopStream();
      if (this._audioCtx) {
        try { this._audioCtx.close(); } catch {}
        this._audioCtx = null;
      }
      return this.start();
    }
    this._connectWs(true);
  }

  async handleVisibilityResume() {
    if (this._stopped) return;
    setAudioSession('play-and-record');
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
    if (!this._stopped && (!this._ws || this._ws.readyState === WebSocket.CLOSED || this._ws.readyState === WebSocket.CLOSING)) {
      if (!this._fatalReceived) {
        this._reconnectAttempt = 0;
        this._connectWs(true);
      }
    }
  }

  _setState(state) {
    this.onState(state);
  }

  _clearPing() {
    if (this._pingTimer) { clearInterval(this._pingTimer); this._pingTimer = null; }
  }

  _clearTimers() {
    this._clearPing();
    if (this._reconnectTimer) { clearTimeout(this._reconnectTimer); this._reconnectTimer = null; }
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
    this._ready = false;
    this._clearTimers();
    this._clearPlayback();
    this._detachMicFromGraph();
    if (this._playbackNode) {
      try {
        if (this._playbackNode.port) this._playbackNode.port.postMessage({ type: 'stop' });
        this._playbackNode.disconnect();
      } catch {}
      this._playbackNode = null;
    }
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
    setCallAudioMode(false);
  }
}
