// AudioWorklet processors for full-duplex Gemini Live voice calls.
// - voice-capture-processor: resamples native device audio (e.g. 48kHz / 44.1kHz) to 16kHz Int16 PCM LE + RMS.
// - voice-playback-processor: plays streamed 24kHz Int16 PCM LE with smooth resampling, zero-click FIFO queue,
//   output RMS metering, and instant (< 10ms) ramp-down flush on barge-in.

const IS_LITTLE_ENDIAN = new Uint8Array(new Uint16Array([1]).buffer)[0] === 1;

function floatToInt16LE(samples) {
  const len = samples.length;
  if (IS_LITTLE_ENDIAN) {
    const out = new Int16Array(len);
    for (let i = 0; i < len; i++) {
      const s = samples[i] < -1 ? -1 : samples[i] > 1 ? 1 : samples[i];
      out[i] = s < 0 ? (s * 0x8000) | 0 : (s * 0x7fff) | 0;
    }
    return out.buffer;
  }
  const buf = new ArrayBuffer(len * 2);
  const view = new DataView(buf);
  for (let i = 0; i < len; i++) {
    const s = samples[i] < -1 ? -1 : samples[i] > 1 ? 1 : samples[i];
    view.setInt16(i * 2, s < 0 ? (s * 0x8000) | 0 : (s * 0x7fff) | 0, true);
  }
  return buf;
}

function int16LEToFloat32(buffer) {
  const byteLen = buffer.byteLength - (buffer.byteLength % 2);
  const count = byteLen >> 1;
  const out = new Float32Array(count);
  if (!count) return out;
  if (IS_LITTLE_ENDIAN) {
    const view = new Int16Array(buffer, 0, count);
    for (let i = 0; i < count; i++) out[i] = view[i] / 32768;
  } else {
    const view = new DataView(buffer, 0, byteLen);
    for (let i = 0; i < count; i++) out[i] = view.getInt16(i * 2, true) / 32768;
  }
  return out;
}

class VoiceCaptureProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const opts = options?.processorOptions || {};
    this._targetRate = Number(opts.targetSampleRate) || 16000;
    this._chunkSamples = Number(opts.chunkSamples) || 960; // 60ms @ 16kHz
    this._ratio = sampleRate / this._targetRate;
    this._muted = Boolean(opts.muted);
    this._stopped = false;

    this._tail = new Float32Array(0);
    this._pos = 0;
    this._out = new Float32Array(this._chunkSamples);
    this._outIdx = 0;
    this._sumSq = 0;

    this.port.onmessage = (ev) => {
      const msg = ev.data;
      if (!msg || typeof msg !== 'object') return;
      if (msg.type === 'mute') {
        this._muted = Boolean(msg.muted);
        if (this._muted) {
          this._outIdx = 0;
          this._sumSq = 0;
        }
      } else if (msg.type === 'config') {
        if (msg.targetSampleRate) {
          this._targetRate = Number(msg.targetSampleRate) || 16000;
          this._ratio = sampleRate / this._targetRate;
        }
        if (msg.chunkSamples && msg.chunkSamples !== this._chunkSamples) {
          this._chunkSamples = Math.max(320, Math.min(3200, Number(msg.chunkSamples) || 960));
          this._out = new Float32Array(this._chunkSamples);
          this._outIdx = 0;
          this._sumSq = 0;
        }
      } else if (msg.type === 'stop') {
        this._stopped = true;
      }
    };
  }

  _emitChunk() {
    const rms = Math.sqrt(this._sumSq / this._outIdx);
    const slice = this._outIdx === this._out.length ? this._out : this._out.subarray(0, this._outIdx);
    const pcm = floatToInt16LE(slice);
    this._outIdx = 0;
    this._sumSq = 0;
    this.port.postMessage({ type: 'audio', pcm, rms }, [pcm]);
  }

  process(inputs) {
    if (this._stopped) return false;
    const input = inputs[0];
    if (!input || !input.length) return true;
    const ch0 = input[0];
    if (!ch0 || !ch0.length) return true;

    if (this._muted) return true;

    const tailLen = this._tail.length;
    const totalLen = tailLen + ch0.length;
    const src = new Float32Array(totalLen);
    if (tailLen) src.set(this._tail, 0);
    src.set(ch0, tailLen);

    const ratio = this._ratio;
    let pos = this._pos;

    if (Math.abs(ratio - 1) < 1e-4) {
      for (let i = Math.floor(pos); i < totalLen; i++) {
        const s = src[i];
        this._out[this._outIdx++] = s;
        this._sumSq += s * s;
        if (this._outIdx >= this._out.length) this._emitChunk();
      }
      this._tail = new Float32Array(0);
      this._pos = 0;
      return true;
    }

    if (ratio > 1) {
      // Exact fractional area-averaging decimation (natural anti-aliasing, zero phase drift).
      while (pos + ratio <= totalLen) {
        const end = pos + ratio;
        const i0 = Math.floor(pos);
        const i1 = Math.floor(end);
        let acc = 0;
        if (i0 === i1) {
          acc = src[i0] * (end - pos);
        } else {
          acc += src[i0] * (1 - (pos - i0));
          for (let i = i0 + 1; i < i1; i++) acc += src[i];
          if (end > i1 && i1 < totalLen) acc += src[i1] * (end - i1);
        }
        const s = acc / ratio;
        this._out[this._outIdx++] = s;
        this._sumSq += s * s;
        if (this._outIdx >= this._out.length) this._emitChunk();
        pos = end;
      }
      const keepFrom = Math.floor(pos);
      this._tail = keepFrom < totalLen ? src.slice(keepFrom) : new Float32Array(0);
      this._pos = pos - keepFrom;
    } else {
      // Rare upsampling case (e.g. 8kHz mic -> 16kHz): linear interpolation.
      while (pos + 1 < totalLen) {
        const i0 = Math.floor(pos);
        const frac = pos - i0;
        const s = src[i0] * (1 - frac) + src[i0 + 1] * frac;
        this._out[this._outIdx++] = s;
        this._sumSq += s * s;
        if (this._outIdx >= this._out.length) this._emitChunk();
        pos += ratio;
      }
      const keepFrom = Math.floor(pos);
      this._tail = keepFrom < totalLen ? src.slice(keepFrom) : new Float32Array(0);
      this._pos = pos - keepFrom;
    }

    return true;
  }
}

class VoicePlaybackProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const opts = options?.processorOptions || {};
    this._srcRate = Number(opts.sourceSampleRate) || 24000;
    this._ratio = this._srcRate / sampleRate;
    this._prebufferSamples = Math.max(240, Math.round(this._srcRate * (Number(opts.prebufferSec) || 0.04)));
    this._volume = typeof opts.volume === 'number' ? opts.volume : 1;
    this._stopped = false;

    this._queue = [];
    this._headOffset = 0;
    this._available = 0;
    this._frac = 0;
    this._started = false;
    this._turnComplete = false;
    this._wasSpeaking = false;
    this._lastOut = 0;
    this._fadeSamples = 0;
    this._fadeStart = 0;
    this._fadeTotal = 64;

    this._meterSumSq = 0;
    this._meterCount = 0;
    this._meterInterval = Math.max(1024, Math.round(sampleRate * 0.045));

    this.port.onmessage = (ev) => {
      const msg = ev.data;
      if (!msg || typeof msg !== 'object') return;
      if (msg.type === 'pcm' && msg.buffer) {
        const samples = int16LEToFloat32(msg.buffer);
        if (samples.length) {
          this._queue.push(samples);
          this._available += samples.length;
          this._turnComplete = false;
        }
      } else if (msg.type === 'clear') {
        // Instant barge-in flush with ~1.5ms click-free fade-out.
        this._queue = [];
        this._headOffset = 0;
        this._available = 0;
        this._frac = 0;
        this._started = false;
        this._turnComplete = false;
        if (Math.abs(this._lastOut) > 1e-4) {
          this._fadeStart = this._lastOut;
          this._fadeSamples = this._fadeTotal;
        } else {
          this._lastOut = 0;
          this._fadeSamples = 0;
        }
        if (this._wasSpeaking) {
          this._wasSpeaking = false;
          this.port.postMessage({ type: 'level', rms: 0, speaking: false, bufferedMs: 0 });
        }
      } else if (msg.type === 'turn_complete') {
        this._turnComplete = true;
        if (this._available === 0 && !this._wasSpeaking) {
          this.port.postMessage({ type: 'drained' });
        }
      } else if (msg.type === 'config') {
        if (msg.sourceSampleRate) {
          this._srcRate = Number(msg.sourceSampleRate) || 24000;
          this._ratio = this._srcRate / sampleRate;
          this._prebufferSamples = Math.max(240, Math.round(this._srcRate * 0.04));
        }
      } else if (msg.type === 'volume') {
        this._volume = Math.max(0, Math.min(1.5, Number(msg.value) || 0));
      } else if (msg.type === 'stop') {
        this._stopped = true;
      }
    };
  }

  _peek(offset) {
    let idx = this._headOffset + offset;
    for (let q = 0; q < this._queue.length; q++) {
      const chunk = this._queue[q];
      if (idx < chunk.length) return chunk[idx];
      idx -= chunk.length;
    }
    return 0;
  }

  _consume(n) {
    let rem = n;
    while (rem > 0 && this._queue.length) {
      const chunk = this._queue[0];
      const left = chunk.length - this._headOffset;
      if (rem < left) {
        this._headOffset += rem;
        this._available -= rem;
        return;
      }
      rem -= left;
      this._available -= left;
      this._queue.shift();
      this._headOffset = 0;
    }
  }

  process(_inputs, outputs) {
    if (this._stopped) return false;
    const out = outputs[0];
    if (!out || !out.length) return true;
    const ch0 = out[0];
    const frames = ch0.length;

    if (!this._started) {
      if (this._available >= this._prebufferSamples || (this._turnComplete && this._available > 0)) {
        this._started = true;
        this._wasSpeaking = true;
      }
    }

    const vol = this._volume;
    const ratio = this._ratio;

    for (let i = 0; i < frames; i++) {
      let val = 0;
      if (this._fadeSamples > 0) {
        val = this._fadeStart * (this._fadeSamples / this._fadeTotal);
        this._fadeSamples--;
        this._lastOut = val;
      } else if (this._started && this._available > 0) {
        const s0 = this._peek(0);
        const s1 = this._available > 1 ? this._peek(1) : s0;
        val = (s0 + (s1 - s0) * this._frac) * vol;
        this._lastOut = val;

        this._frac += ratio;
        const step = Math.floor(this._frac);
        if (step > 0) {
          this._consume(step);
          this._frac -= step;
        }
        if (this._available <= 0) {
          this._started = false;
          this._frac = 0;
          if (Math.abs(this._lastOut) > 1e-4) {
            this._fadeStart = this._lastOut;
            this._fadeSamples = this._fadeTotal;
          }
        }
      } else {
        this._lastOut = 0;
      }

      ch0[i] = val;
      this._meterSumSq += val * val;
      this._meterCount++;
    }

    for (let c = 1; c < out.length; c++) {
      out[c].set(ch0);
    }

    if (this._wasSpeaking && this._available === 0 && !this._started && this._fadeSamples === 0) {
      this._wasSpeaking = false;
      this.port.postMessage({ type: 'level', rms: 0, speaking: false, bufferedMs: 0 });
      this.port.postMessage({ type: 'drained' });
      this._meterSumSq = 0;
      this._meterCount = 0;
      return true;
    }

    if (this._meterCount >= this._meterInterval) {
      const rms = Math.sqrt(this._meterSumSq / this._meterCount);
      const bufferedMs = Math.round((this._available / this._srcRate) * 1000);
      this.port.postMessage({ type: 'level', rms, speaking: this._wasSpeaking, bufferedMs });
      this._meterSumSq = 0;
      this._meterCount = 0;
    }

    return true;
  }
}

registerProcessor('voice-capture-processor', VoiceCaptureProcessor);
registerProcessor('voice-playback-processor', VoicePlaybackProcessor);
