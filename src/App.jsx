import { useEffect, useState } from 'react';
import { CalendarClock, Download, Gauge, KeyRound, Languages, LogOut, MessageSquare, Monitor, Moon, Plug, RefreshCw, ScrollText, Sparkles, Sun, WifiOff } from 'lucide-react';
import { useRegisterSW } from 'virtual:pwa-register/react';
import { api, setUnauthorizedHandler } from './api.js';
import { LANGS, useI18n } from './i18n.jsx';
import { IconButton, useTheme } from './ui.jsx';
import Login from './pages/Login.jsx';
import Chat from './pages/Chat.jsx';
import Overview from './pages/Overview.jsx';
import Providers from './pages/Providers.jsx';
import Mcp from './pages/Mcp.jsx';
import Schedules from './pages/Schedules.jsx';
import Envs from './pages/Envs.jsx';
import Logs from './pages/Logs.jsx';

const PAGES = [
  { id: 'chat', icon: MessageSquare, el: Chat },
  { id: 'overview', icon: Gauge, el: Overview },
  { id: 'providers', icon: Sparkles, el: Providers },
  { id: 'mcp', icon: Plug, el: Mcp },
  { id: 'schedules', icon: CalendarClock, el: Schedules },
  { id: 'envs', icon: KeyRound, el: Envs },
  { id: 'logs', icon: ScrollText, el: Logs },
];

const pageFromHash = () => {
  const h = window.location.hash.replace('#/', '').split('/')[0];
  return PAGES.some((p) => p.id === h) ? h : 'chat';
};

const THEMES = [{ id: 'system', icon: Monitor }, { id: 'light', icon: Sun }, { id: 'dark', icon: Moon }];

function ThemeSwitch({ compact }) {
  const { theme, setTheme } = useTheme();
  const { t } = useI18n();
  if (compact) {
    const i = THEMES.findIndex((x) => x.id === theme);
    const next = THEMES[(i + 1) % THEMES.length];
    const Icon = THEMES[i].icon;
    return <IconButton icon={Icon} label={t('theme.label') + ': ' + t('theme.' + theme)} onClick={() => setTheme(next.id)} />;
  }
  return (
    <div className="seg" role="radiogroup" aria-label={t('theme.label')}>
      {THEMES.map(({ id, icon: Icon }) => (
        <button key={id} type="button" role="radio" aria-checked={theme === id} className={theme === id ? 'on' : ''} title={t('theme.' + id)} onClick={() => setTheme(id)}>
          <Icon size={15} />
        </button>
      ))}
    </div>
  );
}

function LangSelect({ compact }) {
  const { lang, setLang, t } = useI18n();
  return (
    <label className={'lang' + (compact ? ' compact' : '')} title={t('lang.label')}>
      <Languages size={15} />
      <select value={lang} onChange={(e) => setLang(e.target.value)} aria-label={t('lang.label')}>
        {LANGS.map((l) => <option key={l.id} value={l.id}>{compact ? l.id.slice(0, 2).toUpperCase() : l.label}</option>)}
      </select>
    </label>
  );
}

// "Install app" button: shown when the browser offers it (Chrome/Edge/Android). iOS installs from the share menu.
function useInstall() {
  const [evt, setEvt] = useState(null);
  useEffect(() => {
    const on = (e) => { e.preventDefault(); setEvt(e); };
    window.addEventListener('beforeinstallprompt', on);
    window.addEventListener('appinstalled', () => setEvt(null));
    return () => window.removeEventListener('beforeinstallprompt', on);
  }, []);
  return evt ? async () => { evt.prompt(); await evt.userChoice; setEvt(null); } : null;
}

function useOnline() {
  const [on, setOn] = useState(navigator.onLine);
  useEffect(() => {
    const up = () => setOn(true), down = () => setOn(false);
    window.addEventListener('online', up); window.addEventListener('offline', down);
    return () => { window.removeEventListener('online', up); window.removeEventListener('offline', down); };
  }, []);
  return on;
}

export default function App() {
  const { t } = useI18n();
  const [authed, setAuthed] = useState(null);
  const [page, setPage] = useState(pageFromHash);
  const install = useInstall();
  const online = useOnline();
  const { needRefresh: [needRefresh], updateServiceWorker } = useRegisterSW();

  useEffect(() => {
    setUnauthorizedHandler(() => setAuthed(false));
    api('GET', '/me').then((r) => setAuthed(r.ok)).catch(() => setAuthed(false));
    const onHash = () => setPage(pageFromHash());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  const banners = (
    <>
      {!online && <div className="banner warn"><WifiOff size={15} />{t('pwa.offline')}</div>}
      {needRefresh && <div className="banner"><RefreshCw size={15} />{t('pwa.update')}<button className="small" onClick={() => updateServiceWorker(true)}>{t('pwa.reload')}</button></div>}
    </>
  );

  if (authed === null) return <div className="boot">{t('app.loading')}</div>;
  if (!authed) return <>{banners}<Login onLogin={() => setAuthed(true)} extras={<div className="row center"><ThemeSwitch /><LangSelect /></div>} /></>;

  const Page = PAGES.find((p) => p.id === page).el;
  const go = (id) => { window.location.hash = '#/' + id; };
  const logout = async () => { await api('POST', '/logout').catch(() => {}); setAuthed(false); };

  return (
    <div className="shell">
      <aside className="nav">
        <div className="brand"><img src="/icon.svg" alt="" width="22" height="22" />Agent Control</div>
        <nav>
          {PAGES.map(({ id, icon: Icon }) => (
            <button key={id} className={'nav-item' + (id === page ? ' active' : '')} onClick={() => go(id)} aria-current={id === page ? 'page' : undefined}>
              <Icon size={17} />{t('nav.' + id)}
            </button>
          ))}
        </nav>
        <div className="nav-foot">
          {install && <button className="nav-item" onClick={install}><Download size={17} />{t('pwa.install')}</button>}
          <div className="row between"><ThemeSwitch /><LangSelect compact /></div>
          <button className="nav-item" onClick={logout}><LogOut size={17} />{t('nav.logout')}</button>
        </div>
      </aside>

      <main className={'main' + (page === 'chat' ? ' main-chat' : '')}>
        <div className="topbar">
          <img src="/icon.svg" alt="" width="22" height="22" />
          <strong className="grow ellipsis">{t('nav.' + page)}</strong>
          {install && <IconButton icon={Download} label={t('pwa.install')} onClick={install} />}
          <ThemeSwitch compact />
          <LangSelect compact />
          <IconButton icon={LogOut} label={t('nav.logout')} onClick={logout} />
        </div>
        {banners}
        <Page />
      </main>

      <nav className="tabbar" aria-label={t('nav.menu')}>
        {PAGES.map(({ id, icon: Icon }) => (
          <button key={id} className={id === page ? 'active' : ''} onClick={() => go(id)} aria-current={id === page ? 'page' : undefined}>
            <Icon size={20} /><span>{t('nav.' + id)}</span>
          </button>
        ))}
      </nav>
    </div>
  );
}
