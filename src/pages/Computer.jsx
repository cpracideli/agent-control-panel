import { useEffect, useRef, useState } from 'react';
import { AlertTriangle, Camera, Check, ExternalLink, Eye, Globe, GraduationCap, Hand, Maximize2, Monitor, Play, Power, RefreshCw, SkipForward } from 'lucide-react';
import { bridge } from '../api.js';
import { useT } from '../i18n.jsx';
import { Badge, Btn, Card, ErrorBox, Field, Modal, useAction, useLoad, useToast } from '../ui.jsx';

function TeachModal({ currentUrl, onClose }) {
  const t = useT();
  const toast = useToast();
  const [name, setName] = useState('');
  const [goal, setGoal] = useState('');
  const [steps, setSteps] = useState(currentUrl && currentUrl !== 'about:blank' ? `1. Abrir ${currentUrl}\n2. ` : '1. ');
  const [busy, run] = useAction();

  const save = async (e) => {
    e.preventDefault();
    const r = await run('teach', () => bridge.addSkill({
      name: name.trim(),
      description: goal.trim(),
      instructions: steps.trim(),
      source: 'taught',
    }), t('comp.taughtSaved'));
    if (r) { toast(t('comp.taughtSaved')); onClose(); }
  };

  return (
    <Modal title={t('comp.teachTitle')} onClose={onClose} wide>
      <form className="stack" onSubmit={save}>
        <p className="muted small" style={{ margin: 0 }}>{t('comp.teachIntro')}</p>
        <Field label={t('sk.name')}><input required autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder={t('comp.teachNamePh')} /></Field>
        <Field label={t('sk.desc')}><input value={goal} onChange={(e) => setGoal(e.target.value)} placeholder={t('comp.teachGoalPh')} /></Field>
        <Field label={t('sk.instructions')} hint={t('comp.teachStepsHint')}>
          <textarea required rows={9} value={steps} onChange={(e) => setSteps(e.target.value)} />
        </Field>
        <div className="row end">
          <button type="button" className="ghost" onClick={onClose}>{t('common.cancel')}</button>
          <button disabled={busy === 'teach'}>{t('comp.teachSave')}</button>
        </div>
      </form>
    </Modal>
  );
}

