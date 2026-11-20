import { useState } from 'react';
import { Download, FileText, FolderArchive, Image as ImageIcon, MessageSquare, Music, Search, Trash2 } from 'lucide-react';
import { bridge } from '../api.js';
import { useT } from '../i18n.jsx';
import { Badge, Card, ErrorBox, IconButton, useAction, useConfirm, useFmt, useLoad } from '../ui.jsx';
import { docLink, imageLink } from '../viewer.jsx';

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
                  <a className="btn ghost small" {...(k === 'image' ? imageLink(url, a.origName) : docLink(url, a.origName, a.type))} aria-label={a.origName}><Download size={14} /></a>
                  <IconButton icon={Trash2} className="ghost danger-text" label={t('common.remove')} disabled={busy === 'd' + a.name}
                    onClick={async () => (await confirm(t('art.removeConfirm', { n: a.origName }))) && run('d' + a.name, () => bridge.deleteArtifact(a.name), t('common.removed')).then(() => arts.reload(true))} />
                </div>
              </div>
            );
          })}
        </div>
      </Card>
    </div>
  );
}
