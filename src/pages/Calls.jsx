import { useCallback, useEffect, useMemo, useState } from 'react';
import QRCode from 'qrcode';
import {
  Delete,
  Grid3x3,
  History,
  LogOut,
  Phone,
  PhoneCall,
  PhoneIncoming,
  PhoneMissed,
  PhoneOutgoing,
  Play,
  Plus,
  QrCode,
  RefreshCw,
  Smartphone,
  Square,
  Trash2,
  Wifi,
  WifiOff,
  X,
} from 'lucide-react';
import { useI18n } from '../i18n.jsx';
import { formatDuration, formatPeer, normalizeDialPhone, useWaCalls } from '../lib/wacalls.jsx';
import { Badge, Btn, Card, ErrorBox, Skeleton, haptic, useAction, useConfirm, useFmt, useToast } from '../ui.jsx';

const KEYPAD = [
  { key: '1', sub: '' },
  { key: '2', sub: 'ABC' },
  { key: '3', sub: 'DEF' },
  { key: '4', sub: 'GHI' },
  { key: '5', sub: 'JKL' },
  { key: '6', sub: 'MNO' },
  { key: '7', sub: 'PQRS' },
  { key: '8', sub: 'TUV' },
  { key: '9', sub: 'WXYZ' },
  { key: '+', sub: '' },
  { key: '0', sub: '+' },
  { key: '⌫', sub: '' },
];

function QrCodeBox({ value }) {
  const { t } = useI18n();
  const [dataUrl, setDataUrl] = useState('');
  const [err, setErr] = useState('');

  useEffect(() => {
    let alive = true;
    if (!value) { setDataUrl(''); setErr(''); return undefined; }
    QRCode.toDataURL(value, {
      width: 280,
      margin: 2,
      errorCorrectionLevel: 'M',
      color: { dark: '#000000', light: '#ffffff' },
    })
      .then((url) => { if (alive) { setDataUrl(url); setErr(''); } })
      .catch((e) => { if (alive) setErr(e?.message || 'Erro ao gerar QR Code'); });
    return () => { alive = false; };
  }, [value]);

  if (!value) return null;
  return (
    <div className="wac-qr-panel">
      <div className="wac-qr-frame">
        {dataUrl
          ? <img src={dataUrl} alt="QR Code WhatsApp" width={232} height={232} />
          : <div className="wac-qr-loading"><span className="spin" /></div>}
      </div>
      {err && <small className="danger-text">{err}</small>}
      <p className="muted small wac-qr-hint">{t('calls.qrHint')}</p>
    </div>
  );
}

function sessionBadge(session, t) {
  if (session.paired && session.state === 'connected') return { kind: 'ok', label: t('calls.sess.connected') };
  if (session.paired) return { kind: 'warn', label: session.state || t('calls.sess.connecting') };
  if (session.state === 'qr') return { kind: 'accent', label: t('calls.sess.qr') };
  return { kind: 'muted', label: session.state || t('calls.sess.disconnected') };
}

function endReasonLabel(reason, t) {
  const r = String(reason || '').toLowerCase();
  if (!r) return '';
  if (r.includes('declined') || r.includes('reject')) return t('calls.reason.declined');
  if (r.includes('user_ended') || r.includes('local') || r.includes('hangup')) return t('calls.reason.ended');
  if (r.includes('timeout') || r.includes('no_answer') || r.includes('missed')) return t('calls.reason.missed');
  if (r.includes('busy')) return t('calls.reason.busy');
  if (r.includes('remote') || r.includes('terminate')) return t('calls.reason.remote');
  return reason;
}

