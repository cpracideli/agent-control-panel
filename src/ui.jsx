import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { AlertTriangle, CheckCircle2, X } from 'lucide-react';
import { store, useI18n, useT } from './i18n.jsx';

// ---------- theme: system | light | dark ----------
const ThemeCtx = createContext(null);
export function ThemeProvider({ children }) {
  const [theme, setThemeState] = useState(() => store.get('acp_theme') || 'system');
  useEffect(() => {
    const root = document.documentElement;
    if (theme === 'system') root.removeAttribute('data-theme'); else root.setAttribute('data-theme', theme);
    const apply = () => {
      const dark = theme === 'dark' || (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
      document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? '#0b0f17' : '#f6f7fb');
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

export function Modal({ title, onClose, children, wide }) {
  const t = useT();
  useEffect(() => {
    const k = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [onClose]);
  return (
    <div className="modal-bg" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={'modal' + (wide ? ' wide' : '')} role="dialog" aria-modal="true" aria-label={title}>
        <header className="card-h"><h3>{title}</h3><IconButton icon={X} label={t('common.close')} onClick={onClose} /></header>
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
