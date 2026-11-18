import { useState } from 'react';
import { AlertCircle, KeyRound, LogIn, ShieldCheck } from 'lucide-react';
import { api } from '../api.js';
import { useT } from '../i18n.jsx';

const GoogleG = () => (
  <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden>
    <path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9.1 3.6l6.8-6.8C35.8 2.4 30.3 0 24 0 14.6 0 6.6 5.4 2.7 13.2l7.9 6.2C12.5 13.6 17.8 9.5 24 9.5z" />
    <path fill="#4285F4" d="M46.1 24.6c0-1.6-.1-3.1-.4-4.6H24v9h12.4c-.5 2.9-2.2 5.3-4.6 6.9l7.4 5.8c4.3-4 6.9-9.9 6.9-17.1z" />
    <path fill="#FBBC05" d="M10.6 28.6c-.5-1.4-.8-3-.8-4.6s.3-3.2.8-4.6l-7.9-6.2C1 16.6 0 20.2 0 24s1 7.4 2.7 10.8l7.9-6.2z" />
    <path fill="#34A853" d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.4-5.8c-2.1 1.4-4.8 2.3-8.5 2.3-6.2 0-11.5-4.1-13.4-9.9l-7.9 6.2C6.6 42.6 14.6 48 24 48z" />
  </svg>
);

export default function Login({ onLogin, extras, config = {}, initialError }) {
  const t = useT();
  const [pwd, setPwd] = useState('');
  const [err, setErr] = useState(initialError || '');
  const [busy, setBusy] = useState(false);
  const google = config.google;
  const [showPwd, setShowPwd] = useState(!google);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true); setErr('');
    try { await api('POST', '/login', { password: pwd }); onLogin(); }
    catch (x) { setErr(x.message); }
    finally { setBusy(false); }
  };

  return (
    <div className="login">
      <div className="bloom bloom-a" aria-hidden />
      <div className="bloom bloom-b" aria-hidden />
      <div className="login-tools">{extras}</div>
      <form className="login-box glass-bar" onSubmit={submit}>
        <div className="login-head">
          <img src="/pwa-192.png" alt="" width="64" height="64" className="app-icon" />
          <h1 className="large-title">Agent Control</h1>
          <p className="muted">{t('login.subtitle')}</p>
        </div>

        {err && (
          <div className="login-err" role="alert">
            <AlertCircle size={16} />
            <div><b>{t('login.failed')}</b><span>{err}</span></div>
          </div>
        )}

        {google && (
          <a className="pill google press" href="/api/auth/google" onClick={() => setBusy(true)}>
            <GoogleG /><span>{busy && !showPwd ? t('login.busy') : t('login.google')}</span>
          </a>
        )}

        {google && config.password && !showPwd && (
          <button type="button" className="pill plain press" onClick={() => setShowPwd(true)}>
            <KeyRound size={16} />{t('login.usePassword')}
          </button>
        )}

        {showPwd && config.password !== false && (
          <>
            {google && <div className="divider"><span>{t('login.or')}</span></div>}
            <input type="password" autoFocus={!google} autoComplete="current-password" placeholder={t('login.password')} value={pwd} onChange={(e) => setPwd(e.target.value)} />
            <button className="pill primary press" disabled={busy || !pwd}><LogIn size={16} />{busy ? t('login.busy') : t('login.submit')}</button>
          </>
        )}

        {google && (
          <div className="login-note">
            <b><ShieldCheck size={15} />{t('login.private')}</b>
            <span>{t('login.privateText')}</span>
          </div>
        )}
      </form>
    </div>
  );
}
