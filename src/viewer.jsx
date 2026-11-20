// In-app viewers, so tapping media never throws the installed app out to the browser:
// - openImage(): full-screen photo viewer (pinch / double-tap zoom, pan, drag down to close)
// - openDocument(): full-height sheet with the file or page in an iframe, Share and Download
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Download, ExternalLink, FileText, Share, X } from 'lucide-react';
import { haptic, useToast } from './ui.jsx';
import { useT } from './i18n.jsx';

const EVT = 'acp-viewer';
export const openImage = (src, name) => window.dispatchEvent(new CustomEvent(EVT, { detail: { kind: 'image', src, name } }));
export const openDocument = (src, name, type) => window.dispatchEvent(new CustomEvent(EVT, { detail: { kind: 'doc', src, name, type } }));

// <a> props that open in the in-app viewer on click but keep a real href (long press / middle click still work).
export const imageLink = (src, name) => ({ href: src, onClick: (e) => { if (e.metaKey || e.ctrlKey || e.button === 1) return; e.preventDefault(); openImage(src, name); } });
export const docLink = (src, name, type) => ({ href: src, onClick: (e) => { if (e.metaKey || e.ctrlKey || e.button === 1) return; e.preventDefault(); openDocument(src, name, type); } });

// PDFs in an iframe only show the first page on iOS (and nothing in some Android WebViews), so on touch
// screens they get the file card with Open / Share / Download instead.
const touch = () => window.matchMedia('(hover: none)').matches;
const isPdf = (type, name) => /pdf/.test(type || '') || /\.pdf$/i.test(name || '');
const previewable = (type, name) => !(isPdf(type, name) && touch()) && previewableType(type, name);
const previewableType = (type, name) => !type || /^(text\/|image\/|application\/pdf|application\/json|audio\/|video\/)/.test(type) || /\.(pdf|txt|md|json|html?|csv|log|png|jpe?g|gif|webp|svg)$/i.test(name || '');

async function shareFile({ src, name, type }, onCopied) {
  const abs = new URL(src, window.location.href).href;
  try {
    if (navigator.canShare && !/html/.test(type || '')) {
      const blob = await (await fetch(abs, { credentials: 'include' })).blob();
      const file = new File([blob], name || 'arquivo', { type: blob.type || type || 'application/octet-stream' });
      if (navigator.canShare({ files: [file] })) { await navigator.share({ files: [file], title: name }); return; }
    }
    if (navigator.share) { await navigator.share({ title: name, url: abs }); return; }
  } catch (e) {
    if (e?.name === 'AbortError') return;
  }
  try { await navigator.clipboard.writeText(abs); onCopied?.(); } catch { /* nothing else to try */ }
}

function ImageViewer({ src, name, onClose, onShare }) {
  const t = useT();
  const imgRef = useRef(null);
  const bgRef = useRef(null);
  const v = useRef({ scale: 1, x: 0, y: 0 });
  const [leaving, setLeaving] = useState(false);
  const apply = (anim) => {
    const el = imgRef.current;
    if (!el) return;
    el.style.transition = anim ? 'transform 280ms cubic-bezier(.22, 1, .36, 1)' : 'none';
    el.style.transform = `translate(${v.current.x}px, ${v.current.y}px) scale(${v.current.scale})`;
  };
  const close = () => {
    if (leaving) return;
    setLeaving(true);
    v.current.y += 40; apply(true);
    setTimeout(onClose, 200);
  };
  useEffect(() => {
    const bg = bgRef.current;
    let g = null, lastTap = 0;
    const dist = (a, b) => Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
    const start = (e) => {
      const ts = e.touches;
      if (ts.length === 2) { g = { pinch: true, d0: dist(ts[0], ts[1]), s0: v.current.scale }; return; }
      if (ts.length !== 1) return;
      const now = Date.now();
      if (now - lastTap < 280) { // double tap: toggle zoom
        lastTap = 0;
        v.current = v.current.scale > 1 ? { scale: 1, x: 0, y: 0 } : { scale: 2.5, x: 0, y: 0 };
        apply(true); haptic(6); g = null; return;
      }
      lastTap = now;
      g = { x0: ts[0].clientX, y0: ts[0].clientY, bx: v.current.x, by: v.current.y, moved: false };
    };
    const move = (e) => {
      if (!g) return;
      if (e.cancelable) e.preventDefault();
      const ts = e.touches;
      if (g.pinch && ts.length === 2) {
        v.current.scale = Math.max(1, Math.min(5, g.s0 * (dist(ts[0], ts[1]) / g.d0)));
        if (v.current.scale === 1) { v.current.x = 0; v.current.y = 0; }
        apply(false); return;
      }
      if (ts.length !== 1 || g.pinch) return;
      const dx = ts[0].clientX - g.x0, dy = ts[0].clientY - g.y0;
      if (Math.abs(dx) > 4 || Math.abs(dy) > 4) g.moved = true;
      if (v.current.scale > 1) { v.current.x = g.bx + dx; v.current.y = g.by + dy; apply(false); return; }
      // not zoomed: drag down to dismiss, the backdrop fades with the distance
      v.current.y = Math.max(-40, dy); v.current.x = dx * 0.3;
      bg.style.backgroundColor = `rgba(0,0,0,${Math.max(0.2, 1 - Math.abs(dy) / 400)})`;
      apply(false);
    };
    const end = () => {
      if (!g) return;
      const was = g; g = null;
      if (was.pinch) { if (v.current.scale <= 1.02) { v.current = { scale: 1, x: 0, y: 0 }; apply(true); } return; }
      if (v.current.scale > 1) return;
      if (v.current.y > 110) { haptic(8); onClose(); return; }
      v.current = { scale: 1, x: 0, y: 0 }; apply(true); bg.style.backgroundColor = '';
    };
    bg.addEventListener('touchstart', start, { passive: true });
    bg.addEventListener('touchmove', move, { passive: false });
    bg.addEventListener('touchend', end);
    bg.addEventListener('touchcancel', end);
    const k = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', k);
    return () => {
      bg.removeEventListener('touchstart', start); bg.removeEventListener('touchmove', move);
      bg.removeEventListener('touchend', end); bg.removeEventListener('touchcancel', end);
      window.removeEventListener('keydown', k);
    };
  }, [onClose]);
  return (
    <div ref={bgRef} className={'iv-bg' + (leaving ? ' leaving' : '')} role="dialog" aria-modal="true" aria-label={name || ''}>
      <div className="iv-bar">
        <button type="button" className="iv-btn" aria-label={t('common.close')} onClick={close}><X size={20} /></button>
        <span className="iv-name ellipsis">{name}</span>
        <button type="button" className="iv-btn" aria-label={t('common.share')} onClick={onShare}><Share size={19} /></button>
      </div>
      <img ref={imgRef} src={src} alt={name || ''} className="iv-img" draggable={false} onClick={(e) => e.stopPropagation()} />
    </div>
  );
}

