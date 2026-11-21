import { useEffect, useRef, useState } from 'react';
import { Download, FileText, FolderArchive, Image as ImageIcon, MessageSquare, Music, PenTool, Search, Send, Trash2 } from 'lucide-react';
import { bridge } from '../api.js';
import { useT } from '../i18n.jsx';
import { Badge, Btn, Card, ErrorBox, Field, IconButton, Modal, useAction, useConfirm, useFmt, useLoad, useToast } from '../ui.jsx';
import { docLink, imageLink } from '../viewer.jsx';

function AnnotateArtifactModal({ item, onClose }) {
  const toast = useToast();
  const chats = useLoad(() => bridge.chats(), [], { cacheKey: '/bridge/chats' });
  const webChats = (chats.data || []).filter((c) => c.kind === 'web' && !c.archived);
  const [chatId, setChatId] = useState(item.chatId?.startsWith('web:') ? item.chatId : '');
  const [note, setNote] = useState('');
  const [rect, setRect] = useState(null);
  const [drag, setDrag] = useState(null);
  const imgRef = useRef(null);
  const [busy, run] = useAction();
  const imgUrl = bridge.artifactFileUrl(item.name);

  useEffect(() => { if (!chatId && webChats.length) setChatId(webChats[0].id); }, [webChats, chatId]);
  const toRel = (e) => {
    const box = e.currentTarget.getBoundingClientRect();
    return { x: Math.max(0, Math.min(1, (e.clientX - box.left) / box.width)), y: Math.max(0, Math.min(1, (e.clientY - box.top) / box.height)) };
  };
  const submit = async (e) => {
    e.preventDefault();
    const targetId = chatId || webChats[0]?.id;
    if (!targetId) return toast('Crie uma conversa web primeiro', 'err');
    const img = imgRef.current;
    if (!img) return;
    const canvas = document.createElement('canvas');
    canvas.width = img.naturalWidth || 1024;
    canvas.height = img.naturalHeight || 768;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    if (rect && rect.w > 0.01 && rect.h > 0.01) {
      ctx.strokeStyle = '#ff375f';
      ctx.lineWidth = Math.max(4, Math.round(canvas.width / 220));
      ctx.strokeRect(rect.x * canvas.width, rect.y * canvas.height, rect.w * canvas.width, rect.h * canvas.height);
      ctx.fillStyle = 'rgba(255,55,95,0.14)';
      ctx.fillRect(rect.x * canvas.width, rect.y * canvas.height, rect.w * canvas.width, rect.h * canvas.height);
    }
    const b64 = (canvas.toDataURL('image/png').split(',')[1]) || '';
    const msg = `[Anotação no artefato "${item.origName}"]\n${note.trim() || 'Veja a área destacada em vermelho.'}`;
    const r = await run('send', () => bridge.send(targetId, msg, [{ name: 'anotado-' + item.origName.replace(/\.[^.]+$/, '') + '.png', type: 'image/png', data: b64 }]), 'Anotação enviada ao chat');
    if (r) { onClose(); window.location.hash = '#/chat/' + targetId.slice(4); }
  };
  return (
    <Modal title={'Anotar: ' + item.origName} onClose={onClose} wide>
      <form className="stack" onSubmit={submit}>
        <div style={{ position: 'relative', userSelect: 'none', cursor: 'crosshair', borderRadius: 10, overflow: 'hidden', border: '1px solid var(--border)' }}
          onPointerDown={(e) => { const p = toRel(e); setDrag(p); setRect({ x: p.x, y: p.y, w: 0, h: 0 }); }}
          onPointerMove={(e) => { if (!drag) return; const p = toRel(e); setRect({ x: Math.min(drag.x, p.x), y: Math.min(drag.y, p.y), w: Math.abs(p.x - drag.x), h: Math.abs(p.y - drag.y) }); }}
          onPointerUp={() => setDrag(null)}>
          <img ref={imgRef} src={imgUrl} alt={item.origName} style={{ width: '100%', display: 'block', maxHeight: 420, objectFit: 'contain' }} crossOrigin="anonymous" />
          {rect && rect.w > 0.005 && (
            <div style={{ position: 'absolute', left: (rect.x * 100) + '%', top: (rect.y * 100) + '%', width: (rect.w * 100) + '%', height: (rect.h * 100) + '%', border: '2px solid #ff375f', background: 'rgba(255,55,95,0.16)', pointerEvents: 'none' }} />
          )}
        </div>
        <div className="form-grid">
          <Field label="Enviar para conversa">
            <select value={chatId} onChange={(e) => setChatId(e.target.value)}>
              {webChats.map((c) => <option key={c.id} value={c.id}>{c.title}</option>)}
            </select>
          </Field>
          <Field label="Comentário / instrução">
            <input required value={note} onChange={(e) => setNote(e.target.value)} placeholder="O que ajustar ou analisar nesta área?" />
          </Field>
        </div>
        <div className="row end">
          <button type="button" className="ghost" onClick={onClose}>Cancelar</button>
          <Btn icon={Send} disabled={busy === 'send' || !webChats.length}>Enviar anotação</Btn>
        </div>
      </form>
    </Modal>
  );
}

