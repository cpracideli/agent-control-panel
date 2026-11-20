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

// ---------- context menu (long press) ----------
// openContextMenu({ rect, title, items: [{ icon, label, onClick, danger }] }) from anywhere;
// <ContextMenuHost /> (mounted once in App) renders it over a blurred backdrop, next to the pressed element.
const CTX_EVT = 'acp-context-menu';
export function openContextMenu(menu) {
  haptic(12);
  window.dispatchEvent(new CustomEvent(CTX_EVT, { detail: menu }));
}

export function ContextMenuHost() {
  const [menu, setMenu] = useState(null);
  const [leaving, setLeaving] = useState(false);
  const panelRef = useRef(null);
  const openedAt = useRef(0);
  const [pos, setPos] = useState(null);
  useEffect(() => {
    const on = (e) => { openedAt.current = Date.now(); setLeaving(false); setPos(null); setMenu(e.detail); };
    window.addEventListener(CTX_EVT, on);
    return () => window.removeEventListener(CTX_EVT, on);
  }, []);
  useEffect(() => {
    if (!menu) return undefined;
    const k = (e) => e.key === 'Escape' && close();
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  });
  useEffect(() => {
    // place the menu below the pressed element when there's room, otherwise above it
    if (!menu || !panelRef.current) return;
    const r = menu.rect || { top: window.innerHeight / 2, bottom: window.innerHeight / 2, left: 16, right: window.innerWidth - 16 };
    const h = panelRef.current.offsetHeight, w = panelRef.current.offsetWidth;
    const vh = window.visualViewport?.height || window.innerHeight, vw = window.innerWidth;
    let top = r.bottom + 8;
    if (top + h > vh - 12) top = Math.max(12, r.top - h - 8);
    if (top + h > vh - 12) top = Math.max(12, vh - h - 12);
    const left = Math.min(Math.max(12, (r.left + r.right) / 2 - w / 2), vw - w - 12);
    setPos({ top, left, origin: top < r.top ? 'bottom' : 'top' });
  }, [menu]);
  // the finger lifting at the end of the long press must not dismiss the menu it just opened
  const close = (fromBackdrop) => { if (leaving || (fromBackdrop === true && Date.now() - openedAt.current < 450)) return; setLeaving(true); setTimeout(() => { setMenu(null); setLeaving(false); }, 160); };
  if (!menu) return null;
  return createPortal(
    <div className={'ctx-bg' + (leaving ? ' leaving' : '')} onMouseDown={(e) => e.target === e.currentTarget && close(true)} onTouchStart={(e) => e.target === e.currentTarget && close(true)}>
      <div ref={panelRef} className="ctx-menu" role="menu" aria-label={menu.title || ''}
        style={pos ? { top: pos.top, left: pos.left, transformOrigin: pos.origin + ' center' } : { visibility: 'hidden' }}>
        {menu.title && <div className="ctx-title">{menu.title}</div>}
        {menu.items.filter(Boolean).map((it) => (
          <button key={it.label} type="button" role="menuitem" className={'ctx-item' + (it.danger ? ' danger' : '')} disabled={it.disabled}
            onClick={() => { close(); setTimeout(it.onClick, 0); }}>
            <span className="grow">{it.label}</span>{it.icon && <it.icon size={18} />}
          </button>
        ))}
      </div>
    </div>,
    document.body,
  );
}

// Long-press handlers for any element (touch: ~450 ms still; mouse: right click).
export function useLongPress(cb, ms = 450) {
  const st = useRef(null);
  const fired = useRef(0);
  const cancel = () => { if (st.current) { clearTimeout(st.current.t); st.current = null; } };
  return {
    onTouchStart: (e) => {
      if (e.touches.length !== 1) return;
      const p = e.touches[0], el = e.currentTarget;
      st.current = { x: p.clientX, y: p.clientY, t: setTimeout(() => { st.current = null; fired.current = Date.now(); window.getSelection?.()?.removeAllRanges(); cb(el.getBoundingClientRect(), el); }, ms) };
    },
    onTouchMove: (e) => { const s = st.current; if (!s) return; const p = e.touches[0]; if (Math.abs(p.clientX - s.x) > 8 || Math.abs(p.clientY - s.y) > 8) cancel(); },
    onTouchEnd: cancel,
    onTouchCancel: cancel,
    onContextMenu: (e) => { if (e.target.closest?.('a, input, textarea')) return; e.preventDefault(); cancel(); fired.current = Date.now(); cb(e.currentTarget.getBoundingClientRect(), e.currentTarget); },
    // the tap that ends a long press must not also act as a click
    onClickCapture: (e) => { if (Date.now() - fired.current < 600) { e.preventDefault(); e.stopPropagation(); } },
  };
}

// A <button> that also opens a context menu on long press.
export function LongPressButton({ onLongPress, children, ...props }) {
  const lp = useLongPress((rect, el) => onLongPress(rect, el));
  return <button type="button" {...props} {...lp}>{children}</button>;
}

