import { useState } from 'react';
import { LogIn } from 'lucide-react';
import { api } from '../api.js';
import { useT } from '../i18n.jsx';
import { Btn } from '../ui.jsx';

export default function Login({ onLogin, extras }) {
  const t = useT();
  const [pwd, setPwd] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async (e) => {
    e.preventDefault();
    setBusy(true); setErr('');
    try { await api('POST', '/login', { password: pwd }); onLogin(); }
    catch (x) { setErr(x.message); }
    finally { setBusy(false); }
  };
  return (
    <div className="login">
      <form className="card login-box" onSubmit={submit}>
        <div className="brand big"><img src="/icon.svg" alt="" width="30" height="30" />Agent Control</div>
        <p className="muted">{t('login.subtitle')}</p>
        <input type="password" autoFocus autoComplete="current-password" placeholder={t('login.password')} value={pwd} onChange={(e) => setPwd(e.target.value)} />
        <Btn icon={LogIn} disabled={busy || !pwd}>{busy ? t('login.busy') : t('login.submit')}</Btn>
        {err && <p className="err">{err}</p>}
        {extras}
      </form>
    </div>
  );
}
