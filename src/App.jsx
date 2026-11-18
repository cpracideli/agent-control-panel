import { useEffect, useState } from 'react';
import { api, setUnauthorizedHandler } from './api.js';
import Login from './pages/Login.jsx';
import Chat from './pages/Chat.jsx';
import Overview from './pages/Overview.jsx';
import Providers from './pages/Providers.jsx';
import Mcp from './pages/Mcp.jsx';
import Schedules from './pages/Schedules.jsx';
import Envs from './pages/Envs.jsx';
import Logs from './pages/Logs.jsx';

const PAGES = [
  { id: 'chat', label: 'Chat', icon: '💬', el: Chat },
  { id: 'overview', label: 'Painel', icon: '📊', el: Overview },
  { id: 'providers', label: 'Providers', icon: '🧠', el: Providers },
  { id: 'mcp', label: 'MCP', icon: '🔌', el: Mcp },
  { id: 'schedules', label: 'Agendamentos', icon: '⏰', el: Schedules },
  { id: 'envs', label: 'Variáveis', icon: '🔑', el: Envs },
  { id: 'logs', label: 'Logs', icon: '📜', el: Logs },
];

const pageFromHash = () => {
  const h = window.location.hash.replace('#/', '').split('/')[0];
  return PAGES.some((p) => p.id === h) ? h : 'chat';
};

export default function App() {
  const [authed, setAuthed] = useState(null);
  const [page, setPage] = useState(pageFromHash);
  const [menu, setMenu] = useState(false);

  useEffect(() => {
    setUnauthorizedHandler(() => setAuthed(false));
    api('GET', '/me').then((r) => setAuthed(r.ok)).catch(() => setAuthed(false));
    const onHash = () => setPage(pageFromHash());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  if (authed === null) return <div className="boot">Carregando…</div>;
  if (!authed) return <Login onLogin={() => setAuthed(true)} />;

  const Page = PAGES.find((p) => p.id === page).el;
  const go = (id) => { window.location.hash = '#/' + id; setMenu(false); };
  const logout = async () => { await api('POST', '/logout').catch(() => {}); setAuthed(false); };

  return (
    <div className={'shell' + (menu ? ' menu-open' : '')}>
      <aside className="nav">
        <div className="brand"><span className="dot" />Agent Control</div>
        <nav>
          {PAGES.map((p) => (
            <button key={p.id} className={'nav-item' + (p.id === page ? ' active' : '')} onClick={() => go(p.id)}>
              <span className="nav-ic" aria-hidden>{p.icon}</span>{p.label}
            </button>
          ))}
        </nav>
        <button className="nav-item logout" onClick={logout}><span className="nav-ic" aria-hidden>↩</span>Sair</button>
      </aside>
      <div className="nav-scrim" onClick={() => setMenu(false)} />
      <main className={'main' + (page === 'chat' ? ' main-chat' : '')}>
        <div className="topbar">
          <button className="ghost icon" onClick={() => setMenu(true)} aria-label="Menu">☰</button>
          <strong>{PAGES.find((p) => p.id === page).label}</strong>
        </div>
        <Page />
      </main>
    </div>
  );
}
