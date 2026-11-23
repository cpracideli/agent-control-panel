import { useCallback, useEffect, useRef, useState } from 'react';
import { AlertTriangle, Camera, Check, Copy, Download, ExternalLink, Eye, Globe, GraduationCap, Hand, History, KeyRound, Laptop, Maximize2, Monitor, PenTool, Play, Plus, Power, RefreshCw, Send, SkipForward, Trash2 } from 'lucide-react';
import { bridge } from '../api.js';
import { useT } from '../i18n.jsx';
import { Badge, Btn, Card, ErrorBox, Field, Modal, useAction, useFmt, useLoad, useToast } from '../ui.jsx';
import { imageLink, openImage } from '../viewer.jsx';
import { ListGroup, Row, useIsMobile } from '../native.jsx';

function AnnotateModal({ currentUrl, onClose }) {
  const toast = useToast();
  const chats = useLoad(() => bridge.chats(), [], { cacheKey: '/bridge/chats' });
  const webChats = (chats.data || []).filter((c) => c.kind === 'web' && !c.archived);
  const [chatId, setChatId] = useState('');
  const [note, setNote] = useState('');
  const [rect, setRect] = useState(null);
  const [drag, setDrag] = useState(null);
  const [imgSrc] = useState(() => bridge.computerScreenshotUrl());
  const imgRef = useRef(null);
  const [busy, run] = useAction();

  useEffect(() => { if (!chatId && webChats.length) setChatId(webChats[0].id); }, [webChats, chatId]);

  const toRel = (e) => {
    const box = e.currentTarget.getBoundingClientRect();
    return { x: Math.max(0, Math.min(1, (e.clientX - box.left) / box.width)), y: Math.max(0, Math.min(1, (e.clientY - box.top) / box.height)) };
  };
  const onDown = (e) => { const p = toRel(e); setDrag(p); setRect({ x: p.x, y: p.y, w: 0, h: 0 }); };
  const onMove = (e) => {
    if (!drag) return;
    const p = toRel(e);
    setRect({ x: Math.min(drag.x, p.x), y: Math.min(drag.y, p.y), w: Math.abs(p.x - drag.x), h: Math.abs(p.y - drag.y) });
  };
  const onUp = () => setDrag(null);

  const sendAnnotated = async (e) => {
    e.preventDefault();
    const targetId = chatId || webChats[0]?.id;
    if (!targetId) return toast('Crie uma conversa web primeiro', 'err');
    const img = imgRef.current;
    if (!img) return;
    const canvas = document.createElement('canvas');
    canvas.width = img.naturalWidth || 1280;
    canvas.height = img.naturalHeight || 800;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    if (rect && rect.w > 0.01 && rect.h > 0.01) {
      ctx.strokeStyle = '#ff375f';
      ctx.lineWidth = Math.max(4, Math.round(canvas.width / 250));
      ctx.strokeRect(rect.x * canvas.width, rect.y * canvas.height, rect.w * canvas.width, rect.h * canvas.height);
      ctx.fillStyle = 'rgba(255,55,95,0.14)';
      ctx.fillRect(rect.x * canvas.width, rect.y * canvas.height, rect.w * canvas.width, rect.h * canvas.height);
    }
    const dataUrl = canvas.toDataURL('image/png');
    const b64 = dataUrl.split(',')[1] || '';
    const msg = `[Anotação na tela do Computador${currentUrl ? ' (' + currentUrl + ')' : ''}]\n${note.trim() || 'Veja a área destacada em vermelho nesta tela.'}`;
    const r = await run('send', () => bridge.send(targetId, msg, [{ name: 'tela-anotada.png', type: 'image/png', data: b64 }]), 'Anotação enviada ao chat');
    if (r) { onClose(); window.location.hash = '#/chat/' + targetId.slice(4); }
  };

  return (
    <Modal title="Anotar tela e enviar ao chat" onClose={onClose} wide>
      <form className="stack" onSubmit={sendAnnotated}>
        <p className="muted small" style={{ margin: 0 }}>Arraste sobre a captura para destacar a área desejada, adicione seu comentário e envie direto para o bot.</p>
        <div style={{ position: 'relative', userSelect: 'none', cursor: 'crosshair', borderRadius: 10, overflow: 'hidden', border: '1px solid var(--border)' }}
          onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp}>
          <img ref={imgRef} src={imgSrc} alt="Tela" style={{ width: '100%', display: 'block' }} crossOrigin="anonymous" />
          {rect && rect.w > 0.005 && (
            <div style={{
              position: 'absolute', left: (rect.x * 100) + '%', top: (rect.y * 100) + '%',
              width: (rect.w * 100) + '%', height: (rect.h * 100) + '%',
              border: '2px solid #ff375f', background: 'rgba(255,55,95,0.16)', pointerEvents: 'none',
            }} />
          )}
        </div>
        <div className="form-grid">
          <Field label="Enviar para conversa">
            <select value={chatId} onChange={(e) => setChatId(e.target.value)}>
              {webChats.map((c) => <option key={c.id} value={c.id}>{c.title}</option>)}
            </select>
          </Field>
          <Field label="Instrução / comentário">
            <input required value={note} onChange={(e) => setNote(e.target.value)} placeholder="Ex.: Clique neste botão ou corrija este valor" />
          </Field>
        </div>
        <div className="row end">
          <button type="button" className="ghost" onClick={onClose}>Cancelar</button>
          <Btn icon={Send} disabled={busy === 'send' || !webChats.length}>Enviar anotação ao chat</Btn>
        </div>
      </form>
    </Modal>
  );
}

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