function kindOf(a) {
  if (a.type?.startsWith('image/')) return 'image';
  if (a.type?.startsWith('audio/') || a.voice) return 'audio';
  return 'doc';
}

export default function Artifacts() {
  const t = useT();
  const f = useFmt();
  const confirm = useConfirm();
  const arts = useLoad(() => bridge.artifacts(), [], { interval: 30000, cacheKey: '/bridge/artifacts' });
  const [filter, setFilter] = useState('all');
  const [q, setQ] = useState('');
  const [annotating, setAnnotating] = useState(null);
  const [busy, run] = useAction();

  const list = (arts.data || []).filter((a) => {
    if (filter !== 'all' && kindOf(a) !== filter) return false;
    if (q.trim() && !(a.origName + ' ' + a.name + ' ' + a.chatTitle).toLowerCase().includes(q.toLowerCase())) return false;
    return true;
  });

  return (
    <div className="page">
      <ErrorBox error={arts.error} onRetry={() => arts.reload()} />
      <p className="muted page-intro">{t('art.intro')}</p>
      <Card title={t('art.title', { n: list.length })} icon={FolderArchive} actions={
        <div className="row wrap">
          <div className="seg">
            {[['all', 'art.all'], ['image', 'art.images'], ['audio', 'art.audios'], ['doc', 'art.docs']].map(([k, lk]) => (
              <button key={k} type="button" className={filter === k ? 'on' : ''} onClick={() => setFilter(k)}>{t(lk)}</button>
            ))}
          </div>
          <label className="search"><Search size={14} /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('common.filter')} /></label>
        </div>
      }>
        {arts.data && !list.length && <p className="muted">{t('art.none')}</p>}
        <div className="bot-grid">
          {list.map((a) => {
            const k = kindOf(a);
            const url = bridge.artifactFileUrl(a.name);
            return (
              <div key={a.name} className="bot-card">
                {k === 'image' && (
                  <a {...imageLink(url, a.origName)} className="art-thumb-wrap">
                    <img src={url} alt={a.origName} className="art-thumb" loading="lazy" />
                  </a>
                )}
                {k === 'audio' && (
                  <audio controls preload="none" src={url} style={{ width: '100%', height: 34 }} />
                )}
                <div className="row">
                  <span className="row-ic ic-dashboards" style={{ width: 34, height: 34, borderRadius: 10 }}>
                    {k === 'image' ? <ImageIcon size={16} /> : k === 'audio' ? <Music size={16} /> : <FileText size={16} />}
                  </span>
                  <div className="grow" style={{ minWidth: 0 }}>
                    <b className="ellipsis" style={{ display: 'block' }} title={a.origName}>{a.origName}</b>
                    <div className="muted small ellipsis">{a.chatTitle || a.source} · {Math.max(1, Math.round(a.size / 1024))} KB · {f.ago(a.created)}</div>
                  </div>
                </div>
                <div className="row bot-actions">
                  {a.chatId?.startsWith('web:') && (
                    <a className="btn ghost small" href={'#/chat/' + a.chatId.slice(4)}><MessageSquare size={14} /> {t('art.openChat')}</a>
                  )}
                  <span className="grow" />
                  {k === 'image' && <IconButton icon={PenTool} className="ghost" label="Anotar" onClick={() => setAnnotating(a)} />}
                  <a className="btn ghost small" {...(k === 'image' ? imageLink(url, a.origName) : docLink(url, a.origName, a.type))} aria-label={a.origName}><Download size={14} /></a>
                  <IconButton icon={Trash2} className="ghost danger-text" label={t('common.remove')} disabled={busy === 'd' + a.name}
                    onClick={async () => (await confirm(t('art.removeConfirm', { n: a.origName }))) && run('d' + a.name, () => bridge.deleteArtifact(a.name), t('common.removed')).then(() => arts.reload(true))} />
                </div>
              </div>
            );
          })}
        </div>
      </Card>
      {annotating && <AnnotateArtifactModal item={annotating} onClose={() => setAnnotating(null)} />}
    </div>
  );
}