function DocSheet({ src, name, type, onClose, onShare }) {
  const t = useT();
  const [leaving, setLeaving] = useState(false);
  const close = () => { setLeaving(true); setTimeout(onClose, 240); };
  useEffect(() => {
    const k = (e) => e.key === 'Escape' && close();
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  });
  const canShow = previewable(type, name);
  return (
    <div className={'doc-bg' + (leaving ? ' leaving' : '')} onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div className="doc-sheet" role="dialog" aria-modal="true" aria-label={name || ''}>
        <header className="doc-h">
          <button type="button" className="modal-cancel doc-close" onClick={close}>{t('common.close')}</button>
          <b className="ellipsis">{name}</b>
          <div className="doc-h-actions">
            <a className="iv-btn doc-icon" href={src} target="_blank" rel="noreferrer" aria-label={t('common.openOutside')} title={t('common.openOutside')}><ExternalLink size={18} /></a>
            {!/html/.test(type || '') && <a className="iv-btn doc-icon" href={src} download={name} aria-label={t('common.download')} title={t('common.download')}><Download size={18} /></a>}
            <button type="button" className="iv-btn doc-icon" aria-label={t('common.share')} title={t('common.share')} onClick={onShare}><Share size={18} /></button>
          </div>
        </header>
        {canShow
          ? <iframe className="doc-frame" src={src} title={name || 'doc'} sandbox="allow-scripts allow-same-origin allow-popups allow-forms allow-downloads" />
          : (
            <div className="doc-empty">
              <span className="row-ic ic-dashboards detail-ic"><FileText size={30} /></span>
              <b>{name}</b>
              <div className="row wrap center">
                <a className="btn small" href={src} target="_blank" rel="noreferrer"><ExternalLink size={15} /> {t('common.openOutside')}</a>
                <button type="button" className="ghost small" onClick={onShare}><Share size={15} /> {t('common.share')}</button>
                <a className="btn ghost small" href={src} download={name}><Download size={15} /> {t('common.download')}</a>
              </div>
            </div>
          )}
      </div>
    </div>
  );
}

export function ViewerHost() {
  const [item, setItem] = useState(null);
  const toast = useToast();
  const t = useT();
  useEffect(() => {
    const on = (e) => { haptic(6); setItem(e.detail); };
    window.addEventListener(EVT, on);
    return () => window.removeEventListener(EVT, on);
  }, []);
  if (!item) return null;
  const share = () => shareFile(item, () => toast(t('common.copied')));
  return createPortal(
    item.kind === 'image'
      ? <ImageViewer src={item.src} name={item.name} onClose={() => setItem(null)} onShare={share} />
      : <DocSheet src={item.src} name={item.name} type={item.type} onClose={() => setItem(null)} onShare={share} />,
    document.body,
  );
}