function LocalBridgeCard() {
  const toast = useToast();
  const f = useFmt();
  const devs = useLoad(() => bridge.localDevices(), [], { interval: 10000 });
  const [name, setName] = useState('');
  const [paired, setPaired] = useState(null);
  const [busy, run] = useAction();

  const pair = async (e) => {
    e.preventDefault();
    const r = await run('pair', () => bridge.localPair(name.trim() || 'Meu Computador'), 'Dispositivo pareado');
    if (r) { setPaired(r); setName(''); devs.reload(true); }
  };

  return (
    <Card title={`Meus Computadores — Local Bridge (${(devs.data || []).length})`} icon={Laptop}>
      <p className="muted small" style={{ marginTop: 0 }}>
        Conecte seu Mac, Linux ou Windows pessoal (estilo OpenAI Dots) para os bots acessarem arquivos locais ou abrirem sites no seu navegador pessoal. Conexão revogável a qualquer momento.
      </p>
      <form className="row wrap" onSubmit={pair} style={{ marginBottom: 10 }}>
        <input className="grow" value={name} onChange={(e) => setName(e.target.value)} placeholder="Nome do computador (ex.: Meu MacBook Pro)" />
        <Btn icon={Plus} className="small" disabled={busy === 'pair'}>Parear novo PC/Mac</Btn>
      </form>
      {paired && (
        <div className="trigger-box stack" style={{ marginBottom: 10 }}>
          <div className="row between wrap">
            <b>✅ Token gerado para "{paired.name}" (mostrado uma única vez)</b>
            <a className="btn small" href={bridge.localAgentUrl(paired.token)} download="local-bridge-agent.mjs">
              <Download size={14} /> Baixar local-bridge-agent.mjs
            </a>
          </div>
          <div className="row wrap">
            <code className="mono small grow ellipsis">node local-bridge-agent.mjs</code>
            <Btn icon={Copy} type="button" className="ghost small" onClick={() => { navigator.clipboard.writeText(paired.token); toast('Token copiado'); }}>Copiar token</Btn>
          </div>
          <p className="muted small" style={{ margin: 0 }}>Baixe o script acima (Node 22+, zero dependências) e rode no terminal do seu Mac/PC. O status muda para Online na hora.</p>
        </div>
      )}
      {!(devs.data || []).length && <p className="muted small">Nenhum computador local pareado ainda.</p>}
      {(devs.data || []).map((d) => (
        <div key={d.id} className="list-row wrap">
          <div className="grow">
            <div className="row wrap">
              <Laptop size={14} className="muted" />
              <b>{d.name}</b>
              <Badge kind={d.online ? 'ok' : 'muted'}>{d.online ? 'Online' : 'Offline'}</Badge>
              {d.os && <Badge kind="muted">{d.os}</Badge>}
            </div>
            <div className="muted small">{d.cwd ? d.cwd + ' · ' : ''}{d.lastSeen ? 'visto ' + f.ago(d.lastSeen) : 'nunca conectou'}</div>
          </div>
          <div className="row">
            {d.online && (
              <Btn icon={RefreshCw} className="ghost small" disabled={busy === 'ping' + d.id}
                onClick={() => run('ping' + d.id, () => bridge.localCall({ deviceId: d.id, action: 'info' })).then((r) => r && toast(`Conectado: ${r.hostname} (${r.platform})`))}>
                Testar
              </Btn>
            )}
            <Btn icon={Trash2} className="ghost danger-text small" disabled={busy === 'rev' + d.id}
              onClick={() => run('rev' + d.id, () => bridge.localRevoke(d.id), 'Acesso revogado').then(() => devs.reload(true))}>
              Revogar
            </Btn>
          </div>
        </div>
      ))}
    </Card>
  );
}

