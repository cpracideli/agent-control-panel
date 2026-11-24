// Mutual exclusion lock for active voice calls so LiveVoiceCallModal ("Voz com Bot")
// and WaCalls (WhatsApp voice calls) never fight over the microphone / iOS audioSession.

let activeLock = null; // { owner: 'bot-voice' | 'wacalls', onForceRelease?: () => void }
const listeners = new Set();

function emit() {
  const owner = activeLock?.owner || null;
  listeners.forEach((fn) => {
    try { fn(owner); } catch {}
  });
}

export function getActiveVoiceOwner() {
  return activeLock?.owner || null;
}

export function acquireVoiceMic(owner, { onForceRelease, preempt = false } = {}) {
  if (!owner) return false;
  if (activeLock && activeLock.owner !== owner) {
    if (!preempt) return false;
    const prev = activeLock;
    activeLock = null;
    try { prev.onForceRelease?.(); } catch {}
  }
  activeLock = { owner, onForceRelease };
  emit();
  return true;
}

export function releaseVoiceMic(owner) {
  if (!activeLock || (owner && activeLock.owner !== owner)) return;
  activeLock = null;
  emit();
}

export function subscribeVoiceLock(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
