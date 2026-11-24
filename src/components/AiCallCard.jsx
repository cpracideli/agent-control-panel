import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Bot, ChevronDown, History, PhoneCall, PhoneOff, RefreshCw, Sparkles } from 'lucide-react';
import { bridge } from '../api.js';
import { useI18n } from '../i18n.jsx';
import { formatDuration, formatPeer, normalizeDialPhone } from '../lib/wacalls.jsx';
import { Badge, Btn, Card, ErrorBox, Field, Skeleton, haptic, useConfirm, useFmt, useMore, useToast } from '../ui.jsx';

export const OWNER_PHONE = '5511984691018';
const VOICES = ['Kore', 'Puck', 'Charon', 'Fenrir', 'Aoede', 'Leda', 'Orus', 'Zephyr'];
const LIVE = new Set(['starting', 'ringing', 'active']);
const POLL_LIVE_MS = 2000;
const POLL_IDLE_MS = 30000;

export const isLiveAiCall = (c) => Boolean(c && LIVE.has(c.status) && !c.endedAt);

function statusBadge(c, t) {
  switch (c.status) {
    case 'starting': return { kind: 'warn', label: t('aiCall.st.starting') };
    case 'ringing': return { kind: 'warn', label: t('aiCall.st.ringing') };
    case 'active': return { kind: 'ok', label: t('aiCall.st.active') };
    case 'completed': return { kind: 'ok', label: t('aiCall.st.completed') };
    case 'no_answer': return { kind: 'muted', label: t('aiCall.st.no_answer') };
    case 'cancelled': return { kind: 'muted', label: t('aiCall.st.cancelled') };
    case 'error': return { kind: 'err', label: t('aiCall.st.error') };
    default: return { kind: 'muted', label: c.status || '—' };
  }
}

function reasonLabel(reason, t) {
  const r = String(reason || '');
  if (!r) return '';
  const k = 'aiCall.reason.' + r;
  const s = t(k);
  return s === k ? r : s;
}

function elapsedSec(c, now) {
  if (c.durationSec) return c.durationSec;
  if (!c.connectedAt) return 0;
  const end = c.endedAt ? new Date(c.endedAt).getTime() : now;
  return Math.max(0, Math.round((end - new Date(c.connectedAt).getTime()) / 1000));
}

