// Global WaCalls overlays rendered at App root so incoming & active WhatsApp calls
// work seamlessly regardless of which tab the user is currently viewing.

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { AlertTriangle, Maximize2, Mic, MicOff, Minimize2, Phone, PhoneIncoming, PhoneOff, Volume2 } from 'lucide-react';
import { useI18n } from '../i18n.jsx';
import { formatDuration, formatPeer, useWaCalls } from '../lib/wacalls.jsx';
import { haptic } from '../ui.jsx';

function CallTimer({ since }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(id);
  }, []);
  return <span className="wac-timer">{formatDuration(now - (since || now))}</span>;
}

function VuBar({ value, label, tone = 'in' }) {
  const pct = Math.max(0, Math.min(100, Math.round((Number(value) || 0) * 100)));
  return (
    <div className="wac-vu-row">
      <span className="wac-vu-label">{label}</span>
      <div className="wac-vu-track" role="meter" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}>
        <div className={'wac-vu-fill ' + tone} style={{ transform: `scaleX(${pct / 100})` }} />
      </div>
    </div>
  );
}

export default function WaCallsGlobalOverlay() {
  const { t } = useI18n();
  const wa = useWaCalls();
  if (!wa) return null;

  const {
    sessions,
    incoming,
    activeCall,
    callMinimized,
    setCallMinimized,
    muted,
    levels,
    wsState,
    audioError,
    acceptIncoming,
    rejectIncoming,
    hangupCall,
    toggleMute,
  } = wa;

  const sessionNameOf = (sid) => sessions.find((s) => s.id === sid)?.name || '';

  const statusLabel = (st) => {
    if (st === 'connected') return t('calls.st.connected');
    if (st === 'ringing') return t('calls.st.ringing');
    if (st === 'starting') return t('calls.st.starting');
    return st || t('calls.st.starting');
  };

  const activeLevel = Math.max(levels.input || 0, levels.output || 0);
  const orbScale = 1 + Math.min(0.18, activeLevel * 0.22);
  const ringScale = 1 + Math.min(0.45, activeLevel * 0.6);

  return createPortal(
    <>
      {incoming && (
        <div className="wac-modal-bg" role="dialog" aria-modal="true" aria-label={t('calls.incomingTitle')}>
          <div className="wac-call-modal wac-incoming-modal">
            <div className="wac-call-orb-wrap">
              <div className="wac-call-ring incoming" aria-hidden />
              <div className="wac-call-orb incoming">
                <PhoneIncoming size={32} />
              </div>
            </div>
            <span className="wac-call-kicker">{t('calls.incomingTitle')}</span>
            <h2 className="wac-call-peer">{formatPeer(incoming.peer)}</h2>
            {sessionNameOf(incoming.sessionId) && (
              <span className="muted small">{sessionNameOf(incoming.sessionId)}</span>
            )}
            <div className="wac-incoming-actions">
              <button
                type="button"
                className="wac-round-btn decline press"
                onClick={() => { haptic(12); rejectIncoming(incoming); }}
                aria-label={t('calls.reject')}
              >
                <PhoneOff size={22} />
                <span>{t('calls.reject')}</span>
              </button>
              <button
                type="button"
                className="wac-round-btn accept press"
                onClick={() => { haptic(12); acceptIncoming(incoming); }}
                aria-label={t('calls.accept')}
              >
                <Phone size={22} />
                <span>{t('calls.accept')}</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {activeCall && !callMinimized && (
        <div className="wac-modal-bg" role="dialog" aria-modal="true" aria-label={t('calls.activeTitle')}>
          <div className="wac-call-modal">
            <div className="wac-modal-top">
              <span className={'wac-status-pill ' + (activeCall.status === 'connected' ? 'connected' : 'ringing')}>
                <span className={'wac-dot' + (activeCall.status !== 'connected' ? ' pulse' : '')} />
                {statusLabel(activeCall.status)}
              </span>
              <div className="row" style={{ gap: 6 }}>
                <CallTimer since={activeCall.connectedAt || activeCall.startedAt} />
                <button
                  type="button"
                  className="ghost icon small"
                  onClick={() => setCallMinimized(true)}
                  aria-label={t('calls.minimize')}
                  title={t('calls.minimize')}
                >
                  <Minimize2 size={16} />
                </button>
              </div>
            </div>

            <div className="wac-call-orb-wrap">
              <div
                className={'wac-call-ring ' + (activeCall.status === 'connected' ? 'connected' : 'ringing')}
                style={{ transform: `scale(${ringScale})`, opacity: Math.min(0.85, 0.2 + activeLevel * 0.8) }}
                aria-hidden
              />
              <div
                className={'wac-call-orb ' + (muted ? 'muted' : activeCall.status === 'connected' ? 'connected' : 'ringing')}
                style={{ transform: `scale(${orbScale})` }}
              >
                {muted ? <MicOff size={30} /> : <Phone size={30} />}
              </div>
            </div>

            <h2 className="wac-call-peer">{formatPeer(activeCall.peer)}</h2>
            <div className="meta-line muted small">
              <span>WhatsApp</span>
              {sessionNameOf(activeCall.sessionId) && <span>{sessionNameOf(activeCall.sessionId)}</span>}
              {wsState === 'reconnecting' && <span>{t('calls.audioReconnecting')}</span>}
            </div>

            <div className="wac-vu-box">
              <VuBar value={muted ? 0 : levels.input} label={muted ? t('calls.muted') : t('calls.micLevel')} tone="in" />
              <VuBar value={levels.output} label={t('calls.peerLevel')} tone="out" />
            </div>

            {audioError && (
              <div className="wac-inline-err" role="alert">
                <AlertTriangle size={14} />
                <span>{audioError}</span>
              </div>
            )}

            <div className="wac-active-actions">
              <button
                type="button"
                className={'wac-round-btn mute press' + (muted ? ' on' : '')}
                onClick={() => { haptic(8); toggleMute(); }}
                aria-pressed={muted}
                aria-label={muted ? t('calls.unmute') : t('calls.mute')}
              >
                {muted ? <MicOff size={22} /> : <Mic size={22} />}
                <span>{muted ? t('calls.unmute') : t('calls.mute')}</span>
              </button>
              <button
                type="button"
                className="wac-round-btn decline press"
                onClick={() => { haptic(14); hangupCall(); }}
                aria-label={t('calls.hangup')}
              >
                <PhoneOff size={22} />
                <span>{t('calls.hangup')}</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {activeCall && callMinimized && (
        <div className="wac-floating-bar" role="region" aria-label={t('calls.activeTitle')}>
          <button
            type="button"
            className="wac-bar-main"
            onClick={() => setCallMinimized(false)}
            title={t('calls.expand')}
          >
            <span className={'wac-dot' + (activeCall.status !== 'connected' ? ' pulse' : '')} />
            <span className="wac-bar-info">
              <b className="ellipsis">{formatPeer(activeCall.peer)}</b>
              <span className="meta-line muted">
                <span>{statusLabel(activeCall.status)}</span>
                <CallTimer since={activeCall.connectedAt || activeCall.startedAt} />
              </span>
            </span>
            <span className="wac-bar-meter" aria-hidden>
              <Volume2 size={13} />
              <span className="wac-bar-meter-track">
                <span style={{ transform: `scaleX(${Math.max(0.06, Math.min(1, activeLevel))})` }} />
              </span>
            </span>
          </button>
          <div className="wac-bar-actions">
            <button
              type="button"
              className={'wac-bar-btn press' + (muted ? ' on' : '')}
              onClick={() => { haptic(6); toggleMute(); }}
              aria-pressed={muted}
              aria-label={muted ? t('calls.unmute') : t('calls.mute')}
              title={muted ? t('calls.unmute') : t('calls.mute')}
            >
              {muted ? <MicOff size={16} /> : <Mic size={16} />}
            </button>
            <button
              type="button"
              className="wac-bar-btn press"
              onClick={() => setCallMinimized(false)}
              aria-label={t('calls.expand')}
              title={t('calls.expand')}
            >
              <Maximize2 size={15} />
            </button>
            <button
              type="button"
              className="wac-bar-btn danger press"
              onClick={() => { haptic(12); hangupCall(); }}
              aria-label={t('calls.hangup')}
              title={t('calls.hangup')}
            >
              <PhoneOff size={16} />
            </button>
          </div>
        </div>
      )}
    </>,
    document.body,
  );
}
