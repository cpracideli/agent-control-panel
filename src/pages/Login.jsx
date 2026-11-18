import { useState } from 'react';
import { api } from '../api.js';

export default function Login({ onLogin }) {
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
        <div className="brand big"><span className="dot" />Agent Control</div>
        <p className="muted">Chat, MCP, providers e controle do agente.</p>
        <input type="password" autoFocus placeholder="Senha de acesso" value={pwd} onChange={(e) => setPwd(e.target.value)} />
        <button disabled={busy || !pwd}>{busy ? 'Entrando…' : 'Entrar'}</button>
        {err && <p className="err">{err}</p>}
      </form>
    </div>
  );
}