export default function AiCallCard() {
  const { t } = useI18n();
  const fmt = useFmt();
  const toast = useToast();
  const confirm = useConfirm();

  const [to, setTo] = useState(OWNER_PHONE);
  const [purpose, setPurpose] = useState('');
  const [botId, setBotId] = useState('default');
  const [voice, setVoice] = useState('');
  const [maxMinutes, setMaxMinutes] = useState('');
  const [showAdv, setShowAdv] = useState(false);
  const [bots, setBots] = useState([]);
  const [calls, setCalls] = useState(null);
  const [loadError, setLoadError] = useState('');
  const [formError, setFormError] = useState('');
  const [sending, setSending] = useState(false);
  const [ending, setEnding] = useState('');
  const [openId, setOpenId] = useState('');
  const [now, setNow] = useState(() => Date.now());
  const alive = useRef(true);

  useEffect(() => () => { alive.current = false; }, []);

  useEffect(() => {
    bridge.bots()
      .then((list) => { if (alive.current && Array.isArray(list)) setBots(list); })
      .catch(() => {});
  }, []);

  const reload = useCallback(async () => {
    try {
      const r = await bridge.aiCalls();
      if (!alive.current) return;
      setCalls(Array.isArray(r?.calls) ? r.calls : []);
      setLoadError('');
    } catch (e) {
      if (alive.current) setLoadError(e?.message || 'Erro');
    }
  }, []);

  const live = useMemo(() => (calls || []).find(isLiveAiCall) || null, [calls]);

  // Poll quickly while a call is live, slowly otherwise; pause while the tab is hidden.
  useEffect(() => {
    reload();
    const ms = live ? POLL_LIVE_MS : POLL_IDLE_MS;
    const id = setInterval(() => { if (!document.hidden) reload(); }, ms);
    return () => clearInterval(id);
  }, [reload, Boolean(live)]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!live?.connectedAt) return undefined;
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [live?.connectedAt]);

  const phone = normalizeDialPhone(to, true);
  const isOwner = phone === OWNER_PHONE;
  const canCall = Boolean(phone.length >= 10 && purpose.trim() && !sending && !live);

  const start = async (e) => {
    e?.preventDefault();
    if (!canCall) return;
    setFormError('');
    if (!isOwner) {
      const ok = await confirm(t('aiCall.thirdPartyConfirm', { p: formatPeer(phone) }));
      if (!ok) return;
    }
    haptic(10);
    setSending(true);
    try {
      const body = { to: phone, purpose: purpose.trim(), bot: botId || 'default' };
      if (voice) body.voice = voice;
      const mm = Number(maxMinutes);
      if (mm > 0) body.maxMinutes = Math.min(60, mm);
      const rec = await bridge.aiCallStart(body);
      toast(t('aiCall.started'));
      if (rec?.id) setCalls((prev) => [rec, ...(prev || []).filter((c) => c.id !== rec.id)]);
      reload();
    } catch (err) {
      const msg = err?.status === 403 ? t('aiCall.blocked', { m: err.message }) : err?.message || 'Erro';
      setFormError(msg);
      reload();
    } finally {
      setSending(false);
    }
  };

  const hangup = async (c) => {
    haptic(10);
    setEnding(c.id);
    try {
      const rec = await bridge.aiCallEnd(c.id);
      if (rec?.id) setCalls((prev) => (prev || []).map((x) => (x.id === rec.id ? rec : x)));
      toast(t('aiCall.ended'));
    } catch (err) {
      toast(err?.message || 'Erro', 'err');
    } finally {
      setEnding('');
      reload();
    }
  };

  const history = useMemo(() => (calls || []).filter((c) => !isLiveAiCall(c)), [calls]);
  const [shown, moreBtn] = useMore(history, 6);
  const botName = (id) => {
    const b = bots.find((x) => x.id === id);
    return b ? `${b.emoji || ''} ${b.name}`.trim() : id;
  };

  return (
    <>
      <Card title={t('aiCall.title')} icon={Sparkles} className="aic-card">
        <p className="muted small aic-sub">{t('aiCall.sub')}</p>

        {live && (
          <div className={'aic-live ' + live.status} role="status" aria-live="polite">
            <span className={'wac-dot' + (live.status === 'active' ? ' pulse' : '')} />
            <div className="aic-live-main">
              <b className="ellipsis">{formatPeer(live.to)}{live.isOwner ? ' · ' + t('aiCall.you') : ''}</b>
              <div className="meta-line muted small">
                <span>{statusBadge(live, t).label}</span>
                {live.connectedAt && <span className="tnum">{formatDuration(elapsedSec(live, now) * 1000)}</span>}
                <span>{botName(live.bot)}</span>
                {live.voice && <span>{live.voice}</span>}
              </div>
              <span className="small ellipsis aic-live-purpose">{live.purpose}</span>
            </div>
            <Btn icon={PhoneOff} className="small danger aic-end" disabled={ending === live.id} onClick={() => hangup(live)}>
              {t('aiCall.end')}
            </Btn>
          </div>
        )}

        <form className="stack aic-form" onSubmit={start}>
          <div className="aic-row">
            <Field label={t('aiCall.to')} hint={phone ? '→ ' + formatPeer(phone) + (isOwner ? ' · ' + t('aiCall.you') : '') : ''}>
              <input
                type="tel"
                inputMode="tel"
                autoComplete="tel"
                value={to}
                onChange={(e) => { setTo(e.target.value); setFormError(''); }}
                placeholder="5511999998888"
              />
            </Field>
            <Field label={t('aiCall.bot')}>
              <select value={botId} onChange={(e) => setBotId(e.target.value)}>
                {!bots.some((b) => b.id === 'default') && <option value="default">🤖 default</option>}
                {bots.map((b) => (
                  <option key={b.id} value={b.id}>{`${b.emoji || ''} ${b.name}`.trim()}</option>
                ))}
              </select>
            </Field>
          </div>
          {!isOwner && phone && <small className="aic-warn">{t('aiCall.thirdPartyHint')}</small>}

          <Field label={t('aiCall.purpose')}>
            <textarea
              rows={3}
              value={purpose}
              maxLength={4000}
              onChange={(e) => { setPurpose(e.target.value); setFormError(''); }}
              placeholder={t('aiCall.purposePh')}
            />
          </Field>

          <button
            type="button"
            className={'ghost small aic-adv-toggle' + (showAdv ? ' on' : '')}
            aria-expanded={showAdv}
            onClick={() => setShowAdv((v) => !v)}
          >
            <ChevronDown size={14} className="aic-chev" />
            <span>{t('aiCall.advanced')}</span>
          </button>
          {showAdv && (
            <div className="aic-row">
              <Field label={t('aiCall.voice')}>
                <select value={voice} onChange={(e) => setVoice(e.target.value)}>
                  <option value="">{t('aiCall.voiceDefault')}</option>
                  {VOICES.map((v) => <option key={v} value={v}>{v}</option>)}
                </select>
              </Field>
              <Field label={t('aiCall.maxMinutes')}>
                <input
                  type="number"
                  inputMode="decimal"
                  min="1"
                  max="60"
                  step="1"
                  value={maxMinutes}
                  onChange={(e) => setMaxMinutes(e.target.value)}
                  placeholder="10"
                />
              </Field>
            </div>
          )}

          <div className="aic-actions">
            <button type="submit" className="wac-call-cta aic-cta press" disabled={!canCall}>
              {sending ? <span className="spin" /> : <PhoneCall size={19} />}
              <span>{isOwner ? t('aiCall.callMe') : t('aiCall.call')}</span>
            </button>
          </div>
          {live && <small className="muted aic-hint">{t('aiCall.oneAtATime')}</small>}
          {formError && <ErrorBox error={formError} />}
        </form>
      </Card>

      <Card
        title={t('aiCall.historyTitle')}
        icon={History}
        actions={<Btn icon={RefreshCw} className="ghost small" onClick={reload}>{t('calls.refresh')}</Btn>}
      >
        {loadError && <ErrorBox error={loadError} onRetry={reload} />}
        {calls === null && !loadError ? (
          <Skeleton rows={3} lines={2} avatar={false} />
        ) : !history.length ? (
          <p className="muted small" style={{ margin: 0 }}>{t('aiCall.historyEmpty')}</p>
        ) : (
          <div className="wac-hist-list">
            {shown.map((c) => {
              const st = statusBadge(c, t);
              const dur = elapsedSec(c, now);
              const reason = c.error || reasonLabel(c.endReason, t);
              const inbound = /^O Caio ligou/.test(c.purpose || '');
              const open = openId === c.id;
              return (
                <div key={c.id} className="aic-hist-item">
                  <button
                    type="button"
                    className="wac-hist-row aic-hist-row"
                    aria-expanded={open}
                    onClick={() => setOpenId(open ? '' : c.id)}
                  >
                    <span className={'wac-dir-ic ' + (c.status === 'error' || c.status === 'no_answer' ? 'missed' : 'out')}><Bot size={16} /></span>
                    <div className="wac-hist-main">
                      <div className="row" style={{ gap: 6, minWidth: 0 }}>
                        <b className="ellipsis">{formatPeer(c.to)}</b>
                        <Badge kind={st.kind}>{st.label}</Badge>
                      </div>
                      <span className="small ellipsis aic-hist-purpose">{inbound ? t('aiCall.inbound') : c.purpose}</span>
                      <div className="meta-line muted small">
                        {c.startedAt && <span>{fmt.date(c.startedAt)}</span>}
                        {dur > 0 && <span className="tnum">{formatDuration(dur * 1000)}</span>}
                        <span>{botName(c.bot)}</span>
                        {reason && <span className={c.status === 'error' ? 'danger-text' : ''}>{reason}</span>}
                      </div>
                    </div>
                    <ChevronDown size={16} className={'aic-chev muted' + (open ? ' open' : '')} />
                  </button>
                  {open && (
                    <div className="aic-detail small">
                      <p className="aic-detail-purpose">{c.purpose}</p>
                      {c.error && <p className="danger-text">{c.error}</p>}
                      {Array.isArray(c.transcript) && c.transcript.length > 0 ? (
                        <div className="aic-transcript">
                          {c.transcript.map((x, i) => (
                            <div key={i} className={'voice-turn ' + x.role}>
                              <b>{x.role === 'assistant' ? t('aiCall.ai') : t('aiCall.person')}:</b> {x.text}
                            </div>
                          ))}
                        </div>
                      ) : (
                        <p className="muted">{t('aiCall.noTranscript')}</p>
                      )}
                      <div className="row wrap" style={{ gap: 6 }}>
                        <Btn
                          icon={PhoneCall}
                          className="ghost small"
                          disabled={Boolean(live)}
                          onClick={() => { setTo(c.to); if (!inbound) setPurpose(c.purpose); setBotId(c.bot || 'default'); document.querySelector('.aic-card')?.scrollIntoView({ behavior: 'smooth', block: 'start' }); }}
                        >
                          {t('aiCall.reuse')}
                        </Btn>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
            {moreBtn}
          </div>
        )}
      </Card>
    </>
  );
}