// Disclosure row: a chevron that rotates and content that slides open (replaces <details>).
// `open` is the initial state and re-opens it when it turns true (e.g. a delegation starts running).
export function Disclosure({ summary, children, open: openProp = false, className = '', summaryClassName = '' }) {
  const [open, setOpen] = useState(Boolean(openProp));
  useEffect(() => { if (openProp) setOpen(true); }, [openProp]);
  return (
    <div className={'disc ' + className + (open ? ' open' : '')}>
      <button type="button" className={'disc-sum ' + summaryClassName} aria-expanded={open} onClick={() => { haptic(6); setOpen((o) => !o); }}>
        <ChevronRight size={15} className="disc-chev" aria-hidden />
        <span className="disc-label">{summary}</span>
      </button>
      <div className="disc-body" aria-hidden={!open}>
        <div className="disc-inner">{children}</div>
      </div>
    </div>
  );
}

// ---------- pull to refresh ----------
// Drag down while the screen is at the top: the content follows with resistance, a spinner appears,
// and past the threshold releasing revalidates every useLoad on screen (refreshAll), with a haptic tick.
export function PullToRefresh({ enabled, onRefresh }) {
  const t = useT();
  const [state, setState] = useState({ y: 0, phase: 'idle' }); // idle | pull | ready | loading | done
  const ref = useRef(state);
  ref.current = state;
  useEffect(() => {
    const main = document.querySelector('main.main');
    if (!main || !enabled) return undefined;
    const TH = 72;
    let s = null;
    const set = (v) => { ref.current = v; setState(v); };
    let off;
    const paint = (y) => {
      clearTimeout(off);
      main.style.setProperty('--ptr', y + 'px');
      if (y > 0) main.classList.add('ptr-on'); else off = setTimeout(() => main.classList.remove('ptr-on'), 420);
    };
    const start = (e) => {
      if (e.touches.length !== 1 || main.scrollTop > 0 || ref.current.phase === 'loading') { s = null; return; }
      if (e.target.closest?.('.sheet-bg, .modal-bg, .ctx-bg, .nrow-wrap.swiping, input, textarea, select')) { s = null; return; }
      s = { y0: e.touches[0].clientY, x0: e.touches[0].clientX, active: false, ready: false };
    };
    const move = (e) => {
      if (!s) return;
      const dy = e.touches[0].clientY - s.y0, dx = e.touches[0].clientX - s.x0;
      if (!s.active) {
        if (dy < 8 || Math.abs(dx) > dy || main.scrollTop > 0) { if (dy < -4 || Math.abs(dx) > 10) s = null; return; }
        s.active = true; s.y0 = e.touches[0].clientY; main.classList.add('ptr-dragging');
      }
      if (e.cancelable) e.preventDefault();
      const y = Math.max(0, e.touches[0].clientY - s.y0);
      const eased = Math.min(140, y * 0.5 + Math.sqrt(y) * 2); // rubber band
      const ready = eased >= TH;
      if (ready !== s.ready) { s.ready = ready; if (ready) haptic(10); }
      paint(eased);
      set({ y: eased, phase: ready ? 'ready' : 'pull' });
    };
    const end = async () => {
      if (!s) return;
      const g = s; s = null;
      main.classList.remove('ptr-dragging');
      if (!g.active) return;
      if (!g.ready) { paint(0); set({ y: 0, phase: 'idle' }); return; }
      paint(56); set({ y: 56, phase: 'loading' });
      const t0 = Date.now();
      try { await onRefresh(); } finally {
        await new Promise((r) => setTimeout(r, Math.max(0, 600 - (Date.now() - t0))));
        haptic(6); paint(0); set({ y: 0, phase: 'idle' });
      }
    };
    main.addEventListener('touchstart', start, { passive: true });
    main.addEventListener('touchmove', move, { passive: false });
    main.addEventListener('touchend', end);
    main.addEventListener('touchcancel', end);
    return () => {
      main.removeEventListener('touchstart', start); main.removeEventListener('touchmove', move);
      main.removeEventListener('touchend', end); main.removeEventListener('touchcancel', end);
      clearTimeout(off); main.style.removeProperty('--ptr'); main.classList.remove('ptr-dragging', 'ptr-on');
    };
  }, [enabled, onRefresh]);
  if (!enabled || state.phase === 'idle') return null;
  const p = Math.min(1, state.y / 72);
  return (
    <div className={'ptr ptr-' + state.phase} aria-live="polite" aria-label={state.phase === 'loading' ? t('ptr.loading') : state.phase === 'ready' ? t('ptr.release') : t('ptr.pull')}>
      <span className="ptr-spinner" style={{ opacity: p, transform: state.phase === 'loading' ? undefined : `rotate(${p * 270}deg) scale(${0.6 + p * 0.4})` }} />
    </div>
  );
}