export default function Computer() {
  const t = useT();
  const f = useFmt();
  const toast = useToast();
  const st = useLoad(() => bridge.computerStatus(), [], { interval: 5000, cacheKey: '/bridge/computer/status' });
  const tl = useLoad(() => bridge.computerTimeline(), [], { interval: 15000 });
  const secs = useLoad(() => bridge.secrets(), [], { cacheKey: '/bridge/secrets' });
  const loginSecrets = (secs.data || []).filter((s) => s.kind === 'login' || s.username || s.domain);
  const [url, setUrl] = useState('');
  const [loginPick, setLoginPick] = useState('');
  const [viewerKey, setViewerKey] = useState(0);
  const [teaching, setTeaching] = useState(false);
  const [annotating, setAnnotating] = useState(false);
  const [busy, run] = useAction();
  const frameRef = useRef(null);
  const wrapRef = useRef(null);
  const mobile = useIsMobile();

  const d = st.data;
  const running = d?.status === 'running';
  const human = d?.control === 'human';
  const needs = d?.needsHuman?.active;

  const syncViewerControl = useCallback(() => {
    const viewer = frameRef.current?.contentWindow;
    if (!viewer) return;
    viewer.postMessage({ type: 'viewOnly', value: !human }, window.location.origin);
    if (human) viewer.postMessage({ type: 'computer-focus' }, window.location.origin);
  }, [human]);

  useEffect(() => { syncViewerControl(); }, [syncViewerControl]);

  const openViewerKeyboard = () => {
    frameRef.current?.contentWindow?.postMessage(
      { type: 'computer-keyboard', action: 'open' },
      window.location.origin,
    );
  };

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

  const teach = async () => { if (!human) await run('ctrl', () => bridge.computerControl('human')); st.reload(true); setTeaching(true); };
  const screen = (
    <div ref={wrapRef} className={'computer-screen' + (human ? ' human' : '')}>
      {running ? (
        <iframe key={viewerKey} ref={frameRef} src={bridge.computerViewerUrl(true)} title={t('comp.title')} className="computer-frame" tabIndex={0} onLoad={syncViewerControl} />
      ) : (
        <div className="computer-off">
          <Monitor size={42} className="muted" />
          <h3>{t('comp.offTitle')}</h3>
          <p className="muted small" style={{ maxWidth: 460, textAlign: 'center' }}>{t('comp.offHint')}</p>
          <Btn icon={Play} disabled={busy === 'start'} onClick={start}>{t('comp.start')}</Btn>
        </div>
      )}
    </div>
  );
  const needBanner = needs && (
    <div className="banner warn computer-need-banner">
      <AlertTriangle size={18} />
      <div className="grow">
        <b>{t('comp.needsYou')}</b>
        <div className="small">{d.needsHuman.reason}</div>
      </div>
      <Btn icon={Check} className="small" disabled={busy === 'res'} onClick={() => resolveHuman('done')}>{t('comp.imDone')}</Btn>
      <Btn icon={SkipForward} className="ghost small" disabled={busy === 'res'} onClick={() => resolveHuman('skip')}>{t('comp.skip')}</Btn>
    </div>
  );

  if (mobile) {
    const statusBadge = <Badge kind={running ? (needs ? 'warn' : 'ok') : 'muted'}>{running ? (human ? t('comp.youHaveControl') : t('comp.running')) : t('comp.stoppedState')}</Badge>;
    return (
      <div className="page page-list">
        <ErrorBox error={st.error} onRetry={() => st.reload()} />
        {needBanner}
        <ListGroup title={t('comp.screenTitle')}>{screen}</ListGroup>
        <ListGroup title={t('comp.statusLbl')}>
          <Row icon={Monitor} tint="ic-computer" label={t('comp.title')} value={statusBadge} sub={running && d?.currentUrl ? d.currentUrl : undefined} />
          {running && (
            <form className="group-row vrow" onSubmit={openUrl}>
              <span className="row-ic ic-plain"><Globe size={17} /></span>
              <label className="search grow"><input value={url} onChange={(e) => setUrl(e.target.value)} placeholder={d?.currentUrl || 'https://...'} aria-label={t('comp.openUrl')} /></label>
              <Btn icon={ExternalLink} className="ghost small" type="submit" disabled={busy === 'open' || !url.trim()}>{t('comp.go')}</Btn>
            </form>
          )}
        </ListGroup>
        <ListGroup title={t('comp.actions')}>
          {!running ? (
            <Row icon={Play} tint="ic-chat" label={t('comp.start')} kind="accent" disabled={busy === 'start'} onClick={start} />
          ) : (
            <>
              <Row icon={human ? Eye : Hand} tint={human ? 'ic-schedules' : 'ic-overview'} label={human ? t('comp.releaseControl') : t('comp.takeControl')} kind="accent" disabled={busy === 'ctrl'} onClick={toggleControl} chevron />
              {human && <Row icon={KeyRound} tint="ic-plain" label="Digitar no navegador" onClick={openViewerKeyboard} chevron />}
              <Row icon={GraduationCap} tint="ic-skills" label={t('comp.teach')} onClick={teach} chevron />
              <Row icon={Camera} tint="ic-dashboards" label={t('comp.screenshot')} onClick={() => openImage(bridge.computerScreenshotUrl(), t('comp.screenshot'))} chevron />
              <Row icon={RefreshCw} tint="ic-plain" label={t('comp.reconnect')} onClick={() => setViewerKey((k) => k + 1)} />
              <Row icon={Maximize2} tint="ic-plain" label={t('pg.full')} onClick={fullscreen} />
              <Row icon={Power} tint="ic-logout" label={t('comp.stop')} kind="danger" disabled={busy === 'stop'} onClick={stop} />
            </>
          )}
        </ListGroup>
        {d && (
          <ListGroup title={t('comp.details')} footer={t('comp.profileHint')}>
            <Row label="Display" value={<code className="mono">{d.display}</code>} />
            {d.cdpUrl && <Row label="CDP" value={<code className="mono">{d.cdpUrl}</code>} />}
          </ListGroup>
        )}
        <LocalBridgeCard />

      {teaching && <TeachModal currentUrl={d?.currentUrl} onClose={() => setTeaching(false)} />}
      </div>
    );
  }

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
              {human && <Btn icon={KeyRound} className="ghost small" onClick={openViewerKeyboard}>Digitar</Btn>}
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
          <div className="stack" style={{ gap: 8, marginBottom: 8 }}>
            <form className="row wrap computer-bar" onSubmit={openUrl} style={{ marginBottom: 0 }}>
              <label className="search grow">
                <Globe size={14} />
                <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder={d?.currentUrl || 'https://...'} />
              </label>
              <Btn icon={ExternalLink} className="ghost small" type="submit" disabled={busy === 'open' || !url.trim()}>{t('comp.go')}</Btn>
              <Btn icon={PenTool} type="button" className="ghost small" onClick={() => setAnnotating(true)}>Anotar</Btn>
              <a className="btn ghost small" {...imageLink(bridge.computerScreenshotUrl(), t('comp.screenshot'))}><Camera size={14} /> {t('comp.screenshot')}</a>
              <Btn icon={RefreshCw} type="button" className="ghost small" onClick={() => setViewerKey((k) => k + 1)}>{t('comp.reconnect')}</Btn>
              <Btn icon={Maximize2} type="button" className="ghost small" onClick={fullscreen}>{t('pg.full')}</Btn>
            </form>
            {loginSecrets.length > 0 && (
              <div className="row wrap small">
                <KeyRound size={14} className="muted" />
                <select value={loginPick} onChange={(e) => setLoginPick(e.target.value)} style={{ maxWidth: 260 }}>
                  <option value="">Preencher login do cofre (cego)...</option>
                  {loginSecrets.map((s) => <option key={s.name} value={s.name}>{s.label || s.name}{s.domain ? ' · ' + s.domain : ''}{s.hasTotp ? ' (+2FA)' : ''}</option>)}
                </select>
                <Btn icon={KeyRound} type="button" className="ghost small" disabled={!loginPick || busy === 'fill'}
                  onClick={() => run('fill', () => bridge.computerFillLogin({ name: loginPick }), 'Credenciais preenchidas sem expor ao modelo').then(() => tl.reload(true))}>
                  Preencher
                </Btn>
              </div>
            )}
          </div>
        )}

        <div ref={wrapRef} className={'computer-screen' + (human ? ' human' : '')}>
          {running ? (
            <iframe
              key={viewerKey}
              ref={frameRef}
              src={bridge.computerViewerUrl(true)}
              title={t('comp.title')}
              className="computer-frame"
              tabIndex={0}
              onLoad={syncViewerControl}
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

      <Card title={`Linha do tempo (${(tl.data || []).length})`} icon={History} actions={
        running && <Btn icon={Camera} className="ghost small" disabled={busy === 'cap'} onClick={() => run('cap', () => bridge.computerCaptureTimeline('manual'), 'Frame salvo').then(() => tl.reload(true))}>Capturar agora</Btn>
      }>
        {!(tl.data || []).length && <p className="muted small">Os snapshots automáticos aparecem aqui conforme o bot navega, faz login ou pede ajuda.</p>}
        {(tl.data || []).length > 0 && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(170px, 1fr))', gap: 10 }}>
            {(tl.data || []).slice(0, 12).map((fr) => (
              <a key={fr.id} {...imageLink(bridge.computerTimelineFrameUrl(fr.id), fr.label + ' · ' + f.date(fr.at))} className="bot-card" style={{ padding: 6, textDecoration: 'none', color: 'inherit' }}>
                <img src={bridge.computerTimelineFrameUrl(fr.id)} alt={fr.label} loading="lazy" style={{ width: '100%', height: 96, objectFit: 'cover', borderRadius: 6 }} />
                <div className="small ellipsis" style={{ marginTop: 4 }}><b>{fr.label}</b></div>
                <div className="muted small">{f.ago(fr.at)}</div>
              </a>
            ))}
          </div>
        )}
      </Card>

      <LocalBridgeCard />

      {teaching && <TeachModal currentUrl={d?.currentUrl} onClose={() => setTeaching(false)} />}
      {annotating && <AnnotateModal currentUrl={d?.currentUrl} onClose={() => setAnnotating(false)} />}
    </div>
  );
}
