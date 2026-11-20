import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { AlertTriangle, CheckCircle2, X } from 'lucide-react';
import { store, useI18n, useT } from './i18n.jsx';

// ---------- theme: system | light | dark | terminal ----------
const ThemeCtx = createContext(null);
export function ThemeProvider({ children }) {
  const [theme, setThemeState] = useState(() => store.get('acp_theme') || (store.get('acp_chat_style') === 'terminal' ? 'terminal' : 'system'));
  useEffect(() => {
    const root = document.documentElement;
    if (theme === 'system') root.removeAttribute('data-theme'); else root.setAttribute('data-theme', theme);
    const apply = () => {
      const dark = theme === 'dark' || (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
      const color = theme === 'terminal' ? '#141413' : dark ? '#000000' : '#f2f2f7';
      document.querySelectorAll('meta[name="theme-color"]').forEach((m) => { m.setAttribute('content', color); m.removeAttribute('media'); });
    };
    apply();
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  }, [theme]);
  const setTheme = useCallback((t) => { store.set('acp_theme', t); setThemeState(t); }, []);
  return <ThemeCtx.Provider value={{ theme, setTheme }}>{children}</ThemeCtx.Provider>;
}
export const useTheme = () => useContext(ThemeCtx);

// ---------- toasts ----------
const ToastCtx = createContext(() => {});
export const useToast = () => useContext(ToastCtx);
export function ToastProvider({ children }) {
  const [items, setItems] = useState([]);
  const push = useCallback((text, kind = 'ok') => {
    const id = Math.random();
    setItems((x) => [...x, { id, text, kind }]);
    setTimeout(() => setItems((x) => x.filter((t) => t.id !== id)), kind === 'err' ? 7000 : 3500);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {items.map((t) => (
          <div key={t.id} className={'toast ' + t.kind}>
            {t.kind === 'err' ? <AlertTriangle size={16} /> : <CheckCircle2 size={16} />}<span>{t.text}</span>
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

// ---------- data loading ----------
export function useLoad(fn, deps = [], { interval } = {}) {
  const [state, setState] = useState({ data: null, error: null, loading: true });
  const fnRef = useRef(fn);
  fnRef.current = fn;
  const reload = useCallback(async (quiet) => {
    if (!quiet) setState((s) => ({ ...s, loading: true }));
    try { const data = await fnRef.current(); setState({ data, error: null, loading: false }); }
    catch (e) { setState((s) => ({ ...s, error: e.message, loading: false })); }
  }, []);
  useEffect(() => { reload(); }, deps); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!interval) return undefined;
    const t = setInterval(() => { if (!document.hidden) reload(true); }, interval);
    return () => clearInterval(t);
  }, [interval, reload]);
  return { ...state, reload };
}

// Runs an async action with a busy flag and a toast for the outcome.
export function useAction() {
  const toast = useToast();
  const [busy, setBusy] = useState(null);
  const run = useCallback(async (key, fn, okText) => {
    setBusy(key);
    try { const r = await fn(); if (okText) toast(okText); return r; }
    catch (e) { toast(e.message, 'err'); return undefined; }
    finally { setBusy(null); }
  }, [toast]);
  return [busy, run];
}

// ---------- small components ----------
export const Card = ({ title, icon: Icon, actions, children, className = '' }) => (
  <section className={'card ' + className}>
    {(title || actions) && (
      <header className="card-h">
        <h3>{Icon && <Icon size={16} className="h-ic" />}{title}</h3>
        <div className="row wrap">{actions}</div>
      </header>
    )}
    {children}
  </section>
);

export const Badge = ({ kind = 'muted', children }) => <span className={'badge ' + kind}>{children}</span>;

export function ErrorBox({ error, onRetry }) {
  const t = useT();
  if (!error) return null;
  return <div className="errbox"><AlertTriangle size={16} /><span>{error}</span>{onRetry && <button className="link" onClick={onRetry}>{t('common.retry')}</button>}</div>;
}

// ---------- swipe-to-dismiss for bottom sheets (iOS-like) ----------
// Mobile only. Drag from the grabber/header always moves the sheet; drag from the content
// only when it is scrolled to the top (a scroll that reaches the top hands off to the drag,
// like UIKit). Release past ~25% of the height or with a downward flick dismisses; otherwise
// it springs back. Closing by button / backdrop / Esc also slides down.
const MOBILE_Q = '(max-width: 820px)';
const isMobile = () => typeof window !== 'undefined' && window.matchMedia(MOBILE_Q).matches;
const reduceMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const SCRIM = 0.35;

function useSwipeDismiss(onClose, bodySel) {
  const bgRef = useRef(null);
  const panelRef = useRef(null);
  const closing = useRef(false);
  const cb = useRef(onClose);
  cb.current = onClose;

  const animateOut = useCallback((velocity = 0) => {
    if (closing.current) return;
    closing.current = true;
    const panel = panelRef.current, bg = bgRef.current;
    if (!panel || !bg || !isMobile() || reduceMotion()) { cb.current(); return; }
    const h = panel.getBoundingClientRect().height + 40;
    const cur = new DOMMatrixReadOnly(getComputedStyle(panel).transform).m42 || 0;
    const ms = Math.max(160, Math.min(320, velocity > 0 ? (h - cur) / velocity : 300));
    panel.style.animation = 'none';
    panel.style.transform = `translateY(${cur}px)`;
    void panel.offsetHeight;
    panel.style.transition = `transform ${ms}ms cubic-bezier(.32, .72, 0, 1)`;
    panel.style.transform = `translateY(${h}px)`;
    bg.style.animation = 'none';
    bg.style.transition = `background-color ${ms}ms linear`;
    bg.style.backgroundColor = 'rgba(0,0,0,0)';
    setTimeout(() => cb.current(), ms);
  }, []);

  useEffect(() => {
    const panel = panelRef.current, bg = bgRef.current;
    if (!panel || !bg) return;
    let s = null; // gesture state

    const start = (e) => {
      if (closing.current || e.touches.length !== 1 || !isMobile()) return;
      if (e.target.closest('input[type="range"], [data-no-swipe]')) return;
      const t = e.touches[0];
      const body = bodySel ? panel.querySelector(bodySel) : null;
      s = { x0: t.clientX, y0: t.clientY, dragging: false, locked: false,
        scroller: bodySel ? (body && body.contains(e.target) ? body : null) : panel,
        h: panel.getBoundingClientRect().height, samples: [[t.clientY, e.timeStamp]] };
    };
    const move = (e) => {
      if (!s) return;
      const t = e.touches[0];
      const dx = t.clientX - s.x0, dy = t.clientY - s.y0;
      if (!s.dragging) {
        if (s.locked) return;
        if (Math.abs(dx) < 6 && Math.abs(dy) < 6) return;
        if (Math.abs(dx) > Math.abs(dy)) { s.locked = true; return; } // horizontal: leave it alone
        const atTop = !s.scroller || s.scroller.scrollTop <= 0;
        if (dy > 0 && atTop) {
          s.dragging = true; s.y0 = t.clientY; // start from here so the sheet doesn't jump
          panel.style.animation = 'none'; bg.style.animation = 'none';
          panel.style.transition = 'none'; bg.style.transition = 'none';
          panel.classList.add('dragging');
        } else if (!s.scroller && dy < 0) {
          s.dragging = true; s.y0 = t.clientY;
          panel.style.animation = 'none'; panel.style.transition = 'none';
        } else {
          // content is scrolling; if it hits the top while the finger goes down, hand off to the drag
          if (s.scroller && s.scroller.scrollTop <= 0 && dy > 0) { s.y0 = t.clientY; }
          return;
        }
      }
      if (e.cancelable) e.preventDefault();
      let y = t.clientY - s.y0;
      if (y < 0) y = -Math.pow(-y, 0.6); // rubber band upwards
      panel.style.transform = `translateY(${y}px)`;
      const p = Math.max(0, Math.min(1, y / Math.min(s.h, window.innerHeight)));
      bg.style.backgroundColor = `rgba(0,0,0,${SCRIM * (1 - p)})`;
      s.y = y;
      s.samples.push([t.clientY, e.timeStamp]);
      if (s.samples.length > 6) s.samples.shift();
    };
    const end = (e) => {
      if (!s) return;
      const g = s; s = null;
      if (!g.dragging) return;
      panel.classList.remove('dragging');
      // flick velocity over the last ~100ms of movement; a pause before lifting the finger means no flick
      const [yl, tl] = g.samples[g.samples.length - 1];
      const recent = g.samples.filter(([, ts]) => tl - ts <= 100);
      const [y1, t1] = recent[0];
      const v = e.timeStamp - tl < 150 && tl > t1 ? (yl - y1) / (tl - t1) : 0; // px/ms, + = down
      const y = g.y || 0;
      const h = Math.min(g.h, window.innerHeight);
      if (y > 0 && (y > h * 0.25 || v > 0.5) && v > -0.2) { animateOut(Math.max(v, 1)); return; }
      panel.style.transition = 'transform 420ms cubic-bezier(.22, 1.2, .36, 1)';
      panel.style.transform = 'translateY(0)';
      bg.style.transition = 'background-color 300ms ease-out';
      bg.style.backgroundColor = `rgba(0,0,0,${SCRIM})`;
    };

    panel.addEventListener('touchstart', start, { passive: true });
    panel.addEventListener('touchmove', move, { passive: false });
    panel.addEventListener('touchend', end);
    panel.addEventListener('touchcancel', end);
    // swiping on the dimmed backdrop shouldn't scroll the page behind
    const block = (e) => { if (e.target === bg && e.cancelable) e.preventDefault(); };
    bg.addEventListener('touchmove', block, { passive: false });
    return () => {
      panel.removeEventListener('touchstart', start); panel.removeEventListener('touchmove', move);
      panel.removeEventListener('touchend', end); panel.removeEventListener('touchcancel', end);
      bg.removeEventListener('touchmove', block);
    };
  }, [animateOut, bodySel]);

  return { bgRef, panelRef, close: animateOut };
}

export function Modal({ title, onClose, children, wide }) {
  const t = useT();
  const { bgRef, panelRef, close } = useSwipeDismiss(onClose);
  useEffect(() => {
    const k = (e) => e.key === 'Escape' && close();
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [close]);
  return (
    <div ref={bgRef} className="modal-bg" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div ref={panelRef} className={'modal' + (wide ? ' wide' : '')} role="dialog" aria-modal="true" aria-label={title}>
        <header className="card-h"><h3>{title}</h3><IconButton icon={X} label={t('common.close')} onClick={close} /></header>
        {children}
      </div>
    </div>
  );
}

export const IconButton = ({ icon: Icon, label, className = 'ghost', size = 16, ...p }) => (
  <button type="button" className={className + ' icon'} aria-label={label} title={label} {...p}><Icon size={size} /></button>
);

// Button with a leading icon.
export const Btn = ({ icon: Icon, children, className = '', ...p }) => (
  <button className={className + (Icon ? ' has-ic' : '')} {...p}>{Icon && <Icon size={15} />}{children && <span>{children}</span>}</button>
);

export const Field = ({ label, hint, children }) => (
  <label className="field"><span>{label}</span>{children}{hint && <small>{hint}</small>}</label>
);

// ---------- formatting (locale-aware) ----------
export function useFmt() {
  const { lang } = useI18n();
  return {
    dur: (ms) => (!ms ? '0 s' : ms >= 60000 ? (ms / 60000).toFixed(1).replace(/[.,]0$/, '') + ' min' : Math.round(ms / 1000) + ' s'),
    date: (iso) => (iso ? new Date(iso).toLocaleString(lang, { dateStyle: 'short', timeStyle: 'short' }) : ''),
    ago: (t) => {
      if (!t) return '';
      const s = Math.round((Date.now() - new Date(t).getTime()) / 1000);
      if (s < 60) return s + ' s';
      if (s < 3600) return Math.round(s / 60) + ' min';
      if (s < 86400) return Math.round(s / 3600) + ' h';
      return Math.round(s / 86400) + ' d';
    },
    usd: (n) => new Intl.NumberFormat(lang, { style: 'currency', currency: 'USD', minimumFractionDigits: n >= 1 ? 2 : 4, maximumFractionDigits: n >= 1 ? 2 : 4 }).format(n || 0),
  };
}

export function confirmAsk(text) { return window.confirm(text); }

const ConfirmCtx = createContext(() => Promise.resolve(false));
export const useConfirm = () => useContext(ConfirmCtx);
export function ConfirmProvider({ children }) {
  const t = useT();
  const [req, setReq] = useState(null);
  const ask = useCallback((text, opts = {}) => new Promise((resolve) => {
    setReq({ text, danger: opts.danger !== false, resolve });
  }), []);
  const close = (ok) => {
    req?.resolve(ok);
    setReq(null);
  };
  return (
    <ConfirmCtx.Provider value={ask}>
      {children}
      {req && (
        <Modal title={t('common.confirm')} onClose={() => close(false)}>
          <div className="stack">
            <p>{req.text}</p>
            <div className="row end">
              <button type="button" className="ghost" onClick={() => close(false)}>{t('common.cancel')}</button>
              <button type="button" autoFocus className={req.danger ? 'danger' : ''} onClick={() => close(true)}>{t('common.confirm')}</button>
            </div>
          </div>
        </Modal>
      )}
    </ConfirmCtx.Provider>
  );
}

// iOS-style page sheet: slides up from the bottom on phones, centered card on desktop.
export function Sheet({ title, onClose, children }) {
  const t = useT();
  const { bgRef, panelRef, close } = useSwipeDismiss(onClose, '.sheet-body');
  useEffect(() => {
    const k = (e) => e.key === 'Escape' && close();
    window.addEventListener('keydown', k);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { window.removeEventListener('keydown', k); document.body.style.overflow = prev; };
  }, [close]);
  return (
    <div ref={bgRef} className="sheet-bg" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div ref={panelRef} className="sheet" role="dialog" aria-modal="true" aria-label={title}>
        <div className="sheet-grab" aria-hidden />
        <header className="sheet-h">
          <h2>{title}</h2>
          <button type="button" className="sheet-close press" aria-label={t('common.close')} onClick={close}><X size={17} /></button>
        </header>
        <div className="sheet-body">{children}</div>
      </div>
    </div>
  );
}