export default function Calls() {
  const { t } = useI18n();
  const fmt = useFmt();
  const toast = useToast();
  const [confirm, confirmEl] = useConfirm();
  const [busy, run] = useAction();
  const wa = useWaCalls();

  const [phoneInput, setPhoneInput] = useState('');
  const [defaultDdi55, setDefaultDdi55] = useState(true);
  const [showKeypad, setShowKeypad] = useState(true);
  const [newSessionName, setNewSessionName] = useState('');
  const [showNewSession, setShowNewSession] = useState(false);
  const [history, setHistory] = useState([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState('');

  const {
    serviceStatus,
    sseConnected,
    sessions,
    selectedSessionId,
    setSelectedSessionId,
    qrs,
    activeCall,
    setCallMinimized,
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
    loadHistory,
  } = wa;

  const selectedSession = useMemo(
    () => sessions.find((s) => s.id === selectedSessionId) || sessions[0] || null,
    [sessions, selectedSessionId],
  );
  const pairedSessions = useMemo(() => sessions.filter((s) => s.paired), [sessions]);
  const dialSession = useMemo(() => {
    if (selectedSession?.paired) return selectedSession;
    return pairedSessions[0] || null;
  }, [selectedSession, pairedSessions]);

  const normalizedPhone = useMemo(
    () => normalizeDialPhone(phoneInput, defaultDdi55),
    [phoneInput, defaultDdi55],
  );

  const reloadHistory = useCallback(async (sid = selectedSession?.id) => {
    if (!sid || !serviceStatus.running) {
      setHistory([]);
      return;
    }
    setHistoryLoading(true);
    setHistoryError('');
    try {
      const rows = await loadHistory(sid);
      setHistory(rows);
    } catch (e) {
      setHistoryError(e?.message || 'Erro ao carregar histórico');
    } finally {
      setHistoryLoading(false);
    }
  }, [selectedSession?.id, serviceStatus.running, loadHistory]);

  useEffect(() => {
    reloadHistory(selectedSession?.id);
  }, [selectedSession?.id, historyVersion, serviceStatus.running, reloadHistory]);

  const handleDial = async (overridePhone) => {
    const raw = overridePhone !== undefined ? overridePhone : phoneInput;
    const phone = normalizeDialPhone(raw, defaultDdi55);
    if (!phone) {
      toast(t('calls.needPhone'), 'err');
      return;
    }
    if (!dialSession) {
      toast(t('calls.needPairedSession'), 'err');
      return;
    }
    haptic(10);
    await run('dial', () => startCall(dialSession.id, phone));
  };

  const handleKeyTap = (k) => {
    haptic(5);
    setLastCallError('');
    if (k === '⌫') {
      setPhoneInput((prev) => prev.slice(0, -1));
    } else if (k === '+') {
      setPhoneInput((prev) => (prev.startsWith('+') ? prev : '+' + prev));
    } else {
      setPhoneInput((prev) => (prev.length < 24 ? prev + k : prev));
    }
  };

  const handleCreateSession = async (e) => {
    e?.preventDefault();
    const name = newSessionName.trim() || `WhatsApp ${sessions.length + 1}`;
    const res = await run('create-session', () => createSession(name), t('calls.sessionCreated'));
    if (res) {
      setNewSessionName('');
      setShowNewSession(false);
    }
  };

  const handleDeleteSession = async (s) => {
    const ok = await confirm(t('calls.deleteSessionConfirm', { n: s.name || s.id }));
    if (!ok) return;
    await run('del-' + s.id, () => deleteSession(s.id), t('calls.sessionDeleted'));
  };

  const handleLogoutSession = async (s) => {
    const ok = await confirm(t('calls.logoutSessionConfirm', { n: s.name || s.id }));
    if (!ok) return;
    await run('logout-' + s.id, () => logoutSession(s.id), t('calls.sessionLoggedOut'));
  };

  const handleRefreshAll = async () => {
    await run('refresh', async () => {
      const st = await refreshStatus();
      if (st?.running) {
        await refreshSessions();
        await reloadHistory();
      }
    });
  };

  const canDial = Boolean(serviceStatus.running && dialSession && normalizedPhone.length >= 8 && !activeCall);

  return (
    <div className="page wac-page">
      {confirmEl}

      <Card
        title={t('calls.serviceTitle')}
        icon={PhoneCall}
        actions={
          <>
            <Badge kind={serviceStatus.running ? 'ok' : serviceStatus.available === false ? 'err' : 'muted'}>
              {serviceStatus.loading
                ? t('common.loading')
                : serviceStatus.running
                  ? t('calls.serviceRunning')
                  : serviceStatus.available === false
                    ? t('calls.serviceUnavailable')
                    : t('calls.serviceStopped')}
            </Badge>
            {serviceStatus.running && (
              <Badge kind={sseConnected ? 'ok' : 'warn'}>
                {sseConnected ? <Wifi size={11} /> : <WifiOff size={11} />}
                {sseConnected ? 'SSE' : 'Offline'}
              </Badge>
            )}
            <Btn icon={RefreshCw} className="ghost small" busy={busy === 'refresh'} onClick={handleRefreshAll}>
              {t('calls.refresh')}
            </Btn>
            {serviceStatus.running ? (
              <Btn icon={Square} className="ghost small" busy={busy === 'svc-stop'} onClick={() => run('svc-stop', stopService, t('calls.serviceStoppedToast'))}>
                {t('common.stop')}
              </Btn>
            ) : (
              <Btn icon={Play} className="small" busy={busy === 'svc-start'} disabled={serviceStatus.available === false} onClick={() => run('svc-start', startService, t('calls.serviceStartedToast'))}>
                {t('calls.startService')}
              </Btn>
            )}
          </>
        }
      >
        <div className="meta-line muted small">
          <span>{t('calls.serviceSub')}</span>
          {serviceStatus.port && <span>:{serviceStatus.port}</span>}
          {serviceStatus.running && <span>{t('calls.sessionsCount', { n: sessions.length })}</span>}
        </div>
        {serviceStatus.error && <ErrorBox error={serviceStatus.error} onRetry={handleRefreshAll} />}
        {activeCall && (
          <div className="wac-active-banner">
            <span className="wac-dot pulse" />
            <span className="grow">
              <b>{t('calls.inCallWith', { p: formatPeer(activeCall.peer) })}</b>
            </span>
            <Btn icon={Phone} className="small" onClick={() => setCallMinimized(false)}>
              {t('calls.openCall')}
            </Btn>
          </div>
        )}
      </Card>

      {serviceStatus.loading ? (
        <Card><Skeleton rows={3} /></Card>
      ) : !serviceStatus.running ? (
        <Card>
          <div className="wac-empty-hero">
            <span className="wac-hero-ic"><PhoneCall size={30} /></span>
            <h3>{t('calls.heroTitle')}</h3>
            <p className="muted">{t('calls.heroDesc')}</p>
            <Btn
              icon={Play}
              busy={busy === 'svc-start'}
              disabled={serviceStatus.available === false}
              onClick={() => run('svc-start', startService, t('calls.serviceStartedToast'))}
            >
              {t('calls.startService')}
            </Btn>
          </div>
        </Card>
      ) : (
        <>
          <div className="wac-grid">
            {/* Dialer Card */}
            <Card
              title={t('calls.dialerTitle')}
              icon={Phone}
              actions={
                <Btn
                  icon={Grid3x3}
                  className={'ghost small' + (showKeypad ? ' on' : '')}
                  onClick={() => setShowKeypad((v) => !v)}
                >
                  {t('calls.keypad')}
                </Btn>
              }
            >
              <div className="stack">
                {pairedSessions.length > 1 && (
                  <label className="wac-session-pick">
                    <span className="muted small">{t('calls.callFrom')}</span>
                    <select
                      value={dialSession?.id || ''}
                      onChange={(e) => setSelectedSessionId(e.target.value)}
                    >
                      {pairedSessions.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.name} {s.jid ? `(${formatPeer(s.jid)})` : ''}
                        </option>
                      ))}
                    </select>
                  </label>
                )}

                <form
                  className="wac-dial-input-wrap"
                  onSubmit={(e) => { e.preventDefault(); if (canDial) handleDial(); }}
                >
                  <input
                    type="tel"
                    inputMode="tel"
                    className="wac-dial-input"
                    value={phoneInput}
                    onChange={(e) => { setPhoneInput(e.target.value); setLastCallError(''); }}
                    placeholder={defaultDdi55 ? '11 99999-8888 ou +55…' : '+55 11 99999-8888'}
                    aria-label={t('calls.phonePlaceholder')}
                  />
                  {phoneInput && (
                    <button
                      type="button"
                      className="ghost icon small wac-clear-btn"
                      onClick={() => { setPhoneInput(''); setLastCallError(''); }}
                      aria-label={t('common.close')}
                    >
                      <X size={16} />
                    </button>
                  )}
                </form>

                <div className="row between wrap" style={{ gap: 8 }}>
                  <label className="row small muted" style={{ gap: 6, cursor: 'pointer' }}>
                    <input
                      type="checkbox"
                      checked={defaultDdi55}
                      onChange={(e) => setDefaultDdi55(e.target.checked)}
                    />
                    <span>{t('calls.defaultDdi55')}</span>
                  </label>
                  {normalizedPhone && (
                    <span className="small muted wac-dial-preview">
                      → {formatPeer(normalizedPhone)}
                    </span>
                  )}
                </div>

                {showKeypad && (
                  <div className="wac-keypad" role="group" aria-label={t('calls.keypad')}>
                    {KEYPAD.map(({ key, sub }) => (
                      <button
                        key={key}
                        type="button"
                        className="wac-key press"
                        onClick={() => handleKeyTap(key)}
                        aria-label={key === '⌫' ? t('calls.backspace') : key}
                      >
                        <span className="wac-key-main">
                          {key === '⌫' ? <Delete size={18} /> : key}
                        </span>
                        {sub && <span className="wac-key-sub">{sub}</span>}
                      </button>
                    ))}
                  </div>
                )}

                <button
                  type="button"
                  className="wac-call-cta press"
                  disabled={!canDial || busy === 'dial'}
                  onClick={() => handleDial()}
                >
                  {busy === 'dial' ? <span className="spin" /> : <Phone size={20} />}
                  <span>{t('calls.callBtn')}</span>
                </button>

                {!dialSession && (
                  <p className="muted small" style={{ textAlign: 'center', margin: 0 }}>
                    {t('calls.pairToCallHint')}
                  </p>
                )}

                {lastCallError && <ErrorBox error={lastCallError} />}
              </div>
            </Card>

            {/* WhatsApp Sessions Card */}
            <Card
              title={t('calls.sessionsTitle')}
              icon={Smartphone}
              actions={
                <Btn icon={Plus} className="ghost small" onClick={() => setShowNewSession((v) => !v)}>
                  {t('calls.newSession')}
                </Btn>
              }
            >
              <div className="stack">
                {(showNewSession || sessions.length === 0) && (
                  <form className="wac-new-sess" onSubmit={handleCreateSession}>
                    <input
                      type="text"
                      value={newSessionName}
                      onChange={(e) => setNewSessionName(e.target.value)}
                      placeholder={t('calls.sessionNamePh')}
                      aria-label={t('calls.sessionNamePh')}
                    />
                    <Btn type="submit" icon={Plus} className="small" busy={busy === 'create-session'}>
                      {t('calls.createSession')}
                    </Btn>
                  </form>
                )}

                {sessions.length === 0 ? (
                  <p className="muted small" style={{ margin: '4px 0 0' }}>{t('calls.noSessions')}</p>
                ) : (
                  <div className="wac-sess-list">
                    {sessions.map((s) => {
                      const st = sessionBadge(s, t);
                      const isSel = selectedSession?.id === s.id;
                      const qr = qrs[s.id];
                      return (
                        <div
                          key={s.id}
                          className={'wac-sess-item' + (isSel ? ' selected' : '')}
                          onClick={() => setSelectedSessionId(s.id)}
                        >
                          <div className="wac-sess-head">
                            <div className="wac-sess-info">
                              <div className="row wrap" style={{ gap: 6 }}>
                                <b>{s.name || s.id}</b>
                                <Badge kind={st.kind}>{st.label}</Badge>
                              </div>
                              <div className="meta-line muted small">
                                <span>{s.jid ? formatPeer(s.jid) : t('calls.notPaired')}</span>
                                <span>#{s.id.slice(0, 8)}</span>
                              </div>
                            </div>
                            <div className="row wrap" style={{ gap: 6 }} onClick={(e) => e.stopPropagation()}>
                              {!s.paired && (
                                <Btn
                                  icon={QrCode}
                                  className="small"
                                  busy={busy === 'pair-' + s.id}
                                  onClick={() => run('pair-' + s.id, () => pairSession(s.id), t('calls.qrRequested'))}
                                >
                                  {t('calls.pairQr')}
                                </Btn>
                              )}
                              {s.paired && (
                                <Btn
                                  icon={LogOut}
                                  className="ghost small"
                                  busy={busy === 'logout-' + s.id}
                                  onClick={() => handleLogoutSession(s)}
                                >
                                  {t('calls.disconnect')}
                                </Btn>
                              )}
                              <Btn
                                icon={Trash2}
                                className="ghost small danger-text"
                                busy={busy === 'del-' + s.id}
                                onClick={() => handleDeleteSession(s)}
                                aria-label={t('common.delete')}
                              />
                            </div>
                          </div>

                          {!s.paired && qr && <QrCodeBox value={qr} />}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </Card>
          </div>

          {/* Recent Call History Card */}
          <Card
            title={t('calls.historyTitle')}
            icon={History}
            actions={
              <Btn
                icon={RefreshCw}
                className="ghost small"
                busy={historyLoading}
                onClick={() => reloadHistory(selectedSession?.id)}
              >
                {t('calls.refresh')}
              </Btn>
            }
          >
            {historyError && <ErrorBox error={historyError} onRetry={() => reloadHistory(selectedSession?.id)} />}
            {historyLoading && !history.length ? (
              <Skeleton rows={3} lines={2} avatar={false} />
            ) : !history.length ? (
              <p className="muted small" style={{ margin: 0 }}>{t('calls.historyEmpty')}</p>
            ) : (
              <div className="wac-hist-list">
                {history.map((row) => {
                  const isIn = row.direction === 'inbound';
                  const reasonStr = String(row.endReason || '').toLowerCase();
                  const missed = isIn && (reasonStr.includes('declined') || reasonStr.includes('missed') || reasonStr.includes('timeout'));
                  const DirIcon = missed ? PhoneMissed : isIn ? PhoneIncoming : PhoneOutgoing;
                  const dirCls = missed ? 'missed' : isIn ? 'in' : 'out';
                  const durMs = row.endedAt && row.startedAt ? Math.max(0, row.endedAt - row.startedAt) : 0;
                  const reasonTxt = endReasonLabel(row.endReason, t);
                  const peerDigits = String(row.peer || '').replace(/@.*$/, '').replace(/:\d+$/, '');

                  return (
                    <div key={row.callId + '-' + row.startedAt} className="wac-hist-row">
                      <span className={'wac-dir-ic ' + dirCls}><DirIcon size={16} /></span>
                      <div className="wac-hist-main">
                        <b className="ellipsis">{formatPeer(row.peer)}</b>
                        <div className="meta-line muted small">
                          <span>{isIn ? t('calls.dir.in') : t('calls.dir.out')}</span>
                          {row.startedAt && <span>{fmt.date(row.startedAt)}</span>}
                          {durMs > 0 && <span>{formatDuration(durMs)}</span>}
                          {reasonTxt && <span>{reasonTxt}</span>}
                        </div>
                      </div>
                      {dialSession && peerDigits && (
                        <Btn
                          icon={Phone}
                          className="ghost small"
                          disabled={Boolean(activeCall) || busy === 'dial'}
                          onClick={() => {
                            setPhoneInput('+' + peerDigits);
                            handleDial('+' + peerDigits);
                          }}
                          title={t('calls.callBack')}
                        >
                          {t('calls.callBack')}
                        </Btn>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </Card>
        </>
      )}
    </div>
  );
}