export default function Computer() {
  const t = useT();
  const toast = useToast();
  const st = useLoad(() => bridge.computerStatus(), [], { interval: 5000 });
  const [url, setUrl] = useState('');
  const [viewerKey, setViewerKey] = useState(0);
  const [teaching, setTeaching] = useState(false);
  const [busy, run] = useAction();
  const frameRef = useRef(null);
  const wrapRef = useRef(null);

  const d = st.data;
  const running = d?.status === 'running';
  const human = d?.control === 'human';
  const needs = d?.needsHuman?.active;

  useEffect(() => {
    if (frameRef.current?.contentWindow) {
      frameRef.current.contentWindow.postMessage({ type: 'viewOnly', value: !human }, '*');
    }
  }, [human]);

  const start = async () => {
    const r = await run('start', () => bridge.computerStart(url.trim()), t('comp.started'));
    if (r) { st.reload(true); setViewerKey((k) => k + 1); }
  };
  const stop = async () => {
    const r = await run('stop', () => bridge.computerStop(), t('comp.stopped'));
    if (r) st.reload(true);
  };
  const toggleControl = async () => {
    const next = human ? 'bot' : 'human';
    const r = await run('ctrl', () => bridge.computerControl(next));
    if (r) {
      st.reload(true);
      toast(next === 'human' ? t('comp.youHaveControl') : t('comp.botHasControl'));
    }
  };
  const openUrl = async (e) => {
    e.preventDefault();
    const u = url.trim();
    if (!u) return;
    const norm = /^https?:\/\//i.test(u) ? u : 'https://' + u;
    const r = await run('open', () => bridge.computerOpen(norm));
    if (r) { setUrl(norm); st.reload(true); toast(t('comp.opened')); }
  };
  const resolveHuman = async (action) => {
    const r = await run('res', () => bridge.computerResolve(action), action === 'done' ? t('comp.resolvedDone') : t('comp.resolvedSkip'));
    if (r) st.reload(true);
  };
  const fullscreen = () => {
    const el = wrapRef.current;
    if (!el) return;
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    else el.requestFullscreen?.().catch(() => {});
  };

  return (
    <div className="page">
      <ErrorBox error={st.error} onRetry={() => st.reload()} />
      <p className="muted page-intro">{t('comp.intro')}</p>

      {needs && (
        <div className="banner warn computer-need-banner">
          <AlertTriangle size={18} />
          <div className="grow">
            <b>{t('comp.needsYou')}</b>
            <div className="small">{d.needsHuman.reason}</div>
          </div>
          <Btn icon={Check} className="small" disabled={busy === 'res'} onClick={() => resolveHuman('done')}>{t('comp.imDone')}</Btn>
          <Btn icon={SkipForward} className="ghost small" disabled={busy === 'res'} onClick={() => resolveHuman('skip')}>{t('comp.skip')}</Btn>
        </div>
      )}

      <Card title={t('comp.title')} icon={Monitor} actions={
        <div className="row wrap">
          <Badge kind={running ? (needs ? 'warn' : 'ok') : 'muted'}>
            {running ? (human ? t('comp.youHaveControl') : t('comp.running')) : t('comp.stoppedState')}
          </Badge>
          {!running ? (
            <Btn icon={Play} className="small" disabled={busy === 'start'} onClick={start}>{t('comp.start')}</Btn>
          ) : (
            <>
              <Btn icon={human ? Eye : Hand} className={human ? 'warn small' : 'small'} disabled={busy === 'ctrl'} onClick={toggleControl}>
                {human ? t('comp.releaseControl') : t('comp.takeControl')}
              </Btn>
              <Btn icon={GraduationCap} className="ghost small" onClick={async () => { if (!human) await run('ctrl', () => bridge.computerControl('human')); st.reload(true); setTeaching(true); }}>
                {t('comp.teach')}
              </Btn>
              <Btn icon={Power} className="ghost danger-text small" disabled={busy === 'stop'} onClick={stop}>{t('comp.stop')}</Btn>
            </>
          )}
        </div>
      }>
        {running && (
          <form className="row wrap computer-bar" onSubmit={openUrl}>
            <label className="search grow">
              <Globe size={14} />
              <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder={d?.currentUrl || 'https://...'} />
            </label>
            <Btn icon={ExternalLink} className="ghost small" type="submit" disabled={busy === 'open' || !url.trim()}>{t('comp.go')}</Btn>
            <a className="btn ghost small" href={bridge.computerScreenshotUrl()} target="_blank" rel="noreferrer"><Camera size={14} /> {t('comp.screenshot')}</a>
            <Btn icon={RefreshCw} type="button" className="ghost small" onClick={() => setViewerKey((k) => k + 1)}>{t('comp.reconnect')}</Btn>
            <Btn icon={Maximize2} type="button" className="ghost small" onClick={fullscreen}>{t('pg.full')}</Btn>
          </form>
        )}

        <div ref={wrapRef} className={'computer-screen' + (human ? ' human' : '')}>
          {running ? (
            <iframe
              key={viewerKey}
              ref={frameRef}
              src={bridge.computerViewerUrl(!human)}
              title={t('comp.title')}
              className="computer-frame"
            />
          ) : (
            <div className="computer-off">
              <Monitor size={42} className="muted" />
              <h3>{t('comp.offTitle')}</h3>
              <p className="muted small" style={{ maxWidth: 460, textAlign: 'center' }}>{t('comp.offHint')}</p>
              <Btn icon={Play} disabled={busy === 'start'} onClick={start}>{t('comp.start')}</Btn>
            </div>
          )}
        </div>

        {d && (
          <div className="row wrap muted small" style={{ marginTop: 10 }}>
            <span>Display <code className="mono">{d.display}</code></span>
            {d.cdpUrl && <span>· CDP <code className="mono">{d.cdpUrl}</code></span>}
            <span>· {t('comp.profileHint')}</span>
          </div>
        )}
      </Card>

      {teaching && <TeachModal currentUrl={d?.currentUrl} onClose={() => setTeaching(false)} />}
    </div>
  );
}
