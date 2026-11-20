// Native-feeling building blocks for phones: inset-grouped lists, swipe actions,
// detail sheets and header actions. Desktop keeps the original card layouts.
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronRight, Plus } from 'lucide-react';
import { Sheet, haptic } from './ui.jsx';
import { useT } from './i18n.jsx';

const MOBILE_Q = '(max-width: 820px)';
export function useIsMobile() {
  const [m, setM] = useState(() => typeof window !== 'undefined' && window.matchMedia(MOBILE_Q).matches);
  useEffect(() => {
    const mq = window.matchMedia(MOBILE_Q);
    const on = () => setM(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  return m;
}

// Renders its children into the navigation bar (#topbar-actions) on phones.
export function HeaderActions({ children }) {
  const mobile = useIsMobile();
  const [host, setHost] = useState(null);
  useEffect(() => { setHost(document.getElementById('topbar-actions')); }, []);
  if (!mobile || !host) return null;
  return createPortal(children, host);
}

// Round "+" in the navigation bar. One item acts directly; several open a small action list.
export function AddButton({ items, label }) {
  const [open, setOpen] = useState(false);
  const t = useT();
  const list = items.filter(Boolean);
  if (!list.length) return null;
  const tap = () => { haptic(8); if (list.length === 1) list[0].onClick(); else setOpen(true); };
  return (
    <>
      <button type="button" className="nav-round press icon" aria-label={label || list[0].label} title={label || list[0].label} onClick={tap} disabled={list.length === 1 && list[0].disabled}>
        <Plus size={20} />
      </button>
      {open && (
        <Sheet title={label || t('common.add')} onClose={() => setOpen(false)}>
          <div className="group">
            {list.map((it) => (
              <button key={it.label} type="button" className="group-row press" disabled={it.disabled} onClick={() => { setOpen(false); it.onClick(); }}>
                {it.icon && <span className="row-ic ic-plain"><it.icon size={17} /></span>}
                <span className="grow">{it.label}</span>
                <ChevronRight size={17} className="chev" />
              </button>
            ))}
          </div>
        </Sheet>
      )}
    </>
  );
}

export function ListGroup({ title, children, footer, className = '' }) {
  return (
    <section className={'nlist-section ' + className}>
      {title && <div className="group-label">{title}</div>}
      <div className="group nlist">{children}</div>
      {footer && <div className="nlist-foot muted small">{footer}</div>}
    </section>
  );
}

// Only one row shows its swipe actions at a time (like Mail).
const SWIPE_EVT = 'nlist-swipe-open';
const ACTION_W = 76;

/**
 * A list row: leading visual, title (+ badges), subtitle and a chevron. Tap opens the detail.
 * `swipe` = [{ icon, label, onClick, kind: 'danger' | 'accent' | 'muted' }] revealed by dragging left.
 * `onLongPress(rect)` is called after a ~450 ms press without movement (context menu).
 */
export function ListRow({ leading, title, badges, subtitle, trailing, onOpen, swipe = [], onLongPress, className = '' }) {
  const id = useRef(Math.random().toString(36).slice(2));
  const rowRef = useRef(null);
  const [dx, setDx] = useState(0);
  const [isOpen, setOpen] = useState(false);
  const st = useRef(null);
  const max = swipe.length * ACTION_W;

  useEffect(() => {
    const on = (e) => { if (e.detail !== id.current) setOpen(false); };
    window.addEventListener(SWIPE_EVT, on);
    return () => window.removeEventListener(SWIPE_EVT, on);
  }, []);

  const open = () => { setOpen(true); haptic(10); window.dispatchEvent(new CustomEvent(SWIPE_EVT, { detail: id.current })); };
  const start = (e) => {
    if (e.touches.length !== 1) return;
    const p = e.touches[0];
    st.current = { x0: p.clientX, y0: p.clientY, base: isOpen ? -max : 0, dragging: false, locked: false, moved: false };
    if (onLongPress) {
      st.current.lp = setTimeout(() => {
        const s = st.current;
        if (!s || s.moved) return;
        s.longPressed = true; haptic(12);
        onLongPress(rowRef.current.getBoundingClientRect());
      }, 450);
    }
  };
  const move = (e) => {
    const s = st.current;
    if (!s) return;
    const p = e.touches[0];
    const mx = p.clientX - s.x0, my = p.clientY - s.y0;
    if (Math.abs(mx) > 6 || Math.abs(my) > 6) { s.moved = true; clearTimeout(s.lp); }
    if (s.locked || !max) return;
    if (!s.dragging) {
      if (Math.abs(mx) < 8 && Math.abs(my) < 8) return;
      if (Math.abs(my) > Math.abs(mx) || (!isOpen && mx > 0)) { s.locked = true; return; }
      s.dragging = true;
    }
    if (e.cancelable) e.preventDefault();
    const next = s.base + mx;
    setDx(Math.max(-max - 24, Math.min(0, next)));
  };
  const end = () => {
    const s = st.current;
    st.current = null;
    if (!s) return;
    clearTimeout(s.lp);
    if (s.dragging) { if (dx < -max / 2) { if (!isOpen) open(); } else setOpen(false); }
    setDx(0);
    if (s.longPressed) s.suppressClick = true;
    if (s.longPressed || s.dragging) { rowRef.current.dataset.suppress = '1'; setTimeout(() => { if (rowRef.current) delete rowRef.current.dataset.suppress; }, 350); }
  };
  useEffect(() => {
    // non-passive move so a sideways drag doesn't also scroll the page
    const el = rowRef.current;
    if (!el) return undefined;
    el.addEventListener('touchmove', move, { passive: false });
    return () => el.removeEventListener('touchmove', move);
  });

  const offset = st.current?.dragging ? dx : (isOpen ? -max : 0);
  const click = (e) => {
    if (rowRef.current?.dataset.suppress) { e.preventDefault(); return; }
    if (isOpen) { setOpen(false); return; }
    onOpen?.();
  };
  return (
    <div ref={rowRef} className={'nrow-wrap ' + (offset ? 'swiping ' : '') + className} onTouchStart={start} onTouchEnd={end} onTouchCancel={end}
      onContextMenu={onLongPress ? (e) => { e.preventDefault(); onLongPress(rowRef.current.getBoundingClientRect()); } : undefined}>
      {max > 0 && (
        <div className="nrow-actions" aria-hidden={!isOpen} style={{ width: max }}>
          {swipe.map((a) => (
            <button key={a.label} type="button" className={'nrow-act ' + (a.kind || 'accent')} disabled={a.disabled} aria-label={a.label}
              onClick={(e) => { e.stopPropagation(); setOpen(false); a.onClick(); }}>
              <a.icon size={19} /><span>{a.label}</span>
            </button>
          ))}
        </div>
      )}
      <button type="button" className="nrow press" onClick={click}
        style={{ transform: offset ? `translateX(${offset}px)` : undefined, transition: st.current?.dragging ? 'none' : undefined }}>
        {leading && <span className="nrow-lead">{leading}</span>}
        <span className="nrow-text">
          <span className="nrow-title"><b className="ellipsis">{title}</b>{badges}</span>
          {subtitle && <span className="nrow-sub">{subtitle}</span>}
        </span>
        {trailing}
        <ChevronRight size={17} className="chev" />
      </button>
    </div>
  );
}

/** Detail screen as a sheet: a header block, optional body and a list of actions. */
export function DetailSheet({ title, header, children, actions = [], onClose }) {
  return (
    <Sheet title={title} onClose={onClose}>
      {header && <div className="detail-head">{header}</div>}
      {children}
      {actions.filter(Boolean).length > 0 && (
        <div className="group detail-actions">
          {actions.filter(Boolean).map((a) => (
            <button key={a.label} type="button" className={'group-row press' + (a.kind === 'danger' ? ' danger-text' : '') + (a.kind === 'primary' ? ' primary-row' : '')}
              disabled={a.disabled} onClick={() => { onClose(); setTimeout(a.onClick, 0); }}>
              <span className={'row-ic ' + (a.kind === 'danger' ? 'ic-logout' : 'ic-plain')}><a.icon size={17} /></span>
              <span className="grow">{a.label}</span>
              {a.kind !== 'danger' && <ChevronRight size={17} className="chev" />}
            </button>
          ))}
        </div>
      )}
    </Sheet>
  );
}
