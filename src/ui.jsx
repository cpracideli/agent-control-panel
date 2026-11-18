import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';

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
      <div className="toasts">{items.map((t) => <div key={t.id} className={'toast ' + t.kind}>{t.text}</div>)}</div>
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
export const Card = ({ title, actions, children, className = '' }) => (
  <section className={'card ' + className}>
    {(title || actions) && <header className="card-h"><h3>{title}</h3><div className="row">{actions}</div></header>}
    {children}
  </section>
);

export const Badge = ({ kind = 'muted', children }) => <span className={'badge ' + kind}>{children}</span>;

export const Empty = ({ children }) => <div className="empty">{children}</div>;

export function ErrorBox({ error, onRetry }) {
  if (!error) return null;
  return <div className="errbox">{error}{onRetry && <button className="link" onClick={onRetry}>tentar de novo</button>}</div>;
}

export function Modal({ title, onClose, children, wide }) {
  useEffect(() => {
    const k = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [onClose]);
  return (
    <div className="modal-bg" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={'modal' + (wide ? ' wide' : '')} role="dialog" aria-label={title}>
        <header className="card-h"><h3>{title}</h3><button className="ghost icon" onClick={onClose} aria-label="Fechar">✕</button></header>
        {children}
      </div>
    </div>
  );
}

export const Field = ({ label, hint, children }) => (
  <label className="field"><span>{label}</span>{children}{hint && <small>{hint}</small>}</label>
);

export const fmtDur = (ms) => (!ms ? '0 s' : ms >= 60000 ? (ms / 60000).toFixed(1).replace('.0', '') + ' min' : Math.round(ms / 1000) + ' s');
export const fmtDate = (iso) => (iso ? new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : '');
export const fmtAgo = (t) => {
  if (!t) return '';
  const s = Math.round((Date.now() - new Date(t).getTime()) / 1000);
  if (s < 60) return s + ' s';
  if (s < 3600) return Math.round(s / 60) + ' min';
  if (s < 86400) return Math.round(s / 3600) + ' h';
  return Math.round(s / 86400) + ' d';
};
export const usd = (n) => 'US$ ' + (n || 0).toFixed(n >= 1 ? 2 : 4);

export function confirmAsk(text) { return window.confirm(text); }
